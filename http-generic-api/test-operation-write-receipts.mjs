import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  executeOperationWriteWithReceipt,
  getOperationWriteReceipt,
  _testingOperationWriteReceipt,
} from "./operationWriteReceiptService.js";

const migration = readFileSync(new URL("./migrations/20260726_operation_write_receipts.sql", import.meta.url), "utf8");
const sqlWithoutComments = migration.replace(/--.*$/gm, "");
assert.match(migration, /CREATE TABLE IF NOT EXISTS operation_write_receipts/);
assert.match(migration, /UNIQUE KEY uq_operation_write_receipts_idempotency \(run_id, step_key, idempotency_key_sha256\)/);
assert.match(migration, /FOREIGN KEY \(run_id\) REFERENCES operation_run_revision_pins \(run_id\)/);
assert.match(migration, /same_cycle_readback_verified TINYINT\(1\)/);
assert.match(migration, /recovery_required TINYINT\(1\)/);
assert.doesNotMatch(sqlWithoutComments, /(?:^|;)\s*(?:DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+\w|INSERT\s+INTO|RENAME\s+TABLE)\b/im);
assert.doesNotMatch(migration, /idempotency_key\s+VARCHAR/i);

const ids = {
  run: "11111111-1111-4111-8111-111111111111",
  tenant: "22222222-2222-4222-8222-222222222222",
  workspace: "33333333-3333-4333-8333-333333333333",
  user: "44444444-4444-4444-8444-444444444444",
  receipt: "55555555-5555-4555-8555-555555555555",
  attempt: "66666666-6666-4666-8666-666666666666",
};
const revisionBundleHash = "a".repeat(64);
const resourceFingerprint = "b".repeat(64);

function input(overrides = {}) {
  return {
    run_id: ids.run,
    tenant_id: ids.tenant,
    workspace_id: ids.workspace,
    user_id: ids.user,
    step_key: "apply",
    idempotency_key: "unsafe-write-key-1",
    revision_bundle_hash: revisionBundleHash,
    resource_fingerprint: resourceFingerprint,
    request: { change_id: "change-1", desired_state: "applied", secrets_included: false },
    ...overrides,
  };
}

function createMemoryPool(initialReceipt = null) {
  const db = {
    context: {
      run_id: ids.run,
      tenant_id: ids.tenant,
      workspace_id: ids.workspace,
      user_id: ids.user,
      operation_key: "repo.change.execute",
      revision_bundle_hash: revisionBundleHash,
      resource_fingerprint: resourceFingerprint,
    },
    receipt: initialReceipt ? { ...initialReceipt } : null,
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
      if (compact.startsWith("SELECT receipt_id,run_id,step_key")) return [db.receipt ? [{ ...db.receipt }] : []];
      if (compact.startsWith("INSERT INTO operation_write_receipts")) {
        db.receipt = {
          receipt_id: params[0], run_id: params[1], step_key: params[2], idempotency_key_sha256: params[3],
          request_sha256: params[4], revision_bundle_hash: params[5], resource_fingerprint: params[6],
          state_revision: 1, receipt_status: "reserved", attempt_count: 0, last_attempt_id: null,
          dispatch_result_sha256: null, readback_sha256: null, result_sha256: null,
          same_cycle_readback_verified: 0, dispatch_succeeded: 0, write_observed: 0, recovery_required: 0,
          last_error_code: null, reserved_at: "2026-07-26T00:00:00.000Z", dispatch_started_at: null,
          dispatch_completed_at: null, readback_verified_at: null, completed_at: null,
          updated_at: "2026-07-26T00:00:00.000Z",
        };
        return [{ affectedRows: 1 }];
      }
      if (compact.startsWith("UPDATE operation_write_receipts") && compact.includes("receipt_status='dispatching'")) {
        if (!db.receipt || db.receipt.receipt_id !== params[2] || Number(db.receipt.state_revision) !== Number(params[3])) return [{ affectedRows: 0 }];
        db.receipt = {
          ...db.receipt,
          state_revision: Number(params[0]), receipt_status: "dispatching",
          attempt_count: Number(db.receipt.attempt_count) + 1, last_attempt_id: params[1],
          dispatch_started_at: "2026-07-26T00:01:00.000Z", updated_at: "2026-07-26T00:01:00.000Z",
        };
        return [{ affectedRows: 1 }];
      }
      if (compact.startsWith("UPDATE operation_write_receipts") && compact.includes("dispatch_result_sha256")) {
        if (!db.receipt || db.receipt.receipt_id !== params[13] || Number(db.receipt.state_revision) !== Number(params[14])) return [{ affectedRows: 0 }];
        db.receipt = {
          ...db.receipt,
          state_revision: Number(params[0]), receipt_status: params[1], dispatch_result_sha256: params[2],
          readback_sha256: params[3], result_sha256: params[4], same_cycle_readback_verified: Number(params[5]),
          dispatch_succeeded: Number(params[6]), write_observed: Number(params[7]), recovery_required: Number(params[8]),
          last_error_code: params[9], dispatch_completed_at: "2026-07-26T00:02:00.000Z",
          readback_verified_at: params[10], completed_at: params[11], updated_at: "2026-07-26T00:02:00.000Z",
        };
        return [{ affectedRows: 1 }];
      }
      throw new Error(`unexpected SQL: ${compact}`);
    },
  };
  return { pool: { async getConnection() { return connection; } }, db, lifecycle };
}

function uuidSequence(values) {
  const queue = [...values];
  return () => {
    const value = queue.shift();
    if (!value) throw new Error("unexpected uuid call");
    return value;
  };
}

{
  const memory = createMemoryPool();
  let dispatchCalls = 0;
  let readbackCalls = 0;
  const result = await executeOperationWriteWithReceipt(input(), {
    pool: memory.pool,
    uuid: uuidSequence([ids.receipt, ids.attempt]),
    now: () => new Date("2026-07-26T00:02:00.000Z"),
    dispatchWrite: async () => {
      dispatchCalls += 1;
      return { ok: true, result: { write_id: "write-1" }, secrets_included: false };
    },
    readbackWrite: async () => {
      readbackCalls += 1;
      return { ok: true, conclusive: true, applied: true, result: { write_id: "write-1", state: "applied" }, secrets_included: false };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.receipt.receipt_status, "completed");
  assert.equal(result.receipt.attempt_count, 1);
  assert.equal(result.receipt.same_cycle_readback_verified, true);
  assert.equal(result.receipt.write_observed, true);
  assert.equal(result.dispatch_authorized_by_receipt, false);
  assert.equal(dispatchCalls, 1);
  assert.equal(readbackCalls, 1);
  assert.notEqual(result.receipt.idempotency_key_sha256, input().idempotency_key);
  assert.equal(memory.lifecycle.rolledBack, 0);

  const replay = await executeOperationWriteWithReceipt(input(), {
    pool: memory.pool,
    uuid: () => { throw new Error("uuid must not be called"); },
    dispatchWrite: async () => { throw new Error("dispatch must not be called"); },
    readbackWrite: async () => { throw new Error("readback must not be called"); },
  });
  assert.equal(replay.idempotent_replay, true);
  assert.equal(replay.dispatch_performed, false);
}

{
  const memory = createMemoryPool();
  await executeOperationWriteWithReceipt(input(), {
    pool: memory.pool,
    uuid: uuidSequence([ids.receipt, ids.attempt]),
    dispatchWrite: async () => ({ ok: true, result: { write_id: "write-1" }, secrets_included: false }),
    readbackWrite: async () => ({ ok: true, conclusive: true, applied: true, result: { write_id: "write-1" }, secrets_included: false }),
  });
  await assert.rejects(
    executeOperationWriteWithReceipt(input({ request: { change_id: "change-2", desired_state: "applied", secrets_included: false } }), { pool: memory.pool }),
    (error) => error.code === "operation_write_receipt_idempotency_conflict",
  );
}

{
  const normalized = _testingOperationWriteReceipt.normalizeInput(input());
  const memory = createMemoryPool({
    receipt_id: ids.receipt, run_id: ids.run, step_key: "apply", idempotency_key_sha256: normalized.idempotency_key_sha256,
    request_sha256: normalized.request_sha256, revision_bundle_hash: revisionBundleHash, resource_fingerprint: resourceFingerprint,
    state_revision: 1, receipt_status: "reserved", attempt_count: 0, last_attempt_id: null,
    dispatch_result_sha256: null, readback_sha256: null, result_sha256: null,
    same_cycle_readback_verified: 0, dispatch_succeeded: 0, write_observed: 0, recovery_required: 0,
    last_error_code: null, reserved_at: "2026-07-26T00:00:00.000Z", dispatch_started_at: null,
    dispatch_completed_at: null, readback_verified_at: null, completed_at: null, updated_at: "2026-07-26T00:00:00.000Z",
  });
  let dispatchCalls = 0;
  const result = await executeOperationWriteWithReceipt(input(), {
    pool: memory.pool,
    uuid: () => { throw new Error("uuid must not be called"); },
    dispatchWrite: async () => { dispatchCalls += 1; throw new Error("must not dispatch"); },
    readbackWrite: async () => ({ ok: true, conclusive: true, applied: true, result: { write_id: "existing" }, secrets_included: false }),
  });
  assert.equal(result.recovered_without_dispatch, true);
  assert.equal(result.receipt.receipt_status, "recovered_completed");
  assert.equal(dispatchCalls, 0);
}

{
  const normalized = _testingOperationWriteReceipt.normalizeInput(input());
  const memory = createMemoryPool({
    receipt_id: ids.receipt, run_id: ids.run, step_key: "apply", idempotency_key_sha256: normalized.idempotency_key_sha256,
    request_sha256: normalized.request_sha256, revision_bundle_hash: revisionBundleHash, resource_fingerprint: resourceFingerprint,
    state_revision: 2, receipt_status: "readback_required", attempt_count: 1, last_attempt_id: ids.attempt,
    dispatch_result_sha256: "c".repeat(64), readback_sha256: null, result_sha256: null,
    same_cycle_readback_verified: 0, dispatch_succeeded: 0, write_observed: 0, recovery_required: 1,
    last_error_code: "transport_timeout", reserved_at: "2026-07-26T00:00:00.000Z", dispatch_started_at: "2026-07-26T00:01:00.000Z",
    dispatch_completed_at: null, readback_verified_at: null, completed_at: null, updated_at: "2026-07-26T00:01:00.000Z",
  });
  let dispatchCalls = 0;
  const result = await executeOperationWriteWithReceipt(input(), {
    pool: memory.pool,
    uuid: () => { throw new Error("uuid must not be called"); },
    dispatchWrite: async () => { dispatchCalls += 1; throw new Error("must not dispatch"); },
    readbackWrite: async () => ({ ok: false, conclusive: false, applied: false, result: {}, error_code: "dependency_unavailable", secrets_included: false }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.receipt.receipt_status, "blocked_recovery");
  assert.equal(result.receipt.recovery_required, true);
  assert.equal(dispatchCalls, 0);
}

{
  const memory = createMemoryPool();
  const result = await executeOperationWriteWithReceipt(input(), {
    pool: memory.pool,
    uuid: uuidSequence([ids.receipt, ids.attempt]),
    dispatchWrite: async () => {
      const error = new Error("timeout");
      error.code = "ETIMEDOUT";
      throw error;
    },
    readbackWrite: async () => ({ ok: true, conclusive: true, applied: true, result: { write_id: "write-after-timeout" }, secrets_included: false }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.receipt.receipt_status, "recovered_completed");
  assert.equal(result.receipt.dispatch_succeeded, false);
  assert.equal(result.receipt.write_observed, true);
}

{
  const memory = createMemoryPool();
  const result = await executeOperationWriteWithReceipt(input(), {
    pool: memory.pool,
    uuid: uuidSequence([ids.receipt, ids.attempt]),
    dispatchWrite: async () => ({ ok: false, result: {}, error_code: "dependency_unavailable", secrets_included: false }),
    readbackWrite: async () => ({ ok: true, conclusive: true, applied: false, result: {}, secrets_included: false }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.receipt.receipt_status, "retry_ready");
  assert.equal(result.receipt.same_cycle_readback_verified, true);
  assert.equal(result.receipt.recovery_required, false);
}

{
  const memory = createMemoryPool();
  await assert.rejects(
    executeOperationWriteWithReceipt(input({ request: { access_token: "forbidden" } }), {
      pool: memory.pool,
      dispatchWrite: async () => { throw new Error("must not dispatch"); },
      readbackWrite: async () => { throw new Error("must not read back"); },
    }),
    (error) => error.code === "operation_write_receipt_sensitive_field_forbidden",
  );
  assert.equal(memory.lifecycle.began, 0);
}

{
  const memory = createMemoryPool();
  await executeOperationWriteWithReceipt(input(), {
    pool: memory.pool,
    uuid: uuidSequence([ids.receipt, ids.attempt]),
    dispatchWrite: async () => ({ ok: true, result: { write_id: "write-1" }, secrets_included: false }),
    readbackWrite: async () => ({ ok: true, conclusive: true, applied: true, result: { write_id: "write-1" }, secrets_included: false }),
  });
  const result = await getOperationWriteReceipt(input(), { pool: memory.pool });
  assert.equal(result.ok, true);
  assert.equal(result.read_only, true);
  assert.equal(result.receipt.receipt_status, "completed");
}

console.log("operation write receipt contract tests passed");
