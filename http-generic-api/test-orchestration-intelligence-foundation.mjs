import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("migrations/261_sprint68_orchestration_intelligence_foundation.sql", "utf8");
const releaseReadiness = readFileSync("releaseReadiness.js", "utf8");

const requiredTables = [
  "platform_orchestration_plugins",
  "platform_orchestration_stages",
  "platform_orchestration_edges",
  "platform_orchestration_state_snapshots",
  "platform_orchestration_recommendations",
];

for (const table of requiredTables) {
  assert(
    migration.includes(`CREATE TABLE IF NOT EXISTS \`${table}\``),
    `migration must create ${table}`
  );
}

const noSecretCheckCount = (migration.match(/CHECK \(`secrets_included` = 0\)/g) || []).length;
assert(
  noSecretCheckCount >= requiredTables.length,
  "each orchestration foundation table must have a no-secret check"
);

const requiredSeeds = [
  "orchestration_intelligence_foundation_policy_v1",
  "orchestration_intelligence_engine",
  "orchestration_intelligence_policy_v1",
  "orchestration_intelligence_default_rule_v1",
  "orchestration_intelligence_bypass_deny_rule_v1",
  "orchestration_intelligence_approval_rule_v1",
  "orchestration_intelligence_readback_rule_v1",
  "orchestration_intelligence_no_secret_rule_v1",
  "orchestration_intelligence_degraded_fallback_rule_v1",
  "ads_provider_governance_orchestrator",
  "ads_provider.profile",
  "ads_provider.preflight_contract",
  "ads_provider.preflight_surface_blueprint",
  "ads_provider.credential_readiness",
  "ads_provider.budget_authority",
  "ads_provider.execution_enablement",
  "ads_provider.execution_adapter_candidate",
];

for (const seed of requiredSeeds) {
  assert(migration.includes(seed), `migration must seed ${seed}`);
}

const forbiddenSql = /\b(DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM)\b/i;
assert(!forbiddenSql.test(migration), "foundation migration must not contain destructive SQL");

for (const requiredSafetyFlag of [
  "no_provider_call",
  "no_spend_change",
  "no_credential_payload_read",
  "execution_enabled_default",
  "secrets_included",
  "diagnose_only",
  "recommendation_only",
]) {
  assert(migration.includes(requiredSafetyFlag), `migration must include ${requiredSafetyFlag}`);
}

assert(
  migration.includes("provider_execution_allowed',false") || migration.includes("provider_execution_allowed",),
  "execution adapter candidate must remain recommendation-only and not provider execution"
);
assert(
  migration.includes("INSERT INTO `platform_engine_policy_rules`"),
  "engine must have active policy rules"
);
assert(
  migration.match(/orchestration_intelligence_.*_rule_v1/g)?.length >= 6,
  "orchestration intelligence engine must have at least six policy rules"
);
assert(
  releaseReadiness.includes("261_sprint68_orchestration_intelligence_foundation.sql"),
  "release readiness must track the foundation migration"
);
assert(
  releaseReadiness.includes('policy_key: "orchestration_intelligence_foundation_policy_v1"'),
  "release readiness must require the foundation runtime policy"
);

console.log("orchestration intelligence foundation is schema-seeded, policy-gated, and recommendation-only");
