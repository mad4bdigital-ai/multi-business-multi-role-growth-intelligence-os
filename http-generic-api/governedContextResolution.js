import { resolveGovernedContext as resolvePathGovernedContext } from './resolvers/index.js';

function normalize(value = "") {
  return String(value ?? "").trim();
}

function lower(value = "") {
  return normalize(value).toLowerCase();
}

function bool(value) {
  if (value === true || value === false) return value;
  const normalized = lower(value);
  return normalized === "true" || normalized === "yes" || normalized === "1";
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const normalized = normalize(value);
    if (normalized) return normalized;
  }
  return "";
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function jsonObject(value, fallback = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  return value;
}

function throwContextGate(code, message, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.status = 403;
  err.details = details;
  throw err;
}

export function extractBusinessActivityContext(requestPayload = {}) {
  const body = jsonObject(requestPayload.body);
  const context = jsonObject(requestPayload.context);
  const nestedActivity = jsonObject(context.business_activity);

  const businessActivityTypeKey = firstNonEmpty(
    requestPayload.business_activity_type_key,
    requestPayload.business_activity_key,
    requestPayload.activity_type_key,
    nestedActivity.business_activity_type_key,
    nestedActivity.business_activity_key,
    body.business_activity_type_key
  );

  const businessActivityType = firstNonEmpty(
    requestPayload.business_activity_type,
    requestPayload.activity_type,
    nestedActivity.business_activity_type,
    body.business_activity_type
  );

  return {
    requested: !!(businessActivityTypeKey || businessActivityType),
    business_activity_type_key: businessActivityTypeKey,
    business_activity_type: businessActivityType,
    surface: "surface.business_activity_type_registry",
    resolution_status: businessActivityTypeKey || businessActivityType ? "declared" : "not_declared",
    authority_rule: "business_activity_type_registry_first"
  };
}

export function extractLogicContext(requestPayload = {}) {
  const body = jsonObject(requestPayload.body);
  const context = jsonObject(requestPayload.context);
  const nestedLogic = jsonObject(context.logic);

  const logicId = firstNonEmpty(
    requestPayload.logic_id,
    requestPayload.logic_key,
    requestPayload.logic_profile_key,
    nestedLogic.logic_id,
    nestedLogic.logic_key,
    body.logic_id
  );

  const functionalRole = firstNonEmpty(
    requestPayload.logic_functional_role,
    requestPayload.functional_logic_role,
    nestedLogic.functional_role,
    body.logic_functional_role
  );

  const legacyExternalId = firstNonEmpty(
    requestPayload.legacy_logic_external_id,
    requestPayload.legacy_external_id,
    nestedLogic.legacy_external_id,
    body.legacy_logic_external_id
  );

  return {
    requested: !!(logicId || functionalRole || legacyExternalId),
    logic_id: logicId,
    functional_role: functionalRole,
    legacy_external_id: legacyExternalId,
    surface: "surface.logic_canonical_pointer_registry",
    knowledge_surface: "surface.logic_knowledge_profiles",
    resolution_status: logicId || functionalRole ? "declared" : legacyExternalId ? "legacy_lineage_only" : "not_declared",
    authority_rule: "logic_pointer_first"
  };
}

export function detectLegacyLogicExecutionRequest(logicContext = {}, requestPayload = {}) {
  const candidates = [
    logicContext.logic_id,
    logicContext.legacy_external_id,
    requestPayload.logic_id,
    requestPayload.logic_key,
    requestPayload.legacy_logic_external_id
  ].map(lower);

  return candidates.some(value =>
    value.includes("gpt-logic") ||
    value.includes("gpt_logic") ||
    value.startsWith("legacy.gpt") ||
    value.startsWith("legacy_logic") ||
    value.startsWith("legacy.logic")
  );
}

export function classifyBrandRequirement({ requestPayload = {}, endpoint = {} } = {}) {
  const providerDomain = lower(endpoint.provider_domain || requestPayload.provider_domain);
  const brandResolutionSource = lower(endpoint.brand_resolution_source);
  const path = lower(endpoint.endpoint_path_or_function || requestPayload.path);
  const parentActionKey = lower(endpoint.parent_action_key || requestPayload.parent_action_key);
  const hasBrandSelector =
    !!normalize(requestPayload.target_key) ||
    !!normalize(requestPayload.brand) ||
    !!normalize(requestPayload.brand_domain);

  const brandResolvedEndpoint =
    providerDomain === "target_resolved" ||
    !!brandResolutionSource ||
    parentActionKey === "wordpress_api" ||
    path.startsWith("/wp/v2/") ||
    path.startsWith("/jet-engine/v2/");

  return {
    required: brandResolvedEndpoint || hasBrandSelector,
    reason: brandResolvedEndpoint ? "brand_resolved_endpoint" : hasBrandSelector ? "brand_selector_present" : "not_required"
  };
}

export function buildBrandContext({ requestPayload = {}, brand = null, endpoint = {} } = {}) {
  const requirement = classifyBrandRequirement({ requestPayload, endpoint });
  const requestedTargetKey = normalize(requestPayload.target_key);
  const requestedBrand = normalize(requestPayload.brand);
  const requestedBrandDomain = normalize(requestPayload.brand_domain);

  return {
    required: requirement.required,
    reason: requirement.reason,
    requested_target_key: requestedTargetKey,
    requested_brand: requestedBrand,
    requested_brand_domain: requestedBrandDomain,
    resolved: !!brand,
    target_key: normalize(brand?.target_key),
    brand_name: normalize(brand?.brand_name || brand?.normalized_brand_name),
    brand_domain: normalize(brand?.brand_domain),
    surface: "surface.brand_registry_sheet",
    brand_core_surface: "surface.brand_core_registry",
    authority_rule: "brand_registry_then_brand_core"
  };
}

export function validateBrandContext(brandContext = {}) {
  if (brandContext.required && !brandContext.resolved) {
    throwContextGate(
      "brand_target_resolution_required",
      "Brand-targeted execution requires Brand Registry target resolution before runtime execution.",
      {
        requested_target_key: brandContext.requested_target_key,
        requested_brand: brandContext.requested_brand,
        requested_brand_domain: brandContext.requested_brand_domain,
        reason: brandContext.reason
      }
    );
  }

  if (
    brandContext.resolved &&
    brandContext.requested_target_key &&
    brandContext.target_key &&
    brandContext.requested_target_key !== brandContext.target_key
  ) {
    throwContextGate(
      "brand_target_key_mismatch",
      "Requested target_key does not match the resolved Brand Registry target_key.",
      {
        requested_target_key: brandContext.requested_target_key,
        resolved_target_key: brandContext.target_key,
        brand_name: brandContext.brand_name
      }
    );
  }
}

export function validateLogicContext(logicContext = {}, requestPayload = {}) {
  if (detectLegacyLogicExecutionRequest(logicContext, requestPayload)) {
    const lineageOnly =
      bool(requestPayload.legacy_logic_lineage_lookup) ||
      bool(requestPayload.lineage_lookup_only);

    if (!lineageOnly) {
      throwContextGate(
        "legacy_logic_direct_execution_blocked",
        "Legacy Logic identifiers may be used only as lineage evidence, not as direct execution authority.",
        {
          logic_id: logicContext.logic_id,
          legacy_external_id: logicContext.legacy_external_id,
          repair_action: "resolve_current_logic_via_logic_canonical_pointer_registry"
        }
      );
    }
  }
}

export function extractPathResolutionContext(requestPayload = {}) {
  const body = jsonObject(requestPayload.body);
  const context = jsonObject(requestPayload.context);
  const nestedPathResolution = jsonObject(context.path_resolution);
  const nestedBusinessType = jsonObject(context.business_type);
  const nestedBrand = jsonObject(context.brand);

  const businessActivityTypeKey = firstNonEmpty(
    requestPayload.business_activity_type_key,
    requestPayload.business_activity_key,
    requestPayload.activity_type_key,
    body.business_activity_type_key,
    body.business_activity_key,
    body.activity_type_key,
    context.business_activity_type_key,
    context.business_activity_key,
    context.activity_type_key,
    nestedBusinessType.business_activity_type_key,
    nestedPathResolution.business_activity_type_key
  );

  const businessTypeKey = firstNonEmpty(
    requestPayload.business_type_key,
    requestPayload.business_type,
    body.business_type_key,
    body.business_type,
    context.business_type_key,
    nestedBusinessType.business_type_key,
    nestedPathResolution.business_type_key
  );

  const knowledgeProfileKey = firstNonEmpty(
    requestPayload.knowledge_profile_key,
    requestPayload.business_type_knowledge_profile_key,
    body.knowledge_profile_key,
    body.business_type_knowledge_profile_key,
    context.knowledge_profile_key,
    nestedBusinessType.knowledge_profile_key,
    nestedPathResolution.knowledge_profile_key
  );

  const brandKey = firstNonEmpty(
    requestPayload.brand_key,
    requestPayload.target_key,
    body.brand_key,
    body.target_key,
    context.brand_key,
    nestedBrand.brand_key,
    nestedPathResolution.brand_key
  );

  const targetKey = firstNonEmpty(
    requestPayload.target_key,
    body.target_key,
    context.target_key,
    nestedBrand.target_key,
    nestedPathResolution.target_key
  );

  return {
    requested: Boolean(
      businessActivityTypeKey ||
        businessTypeKey ||
        knowledgeProfileKey ||
        brandKey ||
        targetKey ||
        Object.keys(nestedPathResolution).length
    ),
    business_activity_type_key: businessActivityTypeKey,
    business_type_key: businessTypeKey,
    knowledge_profile_key: knowledgeProfileKey,
    brand_key: brandKey,
    target_key: targetKey,
    authority_rule: "business_type_path_then_brand_under_business_type"
  };
}

export function buildPathResolverRows(input = {}) {
  const requestPayload = jsonObject(input.requestPayload);
  const context = jsonObject(requestPayload.context);
  const body = jsonObject(requestPayload.body);
  const explicitRows = jsonObject(input.pathResolverRows);
  const contextRows = jsonObject(context.path_resolver_rows);
  const bodyRows = jsonObject(body.path_resolver_rows);

  const rows = {
    ...bodyRows,
    ...contextRows,
    ...explicitRows
  };

  return {
    businessActivityRows: arrayValue(rows.businessActivityRows || rows.business_activity_rows),
    profileRows: arrayValue(rows.profileRows || rows.profile_rows),
    brandRows: arrayValue(rows.brandRows || rows.brand_rows),
    brandPathRows: arrayValue(rows.brandPathRows || rows.brand_path_rows),
    brandCoreRows: arrayValue(rows.brandCoreRows || rows.brand_core_rows),
    targetRows: arrayValue(rows.targetRows || rows.target_rows),
    validationRows: arrayValue(rows.validationRows || rows.validation_rows)
  };
}

function hasPathResolverRows(rows = {}) {
  return Object.values(rows).some((value) => Array.isArray(value) && value.length > 0);
}

export function buildPathResolutionContext(input = {}) {
  const { requestPayload = {} } = input;
  const declared = extractPathResolutionContext(requestPayload);
  const rows = buildPathResolverRows(input);

  if (!declared.requested) {
    return {
      requested: false,
      attempted: false,
      resolution_status: "not_requested",
      authority_rule: declared.authority_rule
    };
  }

  if (!hasPathResolverRows(rows)) {
    return {
      requested: true,
      attempted: false,
      resolution_status: "not_attempted_missing_resolver_rows",
      business_activity_type_key: declared.business_activity_type_key,
      business_type_key: declared.business_type_key,
      knowledge_profile_key: declared.knowledge_profile_key,
      brand_key: declared.brand_key,
      target_key: declared.target_key,
      authority_rule: declared.authority_rule
    };
  }

  try {
    const resolved = resolvePathGovernedContext({
      businessActivityTypeKey: declared.business_activity_type_key,
      businessTypeKey: declared.business_type_key,
      knowledgeProfileKey: declared.knowledge_profile_key,
      brandKey: declared.brand_key,
      targetKey: declared.target_key,
      rows
    });

    return {
      requested: true,
      attempted: true,
      resolution_status: resolved.ready ? "ready" : "validating",
      authority_rule: declared.authority_rule,
      ...resolved
    };
  } catch (error) {
    return {
      requested: true,
      attempted: true,
      resolution_status: "blocked",
      authority_rule: declared.authority_rule,
      error_code: error.code || "path_resolution_failed",
      error_message: error.message,
      business_activity_type_key: declared.business_activity_type_key,
      business_type_key: declared.business_type_key,
      knowledge_profile_key: declared.knowledge_profile_key,
      brand_key: declared.brand_key,
      target_key: declared.target_key
    };
  }
}

export function validatePathResolutionContext(pathResolution = {}, requestPayload = {}) {
  if (!pathResolution.requested) return;

  const body = jsonObject(requestPayload.body);
  const mutationIntent = lower(
    firstNonEmpty(
      requestPayload.mutation_intent,
      requestPayload.intent,
      body.mutation_intent,
      body.intent
    )
  );

  const pathSensitiveMutation =
    mutationIntent.includes("create_brand") ||
    mutationIntent.includes("brand_core") ||
    mutationIntent.includes("create_business_type") ||
    mutationIntent.includes("business_type") ||
    mutationIntent.includes("drive_folder") ||
    mutationIntent.includes("folder");

  if (pathResolution.resolution_status === "blocked") {
    throwContextGate(
      "governed_path_resolution_blocked",
      "Business Type / Brand path resolution failed before runtime execution.",
      {
        error_message: pathResolution.error_message,
        business_type_key: pathResolution.business_type_key,
        brand_key: pathResolution.brand_key,
        target_key: pathResolution.target_key
      }
    );
  }

  if (
    pathSensitiveMutation &&
    pathResolution.resolution_status === "not_attempted_missing_resolver_rows"
  ) {
    throwContextGate(
      "missing_required_path_resolver_rows",
      "Path-sensitive Business Type / Brand mutations require resolver rows before runtime execution.",
      {
        business_type_key: pathResolution.business_type_key,
        brand_key: pathResolution.brand_key,
        target_key: pathResolution.target_key,
        repair_action:
          "load Business Activity, Business Type Knowledge Profiles, Brand Registry, Brand Core, JSON maps, Graph, and Validation rows"
      }
    );
  }
}

// GAP 21: Task Routes resolution — surfaces matched task route from the MySQL
// task_routes table rows loaded by the caller before context assembly.
// GAP 21: task_routes table columns are: task_key, intent_key, route_id, target_module,
// workflow_key, route_mode, trigger_terms — NOT parent_action_key/endpoint_key.
// Match on intent_key from request payload, falling back to endpoint_key as intent alias.
function buildTaskRouteContext({ requestPayload = {}, endpoint = {}, taskRouteRows = [] }) {
  const intentKey = normalize(
    requestPayload.intent_key ||
    requestPayload.task_key ||
    requestPayload.endpoint_key ||
    endpoint.endpoint_key
  );

  if (!taskRouteRows.length) {
    return {
      requested: !!intentKey,
      resolution_status: "not_loaded",
      matched_route: null,
      surface: "surface.task_routes"
    };
  }

  const matched = taskRouteRows.find(row =>
    intentKey && (normalize(row.intent_key) === intentKey || normalize(row.task_key) === intentKey)
  );

  return {
    requested: !!intentKey,
    resolution_status: matched ? "matched" : "no_match",
    matched_route: matched
      ? {
          route_id: normalize(matched.route_id),
          task_key: normalize(matched.task_key),
          intent_key: normalize(matched.intent_key),
          workflow_key: normalize(matched.workflow_key),
          target_module: normalize(matched.target_module),
          route_mode: normalize(matched.route_mode)
        }
      : null,
    surface: "surface.task_routes"
  };
}

export function buildGovernedExecutionContext(input = {}) {
  const {
    requestPayload = {},
    brand = null,
    endpoint = {},
    action = {},
    pathResolverRows = {},
    taskRouteRows = []
  } = input;

  const businessActivity = extractBusinessActivityContext(requestPayload);
  const logic = extractLogicContext(requestPayload);
  const brandContext = buildBrandContext({ requestPayload, brand, endpoint });
  const pathResolution = buildPathResolutionContext({ requestPayload, pathResolverRows });
  const taskRoute = buildTaskRouteContext({ requestPayload, endpoint, taskRouteRows });

  validateBrandContext(brandContext);
  validateLogicContext(logic, requestPayload);
  validatePathResolutionContext(pathResolution, requestPayload);

  const needsBusinessActivityBeforeKnowledge =
    businessActivity.requested ||
    logic.requested ||
    brandContext.required ||
    lower(endpoint.category_group).includes("cms") ||
    lower(endpoint.category_group).includes("content");

  return {
    ok: true,
    resolution_order: [
      "registry_surface_resolver",
      "business_activity_type_registry",
      "business_type_path_resolver",
      "brand_under_business_type_path_resolver",
      "brand_registry_and_brand_core",
      "logic_canonical_pointer_registry",
      "logic_knowledge_profiles",
      "task_routes",
      "workflow_registry",
      "actions_and_endpoint_registry"
    ],
    business_activity: {
      ...businessActivity,
      required_before_business_type_knowledge: needsBusinessActivityBeforeKnowledge
    },
    brand: brandContext,
    path_resolution: pathResolution,
    task_route: taskRoute,
    logic,
    knowledge_surfaces: {
      requested: false,
      resolved: false,
      surfaces: [],
      reason: "pending"
    },
    action: {
      parent_action_key: normalize(action.action_key || endpoint.parent_action_key),
      endpoint_key: normalize(endpoint.endpoint_key),
      endpoint_role: normalize(endpoint.endpoint_role),
      execution_mode: normalize(endpoint.execution_mode)
    },
    gates: {
      legacy_logic_direct_execution_blocked: true,
      brand_core_required_for_brand_outputs: brandContext.required,
      business_activity_type_first: true,
      business_type_path_resolution_required_for_business_type_mutations: true,
      brand_path_resolution_required_for_brand_folder_mutations: true,
      current_execution_authority_only: true
    }
  };
}
