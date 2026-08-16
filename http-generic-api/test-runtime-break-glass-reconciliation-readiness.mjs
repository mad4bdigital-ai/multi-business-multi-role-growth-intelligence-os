import assert from "node:assert/strict";
import { assessRuntimeBreakGlassReconciliationReadiness, buildRuntimeBreakGlassRollbackRehearsal } from "./runtimeBreakGlassReconciliationReadiness.js";

const commit = "a".repeat(40);
const now = new Date("2026-08-14T00:30:00Z");
const incident = {
  break_glass_id: "bg-1",
  incident_id: "incident-1",
  expected_commit_sha: commit,
  authorization_expires_at: "2026-08-14T02:00:00Z",
  allowed_paths: ["/home/u/domains/example.com/nodejs/server.js"],
  rollback_plan: { strategy: "restore pre-change hashes then governed clean redeploy" },
};
const evidence = {
  git_representation: { present: true, commit_sha: commit, repository_path: "http-generic-api/server.js", path_hashes: [{ path: incident.allowed_paths[0], sha256: "b".repeat(64) }] },
  main_reachability: { reachable: true, commit_sha: commit, verified_at: "2026-08-14T00:10:00Z" },
  staging_verification: { verified: true, commit_sha: commit, verified_at: "2026-08-14T00:12:00Z" },
  production_promotion: { governed_flow: true, production_sha: "c".repeat(40), contains_expected_commit: true, promoted_at: "2026-08-14T00:15:00Z" },
  clean_redeploy: { clean: true, production_sha: "c".repeat(40), deployed_sha: "c".repeat(40), deployed_at: "2026-08-14T00:20:00Z" },
  clean_runtime_readback: { clean: true, deployed_sha: "c".repeat(40), unreconciled_local_difference_count: 0, verified_at: "2026-08-14T00:22:00Z" },
  replay_guard: { event_id: "event-1", prior_event_ids: [], incident_id: "incident-1" },
};
const ready = assessRuntimeBreakGlassReconciliationReadiness({ incident, evidence, now, max_evidence_age_seconds: 3600 });
assert.equal(ready.readiness_status, "ready_for_runtime_authority_consumption");
assert.equal(ready.runtime_transition_activation, false);
assert.equal(ready.production_mutated, false);
assert.equal(ready.database_mutated, false);

const stale = assessRuntimeBreakGlassReconciliationReadiness({ incident, evidence: { ...evidence, staging_verification: { ...evidence.staging_verification, verified_at: "2026-08-13T20:00:00Z" } }, now, max_evidence_age_seconds: 3600 });
assert.ok(stale.blockers.includes("BREAK_GLASS_STAGING_VERIFICATION_INCOMPLETE"));

const replay = assessRuntimeBreakGlassReconciliationReadiness({ incident, evidence: { ...evidence, replay_guard: { event_id: "event-1", prior_event_ids: ["event-1"], incident_id: "incident-1" } }, now });
assert.ok(replay.blockers.includes("BREAK_GLASS_REPLAY_DETECTED"));

const expired = assessRuntimeBreakGlassReconciliationReadiness({ incident: { ...incident, authorization_expires_at: "2026-08-13T23:00:00Z" }, evidence, now });
assert.ok(expired.blockers.includes("BREAK_GLASS_AUTHORIZATION_EXPIRED"));

const rollback = buildRuntimeBreakGlassRollbackRehearsal({ incident, rollback_evidence: { rehearsal_id: "rr-1", scope_matches_incident: true, pre_change_hash_restore_verified: true, runtime_readback_clean: true, verified_at: "2026-08-14T00:25:00Z" }, now });
assert.equal(rollback.rehearsal_status, "pass");
assert.equal(rollback.rollback_executed, false);
assert.equal(rollback.runtime_mutation_performed, false);

console.log("runtime break-glass reconciliation readiness tests passed");
