#!/usr/bin/env node
import crypto, { randomUUID } from "node:crypto";
import { getPool } from "../db.js";

function parseArgs(argv = process.argv.slice(2)) {
  const args = { familyKey: "", adapterKey: "", tenantId: "", workspaceId: "", workspaceKey: "", requestedBy: "gpt_admin", reason: "", ttlHours: 24, maxRiskLevel: "critical" };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    const value = item.includes("=") ? item.split(/=(.*)/s)[1] : argv[i + 1];
    const consume = !item.includes("=");
    if (item.startsWith("--family-key")) { args.familyKey = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--adapter-key")) { args.adapterKey = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--tenant-id")) { args.tenantId = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--workspace-id")) { args.workspaceId = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--workspace-key")) { args.workspaceKey = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--requested-by")) { args.requestedBy = value || args.requestedBy; if (consume) i += 1; }
    else if (item.startsWith("--reason")) { args.reason = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--ttl-hours")) { args.ttlHours = Number(value); if (consume) i += 1; }
    else if (item.startsWith("--max-risk-level")) { args.maxRiskLevel = value || args.maxRiskLevel; if (consume) i += 1; }
  }
  return args;
}

function clean(value = "", max = 191) { return String(value || "").trim().slice(0, max); }
function sha256Json(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function fail(code, message, details = {}) { return { ok: false, error: { code, message, details }, secrets_included: false }; }

export async function requestExecutionEnablement(args = parseArgs()) {
  const familyKey = clean(args.familyKey, 128);
  const adapterKey = clean(args.adapterKey, 191);
  const tenantId = clean(args.tenantId, 64);
  if (!familyKey || !adapterKey) return fail("execution_enablement_request_missing_required_fields", "--family-key and --adapter-key are required.");
  if (!tenantId) return fail("execution_enablement_request_tenant_id_required", "--tenant-id is required because approval_holds are tenant-scoped.");
  const ttl = Math.max(1, Math.min(Number(args.ttlHours || 24), 168));
  const requestId = randomUUID();
  const holdId = randomUUID();
  const payload = {
    request_id: requestId,
    family_key: familyKey,
    adapter_key: adapterKey,
    tenant_id: clean(args.tenantId, 64) || null,
    workspace_id: clean(args.workspaceId, 64) || null,
    workspace_key: clean(args.workspaceKey, 191) || null,
    requested_by: clean(args.requestedBy, 191),
    reason: clean(args.reason, 512),
    ttl_hours: ttl,
    max_risk_level: clean(args.maxRiskLevel, 32),
    requested_at: new Date().toISOString(),
    approval_hold_id: holdId,
    no_provider_call: true,
    no_spend_change: true,
    secrets_included: false,
  };
  const pool = getPool();
  await pool.query(
    `INSERT INTO execution_enablement_requests
      (request_id, family_key, adapter_key, tenant_id, workspace_id, workspace_key,
       requested_by, reason, ttl_hours, max_risk_level, request_status,
       approval_hold_id, request_json, request_sha256, secrets_included)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_approval', ?, ?, ?, 0)`,
    [requestId, familyKey, adapterKey, payload.tenant_id, payload.workspace_id, payload.workspace_key, payload.requested_by, payload.reason, ttl, payload.max_risk_level, holdId, JSON.stringify(payload), sha256Json(payload)]
  );
  await pool.query(
    `INSERT INTO approval_holds
      (hold_id, run_id, tenant_id, workspace_id, workspace_key, hold_type, requested_by, actor_id,
       actor_type, request_id, correlation_id, execution_context_json, assigned_to, required_role,
       status, created_at)
     VALUES (?, ?, ?, ?, ?, 'execution_enablement_approval', ?, ?, 'platform_admin', ?, ?, ?, ?, 'admin', 'pending', NOW())`,
    [holdId, requestId, payload.tenant_id, payload.workspace_id, payload.workspace_key, payload.requested_by, payload.requested_by, requestId, requestId, JSON.stringify(payload), payload.requested_by]
  );
  return { ok: true, request_id: requestId, approval_hold_id: holdId, request_status: "pending_approval", family_key: familyKey, adapter_key: adapterKey, expires_in_hours_after_approval: ttl, no_provider_call: true, no_spend_change: true, secrets_included: false };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  requestExecutionEnablement(parseArgs()).then(async (r) => { process.stdout.write(`${JSON.stringify(r, null, 2)}\n`); await getPool().end().catch(() => {}); if (!r.ok) process.exitCode = 1; }).catch(async (err) => { process.stdout.write(`${JSON.stringify({ ok: false, error: { code: err.code || "execution_enablement_request_failed", message: err.message }, secrets_included: false }, null, 2)}\n`); await getPool().end().catch(() => {}); process.exitCode = 1; });
}
