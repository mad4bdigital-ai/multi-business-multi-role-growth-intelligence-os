import assert from "node:assert/strict";
import {
  assessDatabaseLifecycleMutationReadiness,
  buildRepositoryAuditSupersessionPlan,
  buildResponseChunkTtlPilotPlan,
  reconcileResponseChunkTtlPilot,
  DATABASE_LIFECYCLE_DISABLED_FOLLOWUPS,
} from "./databaseLifecycleMutationReadiness.js";

const plan = {
  plan_id: "dbplan_abc",
  plan_fingerprint: `sha256:${"a".repeat(64)}`,
  resource_uri: "mysql://growthOS/governed_tool_response_chunks",
  recipe_key: "database.response_chunks.expired_cleanup",
};
const expires = "2026-08-15T00:00:00.000Z";
const readiness = assessDatabaseLifecycleMutationReadiness({
  plan,
  environment_key: "staging",
  now: new Date("2026-08-14T00:00:00.000Z"),
  authority_binding: { authority_binding_id: "auth-1", resource_type: "database_table", resource_uri: plan.resource_uri, recipe_key: plan.recipe_key, principal_id: "principal-1", expires_at: expires, policy_revision: "policy-1" },
  capability_envelope: { envelope_id: "env-1", plan_fingerprint: plan.plan_fingerprint, resource_uri: plan.resource_uri, recipe_key: plan.recipe_key, expires_at: expires, secrets_included: false },
  execution_lease: { lease_id: "lease-1", plan_fingerprint: plan.plan_fingerprint, resource_uri: plan.resource_uri, recipe_key: plan.recipe_key, expires_at: expires },
  typed_approval: { approval_id: "approval-1", plan_id: plan.plan_id, plan_fingerprint: plan.plan_fingerprint, resource_uri: plan.resource_uri, recipe_key: plan.recipe_key, approved_by: "reviewer-1", approved_at: "2026-08-13T23:00:00.000Z", expires_at: expires, risk_class: "medium" },
  receipt_readiness: { persistence_available: true, idempotency_key_supported: true, unknown_outcome_reconciliation_available: true, same_cycle_readback_available: true, readback_source_same_authority: true },
});
assert.equal(readiness.readiness_status, "ready_for_final_authority_consumption");
assert.equal(readiness.authority_granted_by_track_b, false);
assert.equal(readiness.database_mutated, false);
assert.equal(readiness.durable_execution_started, false);

const productionBlocked = assessDatabaseLifecycleMutationReadiness({ plan, environment_key: "Production", now: new Date("2026-08-14T00:00:00Z") });
assert.ok(productionBlocked.blockers.includes("DATABASE_TRACK_B_PRODUCTION_MUTATION_FORBIDDEN"));

const ttl = buildResponseChunkTtlPilotPlan({
  cutoff_at: "2026-08-13T00:00:00Z",
  plan_created_at: "2026-08-14T00:00:00Z",
  candidates: [
    { candidate_key: "expired", expires_at: "2026-08-12T00:00:00Z", created_at: "2026-08-10T00:00:00Z" },
    { candidate_key: "fresh", expires_at: "2026-08-15T00:00:00Z", created_at: "2026-08-10T00:00:00Z" },
    { candidate_key: "post-plan", expires_at: "2026-08-12T00:00:00Z", created_at: "2026-08-15T00:00:00Z" },
  ],
  batch_size: 1,
  environment_key: "staging",
});
assert.equal(ttl.ok, true);
assert.deepEqual(ttl.batches[0].candidate_keys, ["expired"]);
assert.equal(ttl.preserved_candidate_count, 2);
assert.equal(ttl.physical_reclaim_assessment.automatic_compaction, false);
assert.equal(ttl.execution_allowed, false);
assert.equal(ttl.database_mutated, false);

const unknown = reconcileResponseChunkTtlPilot({ plan: ttl, receipts: [{ batch_id: ttl.batches[0].batch_id, plan_fingerprint: ttl.plan_fingerprint, idempotency_key: ttl.batches[0].expected_receipt_idempotency_key }], readback: [] });
assert.equal(unknown.outcomes[0].status, "unknown_outcome_readback_required");
assert.equal(unknown.blind_retry_allowed, false);

const supersession = buildRepositoryAuditSupersessionPlan({
  findings: [
    { finding_id: "f1", file_key: "a.js", parent_run_id: "r1", observed_at: "2026-08-10T00:00:00Z" },
    { finding_id: "f2", file_key: "a.js", parent_run_id: "r2", observed_at: "2026-08-12T00:00:00Z" },
    { finding_id: "f3", file_key: "b.js", parent_run_id: "r3", observed_at: "2026-08-11T00:00:00Z" },
    { finding_id: "f4", file_key: "b.js", parent_run_id: "r4", observed_at: "2026-08-13T00:00:00Z" },
  ],
  runs: [
    { run_id: "r1", status: "completed" },
    { run_id: "r2", status: "completed" },
    { run_id: "r3", status: "running" },
    { run_id: "r4", status: "completed" },
  ],
  policy_approval_present: false,
});
assert.deepEqual(supersession.candidates.map((entry) => entry.finding_id), ["f1"]);
assert.ok(supersession.preserved_findings.some((entry) => entry.finding_id === "f3" && entry.preservation_reason === "parent_run_non_terminal"));
assert.ok(supersession.blockers.includes("SUPERSESSION_POLICY_APPROVAL_REQUIRED_FOR_EXECUTION"));
assert.equal(supersession.concurrent_newer_row_guard.reject_if_newer_observation_appears, true);
assert.equal(supersession.execution_allowed, false);
assert.deepEqual(DATABASE_LIFECYCLE_DISABLED_FOLLOWUPS, { job_runner: false, autopilot: false, engine_run_archive_thin: false, physical_reclaim_execution: false });

const wildcardBlocked = assessDatabaseLifecycleMutationReadiness({
  plan: { ...plan, resource_uri: "mysql://growthOS/*" },
  environment_key: "staging",
  now: new Date("2026-08-14T00:00:00Z"),
});
assert.ok(wildcardBlocked.blockers.includes("DATABASE_RESOURCE_NOT_EXACT"));
assert.ok(wildcardBlocked.blockers.includes("DATABASE_RECIPE_RESOURCE_MISMATCH"));

const recipeInjectionBlocked = assessDatabaseLifecycleMutationReadiness({
  plan: { ...plan, recipe_key: "database.response_chunks.expired_cleanup;DROP_TABLE" },
  environment_key: "staging",
  now: new Date("2026-08-14T00:00:00Z"),
});
assert.ok(recipeInjectionBlocked.blockers.includes("DATABASE_RECIPE_NOT_REGISTERED"));

console.log("database lifecycle mutation readiness tests passed");
