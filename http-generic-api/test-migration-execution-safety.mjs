import assert from "node:assert/strict";
import {
  MIGRATION_EXECUTION_SAFETY_CONTRACT,
  buildMigrationArtifactBinding,
  createBoundedEmergencyReceipt,
  createDurableExecutionStateMachine,
  createStatementBoundaryGuard,
  createStatementExecutionJournal,
  evaluateMigrationExecutionPreflight,
  recordStatementJournalEvent,
  finalizeLedgerFromPostcondition,
  normalizeMigrationArtifact,
  reconcileExecutionOutcome,
  sha256,
  validateStatementJournal,
} from "./migrationExecutionSafety.js";
import { splitMigrationSqlStatements } from "./migrationSqlStatements.js";

const rawSql = "-- fixture\r\nALTER TABLE demo ADD COLUMN flag INT NULL;\r\nUPDATE demo SET flag = 1 WHERE flag IS NULL;\r\n";
const statements = [
  "ALTER TABLE demo ADD COLUMN flag INT NULL",
  "UPDATE demo SET flag = 1 WHERE flag IS NULL",
];
const binding = buildMigrationArtifactBinding({ migration: "fixture.sql", rawSql, statements });
assert.equal(binding.ok, true);
assert.equal(binding.binding.statement_count, 2);
assert.notEqual(binding.binding.raw_artifact_sha256, binding.binding.normalized_artifact_sha256);
assert.equal(binding.binding.raw_artifact_sha256, sha256(rawSql));
assert.equal(binding.binding.normalized_artifact_sha256, sha256(normalizeMigrationArtifact(rawSql)));
assert.equal(binding.binding.statement_fingerprints.length, 2);
assert.equal(binding.binding.statement_fingerprints[0].step_index, 1);
assert.equal(binding.binding.secrets_included, false);
const parserFixture = "INSERT INTO demo (payload) VALUES ('semi;colon -- not a comment'); -- comment;\nUPDATE demo SET flag = 1 WHERE id = 1;";
const parserStatements = splitMigrationSqlStatements(parserFixture);
assert.equal(parserStatements.length, 2);
assert.match(parserStatements[0], /semi;colon/);
assert.match(parserStatements[1], /UPDATE demo/);

const mismatch = buildMigrationArtifactBinding({
  migration: "fixture.sql",
  rawSql,
  statements,
  expectedExecutionBundleSha256: "0".repeat(64),
});
assert.equal(mismatch.ok, false);
assert.deepEqual(mismatch.mismatches, ["execution_bundle_checksum_mismatch"]);

const journal = createStatementExecutionJournal({ statements, preconditionHash: sha256("schema-before") });
assert.equal(journal.length, 2);
assert.equal(validateStatementJournal(journal, journal.map((entry) => entry.statement_fingerprint)).ok, true);
const completedJournal = journal.map((entry, index) => ({
  ...entry,
  state: "completed",
  postcondition_hash: sha256(`schema-after-${index + 1}`),
  result_class: "success",
}));
assert.equal(validateStatementJournal(completedJournal, journal.map((entry) => entry.statement_fingerprint)).ok, true);
assert.equal(validateStatementJournal([{ ...completedJournal[0], statement_fingerprint: "bad" }, completedJournal[1]], journal.map((entry) => entry.statement_fingerprint)).ok, false);
const startedJournal = recordStatementJournalEvent(journal, {
  stepIndex: 1,
  state: "started",
  preconditionHash: sha256("schema-before"),
  startedAt: "2026-08-27T00:00:00.000Z",
  resultClass: "running",
});
const eventCompletedJournal = recordStatementJournalEvent(startedJournal, {
  stepIndex: 1,
  state: "completed",
  preconditionHash: sha256("schema-before"),
  postconditionHash: sha256("schema-after"),
  completedAt: "2026-08-27T00:00:01.000Z",
  resultClass: "success",
});
assert.equal(eventCompletedJournal[0].state, "completed");
await assert.rejects(async () => recordStatementJournalEvent(eventCompletedJournal, {
  stepIndex: 1,
  state: "started",
  preconditionHash: sha256("schema-before"),
}), { code: "migration_statement_journal_state_regression" });

const completePlan = {
  target_role: "runtime_persistence",
  credential_binding: { role: "runtime_persistence" },
  expected_runtime_sha: "runtime-sha-1",
  expected_target_fingerprint: "target-fingerprint-1",
  expected_schema_precondition_fingerprint: "schema-before-1",
  required_mysql_version: "8.0.0",
  artifact: {
    migration: "fixture.sql",
    raw_artifact_sha256: binding.binding.raw_artifact_sha256,
    normalized_artifact_sha256: binding.binding.normalized_artifact_sha256,
    execution_bundle_sha256: binding.binding.execution_bundle_sha256,
    dependencies: [{ migration: "base.sql", required_state: "applied" }],
  },
  execution_profile: {
    expected_algorithm: "INSTANT",
    expected_lock: "NONE",
    estimated_impact: "small_backfill",
    traffic_mode: "degraded_mode_required",
    backfill_mode: "single_statement",
    single_update_safe_row_threshold: 1000,
  },
  timeout_budget: {
    metadata_lock_timeout_ms: 5000,
    row_lock_timeout_ms: 5000,
    statement_timeout_ms: 30000,
    provider_timeout_ms: 45000,
    recovery_lease_ttl_ms: 90000,
    heartbeat_interval_ms: 10000,
    workflow_timeout_ms: 120000,
  },
  approval: { status: "approved", approval_id: "123e4567-e89b-12d3-a456-426614174000" },
  traffic_gate: { status: "pass" },
};
const completeRuntime = {
  target_role: "runtime_persistence",
  runtime_sha: "runtime-sha-1",
  target_fingerprint: "target-fingerprint-1",
  schema_precondition_fingerprint: "schema-before-1",
  default_engine: "InnoDB",
  server_version: "8.0.36",
  replication: { enabled: false, lag_seconds: 0 },
  backup: { recent_checkpoint: true },
};
const completeLocks = { blocking_metadata_locks: 0, long_running_transactions: 0, open_target_transactions: 0, lock_queue_length: 0 };
const completeCapacity = { free_disk_bytes: 1000000, estimated_required_bytes: 1000, row_count: 10 };
const completeSession = {
  sql_mode: "STRICT_TRANS_TABLES",
  time_zone: "+00:00",
  transaction_isolation: "REPEATABLE-READ",
  character_set_client: "utf8mb4",
  collation_connection: "utf8mb4_unicode_ci",
  foreign_key_checks: 1,
  autocommit: 1,
};
const completeHealth = {
  api_healthy: true,
  db_connections_healthy: true,
  db_latency_healthy: true,
  no_open_recovery_incident: true,
  no_unknown_prior_outcome: true,
};
const pass = evaluateMigrationExecutionPreflight({
  plan: completePlan,
  binding: binding.binding,
  runtime: completeRuntime,
  metadataLocks: completeLocks,
  capacity: completeCapacity,
  session: completeSession,
  health: completeHealth,
});
assert.equal(pass.ok, true);
assert.equal(pass.status, "pass");
assert.equal(pass.safety.database_mutation_performed, false);
assert.equal(pass.safety.provider_access_performed, false);

const blocked = evaluateMigrationExecutionPreflight({
  plan: completePlan,
  binding: binding.binding,
  runtime: { ...completeRuntime, target_role: "governance", target_fingerprint: "changed" },
  metadataLocks: { ...completeLocks, blocking_metadata_locks: 1 },
  capacity: completeCapacity,
  session: completeSession,
  health: { ...completeHealth, no_unknown_prior_outcome: false },
  previousOutcome: { execution_outcome_unknown: true },
});
assert.equal(blocked.ok, false);
assert.ok(blocked.problems.some((entry) => entry.code === "runtime_sha_mismatch" || entry.code === "target_fingerprint_mismatch"));
assert.ok(blocked.problems.some((entry) => entry.code === "target_role_mismatch"));
assert.ok(blocked.problems.some((entry) => entry.code === "blocking_metadata_locks_present"));
assert.ok(blocked.problems.some((entry) => entry.code === "previous_execution_outcome_unknown"));

const events = [];
let clock = 0;
const boundary = createStatementBoundaryGuard({
  assertFence: async () => events.push("fence"),
  heartbeat: async () => events.push("heartbeat"),
  heartbeatIntervalMs: 10,
  now: () => clock,
});
await boundary.beforeStatement();
clock = 11;
await boundary.whileWaiting();
await boundary.beforeSuccessRecord();
assert.equal(events.filter((event) => event === "fence").length, 3);
assert.ok(events.filter((event) => event === "heartbeat").length >= 2);
assert.equal(events.at(-1), "heartbeat");

const transitions = [];
const machine = createDurableExecutionStateMachine({
  persist: async (event) => {
    transitions.push(event);
    return { durable: true };
  },
});
for (const state of ["claimed", "executing", "provider_returned", "verifying", "verified", "finalized"]) await machine.transition(state);
assert.equal(machine.state, "finalized");
assert.equal(transitions.length, 6);
await assert.rejects(() => machine.transition("approved"), { code: "migration_execution_transition_invalid" });

const nonDurableMachine = createDurableExecutionStateMachine({ persist: async () => false });
await assert.rejects(() => nonDurableMachine.transition("claimed"), { code: "migration_execution_transition_not_durable" });
assert.equal(nonDurableMachine.state, "approved");

assert.deepEqual(reconcileExecutionOutcome({ providerReturned: true, databasePostcondition: "pass" }).state, "verified");
assert.deepEqual(reconcileExecutionOutcome({ providerReturned: true, databasePostcondition: "fail" }).state, "partial_execution");
assert.deepEqual(reconcileExecutionOutcome({ providerReturned: true, databasePostcondition: "unknown" }).state, "execution_outcome_unknown");
assert.deepEqual(reconcileExecutionOutcome({ providerReturned: false, databasePostcondition: "unknown" }).state, "not_executed");
assert.equal(finalizeLedgerFromPostcondition({ databasePostcondition: "pass", ledgerWrite: { ok: false } }).state, "applied_unrecorded");
assert.equal(finalizeLedgerFromPostcondition({ databasePostcondition: "pass", ledgerWrite: { ok: true } }).state, "finalized");
assert.equal(finalizeLedgerFromPostcondition({ databasePostcondition: "fail", ledgerWrite: { ok: true } }).reconciliation_required, true);

const emergencyReceipt = createBoundedEmergencyReceipt({
  runId: "run-1",
  migration: "fixture.sql",
  sha: sha256(rawSql),
  target: "role-a",
  result: "unknown",
  postconditions: [{ name: "schema", status: "unknown", ticket_id: "must-not-escape" }],
  reconciliationState: "required",
});
assert.equal(emergencyReceipt.run_id, "run-1");
assert.equal(emergencyReceipt.reconciliation_state, "required");
assert.equal(Object.prototype.hasOwnProperty.call(emergencyReceipt, "ticket_id"), false);
assert.equal(JSON.stringify(emergencyReceipt).includes("must-not-escape"), false);
assert.equal(MIGRATION_EXECUTION_SAFETY_CONTRACT.fail_closed_defaults, true);
assert.equal(MIGRATION_EXECUTION_SAFETY_CONTRACT.live_execution_enabled, false);
assert.equal(MIGRATION_EXECUTION_SAFETY_CONTRACT.secrets_included, false);

console.log(JSON.stringify({
  ok: true,
  test: "migration_execution_safety",
  checks: [
    "normalized_artifact_binding",
    "statement_journal",
    "preflight_gates",
    "statement_boundary_fencing",
    "durable_state_machine",
    "unknown_outcome_reconciliation",
    "bounded_emergency_receipt",
  ],
  database_mutation_performed: false,
  provider_access_performed: false,
  secrets_included: false,
}, null, 2));
