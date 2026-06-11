import crypto from "node:crypto";
import net from "node:net";
import tls from "node:tls";
import { getGoogleAccessToken } from "./googleAuthTokenResolver.js";
import { getPool } from "./db.js";

const DEFAULT_SMTP_TIMEOUT_MS = 15000;
const SMTP_MAX_BODY_CHARS = 20000;
const SMTP_MAX_SUBJECT_CHARS = 220;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const SMTP_ADAPTER_KEYS = new Set(["smtp_email_adapter", "hostinger_smtp_adapter"]);
const GMAIL_ADAPTER_KEYS = new Set(["gmail_user_oauth_adapter"]);

function cleanString(value, max = 1024) {
  return String(value || "").replace(/[\r\n\u0000]+/g, " ").trim().slice(0, max);
}

function parseListEnv(name) {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try { return JSON.parse(raw).map((item) => String(item).trim()).filter(Boolean); } catch {}
  }
  return raw.split(",").map((item) => item.trim()).filter(Boolean);
}

function allowedRecipientPatterns() {
  return [
    ...parseListEnv("SUPPORT_TICKET_LIVE_SEND_ALLOWLIST"),
    ...parseListEnv("EXTERNAL_DELIVERY_LIVE_SEND_ALLOWLIST"),
  ].map((item) => item.toLowerCase());
}

export function isLiveSendRecipientAllowed(email) {
  const normalized = cleanString(email, 320).toLowerCase();
  if (!EMAIL_PATTERN.test(normalized)) return false;
  const patterns = allowedRecipientPatterns();
  if (!patterns.length) return false;
  return patterns.some((pattern) => {
    if (pattern === normalized) return true;
    if (pattern.startsWith("@")) return normalized.endsWith(pattern);
    if (pattern.startsWith("*.")) return normalized.endsWith(pattern.slice(1));
    return false;
  });
}

function parseSmtpUrl() {
  const raw = String(process.env.SMTP_URL || process.env.HOSTINGER_SMTP_URL || "").trim();
  if (!raw) return null;
  const parsed = new URL(raw);
  if (!["smtp:", "smtps:"].includes(parsed.protocol)) {
    const err = new Error("SMTP_URL must use smtp:// or smtps://.");
    err.code = "support_ticket_live_smtp_url_invalid";
    throw err;
  }
  return {
    secure: parsed.protocol === "smtps:",
    host: parsed.hostname,
    port: Number(parsed.port || (parsed.protocol === "smtps:" ? 465 : 587)),
    username: decodeURIComponent(parsed.username || ""),
    password: decodeURIComponent(parsed.password || ""),
    from: parsed.searchParams.get("from") || process.env.SMTP_FROM || process.env.HOSTINGER_SMTP_FROM || parsed.username || "",
  };
}

function smtpConfigured() {
  try {
    const config = parseSmtpUrl();
    return Boolean(config?.host && config?.port && config?.from);
  } catch {
    return false;
  }
}

function providerRuntimeKind(adapter = {}) {
  const adapterKey = String(adapter.adapter_key || adapter.provider_key || "").trim();
  if (GMAIL_ADAPTER_KEYS.has(adapterKey)) return "gmail_user_oauth";
  if (SMTP_ADAPTER_KEYS.has(adapterKey)) return adapterKey === "hostinger_smtp_adapter" ? "hostinger_smtp" : "smtp";
  return "unsupported_email_provider";
}

function providerReadinessBase(kind) {
  const allowlist = allowedRecipientPatterns();
  return {
    runtime: kind,
    smtp_url_present: Boolean(process.env.SMTP_URL || process.env.HOSTINGER_SMTP_URL),
    smtp_configured: smtpConfigured(),
    recipient_allowlist_present: allowlist.length > 0,
    allowlist_count: allowlist.length,
    external_network_allowed: kind !== "unsupported_email_provider",
    secret_value_included: false,
    secrets_included: false,
  };
}

function extractEmailPayload(providerPlan = {}) {
  const payload = providerPlan.payload_json || {};
  const to = cleanString(payload.to || payload.recipient_email || payload.email_to || providerPlan.to, 320);
  const from = cleanString(payload.from || payload.from_email || providerPlan.from, 320);
  const subject = cleanString(payload.subject || providerPlan.subject || "Support Ticket update", SMTP_MAX_SUBJECT_CHARS);
  const text = String(payload.body || payload.body_text || providerPlan.body || "").slice(0, SMTP_MAX_BODY_CHARS);
  const html = payload.body_html ? String(payload.body_html).slice(0, SMTP_MAX_BODY_CHARS) : null;
  return { to, from, subject, text, html };
}

function createMessage({ from, to, subject, text, html, idempotencyKey }) {
  const boundary = `mad4b_${crypto.randomBytes(12).toString("hex")}`;
  const messageId = `<${crypto.createHash("sha256").update(`${Date.now()}:${idempotencyKey || crypto.randomUUID()}`).digest("hex").slice(0, 32)}@mad4b.com>`;
  const headers = [
    from ? `From: ${from}` : null,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Message-ID: ${messageId}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
  ].filter(Boolean);
  if (html) {
    return {
      messageId,
      data: [
        ...headers,
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        "",
        `--${boundary}`,
        "Content-Type: text/plain; charset=utf-8",
        "Content-Transfer-Encoding: 8bit",
        "",
        text || " ",
        `--${boundary}`,
        "Content-Type: text/html; charset=utf-8",
        "Content-Transfer-Encoding: 8bit",
        "",
        html,
        `--${boundary}--`,
        "",
      ].join("\r\n"),
    };
  }
  return {
    messageId,
    data: [
      ...headers,
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      text || " ",
      "",
    ].join("\r\n"),
  };
}

function dotStuff(value) {
  return String(value || "").replace(/^\./gm, "..");
}

function connectSocket(config, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = config.secure
      ? tls.connect({ host: config.host, port: config.port, servername: config.host, timeout: timeoutMs })
      : net.connect({ host: config.host, port: config.port, timeout: timeoutMs });
    const done = (fn) => (value) => {
      socket.off("connect", onConnect);
      socket.off("secureConnect", onSecureConnect);
      socket.off("error", onError);
      socket.off("timeout", onTimeout);
      fn(value);
    };
    const onConnect = done(() => resolve(socket));
    const onSecureConnect = done(() => resolve(socket));
    const onError = done(reject);
    const onTimeout = done(() => {
      socket.destroy();
      reject(Object.assign(new Error("SMTP connection timed out."), { code: "support_ticket_live_smtp_timeout" }));
    });
    socket.once("connect", onConnect);
    socket.once("secureConnect", onSecureConnect);
    socket.once("error", onError);
    socket.once("timeout", onTimeout);
  });
}

async function readSmtpResponse(socket) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1] || "";
      if (/^\d{3} /.test(last)) {
        socket.off("data", onData);
        const code = Number(last.slice(0, 3));
        resolve({ code, raw: lines.map((line) => line.slice(0, 4)).join("|") });
      }
    };
    socket.on("data", onData);
    socket.once("error", reject);
  });
}

async function writeSmtp(socket, command, expected = [250]) {
  socket.write(`${command}\r\n`);
  const response = await readSmtpResponse(socket);
  if (!expected.includes(response.code)) {
    const err = new Error("SMTP command failed.");
    err.code = "support_ticket_live_smtp_command_failed";
    err.smtp_code = response.code;
    throw err;
  }
  return response;
}

async function sendSmtpMail({ config, to, subject, text, html, idempotencyKey }) {
  const socket = await connectSocket(config, DEFAULT_SMTP_TIMEOUT_MS);
  try {
    await readSmtpResponse(socket);
    await writeSmtp(socket, `EHLO ${process.env.SMTP_EHLO_DOMAIN || "mad4b.com"}`);
    if (!config.secure) {
      const err = new Error("Use smtps:// SMTP_URL for live dispatch; smtp:// STARTTLS upgrade is not enabled by this adapter yet.");
      err.code = "support_ticket_live_smtp_starttls_not_enabled";
      throw err;
    }
    if (config.username || config.password) {
      const auth = Buffer.from(`\u0000${config.username}\u0000${config.password}`, "utf8").toString("base64");
      await writeSmtp(socket, `AUTH PLAIN ${auth}`, [235, 250]);
    }
    const { data, messageId } = createMessage({ from: config.from, to, subject, text, html, idempotencyKey });
    await writeSmtp(socket, `MAIL FROM:<${config.from}>`);
    await writeSmtp(socket, `RCPT TO:<${to}>`, [250, 251]);
    await writeSmtp(socket, "DATA", [354]);
    socket.write(`${dotStuff(data)}\r\n.\r\n`);
    await readSmtpResponse(socket);
    await writeSmtp(socket, "QUIT", [221, 250]);
    return { provider_message_id: messageId, provider_status: "sent", external_send_performed: true };
  } finally {
    socket.destroy();
  }
}

function gmailOauthConfigRef(providerPlan = {}) {
  const payload = providerPlan.payload_json || {};
  const explicit = cleanString(payload.google_oauth_config_ref || payload.oauth_config_ref, 700);
  if (explicit) return explicit;
  const appKey = cleanString(payload.google_app_key || payload.app_key || "google_cloud", 64);
  const scopes = cleanString(payload.google_scopes || GMAIL_SEND_SCOPE, 300);
  const userId = cleanString(payload.user_id || payload.member_user_id, 128);
  if (userId) return `member_user_id:${userId};app_key=${appKey};scopes=${scopes}`;
  const memberEmail = cleanString(payload.member_email || payload.google_account_email, 320);
  if (memberEmail) return `member_email:${memberEmail};app_key=${appKey};scopes=${scopes}`;
  const tenantId = cleanString(providerPlan.tenant_id || payload.tenant_id, 128);
  if (tenantId) return `tenant_primary:${appKey};tenant_id=${tenantId};app_key=${appKey};scopes=${scopes}`;
  return "";
}

function base64Url(value) {
  return Buffer.from(String(value || ""), "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sendGmailMail(providerPlan = {}, payload = {}) {
  const oauthRef = gmailOauthConfigRef(providerPlan);
  const token = await getGoogleAccessToken({
    oauth_config_ref: oauthRef,
    action: {
      action_key: "gmail_api",
      connector_family: payload.google_app_key || "google_cloud",
      required_oauth_scopes: GMAIL_SEND_SCOPE,
      oauth_config_ref: oauthRef,
    },
    auth_context: { allow_platform_fallback: false },
    allow_platform_fallback: false,
  });
  if (!token) {
    const err = new Error("No Google OAuth access token resolved for Gmail live send.");
    err.status = 403;
    err.code = "support_ticket_live_gmail_token_unavailable";
    throw err;
  }
  const { data, messageId } = createMessage({
    from: payload.from || "",
    to: payload.to,
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
    idempotencyKey: providerPlan.idempotency_key || providerPlan.payload_json?.idempotency_key,
  });
  const response = await fetch(GMAIL_SEND_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: base64Url(data) }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error("Gmail API live send failed.");
    err.status = response.status;
    err.code = "support_ticket_live_gmail_send_failed";
    err.provider_status = result?.error?.status || null;
    throw err;
  }
  return { provider_message_id: result.id || messageId, provider_status: "sent", external_send_performed: true };
}

export function checkSupportTicketLiveSendReadiness(providerPlan = {}) {
  const adapter = providerPlan.provider_adapter || {};
  const payload = extractEmailPayload(providerPlan);
  const runtime = providerRuntimeKind(adapter);
  const readiness = providerReadinessBase(runtime);
  const blockers = [];
  if (providerPlan.send_mode !== "live_send") blockers.push("live_send_mode_required");
  if (!providerPlan.ready_for_provider_dispatch) blockers.push("provider_plan_not_ready");
  if (!adapter.dispatch_enabled || !adapter.provider_dispatch_enabled) blockers.push("provider_dispatch_not_enabled");
  if (!providerPlan.approval_hold_id) blockers.push("approval_hold_required");
  if (!providerPlan.credential_ref) blockers.push("credential_ref_required");
  if (!providerPlan.idempotency_key && !providerPlan.payload_json?.idempotency_key) blockers.push("idempotency_key_required");
  if (!readiness.recipient_allowlist_present) blockers.push("recipient_allowlist_missing");
  if (!isLiveSendRecipientAllowed(payload.to)) blockers.push("recipient_not_allowlisted");
  if (!payload.text && !payload.html) blockers.push("message_body_required");
  if (runtime === "smtp" || runtime === "hostinger_smtp") {
    if (!readiness.smtp_configured) blockers.push("smtp_url_not_configured");
  } else if (runtime === "gmail_user_oauth") {
    if (!gmailOauthConfigRef(providerPlan)) blockers.push("gmail_user_oauth_connection_ref_required");
  } else {
    blockers.push("live_send_provider_runtime_not_supported");
  }
  return { ok: blockers.length === 0, channel: "email", adapter_key: adapter.adapter_key || null, to_present: Boolean(payload.to), ...readiness, blockers, external_send_performed: false, secret_value_included: false, secrets_included: false };
}

export async function executeSupportTicketLiveSend(providerPlan = {}) {
  const adapter = providerPlan.provider_adapter || {};
  if (String(adapter.channel || "") !== "email") {
    const err = new Error("Live external dispatch currently supports email providers only.");
    err.status = 409;
    err.code = "support_ticket_live_send_adapter_not_supported";
    throw err;
  }
  const readiness = checkSupportTicketLiveSendReadiness(providerPlan);
  if (!readiness.ok) {
    const err = new Error("Live external dispatch is blocked by readiness gates.");
    err.status = 409;
    err.code = "support_ticket_live_send_readiness_blocked";
    err.readiness = readiness;
    err.external_send_performed = false;
    err.secrets_included = false;
    throw err;
  }
  const payload = extractEmailPayload(providerPlan);
  const runtime = providerRuntimeKind(adapter);
  const result = runtime === "gmail_user_oauth"
    ? await sendGmailMail(providerPlan, payload)
    : await sendSmtpMail({ config: parseSmtpUrl(), ...payload, idempotencyKey: providerPlan.idempotency_key || providerPlan.payload_json?.idempotency_key });
  return { ok: true, mode: "live_send", runtime, adapter_key: adapter.adapter_key || null, provider_status: result.provider_status, provider_message_id: result.provider_message_id, external_send_performed: true, secret_value_included: false, secrets_included: false };
}
