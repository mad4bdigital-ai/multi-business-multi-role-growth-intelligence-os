import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8");

const record = JSON.parse(read(
  "specs/012-tenant-activation-lifecycle/implementation/pr-2j-t007a-t029d-slo-baseline-readiness.json",
));
const narrative = read(
  "specs/012-tenant-activation-lifecycle/implementation/pr-2j-t007a-t029d-slo-baseline-readiness.md",
);
const tasks = read("specs/012-tenant-activation-lifecycle/tasks.md");
const adr = read(
  "specs/012-tenant-activation-lifecycle/decisions/ADR-005-governed-interactive-policy-questionnaire-engine.md",
);
const dataModel = read("specs/012-tenant-activation-lifecycle/data-model.md");

assert.deepEqual(record.task_ids, ["T007A", "T029D"]);
assert.equal(record.status, "measurement_contract_ready_production_baseline_required");
assert.equal(record.authority.questionnaire_is_runtime_authority, false);
assert.equal(record.authority.runtime_policy_authority, "governed_sql_registry");
assert.equal(record.measurement_contract.environment, "production");
assert.equal(record.measurement_contract.collection_mode, "read_only_aggregated_no_secret");
assert.equal(record.measurement_contract.production_measurement_performed, false);
assert.equal(record.measurement_contract.baseline_registered, false);
assert.equal(record.measurement_contract.baseline_readback_complete, false);
assert.equal(
  record.measurement_contract.minimum_sample_policy.approved_minimum_sample_count,
  null,
);
assert.equal(
  record.measurement_contract.minimum_sample_policy.approved_minimum_window_duration,
  null,
);
assert.equal(record.measurement_contract.minimum_sample_policy.approval_required, true);

assert.match(tasks, /^- \[ \] \*\*T007A\*\*/mu);
assert.match(tasks, /^- \[ \] \*\*T029D\*\*/mu);
assert.match(adr, /exact production thresholds are measured and versioned as policy profiles/u);
assert.match(adr, /`fast`/u);
assert.match(adr, /`balanced`/u);
assert.match(adr, /`complete`/u);
assert.match(adr, /`high_reliability`/u);
assert.match(dataModel, /## Stage catalog/u);
assert.match(narrative, /does not measure Production/u);
assert.match(narrative, /T007A remains open/u);
assert.match(narrative, /T029D remains open/u);

const expectedProfiles = new Set(["fast", "balanced", "complete", "high_reliability"]);
assert.deepEqual(
  new Set(record.starter_profiles.map(profile => profile.profile_key)),
  expectedProfiles,
);
for (const profile of record.starter_profiles) {
  assert.equal(profile.status, "unpublished");
  assert.equal(profile.profile_version, null);
  assert.equal(profile.source_baseline_id, null);
  assert.equal(profile.policy_values, null);
  assert.equal(profile.safety_bounds_approved, false);
  assert.equal(profile.impact_model_validated, false);
  assert.equal(profile.rollout_plan_approved, false);
  assert.equal(profile.rollback_plan_approved, false);
}

const requiredMetrics = new Set(record.measurement_contract.required_metrics);
for (const metric of [
  "sample_count",
  "success_count",
  "degraded_count",
  "failure_count",
  "timeout_count",
  "rate_limited_count",
  "unknown_outcome_count",
  "reconciliation_count",
  "latency_ms_p50",
  "latency_ms_p95",
  "latency_ms_p99",
]) {
  assert.equal(requiredMetrics.has(metric), true, `${metric} must remain required`);
}

const expectedStages = new Set([
  "oauth_authorize",
  "identity_verify",
  "oauth_code_issue",
  "oauth_token_exchange",
  "gateway_verify",
  "membership_resolve",
  "session_context",
  "workspace_resolve",
  "bootstrap_config",
  "connection_resolve",
  "provider_validate",
  "tool_discovery",
  "dispatch_prepare",
  "dispatch_execute",
  "readback",
  "response_prepare",
  "delivery",
  "acknowledgement",
  "reconciliation",
  "deployment_verify",
]);
assert.deepEqual(new Set(record.stage_scope), expectedStages);

assert.equal(record.t029d_adapter_gate.adapter_implementation_authorized, false);
assert.equal(record.approval_gate.operations_approval_registered, false);
assert.equal(record.approval_gate.product_approval_registered, false);
assert.equal(record.approval_gate.security_approval_registered, false);
assert.equal(record.approval_gate.profile_publish_authorized, false);
assert.equal(record.approval_gate.tasks_complete, false);
assert.equal(record.non_effects.production_query_performed, false);
assert.equal(record.non_effects.production_data_read, false);
assert.equal(record.non_effects.profile_published, false);
assert.equal(record.non_effects.adapter_implemented, false);
assert.equal(record.non_effects.database_mutation_performed, false);
assert.equal(record.non_effects.deployment_performed, false);
assert.equal(record.non_effects.secrets_included, false);

console.log("Spec 012 T007A/T029D SLO baseline readiness tests passed");
