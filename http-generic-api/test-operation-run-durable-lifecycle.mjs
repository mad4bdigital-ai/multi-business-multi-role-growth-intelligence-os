import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyOperationRunLifecycleCommand,
  getOperationRunLifecycleStatus,
  _testingOperationRunLifecycle,
} from "./operationRunLifecycleService.js";

const migration = readFileSync(new URL("./migrations/20260725_operation_durable_lifecycle.sql", import.meta.url), "utf8");
const sqlWithoutComments = migration.replace(/--.*$/gm, "");
assert.match(migration, /CREATE TABLE IF NOT EXISTS operation_run_lifecycle_state/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS operation_run_lifecycle_events/);
assert.match(migration, /UNIQUE KEY uq_operation_run_lifecycle_state_run_id \(run_id\)/);
assert.match(migration, /UNIQUE KEY uq_operation_run_lifecycle_events_key \(run_id, event_key\)/);
assert.match(migration, /UNIQUE KEY uq_operation_run_lifecycle_events_revision \(run_id, state_revision\)/);
assert.match(migration, /FOREIGN KEY \(run_id\) REFERENCES repository_automation_runs \(run_id\)/);
assert.match(migration, /FOREIGN KEY \(run_id\) REFERENCES operation_run_lifecycle_state \(run_id\)/);
assert.doesNotMatch(sqlWithoutComments, /(?:^|;)\s*(?:DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+\w|INSERT\s+INTO|RENAME\s+TABLE)\b/im);

const ids = {
  run: "11111111-1111-4111-8111-111111111111",
  tenant: "22222222-2222-4222-8222-222222222222",
  workspace: "33333333-3333-4333-8333-333333333333",
  user: "44444444-4444-4444-8444-444444444444",
  lifecycle: "55555555-5555-4555-8555-555555555555",
  event: "66666666-6666-4666-8666-666666666666",
};
const revisionBundleHash = "a".repeat(64);
const resourceFingerprint = "b".repeat(64);

function baseInput(overrides = {}) {
  return {
    run_id: ids.run,
    tenant_id: ids.tenant,
    workspace_id: ids.workspace,
    user_id: ids.user,
    command: "initialize",
    command_id: "init-1",
    expected_state_revision: 0,
    revision_bundle_hash: revisionBundleHash,
    resource_fingerprint: resourceFingerprint,
    actor_key: "platform_admin_service",
    payload: { reason: "initialize", secrets_included: false },
    ...overrides,
  };
}

function createMemoryPool() {
  const db = {
    context: {
      run_id: ids.run,
      tenant_id: ids.tenant,
      workspace_id: ids.workspace,
      user_id: ids.user,
      operation_key: "repo.change.execute",
      resource_uri: "github://mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
      run_status: "running",
      stage: "preflight",
      automation_key: "repository_change",
      mode: "apply",
      input_sha256: "c".repeat(64),
      plan_sha256: "d".repeat(64),
      run_secrets_included: 0,
      revision_bundle_hash: revisionBundleHash,
      resource_fingerprint: resourceFingerprint,
    },
    state: null,
    steps: [
      { step_key: "preflight", step_order: 10, status: "completed", attempt_count: 1, request_sha256: "e".repeat(64), completed_at: "2026-07-25T19:00:00.000Z" },
      { step_key: "apply", step_order: 20, status: "pending", attempt_count: 0, request_sha256: "f".repeat(64), completed_at: null },
    ],
    events: [],
    eventAutoId: 1,
  };
  const lifecycle = { began: 0, committed: 0, rolledBack: 0, released: 0 };
  const connection = {
    async beginTransaction() { lifecycle.began += 1; },
    async commit() { lifecycle.committed += 1; },
    async rollback() { lifecycle.rolledBack += 1; },
    release() { lifecycle.released += 1; },
    async query(sql, params = []) {
      const compact = String(sql).replace(/\s+/g, " ").trim();
      if (compact.startsWith("SELECT o.run_id,o.tenant_id")) return [[db.context]];
      if (compact.startsWith("SELECT lifecycle_id,run_id,state_revision")) return [db.state ? [[{ ...db.state }][0]] : []];
      if (compact.startsWith("SELECT step_key,step_order,status")) return [[...db.steps]];
      if (compact.startsWith("SELECT id,event_id,run_id,state_revision") && compact.includes("event_key=?")) {
        return [[db.events.find((event) => event.run_id === params[0] && event.event_key === params[1])].filter(Boolean)];
      }
      if (compact.startsWith("SELECT id,event_id,run_id,state_revision") && compact.includes("event_id=?")) {
        return [[db.events.find((event) => event.event_id === params[0])].filter(Boolean)];
      }
      if (compact.startsWith("SELECT id,event_id,run_id,state_revision") && compact.includes("id>?")) {
        const rows = db.events.filter((event) => event.run_id === params[0] && event.id > Number(params[1])).slice(0, Number(params[2]));
        return [rows];
      }
      if (compact.startsWith("INSERT INTO operation_run_lifecycle_state")) {
        db.state = {
          lifecycle_id: params[0], run_id: params[1], state_revision: Number(params[2]), lifecycle_status: params[3],
          approval_status: params[4], resume_from_step_key: params[5], checkpoint_sha256: params[6],
          revision_bundle_hash: params[7], resource_fingerprint: params[8], callback_id: params[9],
          callback_payload_sha256: params[10], cancellation_requested_at: params[11], cancelled_at: params[12],
          recovery_classification: params[13], last_event_id: params[14],
          created_at: "2026-07-25T19:00:00.000Z", updated_at: "2026-07-25T19:00:00.000Z",
        };
        return [{ affectedRows: 1 }];
      }
      if (compact.startsWith("UPDATE operation_run_lifecycle_state")) {
        if (!db.state || db.state.run_id !== params[11] || db.state.state_revision !== Number(params[12])) return [{ affectedRows: 0 }];
        db.state = {
          ...db.state,
          state_revision: Number(params[0]), lifecycle_status: params[1], approval_status: params[2],
          resume_from_step_key: params[3], checkpoint_sha256: params[4], callback_id: params[5],
          callback_payload_sha256: params[6], cancellation_requested_at: params[7], cancelled_at: params[8],
          recovery_classification: params[9], last_event_id: params[10], updated_at: "2026-07-25T19:01:00.000Z",
        };
        return [{ affectedRows: 1 }];
      }
      if (compact.startsWith("INSERT INTO operation_run_lifecycle_events")) {
        db.events.push({
          id: db.eventAutoId++, event_id: params[0], run_id: params[1], state_revision: Number(params[2]),
          event_type: params[3], event_key: params[4], actor_key: params[5], payload_sha256: params[6],
          payload_json: params[7], created_at: "2026-07-25T19:00:00.000Z",
        });
        return [{ affectedRows: 1 }];
      }
      throw new Error(`unexpected SQL: ${compact}`);
    },
  };
  return { pool: { async getConnection() { return connection; } }, db, lifecycle };
}

{
  const memory = createMemoryPool();
  const uuids = [ids.event, ids.lifecycle];
  const result = await applyOperationRunLifecycleCommand(baseInput(), {
    pool: memory.pool,
    uuid: () => uuids.shift(),
    now: () => new Date("2026-07-25T19:00:00.000Z"),
  });
  assert.equal(result.ok, true);
  assert.equal(result.inserted, true);
  assert.equal(result.state.state_revision, 1);
  assert.equal(result.state.resume_plan.from_step_key, "apply");
  assert.equal(result.state.dispatch_authorized, false);
  assert.equal(result.database_writes_performed, true);
  assert.equal(memory.lifecycle.committed, 1);
  assert.equal(memory.lifecycle.rolledBack, 0);

  const replay = await applyOperationRunLifecycleCommand(baseInput(), { pool: memory.pool, uuid: () => { throw new Error("uuid must not be called"); } });
  assert.equal(replay.idempotent_replay, true);
  assert.equal(replay.database_writes_performed, false);

  await assert.rejects(
    applyOperationRunLifecycleCommand(baseInput({ payload: { reason: "different", secrets_included: false } }), { pool: memory.pool }),
    (error) => error.code === "operation_run_lifecycle_idempotency_conflict",
  );
}

{
  const memory = createMemoryPool();
  memory.db.state = {
    lifecycle_id: ids.lifecycle, run_id: ids.run, state_revision: 4, lifecycle_status: "resume_ready",
    approval_status: "approved", resume_from_step_key: "apply", checkpoint_sha256: "1".repeat(64),
    revision_bundle_hash: revisionBundleHash, resource_fingerprint: resourceFingerprint, callback_id: null,
    callback_payload_sha256: null, cancellation_requested_at: null, cancelled_at: null,
    recovery_classification: null, last_event_id: "77777777-7777-4777-8777-777777777777",
    created_at: "2026-07-25T19:00:00.000Z", updated_at: "2026-07-25T19:00:00.000Z",
  };
  const result = await applyOperationRunLifecycleCommand(baseInput({
    command: "resume",
    command_id: "resume-1",
    expected_state_revision: 4,
    payload: { reason: "continue", secrets_included: false },
  }), {
    pool: memory.pool,
    uuid: () => ids.event,
    now: () => new Date("2026-07-25T19:02:00.000Z"),
  });
  assert.equal(result.state.lifecycle_status, "resuming");
  assert.equal(result.state.state_revision, 5);
  assert.equal(result.state.resume_plan.from_step_key, "apply");
  assert.deepEqual(result.state.resume_plan.completed_step_keys, ["preflight"]);
  assert.deepEqual(result.state.resume_plan.pending_step_keys, ["apply"]);
}

{
  const memory = createMemoryPool();
  memory.db.state = {
    lifecycle_id: ids.lifecycle, run_id: ids.run, state_revision: 2, lifecycle_status: "awaiting_callback",
    approval_status: "not_required", resume_from_step_key: "apply", checkpoint_sha256: "1".repeat(64),
    revision_bundle_hash: revisionBundleHash, resource_fingerprint: resourceFingerprint, callback_id: null,
    callback_payload_sha256: null, cancellation_requested_at: null, cancelled_at: null,
    recovery_classification: null, last_event_id: "77777777-7777-4777-8777-777777777777",
    created_at: "2026-07-25T19:00:00.000Z", updated_at: "2026-07-25T19:00:00.000Z",
  };
  const result = await applyOperationRunLifecycleCommand(baseInput({
    command: "callback",
    command_id: "callback-123",
    expected_state_revision: 2,
    payload: { callback_status: "received", provider_event_id: "event-1", secrets_included: false },
  }), { pool: memory.pool, uuid: () => ids.event });
  assert.equal(result.state.lifecycle_status, "resume_ready");
  assert.equal(result.state.callback_id, "callback-123");
  assert.match(result.state.callback_payload_sha256, /^[0-9a-f]{64}$/);
}

{
  const memory = createMemoryPool();
  memory.db.state = {
    lifecycle_id: ids.lifecycle, run_id: ids.run, state_revision: 3, lifecycle_status: "interrupted",
    approval_status: "not_required", resume_from_step_key: "apply", checkpoint_sha256: "1".repeat(64),
    revision_bundle_hash: revisionBundleHash, resource_fingerprint: resourceFingerprint, callback_id: null,
    callback_payload_sha256: null, cancellation_requested_at: null, cancelled_at: null,
    recovery_classification: null, last_event_id: "77777777-7777-4777-8777-777777777777",
    created_at: "2026-07-25T19:00:00.000Z", updated_at: "2026-07-25T19:00:00.000Z",
  };
  const result = await applyOperationRunLifecycleCommand(baseInput({
    command: "recover",
    command_id: "recover-1",
    expected_state_revision: 3,
    payload: { reason: "worker_interrupted", secrets_included: false },
  }), { pool: memory.pool, uuid: () => ids.event });
  assert.equal(result.state.lifecycle_status, "interrupted");
  assert.equal(result.state.recovery_classification, "waiting_external_signal");
}

{
  const memory = createMemoryPool();
  memory.db.state = {
    lifecycle_id: ids.lifecycle, run_id: ids.run, state_revision: 1, lifecycle_status: "running",
    approval_status: "not_required", resume_from_step_key: "apply", checkpoint_sha256: null,
    revision_bundle_hash: revisionBundleHash, resource_fingerprint: resourceFingerprint, callback_id: null,
    callback_payload_sha256: null, cancellation_requested_at: null, cancelled_at: null,
    recovery_classification: null, last_event_id: ids.event,
    created_at: "2026-07-25T19:00:00.000Z", updated_at: "2026-07-25T19:00:00.000Z",
  };
  memory.db.events.push({
    id: 1, event_id: ids.event, run_id: ids.run, state_revision: 1, event_type: "initialized",
    event_key: "initialize:init-1", actor_key: "platform_admin_service", payload_sha256: "9".repeat(64),
    payload_json: JSON.stringify({ ok: true, secrets_included: false }), created_at: "2026-07-25T19:00:00.000Z",
  });
  const status = await getOperationRunLifecycleStatus({
    run_id: ids.run,
    tenant_id: ids.tenant,
    workspace_id: ids.workspace,
    user_id: ids.user,
    cursor: 0,
    limit: 1,
  }, { pool: memory.pool });
  assert.equal(status.ok, true);
  assert.equal(status.events.length, 1);
  assert.equal(status.page.has_more, false);
  assert.equal(status.state.resume_plan.from_step_key, "apply");
  assert.equal(status.database_writes_performed, false);
}

await assert.rejects(
  applyOperationRunLifecycleCommand(baseInput({ payload: { access_token: "forbidden" } }), {
    pool: { async getConnection() { throw new Error("database must not be reached"); } },
  }),
  (error) => error.code === "operation_run_lifecycle_sensitive_field_forbidden",
);

{
  const state = { lifecycle_status: "interrupted", state_revision: 4 };
  const context = { run_status: "running", revision_bundle_hash: revisionBundleHash, resource_fingerprint: resourceFingerprint };
  const steps = [{ step_key: "apply", step_order: 20, status: "pending" }];
  assert.equal(_testingOperationRunLifecycle.recoveryClassification(state, context, steps), "waiting_external_signal");
}

console.log("operation durable lifecycle contract tests passed");
