import { createHash, randomUUID } from "node:crypto";
import { getRecoveryControlPool } from "./recoveryControlDb.js";

export const PRODUCTION_RECOVERY_CONTROL_STORE_CONTRACT = "mad4b.production-recovery-control-store.v1";
export const RECOVERY_DURABLE_STORE_CONTRACT = "mad4b.recovery-durable-store.v1";
export const PRODUCTION_RECOVERY_LOCK_CONTRACT = "mad4b.production-recovery-fenced-lock.v1";

const MAX_ID = 191;
const RECOVERY_LOCK_LEASE_BOUNDS = Object.freeze({
  minimumSeconds: 0.1,
  maximumSeconds: 600,
});
const RECORD_TYPES = Object.freeze({
  run: "run",
  plan: "plan",
  finding: "finding",
  approval: "approval",
  exception: "exception",
  ephemeralCapability: "ephemeral_capability",
});

export const RECOVERY_CONTROL_STORE_SCHEMA_STATEMENTS = Object.freeze([
  `CREATE TABLE IF NOT EXISTS recovery_control_records (
    record_type VARCHAR(32) NOT NULL,
    record_id VARCHAR(191) NOT NULL,
    plan_id VARCHAR(191) NULL,
    step_id VARCHAR(191) NULL,
    idempotency_key VARCHAR(191) NULL,
    payload_json LONGTEXT NOT NULL,
    payload_sha256 CHAR(64) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (record_type, record_id),
    KEY idx_recovery_control_plan_step (record_type, plan_id, step_id, updated_at),
    KEY idx_recovery_control_idempotency (record_type, idempotency_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS recovery_control_run_idempotency (
    idempotency_key VARCHAR(191) NOT NULL,
    run_id VARCHAR(191) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (idempotency_key),
    KEY idx_recovery_control_run_id (run_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS recovery_control_idempotency_receipts (
    idempotency_key VARCHAR(191) NOT NULL,
    payload_json LONGTEXT NOT NULL,
    payload_sha256 CHAR(64) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (idempotency_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS recovery_control_approval_index (
    plan_id VARCHAR(191) NOT NULL,
    step_id VARCHAR(191) NOT NULL,
    approval_id VARCHAR(191) NOT NULL,
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (plan_id, step_id),
    KEY idx_recovery_control_approval_id (approval_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS recovery_control_execution_claims (
    idempotency_key VARCHAR(191) NOT NULL,
    claim_id VARCHAR(191) NOT NULL,
    status VARCHAR(32) NOT NULL,
    payload_json LONGTEXT NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (idempotency_key),
    UNIQUE KEY uq_recovery_control_claim_id (claim_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS recovery_control_approval_reservations (
    reservation_key CHAR(64) NOT NULL,
    approval_id VARCHAR(191) NOT NULL,
    plan_hash CHAR(64) NOT NULL,
    step_id VARCHAR(191) NOT NULL,
    idempotency_key VARCHAR(191) NOT NULL,
    payload_json LONGTEXT NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (reservation_key),
    KEY idx_recovery_control_approval_reservation (approval_id, idempotency_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS recovery_control_approval_finalizations (
    approval_id VARCHAR(191) NOT NULL,
    finalized_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (approval_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS recovery_control_execution_tickets (
    ticket_id VARCHAR(191) NOT NULL,
    ticket_hash CHAR(64) NOT NULL,
    state VARCHAR(32) NOT NULL DEFAULT 'issued',
    reservation_idempotency_key VARCHAR(191) NULL,
    payload_json LONGTEXT NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    reserved_at DATETIME(6) NULL,
    finalized_at DATETIME(6) NULL,
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (ticket_id),
    KEY idx_recovery_control_ticket_state (state),
    KEY idx_recovery_control_ticket_hash (ticket_hash)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS recovery_control_evidence_events (
    event_id CHAR(36) NOT NULL,
    run_id VARCHAR(191) NOT NULL,
    event_hash CHAR(64) NOT NULL,
    payload_json LONGTEXT NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (event_id),
    UNIQUE KEY uq_recovery_control_event_hash (event_hash),
    KEY idx_recovery_control_evidence_run (run_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS recovery_control_exception_events (
    event_id CHAR(36) NOT NULL,
    exception_id VARCHAR(191) NOT NULL,
    event_hash CHAR(64) NOT NULL,
    payload_json LONGTEXT NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (event_id),
    UNIQUE KEY uq_recovery_control_exception_event_hash (event_hash),
    KEY idx_recovery_control_exception_event (exception_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS recovery_control_locks (
    target_key VARCHAR(191) NOT NULL,
    fence_counter BIGINT UNSIGNED NOT NULL DEFAULT 0,
    lease_id VARCHAR(191) NULL,
    fencing_token VARCHAR(255) NULL,
    plan_hash CHAR(64) NULL,
    expires_at DATETIME(6) NULL,
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (target_key),
    UNIQUE KEY uq_recovery_control_lease_id (lease_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function canonical(value) {
  return JSON.stringify(stable(value));
}

function digest(value) {
  return createHash("sha256").update(typeof value === "string" ? value : canonical(value)).digest("hex");
}

function text(value, max = MAX_ID) {
  return String(value ?? "").trim().slice(0, max);
}

function requiredId(value, field) {
  const normalized = text(value);
  if (!normalized) throw storeError("RECOVERY_CONTROL_STORE_ID_REQUIRED", `${field} is required.`, { field });
  return normalized;
}

function boundedTtl(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return RECOVERY_LOCK_LEASE_BOUNDS.maximumSeconds;
  return Math.max(RECOVERY_LOCK_LEASE_BOUNDS.minimumSeconds, Math.min(parsed, RECOVERY_LOCK_LEASE_BOUNDS.maximumSeconds));
}

function parsePayload(value) {
  if (value == null) return null;
  if (typeof value === "object" && !Buffer.isBuffer(value)) return structuredClone(value);
  try { return JSON.parse(String(value)); } catch { throw storeError("RECOVERY_CONTROL_STORE_PAYLOAD_INVALID", "Persisted Recovery control-store payload is invalid JSON."); }
}

function storeError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = 503;
  error.details = {
    contract: PRODUCTION_RECOVERY_CONTROL_STORE_CONTRACT,
    independent_of_target_databases: true,
    target_database_binding: "forbidden",
    secrets_included: false,
    ...details,
  };
  return error;
}

async function withTransaction(poolProvider, operation) {
  const pool = poolProvider();
  if (!pool || typeof pool.getConnection !== "function") throw storeError("RECOVERY_CONTROL_STORE_POOL_INVALID", "Recovery control-store pool provider is not configured.");
  const connection = await pool.getConnection();
  let transactionOpen = false;
  try {
    await connection.beginTransaction();
    transactionOpen = true;
    const result = await operation(connection);
    await connection.commit();
    transactionOpen = false;
    return result;
  } catch (error) {
    if (transactionOpen) {
      try { await connection.rollback(); } catch { /* preserve original error */ }
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function query(poolProvider, sql, params = []) {
  const pool = poolProvider();
  if (!pool || typeof pool.query !== "function") throw storeError("RECOVERY_CONTROL_STORE_POOL_INVALID", "Recovery control-store pool provider is not configured.");
  return pool.query(sql, params);
}

async function putRecord(poolProvider, type, id, payload, indexes = {}) {
  const recordId = requiredId(id, `${type}_id`);
  const json = canonical(payload);
  await query(poolProvider, `INSERT INTO recovery_control_records
    (record_type, record_id, plan_id, step_id, idempotency_key, payload_json, payload_sha256)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      plan_id = VALUES(plan_id), step_id = VALUES(step_id), idempotency_key = VALUES(idempotency_key),
      payload_json = VALUES(payload_json), payload_sha256 = VALUES(payload_sha256)`, [
    type,
    recordId,
    text(indexes.plan_id) || null,
    text(indexes.step_id) || null,
    text(indexes.idempotency_key) || null,
    json,
    digest(json),
  ]);
  return { persisted: true };
}

async function getRecord(poolProvider, type, id) {
  const [rows] = await query(poolProvider, "SELECT payload_json FROM recovery_control_records WHERE record_type = ? AND record_id = ? LIMIT 1", [type, requiredId(id, `${type}_id`)]);
  if (rows.length > 1) throw storeError("RECOVERY_CONTROL_STORE_AMBIGUOUS_RECORD", "Recovery control-store lookup returned multiple records for a unique record identity.", { record_type: type });
  return rows?.length ? parsePayload(rows[0].payload_json) : null;
}

function approvalReservationKey(context) {
  return digest({ approval_id: text(context?.approval_id), plan_hash: text(context?.plan_hash, 64), step_id: text(context?.step_id) });
}

function lockResult(row) {
  if (!row?.lease_id || !row?.fencing_token) return null;
  return {
    target_key: row.target_key,
    plan_hash: row.plan_hash,
    lease_id: row.lease_id,
    fencing_token: row.fencing_token,
    fence_counter: Number(row.fence_counter),
    expires_at: row.expires_at instanceof Date ? row.expires_at.toISOString() : row.expires_at,
  };
}

function createFencedLock(poolProvider) {
  return Object.freeze({
    contract: PRODUCTION_RECOVERY_LOCK_CONTRACT,
    durable: true,
    shared_replica_safe: true,
    async acquire({ target_key, plan_hash, ttl_seconds = RECOVERY_LOCK_LEASE_BOUNDS.maximumSeconds } = {}) {
      const targetKey = requiredId(target_key, "target_key");
      const planHash = text(plan_hash, 64) || null;
      const ttlMicros = Math.round(boundedTtl(ttl_seconds) * 1_000_000);
      return withTransaction(poolProvider, async (connection) => {
        const [rows] = await connection.query(`SELECT target_key, fence_counter, lease_id, fencing_token, plan_hash, expires_at,
          (lease_id IS NULL OR expires_at IS NULL OR expires_at <= CURRENT_TIMESTAMP(6)) AS available
          FROM recovery_control_locks WHERE target_key = ? FOR UPDATE`, [targetKey]);
        const current = rows?.[0] || null;
        if (current && Number(current.available) !== 1) return { acquired: false, lock_busy: true, secrets_included: false };

        const nextCounter = current ? Number(current.fence_counter) + 1 : 1;
        const leaseId = `lease:${randomUUID()}`;
        const fencingToken = `${nextCounter}:${randomUUID()}`;
        if (!current) {
          await connection.query(`INSERT INTO recovery_control_locks
            (target_key, fence_counter, lease_id, fencing_token, plan_hash, expires_at)
            VALUES (?, ?, ?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP(6), INTERVAL ? MICROSECOND))`, [targetKey, nextCounter, leaseId, fencingToken, planHash, ttlMicros]);
        } else {
          await connection.query(`UPDATE recovery_control_locks
            SET fence_counter = ?, lease_id = ?, fencing_token = ?, plan_hash = ?,
                expires_at = DATE_ADD(CURRENT_TIMESTAMP(6), INTERVAL ? MICROSECOND)
            WHERE target_key = ?`, [nextCounter, leaseId, fencingToken, planHash, ttlMicros, targetKey]);
        }
        const [updatedRows] = await connection.query("SELECT target_key, fence_counter, lease_id, fencing_token, plan_hash, expires_at FROM recovery_control_locks WHERE target_key = ?", [targetKey]);
        return { acquired: true, ...lockResult(updatedRows?.[0]), secrets_included: false };
      });
    },
    async heartbeat(context = {}) {
      const targetKey = requiredId(context.target_key, "target_key");
      const leaseId = requiredId(context.lease_id, "lease_id");
      const fencingToken = requiredId(context.fencing_token, "fencing_token");
      const ttlMicros = Math.round(boundedTtl(context.ttl_seconds ?? RECOVERY_LOCK_LEASE_BOUNDS.maximumSeconds) * 1_000_000);
      return withTransaction(poolProvider, async (connection) => {
        const [rows] = await connection.query(`SELECT target_key, fence_counter, lease_id, fencing_token, plan_hash, expires_at,
          (expires_at > CURRENT_TIMESTAMP(6)) AS unexpired
          FROM recovery_control_locks WHERE target_key = ? FOR UPDATE`, [targetKey]);
        const row = rows?.[0];
        if (!row || row.lease_id !== leaseId || row.fencing_token !== fencingToken || Number(row.unexpired) !== 1) return { renewed: false, valid: false, secrets_included: false };
        await connection.query("UPDATE recovery_control_locks SET expires_at = DATE_ADD(CURRENT_TIMESTAMP(6), INTERVAL ? MICROSECOND) WHERE target_key = ?", [ttlMicros, targetKey]);
        const [updatedRows] = await connection.query("SELECT target_key, fence_counter, lease_id, fencing_token, plan_hash, expires_at FROM recovery_control_locks WHERE target_key = ?", [targetKey]);
        return { renewed: true, valid: true, ...lockResult(updatedRows?.[0]), secrets_included: false };
      });
    },
    async assertFence(context = {}) {
      const targetKey = requiredId(context.target_key, "target_key");
      const leaseId = requiredId(context.lease_id, "lease_id");
      const fencingToken = requiredId(context.fencing_token, "fencing_token");
      const [rows] = await query(poolProvider, `SELECT lease_id, fencing_token, (expires_at > CURRENT_TIMESTAMP(6)) AS unexpired
        FROM recovery_control_locks WHERE target_key = ? LIMIT 1`, [targetKey]);
      const row = rows?.[0];
      return { valid: Boolean(row && row.lease_id === leaseId && row.fencing_token === fencingToken && Number(row.unexpired) === 1), secrets_included: false };
    },
    async release({ target_key, lock } = {}) {
      const targetKey = requiredId(target_key, "target_key");
      if (!lock?.lease_id || !lock?.fencing_token) return { released: false, secrets_included: false };
      return withTransaction(poolProvider, async (connection) => {
        const [rows] = await connection.query("SELECT lease_id, fencing_token FROM recovery_control_locks WHERE target_key = ? FOR UPDATE", [targetKey]);
        const row = rows?.[0];
        if (!row || row.lease_id !== lock.lease_id || row.fencing_token !== lock.fencing_token) return { released: false, stale_fence: true, secrets_included: false };
        await connection.query("UPDATE recovery_control_locks SET lease_id = NULL, fencing_token = NULL, plan_hash = NULL, expires_at = NULL WHERE target_key = ?", [targetKey]);
        return { released: true, secrets_included: false };
      });
    },
  });
}

export function getProductionRecoveryControlStoreSchemaPlan() {
  return Object.freeze({
    contract: "mad4b.production-recovery-control-store-schema-plan.v1",
    store_contract: PRODUCTION_RECOVERY_CONTROL_STORE_CONTRACT,
    statements: [...RECOVERY_CONTROL_STORE_SCHEMA_STATEMENTS],
    statement_count: RECOVERY_CONTROL_STORE_SCHEMA_STATEMENTS.length,
    auto_apply: false,
    apply_authority: "separate_governed_control_store_provisioning_required",
    production_mutation_allowed: false,
    database_connection_performed: false,
    database_mutation_performed: false,
    secrets_included: false,
  });
}

export function createProductionRecoveryControlStore({
  poolProvider = getRecoveryControlPool,
  executionTicketVerifier = null,
} = {}) {
  if (typeof poolProvider !== "function") throw storeError("RECOVERY_CONTROL_STORE_POOL_PROVIDER_INVALID", "Recovery control-store pool provider must be a function.");
  const recoveryLock = createFencedLock(poolProvider);

  const store = {
    recovery_store_contract: RECOVERY_DURABLE_STORE_CONTRACT,
    implementation_contract: PRODUCTION_RECOVERY_CONTROL_STORE_CONTRACT,
    independent_of_target_databases: true,
    target_database_binding: "forbidden",
    durability: "independent_mysql_control_store",
    shared_replica_safe: true,
    schema_auto_apply: false,
    provider_accessed: false,
    executionTicketVerifier,
    async putRun(value) {
      if (!value?.idempotency_key) {
        return putRecord(poolProvider, RECORD_TYPES.run, value?.run_id, value, {
          plan_id: value?.plan_id,
          step_id: value?.step_id,
          idempotency_key: value?.idempotency_key,
        });
      }

      const idempotencyKey = requiredId(value.idempotency_key, "idempotency_key");
      const runId = requiredId(value.run_id, "run_id");
      const json = canonical(value);
      return withTransaction(poolProvider, async (connection) => {
        const [result] = await connection.query(
          "INSERT IGNORE INTO recovery_control_run_idempotency (idempotency_key, run_id) VALUES (?, ?)",
          [idempotencyKey, runId],
        );
        if (Number(result?.affectedRows) === 0) {
          const [rows] = await connection.query(
            "SELECT run_id FROM recovery_control_run_idempotency WHERE idempotency_key = ? FOR UPDATE",
            [idempotencyKey],
          );
          if (rows.length !== 1) {
            throw storeError(
              "RECOVERY_CONTROL_STORE_IDEMPOTENCY_BINDING_AMBIGUOUS",
              "Recovery run idempotency lookup did not resolve exactly one durable binding.",
              { idempotency_key_hash: digest(idempotencyKey) },
            );
          }
          const [binding] = rows;
          if (binding.run_id !== runId) {
            throw storeError(
              "RECOVERY_CONTROL_STORE_IDEMPOTENCY_COLLISION",
              "An idempotency key cannot be rebound to a different Recovery run.",
              { idempotency_key_hash: digest(idempotencyKey) },
            );
          }
        }

        await connection.query(`INSERT INTO recovery_control_records
          (record_type, record_id, plan_id, step_id, idempotency_key, payload_json, payload_sha256)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            plan_id = VALUES(plan_id), step_id = VALUES(step_id), idempotency_key = VALUES(idempotency_key),
            payload_json = VALUES(payload_json), payload_sha256 = VALUES(payload_sha256)`, [
          RECORD_TYPES.run,
          runId,
          text(value?.plan_id) || null,
          text(value?.step_id) || null,
          idempotencyKey,
          json,
          digest(json),
        ]);
        return { persisted: true };
      });
    },
    async getRun(id) { return getRecord(poolProvider, RECORD_TYPES.run, id); },
    async putPlan(value) { return putRecord(poolProvider, RECORD_TYPES.plan, value?.plan_id, value); },
    async getPlan(id) { return getRecord(poolProvider, RECORD_TYPES.plan, id); },
    async putFinding(value) { return putRecord(poolProvider, RECORD_TYPES.finding, value?.finding_id, value); },
    async getFinding(id) { return getRecord(poolProvider, RECORD_TYPES.finding, id); },
    async getRunByIdempotency(id) {
      const idempotencyKey = requiredId(id, "idempotency_key");
      const [receiptRows] = await query(poolProvider, "SELECT payload_json FROM recovery_control_idempotency_receipts WHERE idempotency_key = ? LIMIT 1", [idempotencyKey]);
      const [receipt] = receiptRows;
      if (receipt) return parsePayload(receipt.payload_json);
      const [rows] = await query(poolProvider, "SELECT run_id FROM recovery_control_run_idempotency WHERE idempotency_key = ? LIMIT 1", [idempotencyKey]);
      const [binding] = rows;
      return binding?.run_id ? getRecord(poolProvider, RECORD_TYPES.run, binding.run_id) : null;
    },
    async getRunByPlanStep(planId, stepId) {
      const [rows] = await query(poolProvider, `SELECT payload_json FROM recovery_control_records
        WHERE record_type = ? AND plan_id = ? AND step_id = ? ORDER BY updated_at DESC, record_id DESC LIMIT 1`, [RECORD_TYPES.run, requiredId(planId, "plan_id"), requiredId(stepId, "step_id")]);
      const [latestRun] = rows;
      return latestRun ? parsePayload(latestRun.payload_json) : null;
    },
    async appendEvidenceEvent(runId, event) {
      const run = requiredId(runId, "run_id");
      const payload = { run_id: run, ...event };
      const json = canonical(payload);
      const eventHash = digest(json);
      const [result] = await query(poolProvider, `INSERT IGNORE INTO recovery_control_evidence_events
        (event_id, run_id, event_hash, payload_json) VALUES (?, ?, ?, ?)`, [randomUUID(), run, eventHash, json]);
      return { appended: Number(result?.affectedRows) === 1, event_hash: eventHash, secrets_included: false };
    },
    async putIdempotencyReceipt(id, value) {
      const key = requiredId(id, "idempotency_key");
      const json = canonical(value);
      await query(poolProvider, `INSERT INTO recovery_control_idempotency_receipts (idempotency_key, payload_json, payload_sha256)
        VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE payload_json = VALUES(payload_json), payload_sha256 = VALUES(payload_sha256)`, [key, json, digest(json)]);
    },
    async putApproval(value) {
      await putRecord(poolProvider, RECORD_TYPES.approval, value?.approval_id, value, { plan_id: value?.plan_id, step_id: value?.step_id });
      await query(poolProvider, `INSERT INTO recovery_control_approval_index (plan_id, step_id, approval_id)
        VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE approval_id = VALUES(approval_id)`, [requiredId(value?.plan_id, "plan_id"), requiredId(value?.step_id, "step_id"), requiredId(value?.approval_id, "approval_id")]);
    },
    async getApprovalByPlanStep(planId, stepId) {
      const [rows] = await query(poolProvider, "SELECT approval_id FROM recovery_control_approval_index WHERE plan_id = ? AND step_id = ? LIMIT 1", [requiredId(planId, "plan_id"), requiredId(stepId, "step_id")]);
      if (rows.length > 1) throw storeError("RECOVERY_CONTROL_STORE_AMBIGUOUS_APPROVAL_INDEX", "Recovery approval index returned multiple approvals for one plan step.");
      return rows?.[0]?.approval_id ? getRecord(poolProvider, RECORD_TYPES.approval, rows[0].approval_id) : null;
    },
    async markApprovalUsed(approvalId) {
      const id = requiredId(approvalId, "approval_id");
      return withTransaction(poolProvider, async (connection) => {
        const [finalRows] = await connection.query("SELECT approval_id FROM recovery_control_approval_finalizations WHERE approval_id = ? FOR UPDATE", [id]);
        if (finalRows?.length) return { already_finalized: true };
        const [rows] = await connection.query("SELECT payload_json FROM recovery_control_records WHERE record_type = ? AND record_id = ? FOR UPDATE", [RECORD_TYPES.approval, id]);
        if (!rows?.length) return { already_finalized: true };
        if (rows.length > 1) throw storeError("RECOVERY_CONTROL_STORE_AMBIGUOUS_APPROVAL", "Recovery approval lookup returned multiple records for one approval identity.");
        const approval = parsePayload(rows[0].payload_json);
        const finalized = { ...approval, used: true, reserved: false, finalized_at: new Date().toISOString() };
        const json = canonical(finalized);
        await connection.query("INSERT INTO recovery_control_approval_finalizations (approval_id) VALUES (?)", [id]);
        await connection.query("UPDATE recovery_control_records SET payload_json = ?, payload_sha256 = ? WHERE record_type = ? AND record_id = ?", [json, digest(json), RECORD_TYPES.approval, id]);
        return { finalized: true };
      });
    },
    async reserveApproval(context = {}) {
      const approvalId = requiredId(context.approval_id, "approval_id");
      const planHash = requiredId(context.plan_hash, "plan_hash");
      const stepId = requiredId(context.step_id, "step_id");
      const idempotencyKey = requiredId(context.idempotency_key, "idempotency_key");
      const reservationKey = approvalReservationKey(context);
      return withTransaction(poolProvider, async (connection) => {
        const [finalRows] = await connection.query("SELECT approval_id FROM recovery_control_approval_finalizations WHERE approval_id = ? FOR UPDATE", [approvalId]);
        if (finalRows?.length) return { reserved: false };
        const [rows] = await connection.query("SELECT payload_json FROM recovery_control_records WHERE record_type = ? AND record_id = ? FOR UPDATE", [RECORD_TYPES.approval, approvalId]);
        if (!rows?.length) return { reserved: false };
        if (rows.length > 1) throw storeError("RECOVERY_CONTROL_STORE_AMBIGUOUS_APPROVAL", "Recovery approval lookup returned multiple records for one approval identity.");
        const approval = parsePayload(rows[0].payload_json);
        if (approval?.used === true || approval?.plan_hash !== planHash || approval?.step_id !== stepId) return { reserved: false };
        const payload = { ...context, reservation_key: reservationKey, reserved_at: new Date().toISOString(), secrets_included: false };
        const [result] = await connection.query(`INSERT IGNORE INTO recovery_control_approval_reservations
          (reservation_key, approval_id, plan_hash, step_id, idempotency_key, payload_json) VALUES (?, ?, ?, ?, ?, ?)`, [reservationKey, approvalId, planHash, stepId, idempotencyKey, canonical(payload)]);
        if (Number(result?.affectedRows) === 1) return { reserved: true, reservation_key: reservationKey };
        const [existingRows] = await connection.query("SELECT idempotency_key FROM recovery_control_approval_reservations WHERE reservation_key = ? FOR UPDATE", [reservationKey]);
        return { reserved: false, existing: true, same_idempotency: existingRows?.[0]?.idempotency_key === idempotencyKey };
      });
    },
    async releaseApprovalReservation(context = {}) {
      const reservationKey = approvalReservationKey(context);
      const idempotencyKey = requiredId(context.idempotency_key, "idempotency_key");
      const [result] = await query(poolProvider, "DELETE FROM recovery_control_approval_reservations WHERE reservation_key = ? AND idempotency_key = ?", [reservationKey, idempotencyKey]);
      return { released: Number(result?.affectedRows) === 1 };
    },
    async claimExecution(context = {}) {
      const idempotencyKey = requiredId(context.idempotency_key, "idempotency_key");
      const claimId = `claim:${digest(idempotencyKey).slice(0, 32)}`;
      const payload = { claim_id: claimId, status: "claimed", ...context, claimed_at: new Date().toISOString(), secrets_included: false };
      const [result] = await query(poolProvider, `INSERT IGNORE INTO recovery_control_execution_claims
        (idempotency_key, claim_id, status, payload_json) VALUES (?, ?, 'claimed', ?)`, [idempotencyKey, claimId, canonical(payload)]);
      if (Number(result?.affectedRows) === 1) return { claimed: true, claim_id: claimId };
      const [rows] = await query(poolProvider, "SELECT claim_id, status FROM recovery_control_execution_claims WHERE idempotency_key = ? LIMIT 1", [idempotencyKey]);
      return { existing: true, status: rows?.[0]?.status || "claimed", claim_id: rows?.[0]?.claim_id || null };
    },
    async releaseExecutionClaim(context = {}) {
      const [result] = await query(poolProvider, "DELETE FROM recovery_control_execution_claims WHERE idempotency_key = ?", [requiredId(context.idempotency_key, "idempotency_key")]);
      return { released: Number(result?.affectedRows) === 1 };
    },
    async getExecutionTicket(ticketId) {
      const [rows] = await query(poolProvider, "SELECT payload_json FROM recovery_control_execution_tickets WHERE ticket_id = ? LIMIT 1", [requiredId(ticketId, "ticket_id")]);
      if (rows.length > 1) throw storeError("RECOVERY_CONTROL_STORE_AMBIGUOUS_EXECUTION_TICKET", "Execution-ticket lookup returned multiple rows for one ticket identity.");
      return rows?.length ? parsePayload(rows[0].payload_json) : null;
    },
    async putExecutionTicket(ticket = {}) {
      const ticketId = requiredId(ticket.ticket_id, "ticket_id");
      const ticketHash = requiredId(ticket.ticket_hash, "ticket_hash");
      const [result] = await query(poolProvider, `INSERT IGNORE INTO recovery_control_execution_tickets
        (ticket_id, ticket_hash, state, payload_json) VALUES (?, ?, 'issued', ?)`, [ticketId, ticketHash, canonical(ticket)]);
      if (Number(result?.affectedRows) === 1) return { persisted: true };
      const [rows] = await query(poolProvider, "SELECT ticket_hash FROM recovery_control_execution_tickets WHERE ticket_id = ? LIMIT 1", [ticketId]);
      if (rows?.[0]?.ticket_hash !== ticketHash) throw storeError("RECOVERY_CONTROL_STORE_EXECUTION_TICKET_COLLISION", "Execution ticket identity cannot be rebound to different content.", { ticket_id_hash: digest(ticketId) });
      return { persisted: true, existing: true };
    },
    async reserveExecutionTicket(context = {}) {
      const ticketId = requiredId(context.ticket_id, "ticket_id");
      const ticketHash = requiredId(context.ticket_hash, "ticket_hash");
      const idempotencyKey = requiredId(context.idempotency_key, "idempotency_key");
      return withTransaction(poolProvider, async (connection) => {
        const [rows] = await connection.query("SELECT ticket_hash, state, reservation_idempotency_key FROM recovery_control_execution_tickets WHERE ticket_id = ? FOR UPDATE", [ticketId]);
        const row = rows?.[0];
        if (!row || row.ticket_hash !== ticketHash || row.state === "finalized") return { reserved: false };
        if (row.state === "reserved") return { reserved: false, existing: true, same_idempotency: row.reservation_idempotency_key === idempotencyKey };
        await connection.query("UPDATE recovery_control_execution_tickets SET state = 'reserved', reservation_idempotency_key = ?, reserved_at = CURRENT_TIMESTAMP(6) WHERE ticket_id = ?", [idempotencyKey, ticketId]);
        return { reserved: true };
      });
    },
    async releaseExecutionTicket(context = {}) {
      const ticketId = requiredId(context.ticket_id, "ticket_id");
      const ticketHash = requiredId(context.ticket_hash, "ticket_hash");
      const idempotencyKey = requiredId(context.idempotency_key, "idempotency_key");
      return withTransaction(poolProvider, async (connection) => {
        const [rows] = await connection.query("SELECT ticket_hash, state, reservation_idempotency_key FROM recovery_control_execution_tickets WHERE ticket_id = ? FOR UPDATE", [ticketId]);
        const row = rows?.[0];
        if (!row || row.ticket_hash !== ticketHash || row.state === "finalized" || row.state !== "reserved" || row.reservation_idempotency_key !== idempotencyKey) return { released: false, finalized: row?.state === "finalized" };
        await connection.query("UPDATE recovery_control_execution_tickets SET state = 'issued', reservation_idempotency_key = NULL, reserved_at = NULL WHERE ticket_id = ?", [ticketId]);
        return { released: true };
      });
    },
    async finalizeExecutionTicket(context = {}) {
      const ticketId = requiredId(context.ticket_id, "ticket_id");
      const ticketHash = requiredId(context.ticket_hash, "ticket_hash");
      const idempotencyKey = requiredId(context.idempotency_key, "idempotency_key");
      return withTransaction(poolProvider, async (connection) => {
        const [rows] = await connection.query("SELECT ticket_hash, state, reservation_idempotency_key FROM recovery_control_execution_tickets WHERE ticket_id = ? FOR UPDATE", [ticketId]);
        const row = rows?.[0];
        if (!row || row.ticket_hash !== ticketHash) return { finalized: false };
        if (row.state === "finalized") return { already_finalized: true };
        if (row.state !== "reserved" || row.reservation_idempotency_key !== idempotencyKey) return { finalized: false };
        await connection.query("UPDATE recovery_control_execution_tickets SET state = 'finalized', finalized_at = CURRENT_TIMESTAMP(6) WHERE ticket_id = ?", [ticketId]);
        return { finalized: true };
      });
    },
    async putException(value) { return putRecord(poolProvider, RECORD_TYPES.exception, value?.exception_id, value); },
    async getException(id) { return getRecord(poolProvider, RECORD_TYPES.exception, id); },
    async appendExceptionEvent(exceptionId, event) {
      const id = requiredId(exceptionId, "exception_id");
      const payload = { exception_id: id, ...event };
      const json = canonical(payload);
      const eventHash = digest(json);
      const [result] = await query(poolProvider, `INSERT IGNORE INTO recovery_control_exception_events
        (event_id, exception_id, event_hash, payload_json) VALUES (?, ?, ?, ?)`, [randomUUID(), id, eventHash, json]);
      return { appended: Number(result?.affectedRows) === 1, event_hash: eventHash, secrets_included: false };
    },
    async putEphemeralCapability(value) { return putRecord(poolProvider, RECORD_TYPES.ephemeralCapability, value?.capability_id, value); },
    async getEphemeralCapability(id) { return getRecord(poolProvider, RECORD_TYPES.ephemeralCapability, id); },
  };

  return Object.freeze({
    ...store,
    recoveryLock,
  });
}

export function createProductionRecoveryFencedLock({ poolProvider = getRecoveryControlPool } = {}) {
  if (typeof poolProvider !== "function") throw storeError("RECOVERY_CONTROL_STORE_POOL_PROVIDER_INVALID", "Recovery control-store pool provider must be a function.");
  return createFencedLock(poolProvider);
}

export const _testingProductionRecoveryControlStore = Object.freeze({
  RECORD_TYPES,
  canonical,
  digest,
  parsePayload,
  boundedTtl,
  approvalReservationKey,
  createFencedLock,
  withTransaction,
});
