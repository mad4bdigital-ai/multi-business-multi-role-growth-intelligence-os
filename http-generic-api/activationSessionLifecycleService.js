import { randomUUID, createHash } from "node:crypto";

const DEFAULT_REUSE_WINDOW_HOURS = 24;

function compactError(err, fallback = "activation_session_lifecycle_failed") {
  return { code: err?.code || fallback, message: err?.message || String(err || fallback) };
}

function normalizeText(value, max = 220) {
  const text = String(value || "").trim();
  if (!text) return null;
  return text.slice(0, max);
}

export function normalizeActivationSessionPolicy(value) {
  const normalized = String(value || "reuse_or_create").trim().toLowerCase();
  if (["reuse_or_create", "create_new", "reuse_only", "read_only"].includes(normalized)) return normalized;
  return "reuse_or_create";
}

export function deriveActivationIdempotencyKey({ explicitKey = null, tenantId = null, userId = null, conversationRef = null } = {}) {
  const explicit = normalizeText(explicitKey, 180);
  if (explicit) return explicit;
  const conversation = normalizeText(conversationRef, 500);
  if (!conversation) return null;
  return createHash("sha256")
    .update([tenantId || "platform", userId || "anonymous", conversation].join("|"))
    .digest("hex");
}

async function querySafe(pool, sql, params = []) {
  try {
    const [rows] = await pool.query(sql, params);
    return { ok: true, rows: Array.isArray(rows) ? rows : [], result: rows };
  } catch (err) {
    return { ok: false, rows: [], result: null, error: compactError(err) };
  }
}

async function findActiveSession(pool, subject = {}) {
  const tenantId = subject.tenant_id || "00000000-0000-0000-0000-000000000000";
  const userId = subject.user_id || null;
  const result = await querySafe(
    pool,
    `SELECT session_id, tenant_id, user_id, session_status, started_at, ended_at
       FROM customer_sessions
      WHERE originator = 'gpt_action'
        AND tenant_id = ?
        AND (? IS NULL OR user_id = ?)
        AND session_status IN ('pending','active')
      ORDER BY started_at DESC
      LIMIT 1`,
    [tenantId, userId, userId]
  );
  return result.ok ? result.rows[0] || null : null;
}

async function findReusableRun(pool, { tenantId, userId, idempotencyKey, reuseWindowHours }) {
  if (!idempotencyKey) return { ok: true, row: null };
  const result = await querySafe(
    pool,
    `SELECT r.run_id, r.session_id, r.idempotency_key, r.response_profile,
            r.run_status, r.validation_state, r.evidence_state, r.delivery_state,
            r.consumer_ack_state, r.retry_count, r.snapshot_id, r.created_at, r.updated_at,
            s.session_status, s.started_at
       FROM activation_runs r
       JOIN customer_sessions s ON s.session_id = r.session_id
      WHERE r.tenant_id = ?
        AND (? IS NULL OR r.user_id = ?)
        AND r.idempotency_key = ?
        AND r.created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? HOUR)
        AND s.session_status IN ('pending','active')
      ORDER BY r.created_at DESC
      LIMIT 1`,
    [tenantId, userId, userId, idempotencyKey, reuseWindowHours]
  );
  if (!result.ok) return { ok: false, row: null, error: result.error };
  return { ok: true, row: result.rows[0] || null };
}

async function touchReusableRun(pool, row, responseProfile) {
  await querySafe(
    pool,
    `UPDATE activation_runs
        SET retry_count = retry_count + 1,
            response_profile = COALESCE(?, response_profile),
            run_status = CASE WHEN run_status IN ('failed','cancelled') THEN 'retrying' ELSE run_status END,
            updated_at = UTC_TIMESTAMP()
      WHERE run_id = ?`,
    [responseProfile || null, row.run_id]
  );
}

async function insertActivationRun(pool, { runId, sessionId, tenantId, userId, idempotencyKey, responseProfile, sessionPolicy }) {
  const result = await querySafe(
    pool,
    `INSERT INTO activation_runs
      (run_id, session_id, tenant_id, user_id, idempotency_key, session_policy,
       response_profile, run_status, validation_state, evidence_state, delivery_state,
       consumer_ack_state, retry_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'running', 'pending', 'pending', 'not_prepared',
             'not_received', 0, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
    [runId, sessionId, tenantId, userId, idempotencyKey, sessionPolicy, responseProfile]
  );
  return result;
}

export async function resolveActivationSessionLifecycle({
  pool,
  subject = {},
  options = {},
  openSession,
} = {}) {
  if (!pool || typeof openSession !== "function") {
    const err = new Error("Activation session lifecycle requires pool and openSession.");
    err.code = "activation_session_lifecycle_invalid_arguments";
    throw err;
  }

  const tenantId = subject.tenant_id || "00000000-0000-0000-0000-000000000000";
  const userId = subject.user_id || null;
  const sessionPolicy = normalizeActivationSessionPolicy(options.session_policy || (options.read_only ? "read_only" : "reuse_or_create"));
  const responseProfile = normalizeText(options.response_profile, 40) || "evidence";
  const idempotencyKey = deriveActivationIdempotencyKey({
    explicitKey: options.idempotency_key,
    tenantId,
    userId,
    conversationRef: options.conversation_ref,
  });
  const reuseWindowHours = Math.min(Math.max(Number(options.reuse_window_hours || DEFAULT_REUSE_WINDOW_HOURS), 1), 168);

  if (sessionPolicy === "read_only" || options.read_only === true) {
    const existing = await findActiveSession(pool, subject);
    return {
      run_id: null,
      session_id: existing?.session_id || null,
      closed_sessions: 0,
      archive_status: "not_attempted_read_only",
      reused: Boolean(existing),
      created: false,
      idempotency_key: idempotencyKey,
      session_policy: "read_only",
      session_management: {
        parallel_sessions_allowed: true,
        close_previous_sessions_requested: false,
        active_sessions_before_open: existing ? 1 : 0,
        active_sessions_after_open: existing ? 1 : 0,
        status_written: null,
        read_only: true,
        reused_existing_session: Boolean(existing),
      },
    };
  }

  if (sessionPolicy !== "create_new" && idempotencyKey) {
    const reusable = await findReusableRun(pool, { tenantId, userId, idempotencyKey, reuseWindowHours });
    if (reusable.ok && reusable.row) {
      await touchReusableRun(pool, reusable.row, responseProfile);
      return {
        run_id: reusable.row.run_id,
        session_id: reusable.row.session_id,
        closed_sessions: 0,
        archive_status: "reused_existing_archive",
        reused: true,
        created: false,
        idempotency_key: idempotencyKey,
        session_policy: sessionPolicy,
        previous_delivery_state: reusable.row.delivery_state,
        previous_evidence_state: reusable.row.evidence_state,
        snapshot_id: reusable.row.snapshot_id || null,
        session_management: {
          parallel_sessions_allowed: true,
          close_previous_sessions_requested: false,
          active_sessions_before_open: 1,
          active_sessions_after_open: 1,
          status_written: null,
          read_only: false,
          reused_existing_session: true,
          retry_count: Number(reusable.row.retry_count || 0) + 1,
        },
      };
    }
    if (sessionPolicy === "reuse_only") {
      const err = new Error("No reusable activation session exists for this idempotency key.");
      err.status = 409;
      err.code = "activation_reuse_session_not_found";
      throw err;
    }
  }

  const opened = await openSession();
  const runId = randomUUID();
  const inserted = await insertActivationRun(pool, {
    runId,
    sessionId: opened.session_id,
    tenantId,
    userId,
    idempotencyKey,
    responseProfile,
    sessionPolicy,
  });

  return {
    ...opened,
    run_id: inserted.ok ? runId : null,
    reused: false,
    created: true,
    idempotency_key: idempotencyKey,
    session_policy: sessionPolicy,
    lifecycle_registry_status: inserted.ok ? "registered" : "degraded_registry_unavailable",
    lifecycle_registry_error: inserted.ok ? null : inserted.error,
    session_management: {
      ...(opened.session_management || {}),
      read_only: false,
      reused_existing_session: false,
      retry_count: 0,
    },
  };
}

export async function markActivationRunPrepared(pool, {
  runId,
  snapshotId = null,
  responseProfile = null,
  responseBytes = null,
  validationState = "complete",
  evidenceState = "complete",
  deliveryState = "prepared",
  projection = null,
} = {}) {
  if (!runId) return { ok: true, skipped: true, reason: "missing_run_id" };
  return querySafe(
    pool,
    `UPDATE activation_runs
        SET snapshot_id = COALESCE(?, snapshot_id),
            response_profile = COALESCE(?, response_profile),
            response_bytes = ?,
            validation_state = ?,
            evidence_state = ?,
            delivery_state = ?,
            run_status = CASE WHEN ? = 'complete' THEN 'evidence_ready' ELSE run_status END,
            projection_json = ?,
            updated_at = UTC_TIMESTAMP()
      WHERE run_id = ?`,
    [snapshotId, responseProfile, responseBytes, validationState, evidenceState, deliveryState,
      evidenceState, projection ? JSON.stringify(projection) : null, runId]
  );
}

export async function markActivationRunDelivered(pool, { runId, statusCode = 200, deliveryState = "delivered" } = {}) {
  if (!runId) return { ok: true, skipped: true, reason: "missing_run_id" };
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const update = await querySafe(
      connection,
      `UPDATE activation_runs
          SET delivery_state = ?,
              delivered_status_code = ?,
              delivered_at = UTC_TIMESTAMP(),
              run_status = CASE WHEN ? = 'delivered' THEN 'delivered' ELSE run_status END,
              updated_at = UTC_TIMESTAMP()
        WHERE run_id = ?`,
      [deliveryState, statusCode, deliveryState, runId]
    );
    if (!update.ok) throw Object.assign(new Error(update.error?.message || "Activation run delivery update failed."), update.error || {});
    await querySafe(
      connection,
      `UPDATE activation_snapshot_ledger
          SET snapshot_status = CASE WHEN ? = 'delivered' THEN 'delivered' ELSE snapshot_status END,
              updated_at = UTC_TIMESTAMP()
        WHERE run_id = ?`,
      [deliveryState, runId]
    );
    await connection.commit();
    return update;
  } catch (err) {
    await connection.rollback().catch(() => {});
    return { ok: false, rows: [], result: null, error: compactError(err, "activation_delivery_state_update_failed") };
  } finally {
    connection.release();
  }
}

export async function acknowledgeActivationRun(pool, { runId, acknowledgedBy = null, consumerState = "acknowledged" } = {}) {
  if (!runId) {
    const err = new Error("run_id is required");
    err.status = 400;
    err.code = "activation_run_id_required";
    throw err;
  }
  const result = await querySafe(
    pool,
    `UPDATE activation_runs
        SET consumer_ack_state = ?,
            acknowledged_by = ?,
            consumer_ack_at = UTC_TIMESTAMP(),
            updated_at = UTC_TIMESTAMP()
      WHERE run_id = ?`,
    [consumerState, normalizeText(acknowledgedBy, 180), runId]
  );
  return { ok: result.ok, affected_rows: Number(result.result?.affectedRows || 0), error: result.error || null };
}

export const _testingActivationSessionLifecycle = {
  normalizeText,
  compactError,
};
