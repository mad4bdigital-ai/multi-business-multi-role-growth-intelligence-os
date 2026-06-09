#!/usr/bin/env node
import { getPool } from "../db.js";
function parseArgs(argv = process.argv.slice(2)) {
  const args = { enablementId: "", revokedBy: "platform_admin", reason: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    const value = item.includes("=") ? item.split(/=(.*)/s)[1] : argv[i + 1];
    const consume = !item.includes("=");
    if (item.startsWith("--enablement-id")) { args.enablementId = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--revoked-by")) { args.revokedBy = value || args.revokedBy; if (consume) i += 1; }
    else if (item.startsWith("--reason")) { args.reason = value || ""; if (consume) i += 1; }
  }
  return args;
}
function clean(value = "", max = 191) { return String(value || "").trim().slice(0, max); }
function fail(code, message, details = {}) { return { ok: false, error: { code, message, details }, secrets_included: false }; }
export async function revokeExecutionEnablement(args = parseArgs()) {
  const enablementId = clean(args.enablementId, 96);
  if (!enablementId) return fail("execution_enablement_id_required", "--enablement-id is required.");
  const pool = getPool();
  const [[row]] = await pool.query(`SELECT enablement_id, status, execution_enabled, secrets_included FROM execution_enablement_registry WHERE enablement_id=? LIMIT 1`, [enablementId]);
  if (!row) return fail("execution_enablement_not_found", "Enablement row not found.", { enablement_id: enablementId });
  if (Number(row.secrets_included || 0) !== 0) return fail("execution_enablement_secret_boundary_failed", "Enablement is secret-marked.");
  await pool.query(
    `UPDATE execution_enablement_registry
        SET status='disabled', execution_enabled=0, updated_by=?,
            policy_json=JSON_MERGE_PATCH(COALESCE(policy_json, JSON_OBJECT()), JSON_OBJECT('revoked_by', ?, 'revocation_reason', ?, 'revoked_at', NOW(), 'secrets_included', false)),
            updated_at=NOW()
      WHERE enablement_id=?`,
    [clean(args.revokedBy, 191), clean(args.revokedBy, 191), clean(args.reason, 512), enablementId]
  );
  await pool.query(`UPDATE execution_enablement_requests SET request_status='revoked', updated_at=NOW() WHERE enablement_id=?`, [enablementId]);
  return { ok: true, enablement_id: enablementId, status: "disabled", execution_enabled: false, no_provider_call: true, no_spend_change: true, secrets_included: false };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  revokeExecutionEnablement(parseArgs()).then(async (r) => { process.stdout.write(`${JSON.stringify(r, null, 2)}\n`); await getPool().end().catch(() => {}); if (!r.ok) process.exitCode = 1; }).catch(async (err) => { process.stdout.write(`${JSON.stringify({ ok: false, error: { code: err.code || "execution_enablement_revoke_failed", message: err.message }, secrets_included: false }, null, 2)}\n`); await getPool().end().catch(() => {}); process.exitCode = 1; });
}
