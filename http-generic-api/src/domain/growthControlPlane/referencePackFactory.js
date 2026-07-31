const KEY_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
}

function assertCanonicalKey(value, field) {
  if (typeof value !== "string" || !KEY_PATTERN.test(value)) {
    throw new TypeError(`${field} must be a canonical key`);
  }
}

function uniqueStrings(values, field) {
  if (!Array.isArray(values)) {
    throw new TypeError(`${field} must be an array`);
  }

  const result = [];
  const seen = new Set();
  for (const value of values) {
    assertCanonicalKey(value, `${field}[]`);
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

function capabilityKeys(prefix) {
  return {
    intentMap: `${prefix}_intent_map_generate`,
    contentBrief: `${prefix}_content_brief_generate`,
    analysis: `${prefix}_analysis_generate`,
    brandPlan: `${prefix}_brand_plan_generate`
  };
}

function nodesForWorkflow(workflowKey, capabilities) {
  switch (workflowKey) {
    case "content_generation_workflow":
      return [
        { id: "intent_map", capability: capabilities.intentMap, mode: "internal_draft" },
        { id: "content_brief", capability: capabilities.contentBrief, depends_on: ["intent_map"], mode: "internal_draft" }
      ];
    case "destination_analysis_workflow":
      return [
        { id: "destination_analysis", capability: capabilities.analysis, mode: "internal_draft" }
      ];
    case "seo_strategy_workflow":
      return [
        { id: "search_intent_map", capability: capabilities.intentMap, mode: "internal_draft" },
        { id: "seo_analysis", capability: capabilities.analysis, depends_on: ["search_intent_map"], mode: "internal_draft" }
      ];
    case "brand_marketing_workflow":
      return [
        { id: "brand_plan", capability: capabilities.brandPlan, mode: "internal_draft" }
      ];
    case "growth_strategy_workflow":
      return [
        { id: "growth_analysis", capability: capabilities.analysis, mode: "internal_draft" },
        { id: "growth_plan", capability: capabilities.brandPlan, depends_on: ["growth_analysis"], mode: "internal_draft" }
      ];
    default:
      return [
        { id: "reference_analysis", capability: capabilities.analysis, mode: "internal_draft" }
      ];
  }
}

function baselineEntitySchemas() {
  return {
    referenceEntity: {
      type: "object",
      additionalProperties: false,
      required: ["entityKey", "name"],
      properties: {
        entityKey: { type: "string", minLength: 3 },
        name: { type: "string", minLength: 2 },
        category: { type: "string", minLength: 2 },
        attributes: { type: "array", uniqueItems: true, items: { type: "string", minLength: 2 } }
      }
    },
    audienceIntent: {
      type: "object",
      additionalProperties: false,
      required: ["intentKey", "stage"],
      properties: {
        intentKey: { type: "string", minLength: 3 },
        stage: { type: "string", enum: ["discover", "compare", "evaluate", "convert", "retain"] },
        locale: { type: "string", minLength: 2 }
      }
    },
    contentBrief: {
      type: "object",
      additionalProperties: false,
      required: ["briefKey", "primaryIntent"],
      properties: {
        briefKey: { type: "string", minLength: 3 },
        primaryIntent: { type: "string", minLength: 3 },
        supportingTopics: { type: "array", uniqueItems: true, items: { type: "string", minLength: 2 } }
      }
    }
  };
}

function validateCatalogEntry(entry, index) {
  assertObject(entry, `profiles[${index}]`);
  assertCanonicalKey(entry.businessTypeKey, `profiles[${index}].businessTypeKey`);
  assertCanonicalKey(entry.knowledgeProfileKey, `profiles[${index}].knowledgeProfileKey`);
  assertCanonicalKey(entry.activityPackKey, `profiles[${index}].activityPackKey`);

  if (!Number.isInteger(entry.version) || entry.version < 1) {
    throw new TypeError(`profiles[${index}].version must be a positive integer`);
  }
  if (!["baseline", "specialized"].includes(entry.referenceMode)) {
    throw new TypeError(`profiles[${index}].referenceMode must be baseline or specialized`);
  }

  uniqueStrings(entry.engineCategories, `profiles[${index}].engineCategories`);
  uniqueStrings(entry.routeKeys, `profiles[${index}].routeKeys`);
  uniqueStrings(entry.workflowKeys, `profiles[${index}].workflowKeys`);
}

export function validateReferencePackCatalog(catalog) {
  assertObject(catalog, "catalog");
  if (catalog.schemaVersion !== 1) {
    throw new TypeError("catalog.schemaVersion must equal 1");
  }
  if (!Array.isArray(catalog.profiles) || catalog.profiles.length === 0) {
    throw new TypeError("catalog.profiles must be a non-empty array");
  }

  const businessTypes = new Set();
  const profileKeys = new Set();
  const activityPackKeys = new Set();

  catalog.profiles.forEach((entry, index) => {
    validateCatalogEntry(entry, index);
    for (const [set, value, field] of [
      [businessTypes, entry.businessTypeKey, "businessTypeKey"],
      [profileKeys, entry.knowledgeProfileKey, "knowledgeProfileKey"],
      [activityPackKeys, entry.activityPackKey, "activityPackKey"]
    ]) {
      if (set.has(value)) {
        throw new TypeError(`duplicate ${field}: ${value}`);
      }
      set.add(value);
    }
  });

  return clone(catalog);
}

export function createBaselineReferencePack(entry) {
  validateCatalogEntry(entry, 0);
  if (entry.referenceMode !== "baseline") {
    throw new TypeError("createBaselineReferencePack requires referenceMode=baseline");
  }

  const prefix = entry.businessTypeKey;
  const capabilities = capabilityKeys(prefix);
  const capabilityList = Object.values(capabilities);
  const workflowKeys = uniqueStrings(entry.workflowKeys, "entry.workflowKeys");
  const workflows = workflowKeys.map((workflowKey) => ({
    workflowKey,
    version: 1,
    nodes: nodesForWorkflow(workflowKey, capabilities)
  }));

  return {
    identity: { activityPackKey: entry.activityPackKey, version: entry.version },
    entitySchemas: baselineEntitySchemas(),
    knowledgeProfile: { pointerKey: entry.knowledgeProfileKey },
    kpiTaxonomy: ["qualified_lead_rate", "organic_visibility", "content_engagement", "content_assisted_conversion"],
    capabilities: capabilityList.map((capabilityKey) => ({ capabilityKey, version: 1 })),
    workflows,
    policies: [
      {
        policyKey: `${prefix}_internal_draft_policy`,
        capabilities: capabilityList,
        workflows: workflowKeys
      }
    ],
    providerCompatibility: [],
    tests: {
      fixtures: [`${prefix}-reference-v1`],
      compatibilityDeclarations: []
    }
  };
}

export function createReferencePackCatalog(catalog, options = {}) {
  const validatedCatalog = validateReferencePackCatalog(catalog);
  const specializedManifests = options.specializedManifests ?? {};
  assertObject(specializedManifests, "options.specializedManifests");

  return validatedCatalog.profiles.map((entry) => {
    if (entry.referenceMode === "baseline") {
      return { catalogEntry: entry, manifest: createBaselineReferencePack(entry) };
    }

    const specializedManifest = specializedManifests[entry.knowledgeProfileKey];
    assertObject(specializedManifest, `specializedManifests.${entry.knowledgeProfileKey}`);

    if (specializedManifest.identity?.activityPackKey !== entry.activityPackKey) {
      throw new TypeError(`specialized manifest activityPackKey mismatch for ${entry.knowledgeProfileKey}`);
    }
    if (specializedManifest.knowledgeProfile?.pointerKey !== entry.knowledgeProfileKey) {
      throw new TypeError(`specialized manifest knowledge profile mismatch for ${entry.knowledgeProfileKey}`);
    }

    return { catalogEntry: entry, manifest: clone(specializedManifest) };
  });
}
