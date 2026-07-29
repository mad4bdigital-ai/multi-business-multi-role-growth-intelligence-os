import { randomUUID } from "node:crypto";

const ATTEMPT_TABLE = "auth_email_outbox_delivery_attempts";
const ATTEMPT_STATUSES = new Set(["sent", "failed", "abandoned", "dead_lettered"]);

function compactErrorValue(value, maximum = 4000) {
  return String(value || "").slice(0, maximum);
}

function isMissingAttemptLedgerError(error) {
  return ["ER_NO_SUCH_TABLE", "ER_BAD_TABLE_ERROR"].includes(error?.code);
}

export function buildAuthEmailOutboxAttemptIdempotencyKey(emailId = "", attemptNumber = 1) {
  const normalizedEmailId = String(emailId || "").trim();
  const normalizedAttemptNumber = Math.max(1, Number.parseInt(attemptNumber, 10) || 1);
  if (!normalizedEmailId) {
    const error = new Error("Email id is required for a delivery attempt idempotency key.");
    error.code = "auth_email_outbox_attempt_email_id_required";
    throw error;
  }
  return `${normalizedEmailId}:gmail_api:${normalizedAttemptNumber}`;
}

export function isAuthEmailOutboxAttemptClaimConflict(error) {
  return error?.code === "auth_email_outbox_attempt_claim_conflict";
}

export async function requireAuthEmailOutboxAttemptLedger({ pool } = {}) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS count
       FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = ?`,
    [ATTEMPT_TABLE]
  );
  if (Number(rows?.[0]?.count || 0) !== 1) {
    const error = new Error("Auth email outbox delivery-attempt ledger is not installed.");
    error.code = "auth_email_outbox_attempt_ledger_unavailable";
    throw error;
  }
  return { ok: true, attempt_ledger_available: true, secrets_included: false };
}

export async function getAuthEmailOutboxAttemptSummary({ pool, purposes = [] } = {}) {
  const normalizedPurposes = [...new Set((purposes || []).map((item) => String(item || "").trim()).filter(Boolean))];
  if (!normalizedPurposes.length) {
    return { attempt_ledger_available: false, attempt_counts: [], secrets_included: false };
  }
  const placeholders = normalizedPurposes.map(() => "?").join(",");
  try {
    const [rows] = await pool.query(
      `SELECT a.status, COUNT(*) AS count,
              MAX(a.started_at) AS latest_started_at,
              MAX(a.completed_at) AS latest_completed_at,
              MAX(a.sent_at) AS latest_sent_at
         FROM auth_email_outbox_delivery_attempts a
         JOIN auth_email_outbox e ON e.email_id = a.email_id
        WHERE e.purpose IN (${placeholders})
        GROUP BY a.status
        ORDER BY a.status`,
      normalizedPurposes
    );
    return {
      attempt_ledger_available: true,
      attempt_counts: (rows || []).map((row) => ({
        status: row.status,
        count: Number(row.count || 0),
        latest_started_at: row.latest_started_at || null,
        latest_completed_at: row.latest_completed_at || null,
        latest_sent_at: row.latest_sent_at || null,
      })),
      secrets_included: false,
    };
  } catch (error) {
    if (!isMissingAttemptLedgerError(error)) throw error;
    return { attempt_ledger_available: false, attempt_counts: [], secrets_included: false };
  }
}

export async function claimAuthEmailOutboxDeliveryAttempt({
  pool,
  email,
  provider = "gmail_api",
  attemptId = randomUUID(),
} = {}) {
  if (!email?.email_id || !email?.recipient_email) {
    const error = new Error("Email id and recipient are required to claim a delivery attempt.");
    error.code = "auth_email_outbox_attempt_claim_input_invalid";
    throw error;
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT COALESCE(MAX(attempt_number), 0) + 1 AS next_attempt_number
         FROM auth_email_outbox_delivery_attempts
        WHERE email_id = ?`,
      [email.email_id]
    );
    const attemptNumber = Math.max(1, Number(rows?.[0]?.next_attempt_number || 1));
    const idempotencyKey = buildAuthEmailOutboxAttemptIdempotencyKey(email.email_id, attemptNumber);
    await connection.query(
      `INSERT INTO auth_email_outbox_delivery_attempts (
         attempt_id, email_id, attempt_number, idempotency_key, recipient_email,
         provider, status, retry_count, started_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'started', ?, CURRENT_TIMESTAMP)`,
      [
        attemptId,
        email.email_id,
        attemptNumber,
        idempotencyKey,
        email.recipient_email,
        provider,
        attemptNumber - 1,
      ]
    );
    await connection.commit();
    return {
      attempt_id: attemptId,
      attempt_number: attemptNumber,
      idempotency_key: idempotencyKey,
      status: "started",
      provider,
      secrets_included: false,
    };
  } catch (error) {
    try { await connection.rollback(); } catch {}
    if (error?.code === "ER_DUP_ENTRY") {
      const conflict = new Error("An active or duplicate delivery attempt already exists for this outbox row.");
      conflict.code = "auth_email_outbox_attempt_claim_conflict";
      conflict.cause = error;
      throw conflict;
    }
    throw error;
  } finally {
    connection.release();
  }
}

export async function updateAuthEmailOutboxDeliveryAttempt(connection, {
  attemptId,
  status,
  senderConnectionId = null,
  providerMessageId = null,
  providerThreadId = null,
  errorCode = null,
  errorMessage = null,
  lifecycleEventId = null,
} = {}) {
  if (!attemptId || !ATTEMPT_STATUSES.has(status)) {
    const error = new Error("A valid attempt id and terminal delivery-attempt status are required.");
    error.code = "auth_email_outbox_attempt_update_input_invalid";
    throw error;
  }
  const [result] = await connection.query(
    `UPDATE auth_email_outbox_delivery_attempts
        SET status = ?,
            sender_connection_id = ?,
            provider_message_id = ?,
            provider_thread_id = ?,
            error_code = ?,
            error_message = ?,
            lifecycle_event_id = ?,
            completed_at = CURRENT_TIMESTAMP,
            sent_at = CASE WHEN ? = 'sent' THEN CURRENT_TIMESTAMP ELSE sent_at END
      WHERE attempt_id = ?
        AND status = 'started'`,
    [
      status,
      senderConnectionId,
      providerMessageId,
      providerThreadId,
      errorCode ? compactErrorValue(errorCode, 191) : null,
      errorMessage ? compactErrorValue(errorMessage) : null,
      lifecycleEventId,
      status,
      attemptId,
    ]
  );
  if (Number(result?.affectedRows || 0) !== 1) {
    const error = new Error("Delivery attempt is missing or is no longer in started state.");
    error.code = "auth_email_outbox_attempt_not_started";
    throw error;
  }
  return { ok: true, attempt_id: attemptId, status, secrets_included: false };
}

export async function recordAuthEmailOutboxAttemptFinalizeError({
  pool,
  attemptId,
  errorCode,
  errorMessage,
} = {}) {
  if (!attemptId) return { ok: false, updated: false, secrets_included: false };
  const [result] = await pool.query(
    `UPDATE auth_email_outbox_delivery_attempts
        SET error_code = ?, error_message = ?
      WHERE attempt_id = ?
        AND status = 'started'`,
    [compactErrorValue(errorCode || "auth_email_outbox_delivery_finalize_failed", 191), compactErrorValue(errorMessage), attemptId]
  );
  return {
    ok: true,
    updated: Number(result?.affectedRows || 0) === 1,
    attempt_id: attemptId,
    status: "started",
    secrets_included: false,
  };
}
