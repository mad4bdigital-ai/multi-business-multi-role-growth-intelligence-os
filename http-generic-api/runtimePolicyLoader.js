import { getPool } from "./db.js";

function normalizeToken(value = "") {
  return String(value || "").trim().toLowerCase();
}

function splitPolicyList(value = "") {
  return String(value || "")
    .split(/[|,;]/)
    .map((part) => normalizeToken(part))
    .filter(Boolean);
}

function isActivePolicy(value) {
  return ["true", "1", "yes", "active", "global"].includes(normalizeToken(value));
}

function isBlockingPolicy(value) {
  return ["true", "1", "yes", "block", "blocking"].includes(normalizeToken(value));
}

function parsePolicyValue(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return { raw: "" };
  if ((raw.startsWith("{") && raw.endsWith("}")) || (raw.startsWith("[") && raw.endsWith("]"))) {
    try {
      return { raw, json: JSON.parse(raw) };
    } catch {
      return { raw, parse_error: "invalid_json" };
    }
  }
  return { raw };
}

function tokenListMatches(policyValue, requestedValues = []) {
  const requested = (Array.isArray(requestedValues) ? requestedValues : [requestedValues])
    .map((value) => normalizeToken(value))
    .filter(Boolean);
  if (!requested.length) return true;
  const policyTokens = splitPolicyList(policyValue);
  if (!policyTokens.length) return false;
  if (policyTokens.some((token) => ["all", "*", "global", "execution"].includes(token))) return true;
  return requested.some((value) => policyTokens.includes(value));
}

export function normalizeExecutionPolicyRow(row = {}) {
  return {
    id: row.id ?? null,
    policy_group: String(row.policy_group || "").trim(),
    policy_key: String(row.policy_key || "").trim(),
    policy_value: parsePolicyValue(row.policy_value),
    active: row.active,
    active_bool: isActivePolicy(row.active),
    execution_scope: String(row.execution_scope || "").trim(),
    execution_scope_tokens: splitPolicyList(row.execution_scope),
    affects_layer: String(row.affects_layer || "").trim(),
    affects_layer_tokens: splitPolicyList(row.affects_layer),
    blocking: row.blocking,
    blocking_bool: isBlockingPolicy(row.blocking),
    notes: row.notes || "",
  };
}

export function policyMatchesContext(policy, context = {}) {
  if (!policy?.active_bool) return false;
  if (context.policy_group && normalizeToken(policy.policy_group) !== normalizeToken(context.policy_group)) return false;
  if (context.policy_key && normalizeToken(policy.policy_key) !== normalizeToken(context.policy_key)) return false;
  if (!tokenListMatches(policy.execution_scope, context.execution_scope || context.execution_scopes)) return false;
  if (!tokenListMatches(policy.affects_layer, context.affects_layer || context.affects_layers)) return false;
  return true;
}

export async function loadActiveExecutionPolicies(context = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const [rows] = await pool.query(
    `SELECT id, policy_group, policy_key, policy_value, active, execution_scope, affects_layer, blocking, notes
       FROM \`execution_policies\`
      WHERE active IN ('TRUE','true','1','global','active','yes')
      ORDER BY policy_group, policy_key, id`
  );
  return rows
    .map(normalizeExecutionPolicyRow)
    .filter((policy) => policyMatchesContext(policy, context));
}

export async function loadExecutionPolicyByKey(policy_group, policy_key, context = {}, deps = {}) {
  const policies = await loadActiveExecutionPolicies({ ...context, policy_group, policy_key }, deps);
  return policies[0] || null;
}

export function summarizePolicies(policies = []) {
  return policies.map((policy) => ({
    id: policy.id,
    policy_group: policy.policy_group,
    policy_key: policy.policy_key,
    execution_scope: policy.execution_scope,
    affects_layer: policy.affects_layer,
    blocking: policy.blocking_bool,
  }));
}
