#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { getPool } from "../db.js";

function parseArgs(argv = process.argv.slice(2)) {
  const args = { requestId: "", approvedBy: "platform_admin", decisionNote: "", ttlHours: null };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    const value = item.includes("=") ? item.split(/=(.*)/s)[1] : argv[i + 1];
    const consume = !item.includes("=");
    if (item.startsWith("--request-id")) { args.requestId = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--approved-by")) { args.approvedBy = value || args.approvedBy; if (consume) i += 1; }
    else if (item.startsWith("--decision-note")) { args.decisionNote = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--ttl-hours")) { args.ttlHours = Number(value); if (consume) i += 1; }
  }
  return args;
}
function clean(value = "", max = 191) { return String(value || "").trim().slice(0, max); }
function fail(code, message, details = {}) { return { ok: false, error: { code, message, details }, secrets_included: false }; }

async function loadRequest(pool, requestId) {
  const [[row]] = await pool.query(`SELECT * FROM execution_enablement_requests WHERE request_id=? LIMIT 1`, [requestId]);
  return row || null;
}

export async function approveExecutionEnablement(args = parseArgs()) {
  const requestId = clean(args.requestId, 64);
  if (!requestId) return fail("execution_enablement_request_id_required", "--request-id is required.");
  const pool = getPool();
  const req = await loadRequest(pool, requestId);
  if (!req) return fail("execution_enablement_request_not_found", "Request not found.", { request_id: requestId });
  if (req.request_status !== "pending_approval") return fail("execution_enablement_request_not_approvable", "Only pending_approval requests can be approved.", { request_status: req.request_status });
  if (Number(req.secrets_included || 0) !== 0) return fail("execution_enablement_request_secret_boundary_failed", "Request is secret-marked.");
  const ttl = Math.max(1, Math.min(Number(args.ttlHours || req.ttl_hours || 24), 168));
  const enablementId = `enable_${randomUUID()}`;
  const approvedBy = clean(args.approvedBy, 191);
  const note = clean(args.decisionNote, 512) || "Approved through execution_enablement_approve.";
  await pool.query(
    `INSERT INTO execution_enablement_registry
      (enablement_id, family_key, adapter_key, tenant_id, workspace_id, workspace_key, status,
       execution_enabled, required_approver, max_risk_level, requires_preflight_gate,
       requires_credential_readiness, requires_budget_authority, requires_live_readback,
       priority, policy_json, expires_at, secrets_included, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, 1, 1, 1, 1, 1000, ?, DATE_ADD(NOW(), INTERVAL ? HOUR), 0, ?, ?)`,
    [enablementId, req.family_key, req.adapter_key, req.tenant_id, req.workspace_id, req.workspace_key, approvedBy, req.max_risk_level, JSON.stringify({ request_id: requestId, approval_hold_id: req.approval_hold_id, approved_by: approvedBy, decision_note: note, no_provider_call: true, no_spend_change: true, secrets_included: false }), ttl, approvedBy, approvedBy]
  );
  await pool.query(`UPDATE execution_enablement_requests SET request_status='approved', enablement_id=?, approved_by=?, approved_at=NOW(), decision_note=?, updated_at=NOW() WHERE request_id=?`, [enablementId, approvedBy, note, requestId]);
  await pool.query(`UPDATE approval_holds SET status='approved', decision_by=?, decision_note=?, decided_at=NOW() WHERE hold_id=?`, [approvedBy, note, req.approval_hold_id]);
  return { ok: true, request_id: requestId, enablement_id: enablementId, request_status: "approved", execution_enabled: true, expires_in_hours: ttl, no_provider_call: true, no_spend_change: true, secrets_included: false };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  approveExecutionEnablement(parseArgs()).then(async (r) => { process.stdout.write(`${JSON.stringify(r, null, 2)}\n`); await getPool().end().catch(() => {}); if (!r.ok) process.exitCode = 1; }).catch(async (err) => { process.stdout.write(`${JSON.stringify({ ok: false, error: { code: err.code || "execution_enablement_approve_failed", message: err.message }, secrets_included: false }, null, 2)}\n`); await getPool().end().catch(() => {}); process.exitCode = 1; });
}
