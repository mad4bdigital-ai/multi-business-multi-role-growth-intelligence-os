import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("migrations/260_sprint68_platform_development_constitution_policies.sql", "utf8");
const releaseReadiness = readFileSync("releaseReadiness.js", "utf8");

const requiredPolicies = [
  "platform_development_constitution_policy_v1",
  "orchestration_first_development_policy_v1",
  "orchestration_state_snapshot_required_policy_v1",
  "recommendation_before_execution_policy_v1",
  "intentional_safety_block_classification_policy_v1",
  "no_hidden_execution_policy_v1",
  "plugin_manifest_completeness_policy_v1",
  "orchestration_stage_graph_completeness_policy_v1",
  "platform_task_quality_gate_policy_v1",
  "tenant_proactive_guidance_policy_v1",
  "validation_semantics_policy_v1",
  "platform_schema_blocker_classification_policy_v1",
  "intelligence_policy_rules_required_policy_v1",
  "model_never_executes_tools_policy_v1",
  "domain_generalization_before_provider_specific_policy_v1",
  "legacy_surface_bridge_policy_v1",
  "session_memory_reliability_policy_v1",
  "release_readiness_orchestration_gate_policy_v1",
  "development_drift_detection_policy_v1",
  "final_pattern_enforcement_policy_v1",
];

for (const policyKey of requiredPolicies) {
  assert(
    migration.includes(policyKey),
    `migration must seed ${policyKey}`
  );
  assert(
    releaseReadiness.includes(`policy_key: "${policyKey}"`),
    `release readiness must require ${policyKey}`
  );
}

assert(
  migration.includes("INSERT INTO `execution_policies`"),
  "constitution policies must seed execution_policies because it is the current enforcement source"
);
assert(
  migration.includes("WHERE NOT EXISTS"),
  "migration must be idempotent"
);
assert(
  migration.includes("JSON_OBJECT"),
  "policy values must be JSON contracts"
);
assert(
  migration.includes("'TRUE'"),
  "seeded policies must be active and blocking"
);
assert(
  releaseReadiness.includes("REQUIRED_RUNTIME_POLICY_SEEDS"),
  "release readiness must keep runtime policy seed enforcement"
);
assert(
  releaseReadiness.includes("required_scope_tokens"),
  "release readiness policy seeds must assert execution_scope tokens"
);
assert(
  releaseReadiness.includes("required_affects_layer_tokens"),
  "release readiness policy seeds must assert affects_layer tokens"
);

console.log("platform development constitution policies are migration-seeded and release-readiness-required");
