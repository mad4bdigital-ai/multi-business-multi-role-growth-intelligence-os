import { google } from "googleapis";
import { getPool } from "./db.js";
import { decryptUserAppCredentials, extractCredentialValue, markUserAppConnectionUsed } from "./userAppConnectionCredentials.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const DEFAULT_PURPOSES = ["support_ticket_admin_notification"];
const GMAIL_APP_KEYS = ["gmail_user_oauth", "gmail", "gmail_api", "google_cloud"];
const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const CONFIRM_SEND = "SEND_AUTH_EMAIL_OUTBOX";

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

export function buildAuthEmailOutboxWorkerReadiness({ env = process.env, apply = false, confirm = "" } = {}) {
  const reasons = [];
  const deliveryEnabled = env.AUTH_EMAIL_OUTBOX_DELIVERY_ENABLED === "true";
  if (apply && !deliveryEnabled) reasons.push("auth_email_outbox_delivery_feature_flag_disabled");
  if (apply && confirm !== CONFIRM_SEND) reasons.push("auth_email_outbox_send_confirmation_required");
  return {
    ready: reasons.length === 0,
    delivery_feature_flag_enabled: deliveryEnabled,
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

async function fetchQueuedEmails(connection, { purposes = DEFAULT_PURPOSES, limit = DEFAULT_LIMIT } = {}) {
  const normalizedPurposes = normalizePurposeList(purposes);
  const safeLimit = integer(limit);
  const placeholders = normalizedPurposes.map(() => "?").join(",");
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
      ORDER BY e.created_at ASC
      LIMIT ${safeLimit}`,
    normalizedPurposes
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
  return {
    ok: true,
    purposes: normalizedPurposes,
    delivery_feature_flag_enabled: process.env.AUTH_EMAIL_OUTBOX_DELIVERY_ENABLED === "true",
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

export async function runAuthEmailOutboxWorker({ pool = getPool(), purposes = DEFAULT_PURPOSES, limit = DEFAULT_LIMIT, dryRun = true, confirm = "", senderConnectionId = "" } = {}) {
  const normalizedPurposes = normalizePurposeList(purposes);
  const safeLimit = integer(limit);
  const apply = !dryRun;
  const readiness = buildAuthEmailOutboxWorkerReadiness({ apply, confirm });
  if (apply && !readiness.ready) {
    const error = new Error(`Auth email outbox delivery is not ready: ${readiness.reasons.join(", ")}`);
    error.code = "auth_email_outbox_delivery_not_ready";
    error.readiness = readiness;
    throw error;
  }

  const connection = await pool.getConnection();
  try {
    if (!apply) {
      const rows = await fetchQueuedEmails(connection, { purposes: normalizedPurposes, limit: safeLimit });
      return {
        ok: true,
        mode: "dry_run",
        purposes: normalizedPurposes,
        eligible_count: rows.length,
        emails: rows.map(compactEmailOutboxRow),
        readiness,
        applies_delivery: false,
        secrets_included: false,
      };
    }

    const delivered = [];
    const failed = [];
    for (let index = 0; index < safeLimit; index += 1) {
      await connection.beginTransaction();
      const rows = await fetchQueuedEmails(connection, { purposes: normalizedPurposes, limit: 1 });
      const email = rows[0] || null;
      if (!email) {
        await connection.commit();
        break;
      }
      const metadata = parseJsonObject(email.metadata_json, {});
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
        const gmailResult = await sendViaGmail({ sender, email });
        const nextMetadata = {
          ...metadata,
          delivery_provider: "gmail_api",
          sender_connection_id: gmailResult.sender_connection_id,
          sender_account_label: gmailResult.sender_account_label,
          external_send_performed: true,
          secrets_included: false,
        };
        await connection.query(
          `UPDATE auth_email_outbox
              SET status = 'sent', provider = 'gmail_api', provider_message_id = ?, metadata_json = ?, last_error = NULL, sent_at = CURRENT_TIMESTAMP
            WHERE email_id = ? AND status = 'queued'`,
          [gmailResult.provider_message_id, JSON.stringify(nextMetadata), email.email_id]
        );
        if (metadata.ticket_id && metadata.tenant_id) {
          await connection.query(
            `INSERT INTO ticket_lifecycle_events (event_id, ticket_id, tenant_id, event_type, from_state, to_state, actor_id, actor_type, visibility, summary, payload_json)
             VALUES (UUID(), ?, ?, 'ticket_admin_notification_sent', NULL, NULL, 'auth_email_outbox_worker', 'system', 'internal_support', ?, ?)`,
            [
              metadata.ticket_id,
              metadata.tenant_id,
              email.subject,
              JSON.stringify({
                email_id: email.email_id,
                provider: "gmail_api",
                provider_message_id: gmailResult.provider_message_id,
                recipient_email: email.recipient_email,
                recipient_route_reason: metadata.recipient_route_reason || null,
                external_send_performed: true,
                secrets_included: false,
              }),
            ]
          );
        }
        await connection.commit();
        delivered.push({ email_id: email.email_id, recipient_email: email.recipient_email, provider_message_id: gmailResult.provider_message_id, secrets_included: false });
      } catch (error) {
        await connection.query(
          `UPDATE auth_email_outbox
              SET status = 'failed', last_error = ?, provider = COALESCE(provider, 'gmail_api')
            WHERE email_id = ? AND status = 'queued'`,
          [String(error?.code || error?.message || "gmail_delivery_failed").slice(0, 1000), email.email_id]
        );
        await connection.commit();
        failed.push({ email_id: email.email_id, recipient_email: email.recipient_email, error_code: error?.code || "gmail_delivery_failed", secrets_included: false });
      }
    }

    return {
      ok: failed.length === 0,
      mode: "apply",
      purposes: normalizedPurposes,
      attempted_count: delivered.length + failed.length,
      delivered_count: delivered.length,
      failed_count: failed.length,
      delivered,
      failed,
      external_send_performed: delivered.length > 0,
      secrets_included: false,
    };
  } finally {
    connection.release();
  }
}
