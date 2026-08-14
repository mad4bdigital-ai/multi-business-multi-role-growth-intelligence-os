import { createHash } from "node:crypto";

export const PLATFORM_CONFIGURATION_RESOLVER_VERSION = "platform-configuration-resolver.v1";

const SCOPE_PRECEDENCE = Object.freeze({
  platform: 100,
  environment: 150,
  tenant: 200,
  workspace: 300,
  brand: 400,
  app: 500,
  repository: 600,
  role: 700,
  route: 800,
  resource: 900,
});

const OPERATORS = new Set([
  "priority_replace",
  "deny_wins",
  "strict_intersection",
  "minimum",
  "maximum",
  "guarded_union",
  "append_unique",
  "block_on_ambiguity",
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function canonical(value) {
  return JSON.stringify(stable(value));
}

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function text(value, max = 191) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeScopeRef(value) {
  return text(value).toLowerCase().replace(/^https?:\/\//u, "").replace(/\/+$/u, "");
}

function contextHash(context = {}) {
  return sha256(canonical(Object.fromEntries(Object.entries(context).sort().map(([key, value]) => [key, text(value, 255) || null]))));
}

function pathValue(value, path) {
  if (!path) return { found: true, value };
  let current = value;
  for (const segment of String(path).split(".").filter(Boolean)) {
    if (!isObject(current) || !Object.hasOwn(current, segment)) return { found: false, value: undefined };
    current = current[segment];
  }
  return { found: true, value: current };
}

function setPath(target, path, value) {
  const segments = String(path).split(".").filter(Boolean);
  if (!segments.length) return value;
  const output = isObject(target) ? { ...target } : {};
  let cursor = output;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    cursor[segment] = isObject(cursor[segment]) ? { ...cursor[segment] } : {};
    cursor = cursor[segment];
  }
  cursor[segments.at(-1)] = value;
  return output;
}

function flatten(value, prefix = "", output = {}) {
  if (!isObject(value)) {
    if (prefix) output[prefix] = value;
    return output;
  }
  for (const [key, child] of Object.entries(value)) flatten(child, prefix ? `${prefix}.${key}` : key, output);
  return output;
}

function equal(a, b) {
  return canonical(a) === canonical(b);
}

function applyOperator(previous, next, operator) {
  if (!OPERATORS.has(operator)) throw new TypeError(`Unsupported configuration merge operator: ${operator}`);
  if (operator === "block_on_ambiguity") return equal(previous, next) ? previous : { __ambiguous: true };
  if (operator === "deny_wins" && typeof previous === "boolean" && typeof next === "boolean") return previous === false || next === false ? false : true;
  if (operator === "strict_intersection" && Array.isArray(previous) && Array.isArray(next)) return previous.filter((item) => next.some((candidate) => equal(item, candidate)));
  if (operator === "minimum" && typeof previous === "number" && typeof next === "number") return Math.min(previous, next);
  if (operator === "maximum" && typeof previous === "number" && typeof next === "number") return Math.max(previous, next);
  if ((operator === "guarded_union" || operator === "append_unique") && Array.isArray(previous) && Array.isArray(next)) {
    return [...previous, ...next.filter((item) => !previous.some((candidate) => equal(candidate, item)))];
  }
  if (operator === "priority_replace") return next;
  return equal(previous, next) ? previous : { __ambiguous: true };
}

function typeMatches(value, type) {
  if (!type) return true;
  if (type === "object") return isObject(value);
  if (type === "array") return Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "null") return value === null;
  return typeof value === type;
}

function validateSchema(value, definition) {
  const schema = isObject(definition?.schema_json) ? definition.schema_json : {};
  if (!typeMatches(value, schema.type)) return { valid: false, reason: "CONFIG_SCHEMA_TYPE_INVALID" };
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) return { valid: false, reason: "CONFIG_SCHEMA_MINIMUM_INVALID" };
    if (schema.maximum !== undefined && value > schema.maximum) return { valid: false, reason: "CONFIG_SCHEMA_MAXIMUM_INVALID" };
  }
  if (isObject(value) && Array.isArray(schema.required)) {
    const missing = schema.required.filter((key) => !Object.hasOwn(value, key));
    if (missing.length) return { valid: false, reason: "CONFIG_SCHEMA_REQUIRED_MISSING", missing };
  }
  return { valid: true };
}

function bindingMatches(binding, context) {
  const ref = normalizeScopeRef(binding.scope_ref);
  if (!ref) return false;
  if (binding.scope_type === "platform") return ref === "*";
  const contextKey = {
    environment: "environment",
    tenant: "tenant_id",
    workspace: "workspace_id",
    brand: "brand_key",
    app: "app_key",
    repository: "repository_key",
    role: "role_key",
    route: "route_key",
    resource: "resource_key",
  }[binding.scope_type];
  return Boolean(contextKey && context[contextKey] !== undefined && ref === normalizeScopeRef(context[contextKey]));
}

function lifecycleActive(binding, now) {
  if (binding.lifecycle !== "active") return false;
  const current = now instanceof Date ? now.getTime() : new Date(now || Date.now()).getTime();
  if (binding.effective_from && new Date(binding.effective_from).getTime() > current) return false;
  if (binding.effective_to && new Date(binding.effective_to).getTime() <= current) return false;
  return true;
}

function safePayload(binding) {
  if (binding.secrets_included === true) return null;
  if (!Object.hasOwn(binding, "payload_json")) return {};
  return typeof binding.payload_json === "string" ? JSON.parse(binding.payload_json) : binding.payload_json;
}

function policyResult(decision, context, lineage = [], conflicts = [], resolvedValue = undefined, reason = null) {
  const valuePresent = resolvedValue !== undefined;
  return Object.freeze({
    decision,
    reason,
    resolved_value: valuePresent ? resolvedValue : undefined,
    resolved_checksum: valuePresent ? sha256(canonical(resolvedValue)) : null,
    context_hash: contextHash(context),
    lineage: lineage.map((item) => ({ ...item, payload_omitted: true })),
    conflicts,
    resolver_version: PLATFORM_CONFIGURATION_RESOLVER_VERSION,
    secrets_included: false,
    mutation_allowed: false,
    external_write_allowed: false,
    production_activation_allowed: false,
  });
}

export function resolvePlatformConfiguration({ definition, bindings = [], context = {}, legacyValue, fallbackValue, now = new Date() } = {}) {
  if (!definition?.config_key || !OPERATORS.has(definition.merge_operator || "priority_replace")) return policyResult("invalid_schema", context, [], [], undefined, "CONFIG_DEFINITION_INVALID");
  const allowedScopes = new Set(Array.isArray(definition.allowed_scope_types_json) ? definition.allowed_scope_types_json : []);
  const applicable = bindings
    .filter((binding) => binding.config_key === definition.config_key)
    .filter((binding) => allowedScopes.size === 0 || allowedScopes.has(binding.scope_type))
    .filter((binding) => lifecycleActive(binding, now))
    .filter((binding) => bindingMatches(binding, context))
    .map((binding) => ({ ...binding, effective_precedence: Number(binding.precedence ?? SCOPE_PRECEDENCE[binding.scope_type] ?? 10000) }))
    .sort((left, right) => left.effective_precedence - right.effective_precedence || String(left.binding_id).localeCompare(String(right.binding_id)));

  const lineage = [];
  const conflicts = [];
  let resolved;
  for (const binding of applicable) {
    let payload;
    try { payload = safePayload(binding); } catch { return policyResult("invalid_schema", context, lineage, conflicts, undefined, "CONFIG_PAYLOAD_INVALID_JSON"); }
    if (payload === null) return policyResult("invalid_schema", context, lineage, conflicts, undefined, "CONFIG_SECRETS_FORBIDDEN");
    if (resolved === undefined) resolved = payload;
    else {
      const merged = applyOperator(resolved, payload, definition.merge_operator || "priority_replace");
      if (isObject(merged) && merged.__ambiguous === true) {
        conflicts.push({ binding_id: binding.binding_id, scope_type: binding.scope_type, precedence: binding.effective_precedence });
        return policyResult("ambiguous", context, lineage, conflicts, undefined, "CONFIG_CONFLICT");
      }
      resolved = merged;
    }
    lineage.push({ binding_id: binding.binding_id, source_registry: binding.source_registry, scope_type: binding.scope_type, scope_ref: binding.scope_ref, precedence: binding.effective_precedence });
  }

  if (resolved === undefined && definition.fallback_policy === "legacy_compatibility" && legacyValue !== undefined) resolved = legacyValue;
  if (resolved === undefined && fallbackValue !== undefined && ["safe_floor", "env_bootstrap_only"].includes(definition.fallback_policy)) resolved = fallbackValue;
  if (resolved === undefined) return policyResult("not_found", context, lineage, conflicts, undefined, "CONFIG_NOT_FOUND");
  const finalSchema = validateSchema(resolved, definition);
  if (!finalSchema.valid) return policyResult("invalid_schema", context, lineage, conflicts, undefined, finalSchema.reason);
  return policyResult("resolved", context, lineage, conflicts, resolved);
}

export const __test__ = Object.freeze({
  applyOperator,
  canonical,
  contextHash,
  flatten,
  normalizeScopeRef,
  pathValue,
  setPath,
  validateSchema,
  bindingMatches,
});
