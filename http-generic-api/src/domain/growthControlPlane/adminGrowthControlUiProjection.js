import {
  GrowthControlPlaneError,
  assertNoSecretFields,
  stableSerialize,
  stableSha256,
  validateSchemaDefinition,
} from "./growthControlPlane.js";

const MAX_FORM_FIELDS = 300;
const MAX_DIFF_ENTRIES = 500;
const SUPPORTED_TYPES = new Set(["string", "boolean", "integer", "number", "array", "object"]);
const FORMAT_COMPONENTS = Object.freeze({
  date: "date",
  "date-time": "datetime",
  email: "email",
  uri: "url",
});

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizedType(schema = {}) {
  const declared = Array.isArray(schema.type) ? schema.type.map(String) : schema.type ? [String(schema.type)] : [];
  const nonNull = declared.filter((value) => value !== "null");
  if (nonNull.length > 1) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_UI_SCHEMA_UNION_UNSUPPORTED",
      "Admin form projection supports one non-null field type.",
      422,
    );
  }
  const inferred = nonNull[0]
    || (plainObject(schema.properties) ? "object" : null)
    || (Array.isArray(schema.enum) && schema.enum.length ? typeof schema.enum[0] : null)
    || (Object.hasOwn(schema, "const") ? typeof schema.const : null)
    || "string";
  if (!SUPPORTED_TYPES.has(inferred)) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_UI_FIELD_TYPE_UNSUPPORTED",
      `Unsupported Admin form field type: ${inferred}.`,
      422,
    );
  }
  return Object.freeze({ type: inferred, nullable: declared.includes("null") });
}

function valueAtPath(root, path) {
  let current = root;
  for (const segment of path) {
    if (!plainObject(current) || !Object.hasOwn(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

function constraintsFor(schema = {}) {
  const allowed = [
    "minLength", "maxLength", "minimum", "maximum", "pattern", "format",
    "minItems", "maxItems", "uniqueItems", "additionalProperties",
  ];
  const constraints = {};
  for (const key of allowed) {
    if (Object.hasOwn(schema, key)) constraints[key] = schema[key];
  }
  return Object.freeze(constraints);
}

function itemDescriptor(schema = {}) {
  if (!schema.items) return null;
  const normalized = normalizedType(schema.items);
  const descriptor = {
    type: normalized.type,
    nullable: normalized.nullable,
  };
  if (Array.isArray(schema.items.enum)) descriptor.options = [...schema.items.enum];
  if (schema.items.title) descriptor.title = String(schema.items.title);
  return Object.freeze(descriptor);
}

function componentFor(schema, type) {
  if (Object.hasOwn(schema, "const")) return "constant";
  if (Array.isArray(schema.enum)) return "select";
  if (type === "boolean") return "checkbox";
  if (type === "integer" || type === "number") return "number";
  if (type === "array") return "list";
  if (type === "object") return plainObject(schema.properties) ? "group" : "json";
  return FORMAT_COMPONENTS[schema.format] || "text";
}

function buildFields({ configKey, schemaVersion, schema, defaults, path = [], required = false, fields = [] }) {
  const normalized = normalizedType(schema);
  const pathText = path.join(".");
  const component = componentFor(schema, normalized.type);
  const hasChildren = normalized.type === "object" && plainObject(schema.properties);

  if (path.length) {
    const field = {
      fieldId: stableSha256({ configKey, schemaVersion, path: pathText }).slice(0, 20),
      path: pathText,
      label: String(schema.title || path[path.length - 1]),
      description: schema.description ? String(schema.description) : null,
      component,
      valueType: normalized.type,
      nullable: normalized.nullable,
      required: Boolean(required),
      readOnly: component === "constant",
      constraints: constraintsFor(schema),
      defaultValue: valueAtPath(defaults, path),
      options: Array.isArray(schema.enum) ? [...schema.enum] : null,
      constantValue: Object.hasOwn(schema, "const") ? schema.const : null,
      item: normalized.type === "array" ? itemDescriptor(schema) : null,
      secretsIncluded: false,
    };
    fields.push(Object.freeze(field));
    if (fields.length > MAX_FORM_FIELDS) {
      throw new GrowthControlPlaneError(
        "GROWTH_CONTROL_UI_FIELD_LIMIT_EXCEEDED",
        `Admin form projection is limited to ${MAX_FORM_FIELDS} fields.`,
        422,
      );
    }
  }

  if (hasChildren) {
    const requiredChildren = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
    for (const key of Object.keys(schema.properties).sort()) {
      buildFields({
        configKey,
        schemaVersion,
        schema: schema.properties[key],
        defaults,
        path: [...path, key],
        required: requiredChildren.has(key),
        fields,
      });
    }
  }
  return fields;
}

export function buildAdminConfigurationFormManifest(definition = {}) {
  validateSchemaDefinition(definition.schema);
  assertNoSecretFields({ schema: definition.schema, defaultValues: definition.defaultValues });
  const fields = buildFields({
    configKey: definition.configKey,
    schemaVersion: definition.schemaVersion,
    schema: definition.schema,
    defaults: definition.defaultValues || {},
  });
  return Object.freeze({
    contract: "mad4b.growth-control.admin-form.v1",
    manifestVersion: 1,
    configKey: definition.configKey,
    title: String(definition.schema?.title || definition.configKey),
    description: definition.schema?.description ? String(definition.schema.description) : null,
    definitionRevision: Number(definition.revision),
    schemaVersion: Number(definition.schemaVersion),
    definitionChecksumSha256: definition.checksumSha256,
    allowedScopes: Object.freeze([...(definition.allowedScopes || [])]),
    securityClassification: definition.securityClassification,
    fields: Object.freeze(fields),
    readOnlyProjection: true,
    backendValidationRequired: true,
    secretsIncluded: false,
  });
}

function diffValues(before, after, path = "$", entries = []) {
  if (stableSerialize(before) === stableSerialize(after)) return entries;
  const beforeObject = plainObject(before);
  const afterObject = plainObject(after);
  if (beforeObject && afterObject) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    for (const key of keys) {
      const beforeExists = Object.hasOwn(before, key);
      const afterExists = Object.hasOwn(after, key);
      const nextPath = path === "$" ? `$.${key}` : `${path}.${key}`;
      if (!beforeExists || !afterExists) {
        entries.push(Object.freeze({
          path: nextPath,
          changeType: beforeExists ? "removed" : "added",
          before: beforeExists ? before[key] : null,
          after: afterExists ? after[key] : null,
        }));
      } else {
        diffValues(before[key], after[key], nextPath, entries);
      }
      if (entries.length > MAX_DIFF_ENTRIES) {
        throw new GrowthControlPlaneError(
          "GROWTH_CONTROL_UI_DIFF_LIMIT_EXCEEDED",
          `Admin configuration diff is limited to ${MAX_DIFF_ENTRIES} entries.`,
          422,
        );
      }
    }
    return entries;
  }
  entries.push(Object.freeze({ path, changeType: "changed", before, after }));
  return entries;
}

function projectVersionLineage(version) {
  return Object.freeze({
    configVersionId: version.configVersionId,
    configKey: version.configKey,
    versionNumber: Number(version.versionNumber),
    scopeType: version.scopeType,
    scopeKey: version.scopeKey,
    tenantId: version.tenantId || null,
    workspaceId: version.workspaceId || null,
    brandKey: version.brandKey || null,
    activityTypeKey: version.activityTypeKey || null,
    activityBindingId: version.activityBindingId || null,
    profileKey: version.profileKey || null,
    workflowKey: version.workflowKey || null,
    workflowVersion: version.workflowVersion == null ? null : Number(version.workflowVersion),
    workflowNodeId: version.workflowNodeId || null,
    planId: version.planId || null,
    executionId: version.executionId || null,
    lifecycle: version.lifecycle,
    revision: Number(version.versionRevision),
    checksumSha256: version.checksumSha256,
    createdAt: version.createdAt || null,
    secretsIncluded: false,
  });
}

export function buildAdminConfigurationUiProjection({ definition, baseVersion = null, compareVersion = null } = {}) {
  if (!definition) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_CONFIG_NOT_FOUND",
      "Configuration definition was not found.",
      404,
    );
  }
  if (Boolean(baseVersion) !== Boolean(compareVersion)) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_UI_COMPARISON_PAIR_REQUIRED",
      "baseVersionId and compareVersionId must be provided together.",
      400,
    );
  }
  const form = buildAdminConfigurationFormManifest(definition);
  let comparison = null;
  if (baseVersion && compareVersion) {
    for (const version of [baseVersion, compareVersion]) {
      if (version.configKey !== definition.configKey) {
        throw new GrowthControlPlaneError(
          "GROWTH_CONTROL_CONFIG_VERSION_NOT_FOUND",
          "A comparison version does not belong to the requested configuration.",
          404,
        );
      }
      assertNoSecretFields(version.values);
    }
    const changes = Object.freeze(diffValues(baseVersion.values, compareVersion.values));
    comparison = Object.freeze({
      contract: "mad4b.growth-control.admin-diff.v1",
      base: projectVersionLineage(baseVersion),
      compare: projectVersionLineage(compareVersion),
      changes,
      changed: changes.length > 0,
      diffSha256: stableSha256({
        baseChecksumSha256: baseVersion.checksumSha256,
        compareChecksumSha256: compareVersion.checksumSha256,
        changes,
      }),
      secretsIncluded: false,
    });
  }
  return Object.freeze({
    definition: Object.freeze({
      configKey: definition.configKey,
      status: definition.status,
      revision: Number(definition.revision),
      schemaVersion: Number(definition.schemaVersion),
      checksumSha256: definition.checksumSha256,
      updatedAt: definition.updatedAt || null,
    }),
    form,
    comparison,
    adminFacing: true,
    metadataOnly: false,
    readOnly: true,
    providerCalls: false,
    externalWrites: false,
    secretsIncluded: false,
  });
}

export const _testingAdminGrowthControlUiProjection = Object.freeze({
  normalizedType,
  constraintsFor,
  itemDescriptor,
  componentFor,
  diffValues,
  projectVersionLineage,
});
