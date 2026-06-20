function riskRank(risk = "") {
  return { low: 1, medium: 2, high: 3, critical: 4 }[String(risk)] || 99;
}

export function parseRuleCondition(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function classifyMigrationReconciliationDecision({
  policyState,
  rule,
  authorization,
  ledger,
  preflight,
  required = [],
  existing = [],
  checksum = "",
}) {
  if (ledger) return { action: "no_action", status: "already_recorded", reason: "matching_checksum_in_ledger" };
  if (!policyState.available) return { action: "blocked", status: "policy_unavailable", reason: policyState.missing.join(",") };
  if (!authorization || authorization.authorization_status !== "authorized") {
    return { action: "blocked", status: "authorization_required", reason: "migration_not_authorized" };
  }
  if (!rule) {
    return { action: "diagnose_only", status: "diagnose_only", reason: "no_active_explicit_rule" };
  }

  const action = rule.strategy_key === "governed_migration_record_only"
    ? "record_only"
    : rule.strategy_key === "governed_migration_apply"
      ? "apply"
      : "diagnose_only";
  if (Number(rule.executes_dynamic_code) !== 0 || rule.strategy_status !== "active") {
    return { action: "blocked", status: "strategy_blocked", reason: "strategy_not_active_or_executes_dynamic_code" };
  }
  if (!Number(rule.auto_execute)) {
    return { action, status: "manual_only", reason: "rule_auto_execute_disabled" };
  }
  if (Number(policyState.policy.require_validators) === 1 && preflight.status !== "pass") {
    return { action: "blocked", status: "preflight_failed", reason: "preflight_not_pass" };
  }
  if (
    riskRank(authorization.risk_tier) >= riskRank(policyState.policy.approval_required_min_risk)
    && Number(rule.approval_required) !== 0
  ) {
    return { action: "blocked", status: "approval_required", reason: "risk_requires_approval_but_rule_not_preapproved" };
  }

  const condition = parseRuleCondition(rule.condition_json);
  const requiredObjects = [...new Set((required || []).filter(Boolean))];
  const existingObjects = [...new Set((existing || []).filter(Boolean))];
  const completeSchema = requiredObjects.length > 0
    && requiredObjects.every((name) => existingObjects.includes(name));
  const expectedChecksum = String(condition.expected_checksum_sha256 || "").toLowerCase();
  const actualChecksum = String(checksum || "").toLowerCase();
  const explicitPolicyOnlyRecordOnly = action === "record_only"
    && requiredObjects.length === 0
    && condition.policy_only_record_only === true
    && condition.required_schema_state === "not_applicable";

  if (action === "record_only") {
    if (Number(authorization.allow_record_only) !== 1) {
      return { action: "blocked", status: "authorization_blocked", reason: "record_only_not_allowed" };
    }
    if (requiredObjects.length === 0 && !explicitPolicyOnlyRecordOnly) {
      return {
        action: "blocked",
        status: "schema_evidence_incomplete",
        reason: "record_only_requires_explicit_policy_only_contract",
      };
    }
    if (explicitPolicyOnlyRecordOnly) {
      if (Number(authorization.allow_apply) !== 0) {
        return {
          action: "blocked",
          status: "authorization_blocked",
          reason: "policy_only_record_only_apply_must_be_disabled",
        };
      }
      if (!/^[a-f0-9]{64}$/.test(expectedChecksum) || expectedChecksum !== actualChecksum) {
        return {
          action: "blocked",
          status: "checksum_mismatch",
          reason: "policy_only_record_only_checksum_mismatch",
        };
      }
      return {
        action: "record_only",
        status: "ready",
        reason: "explicit_rule_and_checksum_bound_policy_only_contract",
      };
    }
    if (!completeSchema) {
      return { action: "blocked", status: "schema_evidence_incomplete", reason: "record_only_requires_complete_schema" };
    }
    return { action: "record_only", status: "ready", reason: "explicit_rule_and_complete_schema_evidence" };
  }

  if (action === "apply") {
    if (Number(authorization.allow_apply) !== 1) {
      return { action: "blocked", status: "authorization_blocked", reason: "apply_not_allowed" };
    }
    if (completeSchema) {
      return { action: "blocked", status: "schema_already_complete", reason: "use_record_only_rule_instead_of_reapplying" };
    }
    return { action: "apply", status: "ready", reason: "explicit_rule_and_schema_gap" };
  }
  return { action: "diagnose_only", status: "diagnose_only", reason: "rule_action_is_non_mutating" };
}
