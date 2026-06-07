import { randomUUID, createHmac } from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import { getPool } from "./db.js";

const DELIVERY_LIMIT_DEFAULT = 25;
const DELIVERY_TIMEOUT_MS = 10000;

function safeJsonParse(value, fallback) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function parseEvents(value = "") {
  const parsed = safeJsonParse(value, null);
  if (Array.isArray(parsed)) return parsed.map((item) => String(item || "").trim()).filter(Boolean);
  return String(value || "").split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
}

function webhookMatchesEvent(webhook = {}, eventType = "") {
  const events = parseEvents(webhook.events);
  return events.includes("*") || events.includes(eventType);
}

function isBlockedIp(ip = "") {
  const value = String(ip || "").trim().toLowerCase();
  if (!value) return true;
  if (value === "::1" || value === "0:0:0:0:0:0:0:1") return true;
  if (value.startsWith("127.")) return true;
  if (value.startsWith("10.")) return true;
  if (value.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(value)) return true;
  if (value.startsWith("169.254.")) return true;
  if (value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80:")) return true;
  return false;
}

async function assertWebhookTargetAllowed(rawUrl = "") {
  let parsed;
  try { parsed = new URL(String(rawUrl || "")); } catch {
    const err = new Error("Webhook URL is invalid.");
    err.code = "webhook_url_invalid";
    throw err;
  }
  if (parsed.protocol !== "https:") {
    const err = new Error("Webhook URL must use https.");
    err.code = "webhook_url_https_required";
    throw err;
  }
  const hostname = parsed.hostname;
  if (!hostname || hostname === "localhost" || hostname.endsWith(".local")) {
    const err = new Error("Webhook URL hostname is blocked.");
    err.code = "webhook_url_host_blocked";
    throw err;
  }
  const records = await dns.lookup(hostname, { all: true, verbatim: false });
  if (!records.length || records.some((record) => isBlockedIp(record.address) || (net.isIP(hostname) && isBlockedIp(hostname)))) {
    const err = new Error("Webhook URL resolves to a blocked address.");
    err.code = "webhook_url_address_blocked";
    throw err;
  }
  return parsed.toString();
}

export function buildCredentialIntakeCompletedPayload({ session = {}, connectionId = "" } = {}) {
  return {
    event_type: "credential_intake.completed",
    event_id: randomUUID(),
    occurred_at: new Date().toISOString(),
    tenant_id: session.tenant_id,
    user_id: session.user_id,
    app_key: session.app_key,
    auth_type: session.auth_type,
    session_id: session.session_id,
    connection_id: connectionId,
    status: "used",
    completed: true,
    next_tools: session.auth_type === "ssh_key_pair"
      ? ["tenant_ssh_connection_status", "tenant_ssh_probe", "tenant_ssh_cli_allowlisted_dry_run", "tenant_ssh_cli_approval_request_create", "tenant_ssh_cli_allowlisted_execute", "tenant_ssh_cli_execute_job_result"]
      : [],
    webhook_safe_event: "credential_intake.completed",
    secrets_included: false,
  };
}

export async function enqueueCredentialIntakeCompletedWebhook({ pool = getPool(), session = {}, connectionId = "" } = {}) {
  const payload = buildCredentialIntakeCompletedPayload({ session, connectionId });
  const [webhooks] = await pool.query(
    `SELECT webhook_id, tenant_id, url, events, status
       FROM webhooks
      WHERE tenant_id = ? AND status = 'active'`,
    [session.tenant_id]
  ).catch(() => [[]]);
  const matching = (webhooks || []).filter((webhook) => webhookMatchesEvent(webhook, payload.event_type));
  if (!matching.length) {
    await pool.query(
      `INSERT INTO webhook_deliveries
         (delivery_id, webhook_id, tenant_id, event_type, payload_json, status, attempts, created_at, updated_at)
       VALUES (?, NULL, ?, ?, ?, 'skipped', 0, NOW(), NOW())`,
      [randomUUID(), session.tenant_id, payload.event_type, JSON.stringify({ ...payload, skipped_reason: "no_active_matching_webhook" })]
    ).catch(() => {});
    return { ok: true, queued_count: 0, skipped: true, event_type: payload.event_type, secrets_included: false };
  }
  for (const webhook of matching) {
    await pool.query(
      `INSERT INTO webhook_deliveries
         (delivery_id, webhook_id, tenant_id, event_type, payload_json, status, attempts, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'queued', 0, NOW(), NOW())`,
      [randomUUID(), webhook.webhook_id, session.tenant_id, payload.event_type, JSON.stringify(payload)]
    );
  }
  return { ok: true, queued_count: matching.length, event_type: payload.event_type, secrets_included: false };
}

function deliverySignature({ secretHash = "", payload = "" } = {}) {
  if (!secretHash) return "";
  return createHmac("sha256", String(secretHash)).update(payload).digest("hex");
}

async function deliverOne(pool, row) {
  const payload = row.payload_json || "{}";
  let targetUrl;
  try {
    targetUrl = await assertWebhookTargetAllowed(row.url);
  } catch (err) {
    await pool.query(
      `UPDATE webhook_deliveries
          SET status = 'failed', attempts = attempts + 1, last_error = ?, updated_at = NOW()
        WHERE delivery_id = ?`,
      [err.code || "webhook_target_blocked", row.delivery_id]
    );
    return { delivery_id: row.delivery_id, delivered: false, error_code: err.code || "webhook_target_blocked" };
  }
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": "mad4b-webhook-dispatcher/1.0",
    "X-MAD4B-Event": row.event_type,
    "X-MAD4B-Delivery": row.delivery_id,
  };
  const signature = deliverySignature({ secretHash: row.secret_hash, payload });
  if (signature) headers["X-MAD4B-Signature-SHA256"] = signature;
  try {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: payload,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    const delivered = response.status >= 200 && response.status < 300;
    await pool.query(
      `UPDATE webhook_deliveries
          SET status = ?, attempts = attempts + 1, response_status = ?, last_error = ?, delivered_at = IF(? = 'delivered', NOW(), delivered_at), updated_at = NOW()
        WHERE delivery_id = ?`,
      [delivered ? "delivered" : "failed", response.status, delivered ? null : `http_${response.status}`, delivered ? "delivered" : "failed", row.delivery_id]
    );
    if (delivered) await pool.query(`UPDATE webhooks SET last_fired_at = NOW(), failure_count = 0 WHERE webhook_id = ?`, [row.webhook_id]).catch(() => {});
    else await pool.query(`UPDATE webhooks SET failure_count = failure_count + 1 WHERE webhook_id = ?`, [row.webhook_id]).catch(() => {});
    return { delivery_id: row.delivery_id, delivered, response_status: response.status };
  } catch (err) {
    await pool.query(
      `UPDATE webhook_deliveries
          SET status = 'failed', attempts = attempts + 1, last_error = ?, updated_at = NOW()
        WHERE delivery_id = ?`,
      [err.name === "TimeoutError" ? "webhook_delivery_timeout" : err.message || "webhook_delivery_failed", row.delivery_id]
    );
    await pool.query(`UPDATE webhooks SET failure_count = failure_count + 1 WHERE webhook_id = ?`, [row.webhook_id]).catch(() => {});
    return { delivery_id: row.delivery_id, delivered: false, error_code: err.name === "TimeoutError" ? "webhook_delivery_timeout" : "webhook_delivery_failed" };
  }
}

export async function dispatchPendingWebhookDeliveries({ pool = getPool(), limit = DELIVERY_LIMIT_DEFAULT } = {}) {
  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || DELIVERY_LIMIT_DEFAULT, 1), 100);
  const [rows] = await pool.query(
    `SELECT d.delivery_id, d.webhook_id, d.tenant_id, d.event_type, d.payload_json, d.attempts,
            w.url, w.secret_hash
       FROM webhook_deliveries d
       JOIN webhooks w
         ON w.webhook_id COLLATE utf8mb4_unicode_ci = d.webhook_id COLLATE utf8mb4_unicode_ci
        AND w.tenant_id COLLATE utf8mb4_unicode_ci = d.tenant_id COLLATE utf8mb4_unicode_ci
      WHERE d.status IN ('queued','failed')
        AND d.attempts < 3
        AND w.status = 'active'
      ORDER BY d.created_at ASC
      LIMIT ${safeLimit}`
  );
  const results = [];
  for (const row of rows || []) results.push(await deliverOne(pool, row));
  return {
    ok: true,
    requested_limit: safeLimit,
    attempted_count: results.length,
    delivered_count: results.filter((item) => item.delivered).length,
    failed_count: results.filter((item) => !item.delivered).length,
    results,
    secrets_included: false,
  };
}
