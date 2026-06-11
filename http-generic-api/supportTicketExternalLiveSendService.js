import crypto from "node:crypto";
import net from "node:net";
import tls from "node:tls";

const DEFAULT_SMTP_TIMEOUT_MS = 15000;
const SMTP_MAX_BODY_CHARS = 20000;
const SMTP_MAX_SUBJECT_CHARS = 220;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const raw = String(process.env.SMTP_URL || "").trim();
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
    from: parsed.searchParams.get("from") || process.env.SMTP_FROM || parsed.username || "",
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

function smtpReadiness() {
  const allowlist = allowedRecipientPatterns();
  return {
    smtp_url_present: Boolean(process.env.SMTP_URL),
    smtp_configured: smtpConfigured(),
    recipient_allowlist_present: allowlist.length > 0,
    allowlist_count: allowlist.length,
    external_network_allowed: true,
    secret_value_included: false,
    secrets_included: false,
  };
}

function extractEmailPayload(providerPlan = {}) {
  const payload = providerPlan.payload_json || {};
  const to = cleanString(payload.to || payload.recipient_email || payload.email_to || providerPlan.to, 320);
  const subject = cleanString(payload.subject || providerPlan.subject || "Support Ticket update", SMTP_MAX_SUBJECT_CHARS);
  const text = String(payload.body || payload.body_text || providerPlan.body || "").slice(0, SMTP_MAX_BODY_CHARS);
  const html = payload.body_html ? String(payload.body_html).slice(0, SMTP_MAX_BODY_CHARS) : null;
  return { to, subject, text, html };
}

function createMessage({ from, to, subject, text, html, idempotencyKey }) {
  const boundary = `mad4b_${crypto.randomBytes(12).toString("hex")}`;
  const messageId = `<${crypto.createHash("sha256").update(`${Date.now()}:${idempotencyKey || crypto.randomUUID()}`).digest("hex").slice(0, 32)}@mad4b.com>`;
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Message-ID: ${messageId}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
  ];
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

export function checkSupportTicketLiveSendReadiness(providerPlan = {}) {
  const adapter = providerPlan.provider_adapter || {};
  const payload = extractEmailPayload(providerPlan);
  const readiness = smtpReadiness();
  const blockers = [];
  if (providerPlan.send_mode !== "live_send") blockers.push("live_send_mode_required");
  if (!providerPlan.ready_for_provider_dispatch) blockers.push("provider_plan_not_ready");
  if (!adapter.dispatch_enabled || !adapter.provider_dispatch_enabled) blockers.push("provider_dispatch_not_enabled");
  if (!providerPlan.approval_hold_id) blockers.push("approval_hold_required");
  if (!providerPlan.credential_ref) blockers.push("credential_ref_required");
  if (!providerPlan.idempotency_key && !providerPlan.payload_json?.idempotency_key) blockers.push("idempotency_key_required");
  if (!readiness.smtp_configured) blockers.push("smtp_url_not_configured");
  if (!readiness.recipient_allowlist_present) blockers.push("recipient_allowlist_missing");
  if (!isLiveSendRecipientAllowed(payload.to)) blockers.push("recipient_not_allowlisted");
  if (!payload.text && !payload.html) blockers.push("message_body_required");
  return { ok: blockers.length === 0, channel: "email", adapter_key: adapter.adapter_key || null, to_present: Boolean(payload.to), ...readiness, blockers, external_send_performed: false, secret_value_included: false, secrets_included: false };
}

export async function executeSupportTicketLiveSend(providerPlan = {}) {
  const adapter = providerPlan.provider_adapter || {};
  if (String(adapter.channel || "") !== "email") {
    const err = new Error("Live external dispatch currently supports SMTP email only.");
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
  const config = parseSmtpUrl();
  const payload = extractEmailPayload(providerPlan);
  const result = await sendSmtpMail({ config, ...payload, idempotencyKey: providerPlan.idempotency_key || providerPlan.payload_json?.idempotency_key });
  return { ok: true, mode: "live_send", adapter_key: adapter.adapter_key || null, provider_status: result.provider_status, provider_message_id: result.provider_message_id, external_send_performed: true, secret_value_included: false, secrets_included: false };
}
