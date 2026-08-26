import assert from "node:assert/strict";
import test from "node:test";
import {
  EXCEPTION_CLASSES,
  EXCEPTION_APPROVAL_POLICY,
  NON_BYPASSABLE_INVARIANTS,
  RECOVERY_MODES,
  RECOVERY_PLANE_LEVELS,
  appendEvidenceChainEvent,
  buildPrivilegedLeasePreview,
  buildPrivilegedOperationPreview,
  buildRecoveryCancelPreview,
  buildRecoveryExceptionPreview,
  buildReconciliationPreview,
  buildRecoveryIncident,
  observeSecretSafely,
} from "./recoveryExceptionFramework.js";

const SHA = "a".repeat(40);
const FP = "b".repeat(64);
const ADMIN = { verified: true, binding: "test_admin_guard" };
const BASE = { incident_id: "incident:exception-contract-001", environment: "production", expected_sha: SHA, target_key: "production-runtime", target_fingerprint: FP };

test("recovery plane levels and formal modes are explicit", () => {
  assert.equal(RECOVERY_PLANE_LEVELS.R0, "observe");
  assert.equal(RECOVERY_PLANE_LEVELS.R4, "privileged_recovery");
  assert.equal(RECOVERY_PLANE_LEVELS.R5, "disaster_recovery");
  assert.ok(RECOVERY_MODES.includes("RECOVERY_PRIVILEGED"));
  assert.equal(EXCEPTION_CLASSES.E6, "disaster");
  assert.equal(EXCEPTION_APPROVAL_POLICY.E6.required_approvals, 2);
});

test("incident object precedes privileged recovery and is hash-bound", () => {
  const incident = buildRecoveryIncident({ ...BASE, production_sha: SHA, severity: "high", symptoms: ["mcp_catalog_unavailable"], recovery_level: "R4" }, { adminPrincipal: ADMIN });
  assert.equal(incident.incident_id, BASE.incident_id);
  assert.equal(incident.recovery_mode, "RECOVERY_PRIVILEGED");
  assert.equal(incident.principal_bound, true);
  assert.equal(incident.incident_hash.length, 64);
  assert.equal(incident.secrets_included, false);
});

test("privileged operation preview carries scope/TTL/budget/approval and never executes", () => {
  const preview = buildPrivilegedOperationPreview({ ...BASE, operation_type: "sql_statement", transport: "sql", profile: "Q5", scope_ref: "scope:governance", artifact_sha256: "c".repeat(64), risk_class: "destructive", exception_class: "E6", expires_at: new Date(Date.now() + 120_000).toISOString() }, { adminPrincipal: ADMIN });
  assert.equal(preview.execution_allowed, false);
  assert.equal(preview.session_opened, false);
  assert.equal(preview.required_approvals, 2);
  assert.equal(preview.capability_budget.max_statements, 1);
  assert.ok(preview.required_evidence.includes("same_cycle_readback"));
  assert.deepEqual(preview.non_bypassable_invariants, [...NON_BYPASSABLE_INVARIANTS]);
});

test("privileged lease is short-lived, owner-bound, heartbeat-aware, and unopened", () => {
  const lease = buildPrivilegedLeasePreview({ ...BASE, transport: "ssh", scope_ref: "scope:read-only", expires_at: new Date(Date.now() + 120_000).toISOString(), max_commands: 50 }, { adminPrincipal: ADMIN });
  assert.equal(lease.session_opened, false);
  assert.equal(lease.owner_bound, true);
  assert.equal(lease.heartbeat_required, true);
  assert.equal(lease.max_commands, 50);
  assert.equal(lease.lease_hash.length, 64);
});

test("exception preview supports E0-E6 but grants no authority and prevents unbounded nesting", () => {
  const exception = buildRecoveryExceptionPreview({ ...BASE, exception_class: "E4", scope_ref: "scope:sql-q5", reason: "Normal registered capabilities do not cover this bounded incident repair.", expires_at: new Date(Date.now() + 120_000).toISOString(), depends_on: ["exception:identity-001"] }, { adminPrincipal: ADMIN });
  assert.equal(exception.status, "awaiting_approval");
  assert.equal(exception.max_uses, 1);
  assert.equal(exception.execution_allowed, false);
  assert.deepEqual(exception.exception_graph_dependencies, ["exception:identity-001"]);
  assert.equal(exception.exception_hash.length, 64);
});

test("unknown outcome reconciliation and cancel are readback-first contracts", () => {
  const reconciliation = buildReconciliationPreview({ ...BASE, incident_id: "incident:reconcile-contract-001", run_id: "run:reconcile-contract-001", plan_hash: "c".repeat(64) }, { adminPrincipal: ADMIN });
  assert.equal(reconciliation.observed_outcome, "execution_outcome_unknown");
  assert.equal(reconciliation.retry_allowed, false);
  assert.equal(reconciliation.mutation_allowed, false);
  assert.ok(reconciliation.allowed_actions.includes("same_cycle_readback"));
  const cancel = buildRecoveryCancelPreview({ ...BASE, incident_id: "incident:cancel-contract-001", run_id: "run:cancel-contract-001", plan_hash: "d".repeat(64), reason: "Stop all future steps while the provider outcome is reconciled." }, { adminPrincipal: ADMIN });
  assert.equal(cancel.stops_future_steps, true);
  assert.equal(cancel.rollback_automatic, false);
  assert.equal(cancel.reconciliation_required, true);
  assert.equal(cancel.execution_allowed, false);
});

test("evidence chain is tamper-evident and secret observation is metadata-only", () => {
  const first = appendEvidenceChainEvent({ event: { type: "pre_state_snapshot", incident_id: BASE.incident_id } });
  const second = appendEvidenceChainEvent({ previous_hash: first.event_hash, event: { type: "preview_created", preview_hash: "d".repeat(64) } });
  assert.equal(first.chain_valid, true);
  assert.equal(second.previous_hash, first.event_hash);
  assert.notEqual(first.event_hash, second.event_hash);
  assert.equal(second.secrets_included, false);
  const secret = observeSecretSafely({ configured: true, value_hash: "e".repeat(64), age_seconds: 42 });
  assert.equal(secret.configured, true);
  assert.equal(secret.secret_fingerprint.length, 64);
  assert.equal(secret.raw_value_returned, false);
  assert.equal(secret.secrets_included, false);
});

test("privileged contracts reject unknown target and unverified principal", () => {
  assert.throws(() => buildRecoveryIncident({ ...BASE, target_key: "unknown-host", recovery_level: "R4" }, { adminPrincipal: ADMIN }), (error) => error?.code === "TARGET_IDENTITY_MISMATCH");
  assert.throws(() => buildRecoveryIncident({ ...BASE, recovery_level: "R4" }, { adminPrincipal: { verified: false } }), (error) => error?.code === "RECOVERY_ADMIN_PRINCIPAL_REQUIRED");
});
