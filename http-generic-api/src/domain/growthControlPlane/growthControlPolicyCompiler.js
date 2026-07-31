import { GrowthControlPlaneError, stableSha256 } from "./growthControlPlane.js";

const KEY_RE = /^[a-z][a-z0-9_.-]{2,191}$/;
const OPAQUE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,190}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const SENSITIVE_KEY_RE = /(secret|token|password|passwd|credential|private[_-]?key|client[_-]?secret|api[_-]?key|authorization|cookie|session)/i;
const SENSITIVE_VALUE_RE = /(Bearer\s+[A-Za-z0-9._~+\-/]+=*|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;
const MAX_POLICY_COUNT = 100;
const MAX_CONDITION_COUNT = 25;
const MAX_EFFECT_COUNT = 25;
const MAX_INPUT_BYTES = 262144;

const CONDITION_OPERATORS = new Set([
  "equals",
  "not_equals",
  "in",
  "not_in",
  "exists",
  "less_than",
  "less_than_or_equal",
  "greater_than",
  "greater_than_or_equal",
  "contains_all",
]);

const POLICY_EFFECTS = new Set([
  "require_approval",
  "require_typed_confirmation",
  "require_resource_authority",
  "require_certification",
  "require_readback",
  "require_rollback",
  "limit_resources",
  "limit_concurrency",
  "limit_budget",
  "force_environment",
  "force_provider_write_false",
  "deny",
]);

const CONTEXT_FIELDS = new Set([
  "tenant_id",
  "workspace_id",
  "brand_id",
  "activity_binding_id",
  "operation_key",
  "capability_key",
  "action_ids",
  "resource_ids",
  "resource_count",
  "environment",
  "effect_class",
  "actor_roles",
  "provider_write",
  "external_write",
  "budget_amount",
  "concurrency",
  "certification_keys",
  "delegation_requested",
  "plan_hash_sha256",
  "request_hash_sha256",
]);

const ENVIRONMENTS = new Set(["development", "test", "staging", "canary", "production"]);
const REQUIREMENT_ORDER = new Map([
  ["force_provider_write_false", 0],
  ["force_environment", 1],
  ["limit_resources", 2],
  ["limit_concurrency", 3],
  ["limit_budget", 4],
  ["require_resource_authority", 5],
  ["require_certification", 6],
  ["require_approval", 7],
  ["require_typed_confirmation", 8],
  ["require_readback", 9],
  ["require_rollback", 10],
]);

function fail(code, message, field = null, issue = null, extra = {}) {
  throw new GrowthControlPlaneError(
    code,
    message,
    422,
    field ? [{ field, issue, ...extra }] : [],
  );
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((nested) => deepFreeze(nested, seen));
  return Object.freeze(value);
}

function assertBoundedInput(value) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    fail("GROWTH_CONTROL_POLICY_INPUT_INVALID", "Policy compiler input must be JSON-serializable.", "input", "not_json_serializable");
  }
  if (Buffer.byteLength(serialized || "", "utf8") > MAX_INPUT_BYTES) {
    fail("GROWTH_CONTROL_POLICY_INPUT_OVERSIZED", "Policy compiler input exceeds the supported byte bound.", "input", "oversized");
  }
}

function assertSensitiveFree(value, field = "input", depth = 0) {
  if (depth > 12 || value == null) return;
  if (typeof value === "string") {
    if (SENSITIVE_VALUE_RE.test(value)) {
      fail("GROWTH_CONTROL_POLICY_SENSITIVE_INPUT", "Policy compiler input contains a secret-like value.", field, "forbidden_sensitive_value");
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSensitiveFree(item, `${field}[${index}]`, depth + 1));
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_KEY_RE.test(key)) {
      fail("GROWTH_CONTROL_POLICY_SENSITIVE_INPUT", "Policy compiler input contains a forbidden sensitive field.", `${field}.${key}`, "forbidden_sensitive_field");
    }
    assertSensitiveFree(nested, `${field}.${key}`, depth + 1);
  }
}

function canonical(value, field) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!KEY_RE.test(normalized)) {
    fail("GROWTH_CONTROL_POLICY_INVALID", `${field} must be a canonical key.`, field, "invalid_canonical_key");
  }
  return normalized;
}

function identifier(value, field, { nullable = false } = {}) {
  if (nullable && (value == null || value === "")) return null;
  const normalized = String(value ?? "").trim();
  if (!OPAQUE_ID_RE.test(normalized)) {
    fail("GROWTH_CONTROL_POLICY_INVALID", `${field} must be a bounded opaque identifier.`, field, "invalid_identifier");
  }
  return normalized;
}

function sha256(value, field, { nullable = true } = {}) {
  if (nullable && (value == null || value === "")) return null;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!SHA256_RE.test(normalized)) {
    fail("GROWTH_CONTROL_POLICY_INVALID", `${field} must be SHA-256.`, field, "invalid_sha256");
  }
  return normalized;
}

function boundedInteger(value, field, minimum, maximum, fallback = null) {
  const normalized = value == null ? fallback : Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < minimum || normalized > maximum) {
    fail("GROWTH_CONTROL_POLICY_INVALID", `${field} is outside the supported bounds.`, field, "out_of_range", { minimum, maximum });
  }
  return normalized;
}

function boundedNumber(value, field, minimum, maximum) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < minimum || normalized > maximum) {
    fail("GROWTH_CONTROL_POLICY_INVALID", `${field} is outside the supported bounds.`, field, "out_of_range", { minimum, maximum });
  }
  return normalized;
}

function sortedUnique(values, field, { required = false, normalize = canonical, maximum = 100 } = {}) {
  if (values == null) values = [];
  if (!Array.isArray(values) || values.length > maximum) {
    fail("GROWTH_CONTROL_POLICY_INVALID", `${field} must be a bounded array.`, field, "invalid_or_oversized_array", { maximum });
  }
  const normalized = [...new Set(values.map((value, index) => normalize(value, `${field}[${index}]`)))].sort();
  if (required && normalized.length === 0) {
    fail("GROWTH_CONTROL_POLICY_INVALID", `${field} must not be empty.`, field, "required");
  }
  return normalized;
}

function normalizeContext(source = {}) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    fail("GROWTH_CONTROL_POLICY_CONTEXT_INVALID", "context must be an object.", "context", "invalid_type");
  }
  const unknown = Object.keys(source).filter((field) => !CONTEXT_FIELDS.has(field));
  if (unknown.length > 0) {
    fail("GROWTH_CONTROL_POLICY_CONTEXT_INVALID", "context contains unsupported fields.", "context", "unknown_fields", { fields: unknown.sort() });
  }
  const resourceIds = sortedUnique(source.resource_ids, "context.resource_ids", { normalize: identifier });
  const actionIds = sortedUnique(source.action_ids, "context.action_ids", { normalize: canonical });
  const resourceCount = source.resource_count == null
    ? resourceIds.length
    : boundedInteger(source.resource_count, "context.resource_count", 0, 10000);
  if (resourceCount !== resourceIds.length) {
    fail(
      "GROWTH_CONTROL_POLICY_CONTEXT_INVALID",
      "context.resource_count must equal the canonical resource_ids count.",
      "context.resource_count",
      "count_mismatch",
      { expected: resourceIds.length, observed: resourceCount },
    );
  }
  const environment = canonical(source.environment ?? "development", "context.environment");
  if (!ENVIRONMENTS.has(environment)) {
    fail("GROWTH_CONTROL_POLICY_CONTEXT_INVALID", "context.environment is unsupported.", "context.environment", "unsupported_environment");
  }
  const context = {
    tenant_id: identifier(source.tenant_id, "context.tenant_id"),
    workspace_id: identifier(source.workspace_id, "context.workspace_id", { nullable: true }),
    brand_id: identifier(source.brand_id, "context.brand_id", { nullable: true }),
    activity_binding_id: identifier(source.activity_binding_id, "context.activity_binding_id", { nullable: true }),
    operation_key: canonical(source.operation_key, "context.operation_key"),
    capability_key: canonical(source.capability_key, "context.capability_key"),
    action_ids: actionIds,
    resource_ids: resourceIds,
    resource_count: resourceCount,
    environment,
    effect_class: canonical(source.effect_class ?? "no_effect", "context.effect_class"),
    actor_roles: sortedUnique(source.actor_roles, "context.actor_roles"),
    provider_write: source.provider_write === true,
    external_write: source.external_write === true,
    budget_amount: source.budget_amount == null ? 0 : boundedNumber(source.budget_amount, "context.budget_amount", 0, 1_000_000_000),
    concurrency: source.concurrency == null ? 1 : boundedInteger(source.concurrency, "context.concurrency", 1, 1000),
    certification_keys: sortedUnique(source.certification_keys, "context.certification_keys"),
    delegation_requested: source.delegation_requested === true,
    plan_hash_sha256: sha256(source.plan_hash_sha256, "context.plan_hash_sha256"),
    request_hash_sha256: sha256(source.request_hash_sha256, "context.request_hash_sha256"),
  };
  return deepFreeze(context);
}

function normalizeCondition(source, field) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    fail("GROWTH_CONTROL_POLICY_CONDITION_INVALID", `${field} must be an object.`, field, "invalid_type");
  }
  const contextField = String(source.field ?? "").trim();
  if (!CONTEXT_FIELDS.has(contextField)) {
    fail("GROWTH_CONTROL_POLICY_CONDITION_INVALID", `${field}.field is unsupported.`, `${field}.field`, "unsupported_context_field");
  }
  const operator = String(source.operator ?? "").trim().toLowerCase();
  if (!CONDITION_OPERATORS.has(operator)) {
    fail("GROWTH_CONTROL_POLICY_CONDITION_INVALID", `${field}.operator is unsupported.`, `${field}.operator`, "unsupported_operator");
  }
  let value = source.value;
  if (["in", "not_in", "contains_all"].includes(operator)) {
    value = sortedUnique(value, `${field}.value`, {
      normalize: (candidate, candidateField) => {
        if (typeof candidate === "number" || typeof candidate === "boolean") return candidate;
        const normalized = String(candidate ?? "").trim();
        if (!normalized || normalized.length > 191) {
          fail("GROWTH_CONTROL_POLICY_CONDITION_INVALID", `${candidateField} is invalid.`, candidateField, "invalid_value");
        }
        return normalized;
      },
    });
  } else if (["less_than", "less_than_or_equal", "greater_than", "greater_than_or_equal"].includes(operator)) {
    value = boundedNumber(value, `${field}.value`, -1_000_000_000, 1_000_000_000);
  } else if (operator === "exists") {
    value = source.value !== false;
  } else if (typeof value === "string") {
    value = value.trim();
    if (!value || value.length > 191) {
      fail("GROWTH_CONTROL_POLICY_CONDITION_INVALID", `${field}.value is invalid.`, `${field}.value`, "invalid_value");
    }
  } else if (!["number", "boolean"].includes(typeof value) && value !== null) {
    fail("GROWTH_CONTROL_POLICY_CONDITION_INVALID", `${field}.value must be scalar.`, `${field}.value`, "invalid_scalar");
  }
  return { field: contextField, operator, value };
}

function normalizeApprovalProfile(source, field) {
  const profile = source == null ? {} : source;
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    fail("GROWTH_CONTROL_POLICY_EFFECT_INVALID", `${field} must be an object.`, field, "invalid_type");
  }
  return {
    required_roles: sortedUnique(profile.required_roles ?? ["supervisor"], `${field}.required_roles`, { required: true }),
    separation_of_duties: profile.separation_of_duties === true,
    expires_in_seconds: boundedInteger(profile.expires_in_seconds, `${field}.expires_in_seconds`, 300, 604800, 3600),
    delegation_allowed: profile.delegation_allowed === true,
    max_resource_count: boundedInteger(profile.max_resource_count, `${field}.max_resource_count`, 1, 10000, 10000),
  };
}

function normalizeEffect(source, field) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    fail("GROWTH_CONTROL_POLICY_EFFECT_INVALID", `${field} must be an object.`, field, "invalid_type");
  }
  const type = String(source.type ?? source.effect ?? "").trim().toLowerCase();
  if (!POLICY_EFFECTS.has(type)) {
    fail("GROWTH_CONTROL_POLICY_EFFECT_INVALID", `${field}.type is unsupported.`, `${field}.type`, "unsupported_effect");
  }
  const reasonCode = source.reason_code == null ? null : canonical(source.reason_code, `${field}.reason_code`);
  switch (type) {
    case "require_approval":
      return { type, profile: normalizeApprovalProfile(source.profile, `${field}.profile`), reason_code: reasonCode };
    case "require_typed_confirmation":
      return { type, confirmation_key: canonical(source.confirmation_key ?? "confirmation.required", `${field}.confirmation_key`), reason_code: reasonCode };
    case "require_resource_authority":
      return { type, authority_keys: sortedUnique(source.authority_keys ?? ["resource.authority"], `${field}.authority_keys`, { required: true }), reason_code: reasonCode };
    case "require_certification":
      return { type, certification_keys: sortedUnique(source.certification_keys, `${field}.certification_keys`, { required: true }), reason_code: reasonCode };
    case "require_readback":
      return { type, readback_keys: sortedUnique(source.readback_keys ?? ["mutation.readback"], `${field}.readback_keys`, { required: true }), reason_code: reasonCode };
    case "require_rollback":
      return { type, rollback_keys: sortedUnique(source.rollback_keys ?? ["mutation.rollback"], `${field}.rollback_keys`, { required: true }), reason_code: reasonCode };
    case "limit_resources":
      return { type, maximum: boundedInteger(source.maximum, `${field}.maximum`, 0, 10000), reason_code: reasonCode };
    case "limit_concurrency":
      return { type, maximum: boundedInteger(source.maximum, `${field}.maximum`, 1, 1000), reason_code: reasonCode };
    case "limit_budget":
      return { type, maximum: boundedNumber(source.maximum, `${field}.maximum`, 0, 1_000_000_000), reason_code: reasonCode };
    case "force_environment": {
      const environment = canonical(source.environment, `${field}.environment`);
      if (!ENVIRONMENTS.has(environment)) {
        fail("GROWTH_CONTROL_POLICY_EFFECT_INVALID", `${field}.environment is unsupported.`, `${field}.environment`, "unsupported_environment");
      }
      return { type, environment, reason_code: reasonCode };
    }
    case "force_provider_write_false":
      return { type, required: true, reason_code: reasonCode };
    case "deny":
      return { type, reason_code: reasonCode ?? "policy.denied" };
    default:
      fail("GROWTH_CONTROL_POLICY_EFFECT_INVALID", `${field}.type is unsupported.`, `${field}.type`, "unsupported_effect");
  }
}

function normalizePolicy(source, index) {
  const field = `policies[${index}]`;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    fail("GROWTH_CONTROL_POLICY_INVALID", `${field} must be an object.`, field, "invalid_type");
  }
  if (source.immutable !== true || String(source.status ?? "active") !== "active") {
    fail("GROWTH_CONTROL_POLICY_VERSION_INVALID", "Only immutable active policy versions may be compiled.", field, "version_not_active_immutable");
  }
  const conditions = source.conditions ?? [];
  const effects = source.effects ?? [];
  if (!Array.isArray(conditions) || conditions.length > MAX_CONDITION_COUNT) {
    fail("GROWTH_CONTROL_POLICY_INVALID", `${field}.conditions exceeds the supported bound.`, `${field}.conditions`, "invalid_or_oversized_array");
  }
  if (!Array.isArray(effects) || effects.length === 0 || effects.length > MAX_EFFECT_COUNT) {
    fail("GROWTH_CONTROL_POLICY_INVALID", `${field}.effects must be a non-empty bounded array.`, `${field}.effects`, "invalid_or_oversized_array");
  }
  return {
    policy_key: canonical(source.policy_key, `${field}.policy_key`),
    policy_version_id: identifier(source.policy_version_id, `${field}.policy_version_id`),
    version: boundedInteger(source.version, `${field}.version`, 1, 1_000_000),
    priority: boundedInteger(source.priority, `${field}.priority`, 0, 10000, 0),
    conditions: conditions.map((condition, conditionIndex) => normalizeCondition(condition, `${field}.conditions[${conditionIndex}]`)),
    effects: effects.map((effect, effectIndex) => normalizeEffect(effect, `${field}.effects[${effectIndex}]`)),
  };
}

function stableEqual(left, right) {
  return stableSha256(left) === stableSha256(right);
}

function conditionMatches(condition, context) {
  const actual = context[condition.field];
  const expected = condition.value;
  switch (condition.operator) {
    case "equals": return stableEqual(actual, expected);
    case "not_equals": return !stableEqual(actual, expected);
    case "in": return expected.some((candidate) => stableEqual(candidate, actual));
    case "not_in": return expected.every((candidate) => !stableEqual(candidate, actual));
    case "exists": return expected ? actual !== null && actual !== undefined : actual === null || actual === undefined;
    case "less_than": return Number(actual) < expected;
    case "less_than_or_equal": return Number(actual) <= expected;
    case "greater_than": return Number(actual) > expected;
    case "greater_than_or_equal": return Number(actual) >= expected;
    case "contains_all": return Array.isArray(actual) && expected.every((candidate) => actual.some((item) => stableEqual(item, candidate)));
    default: return false;
  }
}

function policyMatches(policy, context) {
  return policy.conditions.every((condition) => conditionMatches(condition, context));
}

function addAll(target, values) {
  values.forEach((value) => target.add(value));
}

function resolveForcedEnvironment(effects) {
  const candidates = effects.filter((item) => item.effect.type === "force_environment");
  if (candidates.length === 0) return null;
  const highestPriority = Math.max(...candidates.map((item) => item.policy.priority));
  const values = [...new Set(candidates
    .filter((item) => item.policy.priority === highestPriority)
    .map((item) => item.effect.environment))]
    .sort();
  if (values.length > 1) {
    fail(
      "POLICY_AMBIGUOUS",
      "Equal-priority policies force contradictory environments.",
      "policies.effects.force_environment",
      "equal_priority_conflict",
      { priority: highestPriority, values },
    );
  }
  const [environment] = values;
  return { environment, priority: highestPriority };
}

function compileRequirements(matched, context) {
  const effectRows = matched.flatMap((policy) => policy.effects.map((effect) => ({ policy, effect })));
  const requirements = [];
  const reasonCodes = new Set();
  const denials = [];
  const approvalRoles = new Set();
  const confirmationKeys = new Set();
  const authorityKeys = new Set();
  const certificationKeys = new Set();
  const readbackKeys = new Set();
  const rollbackKeys = new Set();
  let approvalRequired = false;
  let separationOfDuties = false;
  let approvalExpiry = 604800;
  let delegationAllowed = true;
  let approvalMaxResourceCount = 10000;
  let resourceLimit = null;
  let concurrencyLimit = null;
  let budgetLimit = null;
  let forceProviderWriteFalse = false;

  for (const { policy, effect } of effectRows) {
    if (effect.reason_code) reasonCodes.add(effect.reason_code);
    switch (effect.type) {
      case "deny":
        denials.push({
          policy_key: policy.policy_key,
          policy_version_id: policy.policy_version_id,
          reason_code: effect.reason_code,
        });
        break;
      case "require_approval":
        approvalRequired = true;
        addAll(approvalRoles, effect.profile.required_roles);
        separationOfDuties ||= effect.profile.separation_of_duties;
        approvalExpiry = Math.min(approvalExpiry, effect.profile.expires_in_seconds);
        delegationAllowed &&= effect.profile.delegation_allowed;
        approvalMaxResourceCount = Math.min(approvalMaxResourceCount, effect.profile.max_resource_count);
        break;
      case "require_typed_confirmation":
        confirmationKeys.add(effect.confirmation_key);
        break;
      case "require_resource_authority":
        addAll(authorityKeys, effect.authority_keys);
        break;
      case "require_certification":
        addAll(certificationKeys, effect.certification_keys);
        break;
      case "require_readback":
        addAll(readbackKeys, effect.readback_keys);
        break;
      case "require_rollback":
        addAll(rollbackKeys, effect.rollback_keys);
        break;
      case "limit_resources":
        resourceLimit = resourceLimit == null ? effect.maximum : Math.min(resourceLimit, effect.maximum);
        break;
      case "limit_concurrency":
        concurrencyLimit = concurrencyLimit == null ? effect.maximum : Math.min(concurrencyLimit, effect.maximum);
        break;
      case "limit_budget":
        budgetLimit = budgetLimit == null ? effect.maximum : Math.min(budgetLimit, effect.maximum);
        break;
      case "force_provider_write_false":
        forceProviderWriteFalse = true;
        break;
      default:
        break;
    }
  }

  const forcedEnvironment = resolveForcedEnvironment(effectRows);
  if (forceProviderWriteFalse) requirements.push({ type: "force_provider_write_false", required: true });
  if (forcedEnvironment) requirements.push({ type: "force_environment", ...forcedEnvironment });
  if (resourceLimit != null) requirements.push({ type: "limit_resources", maximum: resourceLimit });
  if (concurrencyLimit != null) requirements.push({ type: "limit_concurrency", maximum: concurrencyLimit });
  if (budgetLimit != null) requirements.push({ type: "limit_budget", maximum: budgetLimit });
  if (authorityKeys.size > 0) requirements.push({ type: "require_resource_authority", authority_keys: [...authorityKeys].sort() });
  if (certificationKeys.size > 0) requirements.push({ type: "require_certification", certification_keys: [...certificationKeys].sort() });
  if (approvalRequired) {
    requirements.push({
      type: "require_approval",
      approval_profile: {
        required_roles: [...approvalRoles].sort(),
        separation_of_duties: separationOfDuties,
        expires_in_seconds: approvalExpiry,
        delegation_allowed: delegationAllowed,
        max_resource_count: approvalMaxResourceCount,
        target_scope: {
          tenant_id: context.tenant_id,
          workspace_id: context.workspace_id,
          brand_id: context.brand_id,
          activity_binding_id: context.activity_binding_id,
        },
        action_ids: context.action_ids,
        resource_ids: context.resource_ids,
        resource_count: context.resource_count,
        environment: forcedEnvironment?.environment ?? context.environment,
        effect_class: context.effect_class,
        plan_hash_sha256: context.plan_hash_sha256,
        request_hash_sha256: context.request_hash_sha256,
        provider_write_allowed: false,
        grants_authority: false,
      },
    });
  }
  if (confirmationKeys.size > 0) requirements.push({ type: "require_typed_confirmation", confirmation_keys: [...confirmationKeys].sort() });
  if (readbackKeys.size > 0) requirements.push({ type: "require_readback", readback_keys: [...readbackKeys].sort() });
  if (rollbackKeys.size > 0) requirements.push({ type: "require_rollback", rollback_keys: [...rollbackKeys].sort() });

  requirements.sort((left, right) => (REQUIREMENT_ORDER.get(left.type) ?? 999) - (REQUIREMENT_ORDER.get(right.type) ?? 999));
  denials.sort((left, right) => left.policy_key.localeCompare(right.policy_key) || left.policy_version_id.localeCompare(right.policy_version_id));
  return { requirements, denials, reasonCodes: [...reasonCodes].sort() };
}

export function compileGrowthControlPolicyDecision({ policies = [], context: contextInput = {} } = {}) {
  assertBoundedInput({ policies, context: contextInput });
  assertSensitiveFree({ policies, context: contextInput });
  if (!Array.isArray(policies) || policies.length > MAX_POLICY_COUNT) {
    fail("GROWTH_CONTROL_POLICY_INPUT_INVALID", "policies must be a bounded array.", "policies", "invalid_or_oversized_array", { maximum: MAX_POLICY_COUNT });
  }
  const context = normalizeContext(contextInput);
  const normalizedPolicies = policies.map(normalizePolicy);
  const identities = new Set();
  for (const policy of normalizedPolicies) {
    const identity = `${policy.policy_key}:${policy.policy_version_id}`;
    if (identities.has(identity)) {
      fail("GROWTH_CONTROL_POLICY_VERSION_INVALID", "Duplicate policy-version identity is forbidden.", "policies", "duplicate_policy_version", { identity });
    }
    identities.add(identity);
  }
  const matched = normalizedPolicies
    .filter((policy) => policyMatches(policy, context))
    .sort((left, right) => right.priority - left.priority || left.policy_key.localeCompare(right.policy_key) || left.policy_version_id.localeCompare(right.policy_version_id));
  const { requirements, denials, reasonCodes } = compileRequirements(matched, context);
  const decision = denials.length > 0
    ? "deny"
    : requirements.length > 0
      ? "allow_with_requirements"
      : "allow";
  const withoutHash = {
    contract_version: "growth-control-policy-decision-v1",
    decision,
    requirements,
    denials,
    matched_policy_versions: matched.map((policy) => ({
      policy_key: policy.policy_key,
      policy_version_id: policy.policy_version_id,
      version: policy.version,
      priority: policy.priority,
    })),
    reason_codes: reasonCodes,
    context_sha256: stableSha256(context),
    grants_authority: false,
    provider_calls: false,
    provider_dispatch_allowed: false,
    provider_apply_allowed: false,
    external_writes: false,
    secrets_included: false,
  };
  return deepFreeze({ ...withoutHash, decision_sha256: stableSha256(withoutHash) });
}

export const growthControlPolicyCompilerContract = Object.freeze({
  version: "growth-control-policy-decision-v1",
  condition_operators: [...CONDITION_OPERATORS].sort(),
  effects: [...POLICY_EFFECTS].sort(),
  context_fields: [...CONTEXT_FIELDS].sort(),
  max_policy_count: MAX_POLICY_COUNT,
  max_conditions_per_policy: MAX_CONDITION_COUNT,
  max_effects_per_policy: MAX_EFFECT_COUNT,
  deny_wins: true,
  most_restrictive_limits: true,
  equal_priority_scalar_conflict: "POLICY_AMBIGUOUS",
  grants_authority: false,
  provider_dispatch_allowed: false,
  secrets_included: false,
});

export const _testingGrowthControlPolicyCompiler = Object.freeze({
  normalizeContext,
  normalizeCondition,
  normalizeEffect,
  normalizePolicy,
  conditionMatches,
  policyMatches,
  resolveForcedEnvironment,
  compileRequirements,
  assertSensitiveFree,
  deepFreeze,
});
