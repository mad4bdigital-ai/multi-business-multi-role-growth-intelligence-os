import assert from "node:assert/strict";
import test from "node:test";

import {
  createProductionRecoveryControlStore,
} from "./productionRecoveryControlStore.js";
import {
  describeRecoveryStoreQualification,
} from "./recoveryDurableStoreContract.js";

function createFakeControlStoreBackend({ schemaReady = true } = {}) {
  const records = new Map();
  const receipts = new Map();
  const events = new Map();
  const runBindings = new Map();
  const queries = [];

  const requiredColumns = {
    recovery_control_records: ["record_type", "record_id", "payload_json", "payload_sha256", "created_at", "updated_at"],
    recovery_control_run_idempotency: ["idempotency_key", "run_id", "created_at"],
    recovery_control_idempotency_receipts: ["idempotency_key", "payload_json", "payload_sha256", "created_at", "updated_at"],
    recovery_control_evidence_events: ["event_id", "run_id", "event_hash", "payload_json", "created_at"],
  };
  const requiredIndexes = [
    ["recovery_control_records", "PRIMARY", 0, "record_type,record_id"],
    ["recovery_control_run_idempotency", "PRIMARY", 0, "idempotency_key"],
    ["recovery_control_run_idempotency", "idx_recovery_control_run_id", 1, "run_id"],
    ["recovery_control_idempotency_receipts", "PRIMARY", 0, "idempotency_key"],
    ["recovery_control_evidence_events", "PRIMARY", 0, "event_id"],
    ["recovery_control_evidence_events", "idx_recovery_control_evidence_run", 1, "run_id,created_at"],
  ];

  async function query(sql, params = []) {
    const normalized = String(sql).replace(/\s+/gu, " ").trim();
    queries.push(normalized);

    if (normalized.includes("FROM information_schema.COLUMNS")) {
      const rows = Object.entries(requiredColumns).flatMap(([table, columns]) =>
        columns.map((column) => ({ TABLE_NAME: table, COLUMN_NAME: column })),
      );
      if (!schemaReady) return [rows.filter((row) => !(row.TABLE_NAME === "recovery_control_records" && row.COLUMN_NAME === "payload_sha256"))];
      return [rows];
    }
    if (normalized.includes("FROM information_schema.STATISTICS")) {
      return [requiredIndexes.map(([TABLE_NAME, INDEX_NAME, NON_UNIQUE, columns]) => ({ TABLE_NAME, INDEX_NAME, NON_UNIQUE, columns }))];
    }

    if (normalized.startsWith("INSERT INTO recovery_control_records")) {
      const [recordType, recordId, planId, stepId, idempotencyKey, payloadJson, payloadSha256] = params;
      records.set(`${recordType}:${recordId}`, {
        record_type: recordType,
        record_id: recordId,
        plan_id: planId,
        step_id: stepId,
        idempotency_key: idempotencyKey,
        payload_json: payloadJson,
        payload_sha256: payloadSha256,
      });
      return [{ affectedRows: 1 }];
    }
    if (normalized.startsWith("SELECT payload_json, payload_sha256 FROM recovery_control_records WHERE record_type")) {
      const [recordType, recordId] = params;
      const row = records.get(`${recordType}:${recordId}`);
      return [row ? [{ payload_json: row.payload_json, payload_sha256: row.payload_sha256 }] : []];
    }
    if (normalized.startsWith("INSERT IGNORE INTO recovery_control_run_idempotency")) {
      const [idempotencyKey, runId] = params;
      if (runBindings.has(idempotencyKey)) return [{ affectedRows: 0 }];
      runBindings.set(idempotencyKey, runId);
      return [{ affectedRows: 1 }];
    }
    if (normalized.startsWith("SELECT run_id FROM recovery_control_run_idempotency")) {
      const [idempotencyKey] = params;
      const runId = runBindings.get(idempotencyKey);
      return [runId ? [{ run_id: runId }] : []];
    }
    if (normalized.startsWith("INSERT INTO recovery_control_idempotency_receipts")) {
      const [idempotencyKey, payloadJson, payloadSha256] = params;
      receipts.set(idempotencyKey, { payload_json: payloadJson, payload_sha256: payloadSha256 });
      return [{ affectedRows: 1 }];
    }
    if (normalized.startsWith("SELECT payload_json, payload_sha256 FROM recovery_control_idempotency_receipts")) {
      const [idempotencyKey] = params;
      const row = receipts.get(idempotencyKey);
      return [row ? [row] : []];
    }
    if (normalized.startsWith("INSERT IGNORE INTO recovery_control_evidence_events")) {
      const [eventId, runId, eventHash, payloadJson] = params;
      if ([...events.values()].some((event) => event.event_hash === eventHash)) return [{ affectedRows: 0 }];
      events.set(eventId, { event_id: eventId, run_id: runId, event_hash: eventHash, payload_json: payloadJson });
      return [{ affectedRows: 1 }];
    }

    throw new Error(`Unexpected fake Recovery SQL: ${normalized}`);
  }

  const pool = {
    query,
    async getConnection() {
      return {
        query,
        async ping() {},
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {},
      };
    },
  };

  return {
    poolProvider: () => pool,
    queries,
    records,
    receipts,
    events,
    tamperRecord(recordType, recordId, payloadJson) {
      const key = `${recordType}:${recordId}`;
      const current = records.get(key);
      records.set(key, { ...current, payload_json: payloadJson });
    },
  };
}

const ENV = Object.freeze({
  DEPLOYMENT_ENVIRONMENT: "production",
  RECOVERY_CONTROL_DB_HOST: "control-db.internal",
  RECOVERY_CONTROL_DB_NAME: "mad4b_recovery_control",
  RECOVERY_CONTROL_DB_USER: "recovery_control_app",
  RECOVERY_CONTROL_DB_PASSWORD: "test-only-placeholder",
  DB_HOST: "runtime-db.internal",
  DB_NAME: "runtime_db",
  DB_USER: "runtime_app",
  GOVERNANCE_DB_HOST: "governance-db.internal",
  GOVERNANCE_DB_NAME: "governance_db",
  GOVERNANCE_DB_USER: "governance_app",
  RUNTIME_PERSISTENCE_DB_HOST: "persistence-db.internal",
  RUNTIME_PERSISTENCE_DB_NAME: "runtime_persistence_db",
  RUNTIME_PERSISTENCE_DB_USER: "runtime_persistence_app",
});

test("durable Recovery evidence survives a fresh store instance over the same backing state", async () => {
  const backend = createFakeControlStoreBackend();
  const storeA = createProductionRecoveryControlStore({ poolProvider: backend.poolProvider, env: ENV });
  const run = { run_id: "run:restart0000000001", status: "classified", evidence: { inspection: "persisted" }, secrets_included: false };
  const plan = { plan_id: "plan:restart000000001", plan_hash: "a".repeat(64), secrets_included: false };
  const finding = { finding_id: "finding:restart0000001", category: "synthetic", secrets_included: false };
  const receipt = { ok: true, run_id: run.run_id, status: "classified", secrets_included: false };

  await storeA.putRun(run);
  await storeA.putPlan(plan);
  await storeA.putFinding(finding);
  await storeA.putIdempotencyReceipt("restart-proof", receipt);
  await storeA.appendEvidenceEvent(run.run_id, { phase: "classified", event: "restart_probe", secrets_included: false });

  const storeB = createProductionRecoveryControlStore({ poolProvider: backend.poolProvider, env: ENV });
  assert.deepEqual(await storeB.getRun(run.run_id), run);
  assert.deepEqual(await storeB.getPlan(plan.plan_id), plan);
  assert.deepEqual(await storeB.getFinding(finding.finding_id), finding);
  assert.deepEqual(await storeB.getRunByIdempotency("restart-proof"), receipt);
  assert.equal(backend.events.size, 1);
  assert.equal(storeB.payload_integrity_verified_on_read, true);
});

test("persisted Recovery evidence fails closed when payload_json no longer matches payload_sha256", async () => {
  const backend = createFakeControlStoreBackend();
  const store = createProductionRecoveryControlStore({ poolProvider: backend.poolProvider, env: ENV });
  const run = { run_id: "run:tamper00000000001", status: "classified", secrets_included: false };
  await store.putRun(run);
  backend.tamperRecord("run", run.run_id, JSON.stringify({ ...run, status: "recovered" }));

  await assert.rejects(
    () => store.getRun(run.run_id),
    (error) => error?.code === "RECOVERY_CONTROL_STORE_PAYLOAD_HASH_MISMATCH",
  );
});

test("Recovery store qualification is shared and distinguishes durable inspection from mutation grade", () => {
  const backend = createFakeControlStoreBackend();
  const inspectionStore = createProductionRecoveryControlStore({ poolProvider: backend.poolProvider, env: ENV });
  const inspectionQualification = describeRecoveryStoreQualification(inspectionStore);
  assert.equal(inspectionQualification.boundary_valid, true);
  assert.equal(inspectionQualification.durable_inspection_store, true);
  assert.equal(inspectionQualification.mutation_grade_recovery_store, false);

  const executionTicketVerifier = { verify: async () => true };
  const mutationStore = createProductionRecoveryControlStore({ poolProvider: backend.poolProvider, executionTicketVerifier, env: ENV });
  const mutationQualification = describeRecoveryStoreQualification(mutationStore);
  assert.equal(mutationQualification.durable_inspection_store, true);
  assert.equal(mutationQualification.mutation_grade_recovery_store, true);
});

test("Recovery control-store readiness is read-only and detects missing durable evidence schema", async () => {
  const readyBackend = createFakeControlStoreBackend();
  const readyStore = createProductionRecoveryControlStore({ poolProvider: readyBackend.poolProvider, env: ENV });
  const ready = await readyStore.getReadiness();
  assert.equal(ready.ready, true);
  assert.equal(ready.config_complete, true);
  assert.equal(ready.connection_ready, true);
  assert.equal(ready.schema_ready, true);
  assert.equal(ready.database_mutation_performed, false);
  assert.equal(ready.schema_auto_apply, false);
  assert.ok(readyBackend.queries.every((sql) => sql.startsWith("SELECT")));

  const degradedBackend = createFakeControlStoreBackend({ schemaReady: false });
  const degradedStore = createProductionRecoveryControlStore({ poolProvider: degradedBackend.poolProvider, env: ENV });
  const degraded = await degradedStore.getReadiness();
  assert.equal(degraded.ready, false);
  assert.equal(degraded.schema_ready, false);
  assert.equal(degraded.error_code, "RECOVERY_CONTROL_STORE_SCHEMA_NOT_READY");
  assert.ok(degraded.missing_columns.includes("recovery_control_records.payload_sha256"));
  assert.equal(degraded.database_mutation_performed, false);
});

console.log("production Recovery durable evidence tests passed");
