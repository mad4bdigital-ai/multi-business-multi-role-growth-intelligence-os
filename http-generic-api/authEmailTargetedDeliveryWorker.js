import { randomUUID } from "node:crypto";
import { google } from "googleapis";
import { getPool } from "./db.js";
import {
  buildAuthEmailOutboxWorkerReadiness,
  buildMimeMessage,
  compactEmailOutboxRow,
  encodeGmailRawMessage,
  evaluateAuthEmailOutboxSendEligibility,
} from "./authEmailOutboxWorker.js";
import {
  decryptUserAppCredentials,
  extractCredentialValue,
  markUserAppConnectionUsed,
} from "./userAppConnectionCredentials.js";

const GMAIL_APP_KEYS = ["gmail_user_oauth", "gmail", "gmail_api", "google_cloud"];
const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const CONFIRM_SEND = "SEND_AUTH_EMAIL_OUTBOX";
const MAX_LIMIT = 50;

function parseJsonObject(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function splitList(value = "") {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  return String(value || "")
    .split(/[,\s|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function scopeOk(granted = "") {
  const scopes = splitList(granted);
  return scopes.some(
    (scope) =>
      scope === GMAIL_SEND_SCOPE ||
      scope === "https://mail.google.com/" ||
      scope === "https://www.googleapis.com/auth/gmail.modify",
  );
}

function integer(value, fallback = 20, minimum = 1, maximum = MAX_LIMIT) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}

function structuredError(code, message, status = 400, details = null) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details) error.details = details;
  return error;
}

export function normalizeTargetAuthEmailId(value = "") {
  const emailId = String(value || "").trim().toLowerCase();
  if (!emailId) {
    throw structuredError("auth_email_outbox_email_id_required", "email_id is required.", 400);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(emailId)) {
    throw structuredError("auth_email_outbox_email_id_invalid", "email_id must be a canonical UUID.", 400);
  }
  return emailId;
}

async function fetchTargetEmail(connection, emailId, { lock = false } = {}) {
  const [rows] = await connection.query(
    `SELECT e.email_id, e.purpose, e.recipient_email, e.subject, e.body_text, e.body_html,
            e.status, e.provider, e.provider_message_id, e.metadata_json, e.created_at,
            t.ticket_id AS resolved_ticket_id,
            t.status AS ticket_status,
            t.lifecycle_state AS ticket_lifecycle_state,
            t.customer_status AS ticket_customer_status
       FROM auth_email_outbox e
       LEFT JOIN tickets t
         ON t.ticket_id = JSON_UNQUOTE(JSON_EXTRACT(e.metadata_json, '$.ticket_id'))
      WHERE e.email_id = ?
      LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [emailId],
  );
  return rows?.[0] || null;
}

async function resolveGmailSenderConnection(connection, { senderConnectionId = "", tenantId = "" } = {}) {
  const filters = [
    "status = 'active'",
    "auth_type = 'oauth2'",
    `app_key IN (${GMAIL_APP_KEYS.map(() => "?").join(",")})`,
  ];
  const params = [...GMAIL_APP_KEYS];

  if (senderConnectionId) {
    filters.push("connection_id = ?");
    params.push(senderConnectionId);
  }
  if (!senderConnectionId && tenantId) {
    filters.push(
      "(tenant_id = ? OR tenant_id IN ('00000000-0000-0000-0000-000000000000','00000000-0000-4000-a000-000000000001'))",
    );
    params.push(tenantId);
  }

  const [rows] = await connection.query(
    `SELECT *
       FROM user_app_connections
      WHERE ${filters.join(" AND ")}
      ORDER BY is_primary DESC,
               (tenant_id = ?) DESC,
               COALESCE(last_used_at, last_validated_at, connected_at) DESC
      LIMIT 20`,
    [...params, tenantId || ""],
  );

  for (const row of rows || []) {
    if (!scopeOk(row.scopes_granted)) continue;
    const credentials = decryptUserAppCredentials(row.encrypted_credentials) || {};
    const refreshToken = extractCredentialValue(credentials, "refresh_token", "refreshToken");
    if (!refreshToken) continue;
    return { row, credentials, secrets_included: false };
  }
  return null;
}

async function sendViaGmail({ sender, email }) {
  const clientId =
    extractCredentialValue(sender.credentials, "client_id", "clientId") || process.env.GOOGLE_CLIENT_ID;
  const clientSecret =
    extractCredentialValue(sender.credentials, "client_secret", "clientSecret") ||
    process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = extractCredentialValue(sender.credentials, "refresh_token", "refreshToken");

  if (!clientId || !clientSecret || !refreshToken) {
    throw structuredError("gmail_oauth_credential_incomplete", "Gmail OAuth credential is incomplete.", 503);
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: "v1", auth: oauth2 });
  const mimeText = buildMimeMessage({
    from: sender.row.account_label || sender.row.display_label || "",
    to: email.recipient_email,
    subject: email.subject,
    bodyText: email.body_text,
    bodyHtml: email.body_html,
  });
  const response = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: encodeGmailRawMessage(mimeText) },
  });
  await markUserAppConnectionUsed(sender.row.connection_id);
  return {
    provider_message_id: response?.data?.id || null,
    provider_thread_id: response?.data?.threadId || null,
    sender_connection_id: sender.row.connection_id,
    sender_account_label: sender.row.account_label || null,
    secrets_included: false,
  };
}

async function insertAttempt(connection, email, metadata) {
  const [retryRows] = await connection.query(
    `SELECT COALESCE(MAX(retry_count), -1) + 1 AS retry_count
       FROM auth_email_delivery_attempts
      WHERE email_id = ?`,
    [email.email_id],
  );
  const retryCount = Number(retryRows?.[0]?.retry_count || 0);
  const attemptId = randomUUID();
  await connection.query(
    `INSERT INTO auth_email_delivery_attempts
       (attempt_id, email_id, purpose, recipient_email, provider, status, retry_count, metadata_json, started_at)
     VALUES (?, ?, ?, ?, 'gmail_api', 'started', ?, ?, CURRENT_TIMESTAMP)`,
    [
      attemptId,
      email.email_id,
      email.purpose,
      email.recipient_email,
      retryCount,
      JSON.stringify({
        ticket_id: metadata.ticket_id || null,
        tenant_id: metadata.tenant_id || null,
        recipient_route_reason: metadata.recipient_route_reason || null,
        external_send_performed: false,
        secrets_included: false,
      }),
    ],
  );
  return { attempt_id: attemptId, retry_count: retryCount };
}

async function finalizeAttempt(
  connection,
  {
    attemptId,
    status,
    providerMessageId = null,
    providerThreadId = null,
    senderConnectionId = null,
    errorCode = null,
    errorMessage = null,
    lifecycleEventId = null,
  } = {},
) {
  await connection.query(
    `UPDATE auth_email_delivery_attempts
        SET status = ?, provider_message_id = ?, provider_thread_id = ?, sender_connection_id = ?,
            error_code = ?, error_message = ?, lifecycle_event_id = ?, finished_at = CURRENT_TIMESTAMP,
            sent_at = CASE WHEN ? = 'sent' THEN CURRENT_TIMESTAMP ELSE sent_at END,
            updated_at = CURRENT_TIMESTAMP
      WHERE attempt_id = ? AND status = 'started'`,
    [
      status,
      providerMessageId,
      providerThreadId,
      senderConnectionId,
      errorCode,
      errorMessage,
      lifecycleEventId,
      status,
      attemptId,
    ],
  );
}

async function recordLifecycleEvent(
  connection,
  {
    email,
    metadata,
    eventType,
    summary,
    attemptId,
    providerMessageId = null,
    errorCode = null,
    externalSendPerformed = false,
  } = {},
) {
  if (!metadata.ticket_id || !metadata.tenant_id) return null;
  const eventId = randomUUID();
  await connection.query(
    `INSERT INTO ticket_lifecycle_events
       (event_id, ticket_id, tenant_id, event_type, from_state, to_state, actor_id, actor_type, visibility, summary, payload_json)
     VALUES (?, ?, ?, ?, NULL, NULL, 'auth_email_targeted_delivery_worker', 'system', 'internal_support', ?, ?)`,
    [
      eventId,
      metadata.ticket_id,
      metadata.tenant_id,
      eventType,
      summary,
      JSON.stringify({
        attempt_id: attemptId,
        email_id: email.email_id,
        provider: "gmail_api",
        provider_message_id: providerMessageId,
        recipient_email: email.recipient_email,
        recipient_route_reason: metadata.recipient_route_reason || null,
        error_code: errorCode,
        external_send_performed: externalSendPerformed,
        secrets_included: false,
      }),
    ],
  );
  return eventId;
}

export async function previewTargetAuthEmailDelivery({ pool = getPool(), emailId } = {}) {
  const normalizedEmailId = normalizeTargetAuthEmailId(emailId);
  const connection = await pool.getConnection();
  try {
    const email = await fetchTargetEmail(connection, normalizedEmailId);
    if (!email) {
      throw structuredError(
        "auth_email_outbox_email_not_found",
        "The requested auth email outbox row was not found.",
        404,
      );
    }
    const eligibility = evaluateAuthEmailOutboxSendEligibility(email);
    return {
      ok: true,
      mode: "targeted_dry_run",
      email: compactEmailOutboxRow(email),
      queued: email.status === "queued",
      send_eligible: email.status === "queued" && eligibility.eligible,
      ineligible_reason: email.status !== "queued" ? `status_${email.status}` : eligibility.reason,
      readiness: buildAuthEmailOutboxWorkerReadiness({ apply: false }),
      applies_delivery: false,
      external_send_performed: false,
      secrets_included: false,
    };
  } finally {
    connection.release();
  }
}

export async function listAuthEmailDeliveryAttempts({ pool = getPool(), emailId = "", limit = 20 } = {}) {
  const normalizedEmailId = emailId ? normalizeTargetAuthEmailId(emailId) : "";
  const safeLimit = integer(limit);
  const where = normalizedEmailId ? "WHERE email_id = ?" : "";
  const params = normalizedEmailId ? [normalizedEmailId] : [];
  const [rows] = await pool.query(
    `SELECT attempt_id, email_id, purpose, recipient_email, provider, status, retry_count,
            provider_message_id, provider_thread_id, sender_connection_id, error_code,
            lifecycle_event_id, started_at, finished_at, sent_at, created_at, updated_at
       FROM auth_email_delivery_attempts
       ${where}
      ORDER BY started_at DESC, created_at DESC
      LIMIT ${safeLimit}`,
    params,
  );
  return {
    ok: true,
    email_id: normalizedEmailId || null,
    count: (rows || []).length,
    attempts: (rows || []).map((row) => ({
      ...row,
      retry_count: Number(row.retry_count || 0),
      secrets_included: false,
    })),
    secrets_included: false,
  };
}

export async function applyTargetAuthEmailDelivery({
  pool = getPool(),
  emailId,
  confirm = "",
  senderConnectionId = "",
  resolveSender = resolveGmailSenderConnection,
  deliverEmail = sendViaGmail,
} = {}) {
  const normalizedEmailId = normalizeTargetAuthEmailId(emailId);
  const readiness = buildAuthEmailOutboxWorkerReadiness({ apply: true, confirm });
  if (!readiness.ready || confirm !== CONFIRM_SEND) {
    throw structuredError(
      "auth_email_outbox_delivery_not_ready",
      `Auth email outbox delivery is not ready: ${readiness.reasons.join(", ")}`,
      409,
      readiness,
    );
  }

  const connection = await pool.getConnection();
  let email = null;
  let metadata = {};
  let attempt = null;
  let attemptPersisted = false;
  let providerCallStarted = false;
  let providerResult = null;

  try {
    await connection.beginTransaction();
    email = await fetchTargetEmail(connection, normalizedEmailId, { lock: true });
    if (!email) {
      throw structuredError(
        "auth_email_outbox_email_not_found",
        "The requested auth email outbox row was not found.",
        404,
      );
    }
    if (email.status !== "queued") {
      throw structuredError(
        "auth_email_outbox_email_not_queued",
        `The requested auth email outbox row is ${email.status}, not queued.`,
        409,
      );
    }

    const eligibility = evaluateAuthEmailOutboxSendEligibility(email);
    if (!eligibility.eligible) {
      throw structuredError(
        "auth_email_outbox_email_ineligible",
        `The requested auth email is not eligible: ${eligibility.reason}.`,
        409,
        { reason: eligibility.reason },
      );
    }

    metadata = parseJsonObject(email.metadata_json, {});
    attempt = await insertAttempt(connection, email, metadata);
    const reservationMetadata = {
      ...metadata,
      delivery_attempt_id: attempt.attempt_id,
      delivery_provider: "gmail_api",
      delivery_state: "processing",
      external_send_performed: false,
      secrets_included: false,
    };
    const [reservation] = await connection.query(
      `UPDATE auth_email_outbox
          SET status = 'failed', provider = 'gmail_api', metadata_json = ?, last_error = NULL
        WHERE email_id = ? AND status = 'queued'`,
      [JSON.stringify(reservationMetadata), email.email_id],
    );
    if (Number(reservation?.affectedRows || 0) !== 1) {
      throw structuredError(
        "auth_email_outbox_reservation_conflict",
        "The requested auth email could not be reserved for delivery.",
        409,
      );
    }
    await connection.commit();
    attemptPersisted = true;

    const sender = await resolveSender(connection, {
      senderConnectionId: senderConnectionId || metadata.sender_connection_id || "",
      tenantId: metadata.tenant_id || "",
    });
    if (!sender) {
      throw structuredError(
        "gmail_sender_connection_not_found",
        "No active Gmail OAuth sender connection with gmail.send scope was resolved.",
        503,
      );
    }

    providerCallStarted = true;
    providerResult = await deliverEmail({ sender, email });

    await connection.beginTransaction();
    const sentMetadata = {
      ...metadata,
      delivery_attempt_id: attempt.attempt_id,
      delivery_provider: "gmail_api",
      delivery_state: "sent",
      sender_connection_id: providerResult.sender_connection_id,
      sender_account_label: providerResult.sender_account_label,
      external_send_performed: true,
      secrets_included: false,
    };
    const [sentUpdate] = await connection.query(
      `UPDATE auth_email_outbox
          SET status = 'sent', provider = 'gmail_api', provider_message_id = ?, metadata_json = ?,
              last_error = NULL, sent_at = CURRENT_TIMESTAMP
        WHERE email_id = ? AND status = 'failed'
          AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.delivery_attempt_id')) = ?`,
      [
        providerResult.provider_message_id,
        JSON.stringify(sentMetadata),
        email.email_id,
        attempt.attempt_id,
      ],
    );
    if (Number(sentUpdate?.affectedRows || 0) !== 1) {
      throw structuredError(
        "auth_email_outbox_finalize_conflict",
        "The reserved auth email could not be finalized after provider delivery.",
        409,
      );
    }
    const lifecycleEventId = await recordLifecycleEvent(connection, {
      email,
      metadata,
      eventType: "ticket_admin_notification_sent",
      summary: email.subject,
      attemptId: attempt.attempt_id,
      providerMessageId: providerResult.provider_message_id,
      externalSendPerformed: true,
    });
    await finalizeAttempt(connection, {
      attemptId: attempt.attempt_id,
      status: "sent",
      providerMessageId: providerResult.provider_message_id,
      providerThreadId: providerResult.provider_thread_id,
      senderConnectionId: providerResult.sender_connection_id,
      lifecycleEventId,
    });
    await connection.commit();

    return {
      ok: true,
      mode: "targeted_apply",
      attempt_id: attempt.attempt_id,
      email_id: email.email_id,
      recipient_email: email.recipient_email,
      delivery_status: "sent",
      provider: "gmail_api",
      provider_message_id: providerResult.provider_message_id,
      external_send_performed: true,
      secrets_included: false,
    };
  } catch (error) {
    try {
      await connection.rollback();
    } catch {}

    if (!attemptPersisted || !attempt || !email) throw error;

    const outcomeUnknown = providerCallStarted;
    const attemptStatus = outcomeUnknown ? "unknown" : "failed";
    const deliveryState = outcomeUnknown ? "delivery_unknown" : "failed";
    const errorCode = providerResult?.provider_message_id
      ? "delivery_persistence_failed_after_provider_success"
      : outcomeUnknown
        ? "gmail_delivery_result_unknown"
        : String(error?.code || "gmail_delivery_failed");
    let persistenceErrorCode = null;

    try {
      await connection.beginTransaction();
      const externalSendPerformed = providerResult?.provider_message_id ? true : outcomeUnknown ? null : false;
      const failureMetadata = {
        ...metadata,
        delivery_attempt_id: attempt.attempt_id,
        delivery_provider: "gmail_api",
        delivery_state: deliveryState,
        manual_reconciliation_required: outcomeUnknown,
        external_send_performed: externalSendPerformed,
        secrets_included: false,
      };
      await connection.query(
        `UPDATE auth_email_outbox
            SET status = 'failed', provider = 'gmail_api', metadata_json = ?, last_error = ?
          WHERE email_id = ? AND status = 'failed'
            AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.delivery_attempt_id')) = ?`,
        [
          JSON.stringify(failureMetadata),
          errorCode.slice(0, 1000),
          email.email_id,
          attempt.attempt_id,
        ],
      );
      const lifecycleEventId = await recordLifecycleEvent(connection, {
        email,
        metadata,
        eventType: outcomeUnknown
          ? "ticket_admin_notification_delivery_unknown"
          : "ticket_admin_notification_delivery_failed",
        summary: errorCode,
        attemptId: attempt.attempt_id,
        providerMessageId: providerResult?.provider_message_id || null,
        errorCode,
        externalSendPerformed: providerResult?.provider_message_id ? true : false,
      });
      await finalizeAttempt(connection, {
        attemptId: attempt.attempt_id,
        status: attemptStatus,
        providerMessageId: providerResult?.provider_message_id || null,
        providerThreadId: providerResult?.provider_thread_id || null,
        senderConnectionId: providerResult?.sender_connection_id || null,
        errorCode: errorCode.slice(0, 191),
        errorMessage: String(error?.message || errorCode).slice(0, 2000),
        lifecycleEventId,
      });
      await connection.commit();
    } catch (persistenceError) {
      try {
        await connection.rollback();
      } catch {}
      persistenceErrorCode = persistenceError?.code || "delivery_failure_persistence_failed";
    }

    return {
      ok: false,
      mode: "targeted_apply",
      attempt_id: attempt.attempt_id,
      email_id: email.email_id,
      recipient_email: email.recipient_email,
      delivery_status: attemptStatus,
      error_code: errorCode,
      persistence_error_code: persistenceErrorCode,
      manual_reconciliation_required: outcomeUnknown || Boolean(persistenceErrorCode),
      external_send_performed: providerResult?.provider_message_id ? true : outcomeUnknown ? null : false,
      secrets_included: false,
    };
  } finally {
    connection.release();
  }
}
