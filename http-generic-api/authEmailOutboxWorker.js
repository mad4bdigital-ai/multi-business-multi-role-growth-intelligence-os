import { randomUUID } from "node:crypto";
import { google } from "googleapis";
import { getPool } from "./db.js";
import {
  claimAuthEmailOutboxDeliveryAttempt,
  getAuthEmailOutboxAttemptSummary,
  isAuthEmailOutboxAttemptClaimConflict,
  recordAuthEmailOutboxAttemptFinalizeError,
  requireAuthEmailOutboxAttemptLedger,
  updateAuthEmailOutboxDeliveryAttempt,
} from "./authEmailOutboxAttemptLedger.js";
import { decryptUserAppCredentials, extractCredentialValue, markUserAppConnectionUsed } from "./userAppConnectionCredentials.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const DEFAULT_PURPOSES = ["support_ticket_admin_notification"];
const GMAIL_APP_KEYS = ["gmail_user_oauth", "gmail", "gmail_api", "google_cloud"];
const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const CONFIRM_SEND = "SEND_AUTH_EMAIL_OUTBOX";
const RUNTIME_DELIVERY_GATE_KEY = "auth_email_outbox_delivery_gate_v1";

function parseJsonObject(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function integer(value, fallback = DEFAULT_LIMIT, minimum = 1, maximum = MAX_LIMIT) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}

function normalizeEmail(value = "") {
  const email = String(value || "").trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "";
  return email;
}

function headerValue(value = "") {
  return String(value || "").replace(/[\r\n]+/g, " ").trim();
}

function splitList(value = "") {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  return String(value || "").split(/[,\s|]+/).map((item) => item.trim()).filter(Boolean);
}

function scopeOk(granted = "", required = GMAIL_SEND_SCOPE) {
  const got = splitList(granted);
  if (!got.length) return false;
  return got.some((scope) => scope === required || scope === "https://mail.google.com/" || scope === "https://www.googleapis.com/auth/gmail.modify");
}

export function normalizePurposeList(value = DEFAULT_PURPOSES) {
  const items = splitList(value).length ? splitList(value) : DEFAULT_PURPOSES;
  return [...new Set(items)].filter((purpose) => /^[a-z0-9_:-]{3,80}$/i.test(purpose));
}

export async function resolveAuthEmailOutboxRuntimeDeliveryGate({
  pool = getPool(),
  purposes = DEFAULT_PURPOSES,
  limit = DEFAULT_LIMIT,
  now = new Date(),
} = {}) {
  const normalizedPurposes = normalizePurposeList(purposes);
  const safeLimit = integer(limit);
  const [rows] = await pool.query(
    `SELECT config_json, status
       FROM platform_runtime_config
      WHERE config_key = ?
      LIMIT 1`,
    [RUNTIME_DELIVERY_GATE_KEY]
  );
  const row = rows?.[0] || null;
  const config = parseJsonObject(row?.config_json, {});
  const allowedPurposes = [...new Set(splitList(config.purposes || config.purpose || []))]
    .filter((purpose) => /^[a-z0-9_:-]{3,80}$/i.test(purpose));
  const allowedEmailIds = [...new Set(
    (Array.isArray(config.allowed_email_ids) ? config.allowed_email_ids : [])
      .map((value) => String(value || "").trim())
      .filter((value) => /^[A-Za-z0-9._:-]{3,191}$/.test(value))
  )];
  const maxMessages = integer(config.max_messages, 0, 0, MAX_LIMIT);
  const expiresAt = String(config.expires_at || "").trim();
  const expiresAtMs = Date.parse(expiresAt);
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now || ""));
  const reasons = [];
  if (!row) reasons.push("auth_email_outbox_runtime_gate_missing");
  if (row && row.status !== "active") reasons.push("auth_email_outbox_runtime_gate_inactive");
  if (config.enabled !== true) reasons.push("auth_email_outbox_runtime_gate_disabled");
  if (!Number.isFinite(expiresAtMs) || !Number.isFinite(nowMs) || expiresAtMs <= nowMs) {
    reasons.push("auth_email_outbox_runtime_gate_expired");
  }
  if (!normalizedPurposes.every((purpose) => allowedPurposes.includes(purpose))) {
    reasons.push("auth_email_outbox_runtime_gate_purpose_mismatch");
  }
  if (safeLimit > maxMessages) reasons.push("auth_email_outbox_runtime_gate_limit_exceeded");
  if (!allowedEmailIds.length || allowedEmailIds.length < safeLimit) {
    reasons.push("auth_email_outbox_runtime_gate_email_scope_invalid");
  }
  if (config.expected_confirm !== CONFIRM_SEND) {
    reasons.push("auth_email_outbox_runtime_gate_confirmation_mismatch");
  }
  return {
    enabled: reasons.length === 0,
    source: "platform_runtime_config",
    config_key: RUNTIME_DELIVERY_GATE_KEY,
    allowed_email_ids: allowedEmailIds,
    allowed_email_count: allowedEmailIds.length,
    max_messages: maxMessages,
    expires_at: expiresAt || null,
    reasons,
    secrets_included: false,
  };
}

export function buildAuthEmailOutboxWorkerReadiness({
  env = process.env,
  apply = false,
  confirm = "",
  runtimeGateEnabled = false,
} = {}) {
  const reasons = [];
  const envDeliveryEnabled = env.AUTH_EMAIL_OUTBOX_DELIVERY_ENABLED === "true";
  const effectiveDeliveryEnabled = envDeliveryEnabled || Boolean(runtimeGateEnabled);
  if (apply && !effectiveDeliveryEnabled) reasons.push("auth_email_outbox_delivery_feature_flag_disabled");
  if (apply && confirm !== CONFIRM_SEND) reasons.push("auth_email_outbox_send_confirmation_required");
  return {
    ready: reasons.length === 0,
    delivery_feature_flag_enabled: envDeliveryEnabled,
    runtime_delivery_gate_enabled: Boolean(runtimeGateEnabled),
    delivery_enabled: effectiveDeliveryEnabled,
    confirmation_required: CONFIRM_SEND,
    reasons,
    secrets_included: false,
  };
}

export function buildMimeMessage({ from = "", to = "", subject = "", bodyText = "", bodyHtml = null } = {}) {
  const safeFrom = normalizeEmail(from);
  const safeTo = normalizeEmail(to);
  if (!safeTo) {
    const error = new Error("Recipient email is invalid.");
    error.code = "auth_email_outbox_recipient_invalid";
    throw error;
  }
  const headers = [
    `To: ${safeTo}`,
    safeFrom ? `From: ${safeFrom}` : "",
    `Subject: ${headerValue(subject || "Notification")}`,
    "MIME-Version: 1.0",
  ].filter(Boolean);

  if (bodyHtml) {
    const boundary = `mad4b_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    return [
      ...headers,
      `Content-Type: multipart/alternative; boundary=\"${boundary}\"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      String(bodyText || ""),
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      String(bodyHtml || ""),
      `--${boundary}--`,
      "",
    ].join("\r\n");
  }

  return [
    ...headers,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    String(bodyText || ""),
  ].join("\r\n");
}

export function encodeGmailRawMessage(mimeText = "") {
  return Buffer.from(String(mimeText), "utf8").toString("base64url");
}

export function evaluateAuthEmailOutboxSendEligibility(row = {}) {
  const metadata = parseJsonObject(row.metadata_json, {});
  const ticketId = metadata.ticket_id || null;
  if (metadata.smoke_test === true || metadata.internal_smoke === true) {
    return { eligible: false, reason: "smoke_test_notification" };
  }
  if (!ticketId) {
    return { eligible: true, reason: null };
  }
  if (!row.resolved_ticket_id) {
    return { eligible: false, reason: "ticket_not_found" };
  }
  const status = String(row.ticket_status || "").trim().toLowerCase();
  const lifecycleState = String(row.ticket_lifecycle_state || "").trim().toLowerCase();
  const customerStatus = String(row.ticket_customer_status || "").trim().toLowerCase();
  if ([status, lifecycleState, customerStatus].some((value) => ["closed", "resolved", "cancelled", "canceled"].includes(value))) {
    return { eligible: false, reason: "ticket_not_open" };
  }
  return { eligible: true, reason: null };
}

export function compactEmailOutboxRow(row = {}) {
  const metadata = parseJsonObject(row.metadata_json, {});
  const eligibility = evaluateAuthEmailOutboxSendEligibility(row);
  return {
    email_id: row.email_id,
    purpose: row.purpose,
    recipient_email: row.recipient_email,
    subject: row.subject,
    status: row.status,
    provider: row.provider || null,
    ticket_id: metadata.ticket_id || null,
    tenant_id: metadata.tenant_id || null,
    event_type: metadata.event_type || null,
    recipient_route_reason: metadata.recipient_route_reason || null,
    send_eligible: eligibility.eligible,
    skip_reason: eligibility.eligible ? null : eligibility.reason,
    created_at: row.created_at || null,
    secrets_included: false,
  };
}

async function fetchQueuedEmails(connection, {
  purposes = DEFAULT_PURPOSES,
  limit = DEFAULT_LIMIT,
  excludeActiveClaims = false,
  allowedEmailIds = [],
} = {}) {
  const normalizedPurposes = normalizePurposeList(purposes);
  const safeLimit = integer(limit);
  const placeholders = normalizedPurposes.map(() => "?").join(",");
  const normalizedAllowedEmailIds = [...new Set(
    (allowedEmailIds || []).map((value) => String(value || "").trim()).filter(Boolean)
  )];
  const activeClaimFilter = excludeActiveClaims
    ? `AND NOT EXISTS (
         SELECT 1
           FROM auth_email_outbox_delivery_attempts a
          WHERE a.email_id = e.email_id
            AND a.status = 'started'
       )`
    : "";
  const emailScopeFilter = normalizedAllowedEmailIds.length
    ? `AND e.email_id IN (${normalizedAllowedEmailIds.map(() => "?").join(",")})`
    : "";
  const [rows] = await connection.query(
    `SELECT e.email_id, e.purpose, e.recipient_email, e.subject, e.body_text, e.body_html, e.status, e.provider, e.metadata_json, e.created_at,
            t.ticket_id AS resolved_ticket_id,
            t.status AS ticket_status,
            t.lifecycle_state AS ticket_lifecycle_state,
            t.customer_status AS ticket_customer_status
       FROM auth_email_outbox e
       LEFT JOIN tickets t
         ON t.ticket_id = JSON_UNQUOTE(JSON_EXTRACT(e.metadata_json, '$.ticket_id'))
      WHERE e.status = 'queued'
        AND e.purpose IN (${placeholders})
        ${activeClaimFilter}
        ${emailScopeFilter}
      ORDER BY e.created_at ASC
      LIMIT ${safeLimit}`,
    [...normalizedPurposes, ...normalizedAllowedEmailIds]
  );
  return rows || [];
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
    filters.push("(tenant_id = ? OR tenant_id IN ('00000000-0000-0000-0000-000000000000','00000000-0000-4000-a000-000000000001'))");
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
    [...params, tenantId || ""]
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
  const clientId = extractCredentialValue(sender.credentials, "client_id", "clientId") || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = extractCredentialValue(sender.credentials, "client_secret", "clientSecret") || process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = extractCredentialValue(sender.credentials, "refresh_token", "refreshToken");
  if (!clientId || !clientSecret || !refreshToken) {
    const error = new Error("Gmail OAuth credential is incomplete.");
    error.code = "gmail_oauth_credential_incomplete";
    throw error;
  }
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: "v1", auth: oauth2 });
  const fromEmail = sender.row.account_label || sender.row.display_label || "";
  const mimeText = buildMimeMessage({
    from: fromEmail,
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

export async function getAuthEmailOutboxStatus({ pool = getPool(), purposes = DEFAULT_PURPOSES } = {}) {
  const normalizedPurposes = normalizePurposeList(purposes);
  const placeholders = normalizedPurposes.map(() => "?").join(",");
  const [counts] = await pool.query(
    `SELECT purpose, status, COUNT(*) AS count, MAX(created_at) AS latest_created_at, MAX(sent_at) AS latest_sent_at
       FROM auth_email_outbox
      WHERE purpose IN (${placeholders})
      GROUP BY purpose, status
      ORDER BY purpose, status`,
    normalizedPurposes
  );
  const attemptSummary = await getAuthEmailOutboxAttemptSummary({
    pool,
    purposes: normalizedPurposes,
  });
  const runtimeGate = await resolveAuthEmailOutboxRuntimeDeliveryGate({
    pool,
    purposes: normalizedPurposes,
    limit: 1,
  });
  const envDeliveryEnabled = process.env.AUTH_EMAIL_OUTBOX_DELIVERY_ENABLED === "true";
  return {
    ok: true,
    purposes: normalizedPurposes,
    delivery_feature_flag_enabled: envDeliveryEnabled,
    runtime_delivery_gate_enabled: runtimeGate.enabled,
    delivery_enabled: envDeliveryEnabled || runtimeGate.enabled,
    runtime_delivery_gate: {
      enabled: runtimeGate.enabled,
      allowed_email_count: runtimeGate.allowed_email_count,
      max_messages: runtimeGate.max_messages,
      expires_at: runtimeGate.expires_at,
      reasons: runtimeGate.reasons,
      secrets_included: false,
    },
    attempt_ledger_available: attemptSummary.attempt_ledger_available,
    attempt_counts: attemptSummary.attempt_counts,
    counts: (counts || []).map((row) => ({
      purpose: row.purpose,
      status: row.status,
      count: Number(row.count || 0),
      latest_created_at: row.latest_created_at || null,
      latest_sent_at: row.latest_sent_at || null,
    })),
    secrets_included: false,
  };
}

export async function skipAuthEmailOutboxIneligible({ pool = getPool(), purposes = DEFAULT_PURPOSES, limit = DEFAULT_LIMIT, actorId = "auth_email_outbox_skip_ineligible" } = {}) {
  const normalizedPurposes = normalizePurposeList(purposes);
  const safeLimit = integer(limit);
  const connection = await pool.getConnection();
  const skipped = [];
  try {
    const rows = await fetchQueuedEmails(connection, { purposes: normalizedPurposes, limit: safeLimit });
    for (const email of rows || []) {
      const metadata = parseJsonObject(email.metadata_json, {});
      const eligibility = evaluateAuthEmailOutboxSendEligibility(email);
      if (eligibility.eligible) continue;
      const nextMetadata = {
        ...metadata,
        delivery_provider: null,
        external_send_performed: false,
        skip_reason: eligibility.reason,
        skipped_by: actorId,
        secrets_included: false,
      };
      await connection.beginTransaction();
      await connection.query(
        `UPDATE auth_email_outbox
            SET status = 'skipped', metadata_json = ?, last_error = ?, provider = COALESCE(provider, 'support_ticket_router')
          WHERE email_id = ? AND status = 'queued'`,
        [JSON.stringify(nextMetadata), eligibility.reason, email.email_id]
      );
      if (metadata.ticket_id && metadata.tenant_id) {
        await connection.query(
          `INSERT INTO ticket_lifecycle_events (event_id, ticket_id, tenant_id, event_type, from_state, to_state, actor_id, actor_type, visibility, summary, payload_json)
           VALUES (UUID(), ?, ?, 'ticket_admin_notification_skipped', NULL, NULL, ?, 'system', 'internal_support', ?, ?)`,
          [
            metadata.ticket_id,
            metadata.tenant_id,
            actorId,
            eligibility.reason,
            JSON.stringify({
              email_id: email.email_id,
              recipient_email: email.recipient_email,
              recipient_route_reason: metadata.recipient_route_reason || null,
              skip_reason: eligibility.reason,
              external_send_performed: false,
              secrets_included: false,
            }),
          ]
        );
      }
      await connection.commit();
      skipped.push({ email_id: email.email_id, recipient_email: email.recipient_email, skip_reason: eligibility.reason, secrets_included: false });
    }
    return {
      ok: true,
      mode: "skip_ineligible",
      purposes: normalizedPurposes,
      scanned_count: (rows || []).length,
      skipped_count: skipped.length,
      skipped,
      applies_delivery: false,
      external_send_performed: false,
      secrets_included: false,
    };
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally {
    connection.release();
  }
}

export async function runAuthEmailOutboxWorker({ pool = getPool(), purposes = DEFAULT_PURPOSES, limit = DEFAULT_LIMIT, dryRun = true, confirm = "", senderConnectionId = "" } = {}) {
  const normalizedPurposes = normalizePurposeList(purposes);
  const safeLimit = integer(limit);
  const apply = !dryRun;
  const envDeliveryEnabled = process.env.AUTH_EMAIL_OUTBOX_DELIVERY_ENABLED === "true";
  const runtimeGate = apply && !envDeliveryEnabled
    ? await resolveAuthEmailOutboxRuntimeDeliveryGate({
        pool,
        purposes: normalizedPurposes,
        limit: safeLimit,
      })
    : { enabled: false, allowed_email_ids: [], reasons: [], secrets_included: false };
  const readiness = buildAuthEmailOutboxWorkerReadiness({
    apply,
    confirm,
    runtimeGateEnabled: runtimeGate.enabled,
  });
  if (apply && !readiness.ready && runtimeGate.reasons?.length) {
    readiness.runtime_gate_reasons = runtimeGate.reasons;
  }
  if (apply && !readiness.ready) {
    const error = new Error(`Auth email outbox delivery is not ready: ${readiness.reasons.join(", ")}`);
    error.code = "auth_email_outbox_delivery_not_ready";
    error.readiness = readiness;
    throw error;
  }
  if (apply) {
    await requireAuthEmailOutboxAttemptLedger({ pool });
  }

  const connection = await pool.getConnection();
  try {
    if (!apply) {
      const rows = await fetchQueuedEmails(connection, { purposes: normalizedPurposes, limit: safeLimit });
      const eligibleRows = rows.filter((row) => evaluateAuthEmailOutboxSendEligibility(row).eligible);
      const skippedRows = rows.filter((row) => !evaluateAuthEmailOutboxSendEligibility(row).eligible);
      return {
        ok: true,
        mode: "dry_run",
        purposes: normalizedPurposes,
        eligible_count: eligibleRows.length,
        skipped_candidate_count: skippedRows.length,
        emails: eligibleRows.map(compactEmailOutboxRow),
        skipped_candidates: skippedRows.map(compactEmailOutboxRow),
        readiness,
        applies_delivery: false,
        secrets_included: false,
      };
    }

    const delivered = [];
    const failed = [];
    const skipped = [];
    for (let index = 0; index < safeLimit; index += 1) {
      await connection.beginTransaction();
      const rows = await fetchQueuedEmails(connection, {
        purposes: normalizedPurposes,
        limit: 1,
        excludeActiveClaims: true,
        allowedEmailIds: runtimeGate.enabled ? runtimeGate.allowed_email_ids : [],
      });
      const email = rows[0] || null;
      if (!email) {
        await connection.commit();
        break;
      }
      const metadata = parseJsonObject(email.metadata_json, {});
      const eligibility = evaluateAuthEmailOutboxSendEligibility(email);
      if (!eligibility.eligible) {
        const nextMetadata = {
          ...metadata,
          delivery_provider: null,
          external_send_performed: false,
          skip_reason: eligibility.reason,
          skipped_by: "auth_email_outbox_worker",
          secrets_included: false,
        };
        await connection.query(
          `UPDATE auth_email_outbox
              SET status = 'skipped', metadata_json = ?, last_error = ?, provider = COALESCE(provider, 'support_ticket_router')
            WHERE email_id = ? AND status = 'queued'`,
          [JSON.stringify(nextMetadata), eligibility.reason, email.email_id]
        );
        if (metadata.ticket_id && metadata.tenant_id) {
          await connection.query(
            `INSERT INTO ticket_lifecycle_events (event_id, ticket_id, tenant_id, event_type, from_state, to_state, actor_id, actor_type, visibility, summary, payload_json)
             VALUES (UUID(), ?, ?, 'ticket_admin_notification_skipped', NULL, NULL, 'auth_email_outbox_worker', 'system', 'internal_support', ?, ?)`,
            [
              metadata.ticket_id,
              metadata.tenant_id,
              eligibility.reason,
              JSON.stringify({
                email_id: email.email_id,
                recipient_email: email.recipient_email,
                recipient_route_reason: metadata.recipient_route_reason || null,
                skip_reason: eligibility.reason,
                external_send_performed: false,
                secrets_included: false,
              }),
            ]
          );
        }
        await connection.commit();
        skipped.push({ email_id: email.email_id, recipient_email: email.recipient_email, skip_reason: eligibility.reason, secrets_included: false });
        continue;
      }

      await connection.commit();
      let deliveryAttempt = null;
      let gmailResult = null;
      let providerSendCompleted = false;
      try {
        deliveryAttempt = await claimAuthEmailOutboxDeliveryAttempt({ pool, email });
      } catch (error) {
        if (isAuthEmailOutboxAttemptClaimConflict(error)) {
          failed.push({
            email_id: email.email_id,
            recipient_email: email.recipient_email,
            error_code: error.code,
            delivery_state: "claim_conflict",
            external_send_performed: false,
            secrets_included: false,
          });
          continue;
        }
        throw error;
      }

      try {
        const sender = await resolveGmailSenderConnection(connection, {
          senderConnectionId: senderConnectionId || metadata.sender_connection_id || "",
          tenantId: metadata.tenant_id || "",
        });
        if (!sender) {
          const error = new Error("No active Gmail OAuth sender connection with gmail.send scope was resolved.");
          error.code = "gmail_sender_connection_not_found";
          throw error;
        }
        gmailResult = await sendViaGmail({ sender, email });
        providerSendCompleted = true;

        await connection.beginTransaction();
        const nextMetadata = {
          ...metadata,
          delivery_provider: "gmail_api",
          delivery_attempt_id: deliveryAttempt.attempt_id,
          delivery_attempt_number: deliveryAttempt.attempt_number,
          sender_connection_id: gmailResult.sender_connection_id,
          sender_account_label: gmailResult.sender_account_label,
          external_send_performed: true,
          secrets_included: false,
        };
        const [outboxUpdate] = await connection.query(
          `UPDATE auth_email_outbox
              SET status = 'sent', provider = 'gmail_api', provider_message_id = ?, metadata_json = ?, last_error = NULL, sent_at = CURRENT_TIMESTAMP
            WHERE email_id = ? AND status = 'queued'`,
          [gmailResult.provider_message_id, JSON.stringify(nextMetadata), email.email_id]
        );
        if (Number(outboxUpdate?.affectedRows || 0) !== 1) {
          const error = new Error("Outbox row is no longer queued during delivery finalization.");
          error.code = "auth_email_outbox_delivery_state_conflict";
          throw error;
        }

        let lifecycleEventId = null;
        if (metadata.ticket_id && metadata.tenant_id) {
          lifecycleEventId = randomUUID();
          await connection.query(
            `INSERT INTO ticket_lifecycle_events (event_id, ticket_id, tenant_id, event_type, from_state, to_state, actor_id, actor_type, visibility, summary, payload_json)
             VALUES (?, ?, ?, 'ticket_admin_notification_sent', NULL, NULL, 'auth_email_outbox_worker', 'system', 'internal_support', ?, ?)`,
            [
              lifecycleEventId,
              metadata.ticket_id,
              metadata.tenant_id,
              email.subject,
              JSON.stringify({
                email_id: email.email_id,
                attempt_id: deliveryAttempt.attempt_id,
                attempt_number: deliveryAttempt.attempt_number,
                provider: "gmail_api",
                provider_message_id: gmailResult.provider_message_id,
                provider_thread_id: gmailResult.provider_thread_id,
                recipient_email: email.recipient_email,
                recipient_route_reason: metadata.recipient_route_reason || null,
                external_send_performed: true,
                secrets_included: false,
              }),
            ]
          );
        }
        await updateAuthEmailOutboxDeliveryAttempt(connection, {
          attemptId: deliveryAttempt.attempt_id,
          status: "sent",
          senderConnectionId: gmailResult.sender_connection_id,
          providerMessageId: gmailResult.provider_message_id,
          providerThreadId: gmailResult.provider_thread_id,
          lifecycleEventId,
        });
        await connection.commit();
        delivered.push({
          email_id: email.email_id,
          attempt_id: deliveryAttempt.attempt_id,
          attempt_number: deliveryAttempt.attempt_number,
          lifecycle_event_id: lifecycleEventId,
          recipient_email: email.recipient_email,
          provider_message_id: gmailResult.provider_message_id,
          provider_thread_id: gmailResult.provider_thread_id,
          external_send_performed: true,
          secrets_included: false,
        });
      } catch (error) {
        try { await connection.rollback(); } catch {}
        const errorCode = String(error?.code || "gmail_delivery_failed").slice(0, 191);
        const errorMessage = String(error?.message || errorCode).slice(0, 4000);

        if (providerSendCompleted) {
          try {
            await recordAuthEmailOutboxAttemptFinalizeError({
              pool,
              attemptId: deliveryAttempt.attempt_id,
              errorCode: "auth_email_outbox_delivery_finalize_failed",
              errorMessage: `${errorCode}: ${errorMessage}`,
            });
          } catch {}
          failed.push({
            email_id: email.email_id,
            attempt_id: deliveryAttempt.attempt_id,
            attempt_number: deliveryAttempt.attempt_number,
            recipient_email: email.recipient_email,
            provider_message_id: gmailResult?.provider_message_id || null,
            provider_thread_id: gmailResult?.provider_thread_id || null,
            error_code: "auth_email_outbox_delivery_finalize_failed",
            underlying_error_code: errorCode,
            delivery_state: "finalize_pending",
            external_send_performed: true,
            secrets_included: false,
          });
          continue;
        }

        let failureLifecycleEventId = null;
        try {
          await connection.beginTransaction();
          await connection.query(
            `UPDATE auth_email_outbox
                SET status = 'failed', last_error = ?, provider = COALESCE(provider, 'gmail_api')
              WHERE email_id = ? AND status = 'queued'`,
            [errorCode, email.email_id]
          );
          if (metadata.ticket_id && metadata.tenant_id) {
            failureLifecycleEventId = randomUUID();
            await connection.query(
              `INSERT INTO ticket_lifecycle_events (event_id, ticket_id, tenant_id, event_type, from_state, to_state, actor_id, actor_type, visibility, summary, payload_json)
               VALUES (?, ?, ?, 'ticket_admin_notification_delivery_failed', NULL, NULL, 'auth_email_outbox_worker', 'system', 'internal_support', ?, ?)`,
              [
                failureLifecycleEventId,
                metadata.ticket_id,
                metadata.tenant_id,
                errorCode,
                JSON.stringify({
                  email_id: email.email_id,
                  attempt_id: deliveryAttempt.attempt_id,
                  attempt_number: deliveryAttempt.attempt_number,
                  provider: "gmail_api",
                  recipient_email: email.recipient_email,
                  recipient_route_reason: metadata.recipient_route_reason || null,
                  error_code: errorCode,
                  provider_response_received: false,
                  external_send_performed: null,
                  secrets_included: false,
                }),
              ]
            );
          }
          await updateAuthEmailOutboxDeliveryAttempt(connection, {
            attemptId: deliveryAttempt.attempt_id,
            status: "failed",
            errorCode,
            errorMessage,
            lifecycleEventId: failureLifecycleEventId,
          });
          await connection.commit();
          failed.push({
            email_id: email.email_id,
            attempt_id: deliveryAttempt.attempt_id,
            attempt_number: deliveryAttempt.attempt_number,
            lifecycle_event_id: failureLifecycleEventId,
            recipient_email: email.recipient_email,
            error_code: errorCode,
            delivery_state: "failed",
            external_send_performed: null,
            secrets_included: false,
          });
        } catch (finalizeError) {
          try { await connection.rollback(); } catch {}
          try {
            await recordAuthEmailOutboxAttemptFinalizeError({
              pool,
              attemptId: deliveryAttempt.attempt_id,
              errorCode: "auth_email_outbox_failure_finalize_failed",
              errorMessage: `${finalizeError?.code || "finalize_failed"}: ${finalizeError?.message || "Failure finalization failed."}`,
            });
          } catch {}
          failed.push({
            email_id: email.email_id,
            attempt_id: deliveryAttempt.attempt_id,
            attempt_number: deliveryAttempt.attempt_number,
            recipient_email: email.recipient_email,
            error_code: "auth_email_outbox_failure_finalize_failed",
            underlying_error_code: errorCode,
            delivery_state: "finalize_pending",
            external_send_performed: null,
            secrets_included: false,
          });
        }
      }
    }

    return {
      ok: failed.length === 0,
      mode: "apply",
      purposes: normalizedPurposes,
      attempted_count: delivered.length + failed.length + skipped.length,
      delivered_count: delivered.length,
      failed_count: failed.length,
      skipped_count: skipped.length,
      delivered,
      failed,
      skipped,
      external_send_performed: delivered.length > 0 || failed.some((item) => item.external_send_performed === true),
      runtime_delivery_gate_used: runtimeGate.enabled,
      secrets_included: false,
    };
  } finally {
    connection.release();
  }
}
