import { createHash } from "node:crypto";

const SHA256_HEX = /^[0-9a-f]{64}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ENGINE = new Set(["InnoDB"]);
const DDL_ALGORITHMS = new Set(["INSTANT", "INPLACE", "COPY_ALLOWED"]);
const DDL_LOCKS = new Set(["NONE", "SHARED", "EXCLUSIVE_ALLOWED"]);
const IMPACT_CLASSES = new Set(["metadata_only", "small_backfill", "table_scan", "table_rebuild", "index_build"]);
const TRAFFIC_MODES = new Set(["traffic_safe", "degraded_mode_required", "maintenance_window_required"]);
const TRANSITIONS = Object.freeze([
  "approved",
  "claimed",
  "executing",
  "provider_returned",
  "verifying",
  "verified",
  "finalized",
]);

function text(value) {
  return String(value ?? "");
}

function lower(value) {
  return text(value).trim().toLowerCase();
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

export function sha256(value = "") {
  return createHash("sha256").update(text(value), "utf8").digest("hex");
}

export function normalizeMigrationArtifact(sql = "") {
  return text(sql)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trimEnd() + "\n";
}

export function normalizeStatement(statement = "") {
  return text(statement)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

export function canonicalExecutionBundle(statements = []) {
  return statements.map(normalizeStatement).filter(Boolean).join("\n;\n") + (statements.length ? "\n" : "");
}

function problem(code, details = {}) {
  return { code, ...details };
}

function validSha(value) {
  return SHA256_HEX.test(lower(value));
}

function statementDescriptor(statement, index) {
  const normalized = normalizeStatement(statement);
  return {
    step_index: index + 1,
    statement_fingerprint: sha256(normalized),
    statement_kind: text(normalized).split(/\s+/, 1)[0].toUpperCase() || "UNKNOWN",
    consequential: true,
  };
}

export function buildMigrationArtifactBinding({
  migration,
  rawSql,
  statements = [],
  expectedRawArtifactSha256 = "",
  expectedNormalizedArtifactSha256 = "",
  expectedExecutionBundleSha256 = "",
} = {}) {
  const normalizedArtifact = normalizeMigrationArtifact(rawSql);
  const normalizedStatements = statements.map(normalizeStatement).filter(Boolean);
  const bundle = canonicalExecutionBundle(normalizedStatements);
  const binding = {
    migration: text(migration).trim(),
    raw_artifact_sha256: sha256(rawSql),
    normalized_artifact_sha256: sha256(normalizedArtifact),
    execution_bundle_sha256: sha256(bundle),
    statement_count: normalizedStatements.length,
    statement_fingerprints: normalizedStatements.map((statement, index) => statementDescriptor(statement, index)),
    secrets_included: false,
  };
  const mismatches = [];
  if (expectedRawArtifactSha256 && lower(expectedRawArtifactSha256) !== binding.raw_artifact_sha256) mismatches.push("raw_artifact_checksum_mismatch");
  if (expectedNormalizedArtifactSha256 && lower(expectedNormalizedArtifactSha256) !== binding.normalized_artifact_sha256) mismatches.push("normalized_artifact_checksum_mismatch");
  if (expectedExecutionBundleSha256 && lower(expectedExecutionBundleSha256) !== binding.execution_bundle_sha256) mismatches.push("execution_bundle_checksum_mismatch");
  return {
    ok: mismatches.length === 0,
    binding,
    mismatches,
    blocked_reason: mismatches.length ? "migration_artifact_binding_mismatch" : null,
  };
}

export function createStatementExecutionJournal({ statements = [], preconditionHash = "", previousJournal = [] } = {}) {
  const normalizedStatements = statements.map(normalizeStatement).filter(Boolean);
  const previous = new Map((Array.isArray(previousJournal) ? previousJournal : []).map((entry) => [Number(entry.step_index), entry]));
  return normalizedStatements.map((statement, index) => {
    const stepIndex = index + 1;
    const fingerprint = sha256(statement);
    const prior = previous.get(stepIndex);
    const priorMatches = prior && lower(prior.statement_fingerprint) === fingerprint;
    return {
      step_index: stepIndex,
      statement_fingerprint: fingerprint,
      precondition_hash: validSha(prior?.precondition_hash) ? lower(prior.precondition_hash) : (validSha(preconditionHash) ? lower(preconditionHash) : null),
      postcondition_hash: validSha(prior?.postcondition_hash) ? lower(prior.postcondition_hash) : null,
      state: priorMatches && ["completed", "verified"].includes(prior.state) ? prior.state : "pending",
      result_class: priorMatches ? text(prior.result_class || "pending") : "pending",
      started_at: priorMatches ? prior.started_at || null : null,
      completed_at: priorMatches ? prior.completed_at || null : null,
      reconciliation_required: priorMatches ? prior.reconciliation_required === true : false,
    };
  });
}

export function recordStatementJournalEvent(journal = [], { stepIndex, state, preconditionHash, postconditionHash, resultClass, startedAt, completedAt, reconciliationRequired = false } = {}) {
  const next = (Array.isArray(journal) ? journal : []).map((entry) => ({ ...entry }));
  const index = Number(stepIndex);
  const position = next.findIndex((entry) => Number(entry.step_index) === index);
  if (position === -1) {
    const error = new Error(`Unknown migration statement journal step: ${stepIndex}`);
    error.code = "migration_statement_journal_step_unknown";
    throw error;
  }
  const current = next[position];
  const allowedStates = new Set(["pending", "started", "completed", "verified"]);
  if (!allowedStates.has(state)) {
    const error = new Error(`Invalid migration statement journal state: ${state}`);
    error.code = "migration_statement_journal_state_invalid";
    throw error;
  }
  const stateOrder = { pending: 0, started: 1, completed: 2, verified: 3 };
  if (stateOrder[state] < stateOrder[current.state]) {
    const error = new Error(`Migration statement journal state regression: ${current.state} -> ${state}`);
    error.code = "migration_statement_journal_state_regression";
    throw error;
  }
  if (state !== "pending" && !validSha(preconditionHash || current.precondition_hash)) {
    const error = new Error("Migration statement journal precondition hash is required.");
    error.code = "migration_statement_journal_precondition_missing";
    throw error;
  }
  if (["completed", "verified"].includes(state) && !validSha(postconditionHash)) {
    const error = new Error("Completed migration statement journal entries require a postcondition hash.");
    error.code = "migration_statement_journal_postcondition_missing";
    throw error;
  }
  next[position] = {
    ...current,
    state,
    precondition_hash: validSha(preconditionHash) ? lower(preconditionHash) : current.precondition_hash,
    postcondition_hash: validSha(postconditionHash) ? lower(postconditionHash) : current.postcondition_hash,
    result_class: text(resultClass || current.result_class || "pending"),
    started_at: startedAt || current.started_at || null,
    completed_at: completedAt || current.completed_at || null,
    reconciliation_required: reconciliationRequired === true || current.reconciliation_required === true,
  };
  return next;
}

export function validateStatementJournal(journal = [], expectedStatementFingerprints = []) {
  const problems = [];
  if (!Array.isArray(journal) || journal.length === 0) problems.push(problem("statement_journal_missing"));
  const expected = Array.isArray(expectedStatementFingerprints) ? expectedStatementFingerprints : [];
  if (expected.length && journal.length !== expected.length) problems.push(problem("statement_journal_count_mismatch", { expected: expected.length, actual: journal.length }));
  let expectedIndex = 1;
  for (const entry of Array.isArray(journal) ? journal : []) {
    if (Number(entry.step_index) !== expectedIndex) problems.push(problem("statement_journal_index_gap", { expected: expectedIndex, actual: entry.step_index }));
    if (!validSha(entry.statement_fingerprint)) problems.push(problem("statement_fingerprint_missing", { step_index: entry.step_index }));
    if (expected[expectedIndex - 1] && lower(expected[expectedIndex - 1]) !== lower(entry.statement_fingerprint)) problems.push(problem("statement_fingerprint_mismatch", { step_index: entry.step_index }));
    if (!["pending", "started", "completed", "verified"].includes(entry.state)) problems.push(problem("statement_state_invalid", { step_index: entry.step_index, state: entry.state }));
    if (entry.state === "completed" && !validSha(entry.postcondition_hash)) problems.push(problem("completed_statement_postcondition_missing", { step_index: entry.step_index }));
    expectedIndex += 1;
  }
  return { ok: problems.length === 0, problems, secrets_included: false };
}

function validateArtifactPlan(plan = {}, binding = {}) {
  const problems = [];
  if (!text(plan.migration).trim()) problems.push(problem("migration_name_missing"));
  if (!validSha(plan.raw_artifact_sha256)) problems.push(problem("raw_artifact_sha256_missing"));
  if (!validSha(plan.normalized_artifact_sha256)) problems.push(problem("normalized_artifact_sha256_missing"));
  if (!validSha(plan.execution_bundle_sha256)) problems.push(problem("execution_bundle_sha256_missing"));
  if (binding.raw_artifact_sha256 && lower(plan.raw_artifact_sha256) !== lower(binding.raw_artifact_sha256)) problems.push(problem("raw_artifact_binding_mismatch"));
  if (binding.normalized_artifact_sha256 && lower(plan.normalized_artifact_sha256) !== lower(binding.normalized_artifact_sha256)) problems.push(problem("normalized_artifact_binding_mismatch"));
  if (binding.execution_bundle_sha256 && lower(plan.execution_bundle_sha256) !== lower(binding.execution_bundle_sha256)) problems.push(problem("execution_bundle_binding_mismatch"));
  const dependencies = Array.isArray(plan.dependencies) ? plan.dependencies : [];
  const dependencyNames = new Set();
  for (const dependency of dependencies) {
    const dependencyName = text(dependency.migration).trim();
    if (!dependencyName || !["applied", "not_required"].includes(dependency.required_state)) problems.push(problem("dependency_contract_invalid", { migration: dependency.migration || null }));
    if (dependencyName && dependencyName === text(plan.migration).trim()) problems.push(problem("dependency_self_reference", { migration: dependencyName }));
    if (dependencyName && dependencyNames.has(dependencyName)) problems.push(problem("dependency_duplicate", { migration: dependencyName }));
    if (dependencyName) dependencyNames.add(dependencyName);
  }
  const conflicts = Array.isArray(plan.conflicts_with) ? plan.conflicts_with : [];
  if (conflicts.map((entry) => text(entry).trim()).includes(text(plan.migration).trim())) problems.push(problem("migration_self_conflict"));
  return problems;
}

function validateExecutionProfile(profile = {}) {
  const problems = [];
  if (!DDL_ALGORITHMS.has(profile.expected_algorithm)) problems.push(problem("expected_algorithm_invalid"));
  if (!DDL_LOCKS.has(profile.expected_lock)) problems.push(problem("expected_lock_invalid"));
  if (!IMPACT_CLASSES.has(profile.estimated_impact)) problems.push(problem("estimated_impact_invalid"));
  if (!TRAFFIC_MODES.has(profile.traffic_mode)) problems.push(problem("traffic_mode_invalid"));
  if (profile.estimated_impact !== "metadata_only") {
    const threshold = nonNegativeInteger(profile.single_update_safe_row_threshold);
    if (threshold === null) problems.push(problem("backfill_safe_threshold_missing"));
  }
  if (profile.backfill_mode === "chunked") {
    if (!positiveInteger(profile.batch_size)) problems.push(problem("backfill_batch_size_missing"));
    if (!text(profile.ordering_key).trim()) problems.push(problem("backfill_ordering_key_missing"));
    if (!text(profile.progress_cursor).trim()) problems.push(problem("backfill_progress_cursor_missing"));
  }
  if (!["single_statement", "chunked", "not_applicable"].includes(profile.backfill_mode)) problems.push(problem("backfill_mode_invalid"));
  return problems;
}

function validateTimeoutBudget(budget = {}) {
  const problems = [];
  const names = ["metadata_lock_timeout_ms", "row_lock_timeout_ms", "statement_timeout_ms", "provider_timeout_ms", "recovery_lease_ttl_ms", "heartbeat_interval_ms", "workflow_timeout_ms"];
  const values = Object.fromEntries(names.map((name) => [name, finitePositive(budget[name])]));
  for (const name of names) if (!values[name]) problems.push(problem("timeout_budget_missing", { field: name }));
  if (values.heartbeat_interval_ms && values.recovery_lease_ttl_ms && values.heartbeat_interval_ms >= values.recovery_lease_ttl_ms / 3) problems.push(problem("heartbeat_interval_too_slow"));
  if (values.provider_timeout_ms && values.statement_timeout_ms && values.provider_timeout_ms < values.statement_timeout_ms) problems.push(problem("provider_timeout_shorter_than_statement_timeout"));
  if (values.recovery_lease_ttl_ms && values.provider_timeout_ms && values.recovery_lease_ttl_ms <= values.provider_timeout_ms) problems.push(problem("recovery_lease_not_longer_than_provider_timeout"));
  if (values.workflow_timeout_ms && values.recovery_lease_ttl_ms && values.workflow_timeout_ms < values.recovery_lease_ttl_ms) problems.push(problem("workflow_timeout_shorter_than_recovery_lease"));
  return problems;
}

function validateSessionState(session = {}) {
  const problems = [];
  const required = ["sql_mode", "time_zone", "transaction_isolation", "character_set_client", "collation_connection", "autocommit"];
  for (const field of required) if (session[field] === undefined || session[field] === null || text(session[field]).trim() === "") problems.push(problem("session_state_missing", { field }));
  if (session.foreign_key_checks !== 0 && session.foreign_key_checks !== 1 && session.foreign_key_checks !== true && session.foreign_key_checks !== false) problems.push(problem("foreign_key_checks_policy_missing"));
  return problems;
}

function parseVersion(value = "") {
  const match = text(value).trim().match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  return match ? [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)] : null;
}

function versionBelow(actual, minimum) {
  const left = parseVersion(actual);
  const right = parseVersion(minimum);
  if (!left || !right) return true;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index];
  }
  return false;
}

function validateRuntimeSnapshot(snapshot = {}, plan = {}) {
  const problems = [];
  const identityFields = ["expected_runtime_sha", "expected_target_fingerprint", "expected_schema_precondition_fingerprint"];
  for (const field of identityFields) if (!text(plan[field]).trim()) problems.push(problem(`${field}_missing`));
  if (!text(plan.target_role).trim()) problems.push(problem("target_role_missing"));
  if (!text(snapshot.target_role).trim()) problems.push(problem("runtime_target_role_missing"));
  if (text(snapshot.target_role).trim() !== text(plan.target_role).trim()) problems.push(problem("target_role_mismatch"));
  if (text(snapshot.runtime_sha).trim() !== text(plan.expected_runtime_sha).trim()) problems.push(problem("runtime_sha_mismatch"));
  if (text(snapshot.target_fingerprint).trim() !== text(plan.expected_target_fingerprint).trim()) problems.push(problem("target_fingerprint_mismatch"));
  if (text(snapshot.schema_precondition_fingerprint).trim() !== text(plan.expected_schema_precondition_fingerprint).trim()) problems.push(problem("schema_precondition_fingerprint_mismatch"));
  if (!SAFE_ENGINE.has(text(snapshot.default_engine).trim())) problems.push(problem("database_engine_not_supported", { engine: snapshot.default_engine || null }));
  if (plan.required_mysql_version && !text(snapshot.server_version).trim()) problems.push(problem("server_version_missing"));
  if (plan.required_mysql_version && text(snapshot.server_version).trim() && versionBelow(snapshot.server_version, plan.required_mysql_version)) problems.push(problem("server_version_below_minimum"));
  if (snapshot.replication?.enabled === true && snapshot.replication?.lag_seconds !== 0) problems.push(problem("replication_lag_nonzero"));
  if (plan.backup_policy?.required === true && snapshot.backup?.recent_checkpoint !== true) problems.push(problem("recent_backup_checkpoint_missing"));
  return problems;
}

function validateMetadataLocks(locks = {}) {
  const problems = [];
  if (!Number.isInteger(Number(locks.blocking_metadata_locks)) || Number(locks.blocking_metadata_locks) !== 0) problems.push(problem("blocking_metadata_locks_present"));
  if (!Number.isInteger(Number(locks.long_running_transactions)) || Number(locks.long_running_transactions) !== 0) problems.push(problem("long_running_transactions_present"));
  if (!Number.isInteger(Number(locks.open_target_transactions)) || Number(locks.open_target_transactions) !== 0) problems.push(problem("open_target_transactions_present"));
  if (!Number.isInteger(Number(locks.lock_queue_length)) || Number(locks.lock_queue_length) !== 0) problems.push(problem("metadata_lock_queue_not_empty"));
  return problems;
}

function validateCapacity(capacity = {}, profile = {}) {
  const problems = [];
  const freeBytes = finiteNonNegative(capacity.free_disk_bytes);
  const requiredBytes = finiteNonNegative(capacity.estimated_required_bytes);
  const rows = nonNegativeInteger(capacity.row_count);
  if (freeBytes === null) problems.push(problem("free_disk_headroom_missing"));
  if (requiredBytes === null) problems.push(problem("estimated_space_requirement_missing"));
  if (freeBytes !== null && requiredBytes !== null && freeBytes < requiredBytes) problems.push(problem("disk_headroom_insufficient"));
  if (profile.estimated_impact !== "metadata_only" && rows === null) problems.push(problem("target_row_count_missing"));
  if (profile.backfill_mode === "single_statement" && rows !== null && rows > Number(profile.single_update_safe_row_threshold)) problems.push(problem("single_statement_backfill_exceeds_safe_threshold"));
  if (profile.backfill_mode === "chunked" && rows !== null && rows <= Number(profile.single_update_safe_row_threshold)) problems.push(problem("chunked_backfill_not_justified_by_row_count"));
  return problems;
}

function validateHealth(health = {}) {
  const problems = [];
  const required = ["api_healthy", "db_connections_healthy", "db_latency_healthy", "no_open_recovery_incident", "no_unknown_prior_outcome"];
  for (const field of required) if (health[field] !== true) problems.push(problem("health_gate_not_passed", { field }));
  return problems;
}

export function evaluateMigrationExecutionPreflight({ plan = {}, binding = {}, runtime = {}, metadataLocks = {}, capacity = {}, session = {}, health = {}, previousOutcome = {} } = {}) {
  const problems = [
    ...(!text(plan.target_role).trim() ? [problem("target_role_missing")] : []),
    ...(plan.credential_binding?.role && text(plan.credential_binding.role).trim() !== text(plan.target_role).trim() ? [problem("credential_role_binding_mismatch")] : []),
    ...validateArtifactPlan(plan.artifact || plan, binding),
    ...validateExecutionProfile(plan.execution_profile || {}),
    ...validateTimeoutBudget(plan.timeout_budget || {}),
    ...validateSessionState(session),
    ...validateRuntimeSnapshot(runtime, plan),
    ...validateMetadataLocks(metadataLocks),
    ...validateCapacity(capacity, plan.execution_profile || {}),
    ...validateHealth(health),
  ];
  if (previousOutcome.execution_outcome_unknown === true) problems.push(problem("previous_execution_outcome_unknown"));
  if (previousOutcome.partial_execution === true) problems.push(problem("previous_partial_execution"));
  if (previousOutcome.reconciliation_required === true) problems.push(problem("previous_reconciliation_required"));
  if (plan.approval?.status !== "approved") problems.push(problem("approval_not_durable"));
  if (!UUID.test(text(plan.approval?.approval_id))) problems.push(problem("approval_id_invalid"));
  if (plan.execution_profile?.estimated_impact !== "metadata_only" && plan.traffic_gate?.status !== "pass") problems.push(problem("traffic_gate_not_passed"));
  return {
    ok: problems.length === 0,
    status: problems.length === 0 ? "pass" : "blocked",
    blocked_reason: problems.length ? "migration_execution_preflight_failed" : null,
    problems,
    safety: {
      database_connection_performed: false,
      database_mutation_performed: false,
      provider_access_performed: false,
      credential_access_performed: false,
      secrets_included: false,
    },
  };
}

export function createStatementBoundaryGuard({ assertFence, heartbeat, heartbeatIntervalMs = 5_000, now = () => Date.now() } = {}) {
  if (typeof assertFence !== "function") throw new TypeError("assertFence is required");
  if (heartbeat !== undefined && typeof heartbeat !== "function") throw new TypeError("heartbeat must be a function");
  let lastHeartbeat = 0;
  const pulse = async (force = false) => {
    const current = Number(now());
    if (force || current - lastHeartbeat >= heartbeatIntervalMs) {
      if (heartbeat) await heartbeat();
      lastHeartbeat = current;
    }
  };
  return Object.freeze({
    async beforeStatement() {
      await assertFence();
      await pulse(false);
    },
    async beforeSuccessRecord() {
      await assertFence();
      await pulse(true);
    },
    async whileWaiting() {
      await pulse(false);
      await assertFence();
    },
  });
}

export function createDurableExecutionStateMachine({ initialState = "approved", persist } = {}) {
  if (typeof persist !== "function") throw new TypeError("persist is required");
  if (!TRANSITIONS.includes(initialState)) throw new TypeError("invalid initial state");
  let state = initialState;
  return Object.freeze({
    get state() { return state; },
    async transition(nextState, metadata = {}) {
      const currentIndex = TRANSITIONS.indexOf(state);
      const nextIndex = TRANSITIONS.indexOf(nextState);
      if (nextIndex !== currentIndex + 1) {
        const error = new Error(`Invalid migration execution transition: ${state} -> ${nextState}`);
        error.code = "migration_execution_transition_invalid";
        throw error;
      }
      const durable = await persist({ from: state, to: nextState, metadata: { ...metadata, secrets_included: false } });
      if (durable !== true && durable?.durable !== true) {
        const error = new Error(`Migration execution transition was not durably persisted: ${nextState}`);
        error.code = "migration_execution_transition_not_durable";
        throw error;
      }
      state = nextState;
      return { state, durable: true, secrets_included: false };
    },
  });
}

export function reconcileExecutionOutcome({ providerReturned = false, databasePostcondition = "unknown", journal = [] } = {}) {
  const postcondition = text(databasePostcondition).trim().toLowerCase();
  if (postcondition === "pass") return { state: "verified", action: "finalize_ledger", reconciliation_required: false, journal, secrets_included: false };
  if (postcondition === "fail") return { state: "partial_execution", action: "stop_and_reconcile", reconciliation_required: true, journal, secrets_included: false };
  return {
    state: providerReturned ? "execution_outcome_unknown" : "not_executed",
    action: providerReturned ? "stop_and_readback" : "abort_before_dispatch",
    reconciliation_required: providerReturned,
    journal,
    secrets_included: false,
  };
}

export function finalizeLedgerFromPostcondition({ databasePostcondition = "unknown", ledgerWrite = {}, ticketState = "verified" } = {}) {
  if (text(databasePostcondition).trim().toLowerCase() !== "pass") {
    return {
      ok: false,
      state: "reconciliation_required",
      reason: "database_postcondition_not_pass",
      ledger_finalized: false,
      ticket_state: ticketState,
      reconciliation_required: true,
      secrets_included: false,
    };
  }
  if (ledgerWrite.ok !== true) {
    return {
      ok: false,
      state: "applied_unrecorded",
      reason: "ledger_write_failed_after_postcondition_pass",
      ledger_finalized: false,
      ticket_state: ticketState,
      reconciliation_required: true,
      secrets_included: false,
    };
  }
  return {
    ok: true,
    state: "finalized",
    ledger_finalized: true,
    ticket_state: "finalized",
    reconciliation_required: false,
    secrets_included: false,
  };
}

export function createBoundedEmergencyReceipt({ runId, migration, sha, target, result, postconditions = [], reconciliationState = "none" } = {}) {
  const receipt = {
    run_id: text(runId).trim() || null,
    migration: text(migration).trim() || null,
    sha: validSha(sha) ? lower(sha) : null,
    target: text(target).trim() || null,
    result: text(result).trim() || "unknown",
    postconditions: Array.isArray(postconditions) ? postconditions.slice(0, 32).map((entry) => ({
      name: text(entry?.name).slice(0, 120),
      status: text(entry?.status).slice(0, 40),
    })) : [],
    reconciliation_state: text(reconciliationState).trim() || "unknown",
    secrets_included: false,
  };
  return JSON.parse(JSON.stringify(receipt));
}

export const MIGRATION_EXECUTION_SAFETY_CONTRACT = Object.freeze({
  contract: "mad4b.migration-execution-safety.v1",
  transition_order: TRANSITIONS,
  fail_closed_defaults: true,
  live_execution_enabled: false,
  database_mutation_performed: false,
  provider_access_performed: false,
  secrets_included: false,
});
