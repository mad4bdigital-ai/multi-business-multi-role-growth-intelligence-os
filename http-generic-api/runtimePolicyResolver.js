import { getPool } from "./db.js";
import { loadActiveExecutionPolicies } from "./runtimePolicyLoader.js";

function normalizeToken(value = "") {
  return String(value || "").trim().toLowerCase();
}

function splitTokens(value = "") {
  if (Array.isArray(value)) return value.map(normalizeToken).filter(Boolean);
  return String(value || "").split(/[|,;]/).map(normalizeToken).filter(Boolean);
}

function parseJson(value, fallback = {}) {
  if (value && typeof value === "object") return value;
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

function tokenMatches(candidate = "", requested = []) {
  const normalizedCandidate = normalizeToken(candidate);
  if (!normalizedCandidate || normalizedCandidate === "*" || normalizedCandidate === "global") return true;
  const requestedTokens = splitTokens(requested);
  if (!requestedTokens.length) return true;
  return requestedTokens.includes(normalizedCandidate);
}

function resourcePatternMatches(pattern = "*", requested = []) {
  const normalizedPattern = normalizeToken(pattern || "*");
  if (!normalizedPattern || normalizedPattern === "*" || normalizedPattern === "global") return true;
  const requestedTokens = splitTokens(requested);
  if (!requestedTokens.length) return true;
  if (requestedTokens.includes(normalizedPattern)) return true;
  if (normalizedPattern.includes("|")) {
    return splitTokens(normalizedPattern).some((token) => requestedTokens.includes(token));
  }
  return false;
}

function normalizeRuleRow(row = {}) {
  return {
    rule_key: String(row.rule_key || "").trim(),
    policy_key: String(row.policy_key || "").trim(),
    engine_key: String(row.engine_key || "").trim() || null,
    policy_mode: String(row.policy_mode || "").trim(),
    priority: Number(row.priority || 0),
    task_class: String(row.task_class || "").trim(),
    resource_kind: String(row.resource_kind || "").trim(),
    resource_pattern: String(row.resource_pattern || "*").trim(),
    condition_json: parseJson(row.condition_json, {}),
    strategy_key: String(row.strategy_key || "").trim(),
    risk_level: String(row.risk_level || "").trim(),
    auto_apply_allowed: Number(row.auto_apply_allowed || 0) === 1,
    dry_run_required: Number(row.dry_run_required || 0) === 1,
    approval_required: Number(row.approval_required || 0) === 1,
    validator_commands: parseJson(row.validator_commands_json, []),
    status: String(row.status || "").trim(),
    notes: row.notes || "",
  };
}

function ruleReferencesPolicy(rule = {}, policy = {}) {
  const condition = rule.condition_json || {};
  const group = String(condition.execution_policy_group || "").trim();
  const key = String(condition.execution_policy_key || "").trim();
  return Boolean(
    group && key &&
    normalizeToken(group) === normalizeToken(policy.policy_group) &&
    normalizeToken(key) === normalizeToken(policy.policy_key)
  );
}

function ruleMatchesContext(rule = {}, context = {}, executionPolicies = []) {
  if (executionPolicies.some((policy) => ruleReferencesPolicy(rule, policy))) return true;

  const condition = rule.condition_json || {};
  if (context.policy_group && condition.execution_policy_group) {
    if (normalizeToken(condition.execution_policy_group) !== normalizeToken(context.policy_group)) return false;
  }
  if (context.policy_key && condition.execution_policy_key) {
    if (normalizeToken(condition.execution_policy_key) !== normalizeToken(context.policy_key)) return false;
  }

  const executionScopes = context.execution_scope || context.execution_scopes || [];
  const affectsLayers = context.affects_layer || context.affects_layers || [];
  const resourceKinds = context.resource_kind || executionScopes;
  const resourcePatterns = context.resource_pattern || executionScopes;

  const taskOk = tokenMatches(rule.task_class, executionScopes) || tokenMatches(rule.task_class, affectsLayers);
  const kindOk = tokenMatches(rule.resource_kind, resourceKinds) || tokenMatches(rule.resource_kind, executionScopes);
  const patternOk = resourcePatternMatches(rule.resource_pattern, resourcePatterns);
  return taskOk && kindOk && patternOk;
}

export async function loadActivePlatformPolicyRules(context = {}, executionPolicies = [], deps = {}) {
  const pool = deps.pool || getPool();
  const [rows] = await pool.query(
    `SELECT r.rule_key, r.policy_key, r.engine_key, p.mode AS policy_mode,
            r.priority, r.task_class, r.resource_kind, r.resource_pattern,
            r.condition_json, r.strategy_key, r.risk_level, r.auto_apply_allowed,
            r.dry_run_required, r.approval_required, r.validator_commands_json,
            r.status, r.notes
       FROM platform_engine_policy_rules r
       JOIN platform_engine_policy_registry p
         ON p.policy_key = r.policy_key
      WHERE r.status = 'active'
        AND p.status = 'active'
      ORDER BY r.priority DESC, r.rule_key ASC`
  );
  return (rows || [])
    .map(normalizeRuleRow)
    .filter((rule) => ruleMatchesContext(rule, context, executionPolicies));
}

export function summarizePlatformPolicyRules(rules = []) {
  return (rules || []).map((rule) => ({
    rule_key: rule.rule_key,
    policy_key: rule.policy_key,
    engine_key: rule.engine_key,
    task_class: rule.task_class,
    resource_kind: rule.resource_kind,
    resource_pattern: rule.resource_pattern,
    risk_level: rule.risk_level,
    dry_run_required: rule.dry_run_required,
    approval_required: rule.approval_required,
  }));
}

export async function resolveRuntimePolicyContext(context = {}, deps = {}) {
  const executionPolicies = await loadActiveExecutionPolicies(context, deps);
  const targetRules = await loadActivePlatformPolicyRules(context, executionPolicies, deps);
  const policySource = targetRules.length
    ? "platform_engine_policy_rules_with_execution_policies_fallback"
    : "execution_policies";
  return {
    ok: true,
    policy_source: policySource,
    enforcement_source: "execution_policies",
    target_rule_source: targetRules.length ? "platform_engine_policy_rules" : null,
    fallback_source: "execution_policies",
    cutover_enabled: false,
    policies: executionPolicies,
    target_rules: targetRules,
    target_rule_count: targetRules.length,
    execution_policy_count: executionPolicies.length,
    evidence: {
      resolver: "runtimePolicyResolver",
      mode: "target_rule_evidence_with_execution_policy_fallback",
      cutover_enabled: false,
      target_rule_count: targetRules.length,
      execution_policy_count: executionPolicies.length,
      target_rule_keys: targetRules.map((rule) => rule.rule_key),
    },
    secrets_included: false,
  };
}
