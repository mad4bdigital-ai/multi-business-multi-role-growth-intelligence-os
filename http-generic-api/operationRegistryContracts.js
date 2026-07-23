import { createHash } from "node:crypto";

const OPERATION_CLASSES = new Set(["read", "mutation", "repository", "repository_mutation", "workflow", "provider", "provider_mutation", "internal", "other"]);
const SCOPE_TYPES = new Set(["admin", "tenant", "user", "workspace", "internal"]);
const RISK_LEVELS = new Set(["low", "medium", "high", "critical"]);
const EXECUTION_MODES = new Set(["synchronous", "asynchronous", "hybrid"]);
const STATUSES = new Set(["draft", "shadow", "active", "degraded", "disabled", "archived"]);
const MUTABLE_STATUSES = new Set(["draft", "shadow"]);
const SCHEMA_TYPES = new Set(["object", "array", "string", "number", "integer", "boolean", "null"]);
const CONTRACT_FIELDS = new Set(["operation_key", "version", "display_name", "description", "operation_class", "scope_type", "risk_level", "execution_mode", "input_schema_json", "output_schema_json", "status", "source_revision_hash", "compiler_version", "metadata_json", "created_by", "steps"]);
const STEP_FIELDS = new Set(["step_key", "step_order", "depends_on", "handler_key", "capability_key", "input_mapping_json", "success_condition_json", "retry_policy_json", "failure_policy_json", "timeout_seconds", "compensation_required", "compensation_policy_key", "status", "metadata_json"]);
const SCHEMA_FIELDS = new Set(["type", "description", "properties", "required", "additionalProperties", "items", "enum", "const", "format", "pattern", "minLength", "maxLength", "minimum", "maximum", "minItems", "maxItems", "nullable", "default", "examples"]);
const SECRET_KEY = /(?:password|passphrase|secret|access[_-]?token|refresh[_-]?token|private[_-]?key|credential|authorization|cookie)/i;
const TRANSPORT_KEYS = new Set(["provider_url", "endpoint_url", "base_url", "http_method", "request_headers", "auth_header"]);

export class OperationRegistryContractError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = "OperationRegistryContractError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function fail(code, message, status = 400, details = {}) {
  throw new OperationRegistryContractError(code, message, status, details);
}

function isObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function object(value, field) {
  if (!isObject(value)) fail("operation_registry_invalid_object", `${field} must be a JSON object.`, 400, { field });
  return value;
}

function allowedKeys(value, allowed, field) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail("operation_registry_unknown_field", `${field}.${key} is not supported.`, 400, { field: `${field}.${key}` });
  }
}

function text(value, field, { min = 1, max = 191, pattern = null, optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === "")) return null;
  const normalized = String(value ?? "").trim();
  if (normalized.length < min || normalized.length > max || (pattern && !pattern.test(normalized))) {
    fail("operation_registry_invalid_string", `${field} is invalid.`, 400, { field, min, max });
  }
  return normalized;
}

function integer(value, field, { min = 1, max = 2147483647 } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    fail("operation_registry_invalid_integer", `${field} must be an integer between ${min} and ${max}.`, 400, { field });
  }
  return number;
}

function enumValue(value, field, allowed) {
  const normalized = text(value, field, { max: 64 }).toLowerCase();
  if (!allowed.has(normalized)) fail("operation_registry_invalid_enum", `${field} contains an unsupported value.`, 400, { field, value: normalized });
  return normalized;
}

function optionalHash(value, field) {
  if (value === undefined || value === null || value === "") return null;
  const normalized = text(value, field, { min: 64, max: 64 }).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) fail("operation_registry_invalid_hash", `${field} must be a lowercase SHA-256 hash.`, 400, { field });
  return normalized;
}

function rejectKey(key, field) {
  if (SECRET_KEY.test(key)) fail("operation_registry_secret_field_forbidden", `${field} contains a secret-bearing field name.`, 400, { field });
  if (TRANSPORT_KEYS.has(key.toLowerCase())) fail("operation_registry_transport_authority_forbidden", `${field} duplicates provider transport authority.`, 400, { field });
}

function jsonValue(value, field, depth = 0) {
  if (depth > 20) fail("operation_registry_json_depth_exceeded", `${field} exceeds the maximum JSON depth.`, 400, { field });
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item, index) => jsonValue(item, `${field}[${index}]`, depth + 1));
  if (isObject(value)) {
    return Object.keys(value).sort().reduce((result, key) => {
      if (key === "secrets_included") {
        if (value[key] !== false) fail("operation_registry_secrets_marker_invalid", `${field}.secrets_included must be false.`, 400, { field });
        result[key] = false;
        return result;
      }
      rejectKey(key, `${field}.${key}`);
      result[key] = jsonValue(value[key], `${field}.${key}`, depth + 1);
      return result;
    }, {});
  }
  fail("operation_registry_non_json_value", `${field} must contain JSON-safe values only.`, 400, { field });
}

function schemaNode(input, field, { root = false, depth = 0 } = {}) {
  if (depth > 12) fail("operation_registry_schema_depth_exceeded", `${field} exceeds the maximum schema depth.`, 400, { field });
  const schema = object(input, field);
  allowedKeys(schema, SCHEMA_FIELDS, field);
  const result = {};
  if (schema.type !== undefined) {
    result.type = text(schema.type, `${field}.type`, { max: 32 }).toLowerCase();
    if (!SCHEMA_TYPES.has(result.type)) fail("operation_registry_schema_type_invalid", `${field}.type is unsupported.`, 400, { field });
  }
  if (root && result.type !== "object") fail("operation_registry_root_schema_object_required", `${field}.type must be object.`, 400, { field });
  if (schema.description !== undefined) result.description = text(schema.description, `${field}.description`, { max: 1000 });
  if (schema.format !== undefined) result.format = text(schema.format, `${field}.format`, { max: 64 });
  if (schema.pattern !== undefined) result.pattern = text(schema.pattern, `${field}.pattern`, { max: 500 });
  for (const key of ["minLength", "maxLength", "minItems", "maxItems"]) {
    if (schema[key] !== undefined) result[key] = integer(schema[key], `${field}.${key}`, { min: 0, max: 100000 });
  }
  for (const key of ["minimum", "maximum"]) {
    if (schema[key] !== undefined) {
      const number = Number(schema[key]);
      if (!Number.isFinite(number)) fail("operation_registry_schema_number_invalid", `${field}.${key} must be finite.`, 400, { field });
      result[key] = number;
    }
  }
  if (result.minLength !== undefined && result.maxLength !== undefined && result.minLength > result.maxLength) fail("operation_registry_schema_range_invalid", `${field} has an invalid length range.`, 400, { field });
  if (result.minItems !== undefined && result.maxItems !== undefined && result.minItems > result.maxItems) fail("operation_registry_schema_range_invalid", `${field} has an invalid item range.`, 400, { field });
  if (result.minimum !== undefined && result.maximum !== undefined && result.minimum > result.maximum) fail("operation_registry_schema_range_invalid", `${field} has an invalid numeric range.`, 400, { field });
  if (schema.enum !== undefined) {
    if (!Array.isArray(schema.enum) || schema.enum.length === 0 || schema.enum.length > 100) fail("operation_registry_schema_enum_invalid", `${field}.enum must contain 1-100 values.`, 400, { field });
    result.enum = jsonValue(schema.enum, `${field}.enum`);
  }
  if (schema.const !== undefined) result.const = jsonValue(schema.const, `${field}.const`);
  if (schema.default !== undefined) result.default = jsonValue(schema.default, `${field}.default`);
  if (schema.examples !== undefined) result.examples = jsonValue(schema.examples, `${field}.examples`);
  if (schema.nullable !== undefined) {
    if (typeof schema.nullable !== "boolean") fail("operation_registry_schema_nullable_invalid", `${field}.nullable must be boolean.`, 400, { field });
    result.nullable = schema.nullable;
  }
  if (schema.properties !== undefined || result.type === "object") {
    const properties = object(schema.properties || {}, `${field}.properties`);
    result.properties = {};
    for (const key of Object.keys(properties).sort()) {
      rejectKey(key, `${field}.properties.${key}`);
      result.properties[key] = schemaNode(properties[key], `${field}.properties.${key}`, { depth: depth + 1 });
    }
    if (schema.additionalProperties !== false) fail("operation_registry_schema_additional_properties_forbidden", `${field}.additionalProperties must be false.`, 400, { field });
    result.additionalProperties = false;
    const required = schema.required === undefined ? [] : schema.required;
    if (!Array.isArray(required)) fail("operation_registry_schema_required_invalid", `${field}.required must be an array.`, 400, { field });
    result.required = required.map((item, index) => text(item, `${field}.required[${index}]`)).sort();
    if (new Set(result.required).size !== result.required.length) fail("operation_registry_schema_required_duplicate", `${field}.required contains duplicates.`, 400, { field });
    for (const key of result.required) if (!(key in result.properties)) fail("operation_registry_schema_required_unknown", `${field}.required references an unknown property.`, 400, { field, property: key });
  }
  if (schema.items !== undefined || result.type === "array") {
    if (schema.items === undefined) fail("operation_registry_schema_items_required", `${field}.items is required for array schemas.`, 400, { field });
    result.items = schemaNode(schema.items, `${field}.items`, { depth: depth + 1 });
  }
  return result;
}

function step(input, index) {
  const field = `steps[${index}]`;
  const value = object(input, field);
  allowedKeys(value, STEP_FIELDS, field);
  const compensationRequired = Boolean(value.compensation_required);
  const normalized = {
    step_key: text(value.step_key, `${field}.step_key`, { min: 2, pattern: /^[a-z0-9][a-z0-9._-]+$/ }),
    step_order: integer(value.step_order, `${field}.step_order`, { max: 10000 }),
    depends_on: Array.isArray(value.depends_on) ? value.depends_on.map((item, dependencyIndex) => text(item, `${field}.depends_on[${dependencyIndex}]`, { min: 2, pattern: /^[a-z0-9][a-z0-9._-]+$/ })) : [],
    handler_key: text(value.handler_key, `${field}.handler_key`, { min: 2, pattern: /^[a-z0-9][a-z0-9._-]+$/ }),
    capability_key: text(value.capability_key, `${field}.capability_key`, { min: 2, pattern: /^[a-z0-9][a-z0-9._-]+$/, optional: true }),
    input_mapping_json: value.input_mapping_json === undefined ? null : jsonValue(value.input_mapping_json, `${field}.input_mapping_json`),
    success_condition_json: value.success_condition_json === undefined ? null : jsonValue(value.success_condition_json, `${field}.success_condition_json`),
    retry_policy_json: value.retry_policy_json === undefined ? null : jsonValue(value.retry_policy_json, `${field}.retry_policy_json`),
    failure_policy_json: value.failure_policy_json === undefined ? null : jsonValue(value.failure_policy_json, `${field}.failure_policy_json`),
    timeout_seconds: value.timeout_seconds === undefined || value.timeout_seconds === null ? null : integer(value.timeout_seconds, `${field}.timeout_seconds`, { max: 86400 }),
    compensation_required: compensationRequired,
    compensation_policy_key: text(value.compensation_policy_key, `${field}.compensation_policy_key`, { min: 2, pattern: /^[a-z0-9][a-z0-9._-]+$/, optional: true }),
    status: enumValue(value.status || "draft", `${field}.status`, STATUSES),
    metadata_json: value.metadata_json === undefined || value.metadata_json === null ? null : jsonValue(value.metadata_json, `${field}.metadata_json`),
  };
  if (new Set(normalized.depends_on).size !== normalized.depends_on.length) fail("operation_registry_duplicate_dependency", `${field}.depends_on contains duplicates.`, 400, { field });
  if (compensationRequired && !normalized.compensation_policy_key) fail("operation_registry_compensation_policy_required", `${field}.compensation_policy_key is required.`, 400, { field });
  return normalized;
}

function checkGraph(steps) {
  const byKey = new Map(steps.map((item) => [item.step_key, item]));
  for (const item of steps) {
    for (const dependency of item.depends_on) {
      if (!byKey.has(dependency)) fail("operation_registry_unknown_dependency", `${item.step_key} depends on an unknown step.`, 400, { step_key: item.step_key, dependency });
      if (dependency === item.step_key) fail("operation_registry_self_dependency", `${item.step_key} cannot depend on itself.`, 400, { step_key: item.step_key });
    }
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = (key) => {
    if (visited.has(key)) return;
    if (visiting.has(key)) fail("operation_registry_dependency_cycle", "Operation steps contain a dependency cycle.", 400, { step_key: key });
    visiting.add(key);
    for (const dependency of byKey.get(key).depends_on) visit(dependency);
    visiting.delete(key);
    visited.add(key);
  };
  for (const item of steps) visit(item.step_key);
}

export function canonicalizeOperationValue(value, field = "$") {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item, index) => canonicalizeOperationValue(item, `${field}[${index}]`));
  if (isObject(value)) return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonicalizeOperationValue(value[key], `${field}.${key}`);
    return result;
  }, {});
  fail("operation_registry_non_canonical_value", `${field} cannot be canonicalized.`, 400, { field });
}

export function stableOperationHash(value) {
  return createHash("sha256").update(JSON.stringify(canonicalizeOperationValue(value))).digest("hex");
}

export function normalizeOperationDefinition(input, { mutableOnly = false } = {}) {
  const operation = object(input, "operation");
  allowedKeys(operation, CONTRACT_FIELDS, "operation");
  const status = enumValue(operation.status || "draft", "operation.status", STATUSES);
  if (mutableOnly && !MUTABLE_STATUSES.has(status)) fail("operation_registry_mutable_status_required", "Repository writes may create or replace draft/shadow versions only.", 409, { status });
  if (!Array.isArray(operation.steps) || operation.steps.length === 0 || operation.steps.length > 200) fail("operation_registry_steps_invalid", "operation.steps must contain 1-200 steps.", 400, { field: "operation.steps" });
  const steps = operation.steps.map(step);
  if (new Set(steps.map((item) => item.step_key)).size !== steps.length) fail("operation_registry_duplicate_step_key", "operation.steps contains duplicate step keys.", 400);
  if (new Set(steps.map((item) => item.step_order)).size !== steps.length) fail("operation_registry_duplicate_step_order", "operation.steps contains duplicate step orders.", 400);
  checkGraph(steps);
  return {
    operation_key: text(operation.operation_key, "operation.operation_key", { min: 3, pattern: /^[a-z0-9][a-z0-9._-]+$/ }),
    version: integer(operation.version, "operation.version"),
    display_name: text(operation.display_name, "operation.display_name"),
    description: text(operation.description, "operation.description", { max: 4000, optional: true }),
    operation_class: enumValue(operation.operation_class, "operation.operation_class", OPERATION_CLASSES),
    scope_type: enumValue(operation.scope_type, "operation.scope_type", SCOPE_TYPES),
    risk_level: enumValue(operation.risk_level, "operation.risk_level", RISK_LEVELS),
    execution_mode: enumValue(operation.execution_mode, "operation.execution_mode", EXECUTION_MODES),
    input_schema_json: schemaNode(operation.input_schema_json, "operation.input_schema_json", { root: true }),
    output_schema_json: schemaNode(operation.output_schema_json, "operation.output_schema_json", { root: true }),
    status,
    source_revision_hash: optionalHash(operation.source_revision_hash, "operation.source_revision_hash"),
    compiler_version: text(operation.compiler_version, "operation.compiler_version", { max: 64, optional: true }),
    metadata_json: operation.metadata_json === undefined || operation.metadata_json === null ? null : jsonValue(operation.metadata_json, "operation.metadata_json"),
    created_by: text(operation.created_by, "operation.created_by"),
    steps: [...steps].sort((left, right) => left.step_order - right.step_order || left.step_key.localeCompare(right.step_key)),
  };
}

export function operationRevisionDocument(definition) {
  const normalized = normalizeOperationDefinition(definition);
  return {
    operation_key: normalized.operation_key,
    version: normalized.version,
    display_name: normalized.display_name,
    description: normalized.description,
    operation_class: normalized.operation_class,
    scope_type: normalized.scope_type,
    risk_level: normalized.risk_level,
    execution_mode: normalized.execution_mode,
    input_schema_json: normalized.input_schema_json,
    output_schema_json: normalized.output_schema_json,
    metadata_json: normalized.metadata_json,
    steps: normalized.steps.map(({ status, ...item }) => item),
  };
}

export function operationRevisionHash(definition) {
  return stableOperationHash(operationRevisionDocument(definition));
}

export function requireOperationRevisionHash(value, field = "expected_revision_hash") {
  const hash = optionalHash(value, field);
  if (!hash) fail("operation_registry_revision_required", `${field} is required.`, 400, { field });
  return hash;
}

export function isMutableOperationStatus(status) {
  return MUTABLE_STATUSES.has(String(status || "").toLowerCase());
}
