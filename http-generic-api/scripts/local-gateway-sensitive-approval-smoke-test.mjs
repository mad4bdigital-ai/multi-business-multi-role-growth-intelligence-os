#!/usr/bin/env node
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { getPool } from "../db.js";

const DEFAULT_BASE = "https://local.mad4b.com";
const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000000";
const DEFAULT_USER_ID = "f242960c-2857-4b4d-a504-ee50f8a278b4";
const DEFAULT_DEVICE_ID = "essam-pc";
const ENTITLEMENT_KEY = "local_gateway.sensitive_tools";

function parseArgs(argv = process.argv.slice(2)) {
  const out = { base_url: DEFAULT_BASE, tenant_id: DEFAULT_TENANT_ID, user_id: DEFAULT_USER_ID, device_id: DEFAULT_DEVICE_ID };
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1].replace(/-/g, "_")] = m[2];
  }
  return out;
}

async function requestJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { Accept: "application/json", ...(options.headers || {}) },
    signal: AbortSignal.timeout(Number(options.timeout_ms || 30000)),
  });
  const text = await res.text().catch(() => "");
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw_preview: text.slice(0, 500) }; }
  return { status: res.status, ok: res.ok, body };
}

function assertOk(condition, code, details = {}) {
  if (condition) return;
  const err = new Error(code);
  err.code = code;
  err.details = details;
  throw err;
}

async function main() {
  const args = parseArgs();
  if (!process.env.JWT_SECRET) throw Object.assign(new Error("JWT_SECRET is not configured."), { code: "jwt_secret_missing" });
  const pool = getPool();
  const entitlementId = crypto.randomUUID();
  const base = String(args.base_url || DEFAULT_BASE).replace(/\/$/, "");
  const token = jwt.sign({ user_id: args.user_id, tenant_id: args.tenant_id, email: "local-gateway-approval-smoke@mad4b.local", smoke_test: true }, process.env.JWT_SECRET, { expiresIn: "10m" });
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  let approvalHoldId = null;
  let firstCallId = null;
  let secondCallId = null;

  try {
    await pool.query(
      `INSERT INTO \`entitlements\`
         (entitlement_id, tenant_id, entitlement_key, entitlement_value, source, granted_at, expires_at)
       VALUES (?, ?, ?, ?, 'manual', NOW(), DATE_ADD(NOW(), INTERVAL 30 MINUTE))`,
      [entitlementId, args.tenant_id, ENTITLEMENT_KEY, JSON.stringify({ smoke_test: true, temporary: true, reason: "local_gateway_sensitive_approval_smoke" })]
    );

    const first = await requestJson(`${base}/local/tools/call`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "local.connector.files",
        tool_args: { device_id: args.device_id, action: "list_drives", consent_accepted: true },
      }),
    });
    assertOk(first.status === 202 && first.body?.error?.code === "approval_required", "approval_hold_was_not_created", { status: first.status, body: first.body });
    approvalHoldId = first.body?.error?.details?.approval_hold_id || first.body?.local_gateway?.approval_hold_id || null;
    firstCallId = first.body?.local_gateway?.call_id || null;
    assertOk(Boolean(approvalHoldId), "approval_hold_id_missing", { body: first.body });

    const [approvalResult] = await pool.query(
      `UPDATE \`approval_holds\`
          SET status = 'approved', decision_by = ?, decision_note = 'Approved by automated smoke test for read-only list_drives.', decided_at = NOW()
        WHERE hold_id = ? AND tenant_id = ? AND status = 'open'`,
      [args.user_id, approvalHoldId, args.tenant_id]
    );
    assertOk(Number(approvalResult.affectedRows || 0) === 1, "approval_hold_update_failed", { approvalHoldId, affectedRows: approvalResult.affectedRows });

    const second = await requestJson(`${base}/local/tools/call`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "local.connector.files",
        tool_args: { device_id: args.device_id, action: "list_drives", consent_accepted: true, approval_hold_id: approvalHoldId },
      }),
    });
    assertOk(second.status === 200 && second.body?.ok !== false && second.body?.local_gateway?.call_id, "approved_sensitive_tool_dispatch_failed", { status: second.status, body: second.body });
    secondCallId = second.body.local_gateway.call_id;

    console.log(JSON.stringify({
      ok: true,
      base_url: base,
      tenant_id: args.tenant_id,
      user_id: args.user_id,
      device_id: args.device_id,
      entitlement_id: entitlementId,
      entitlement_cleanup: "deleted_after_test",
      approval_hold_id: approvalHoldId,
      first_call_id: firstCallId,
      second_call_id: secondCallId,
      approved_dispatch_status: second.status,
      approved_dispatch_tool: second.body.local_gateway.dispatch_tool_key,
      secrets_included: false,
    }, null, 2));
  } finally {
    await pool.query("DELETE FROM `entitlements` WHERE entitlement_id = ?", [entitlementId]).catch(() => {});
    await pool.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: { code: err.code || "local_gateway_sensitive_approval_smoke_failed", message: err.message, details: err.details || undefined }, secrets_included: false }, null, 2));
  process.exitCode = 1;
});
