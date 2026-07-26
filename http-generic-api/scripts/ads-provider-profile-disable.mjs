#!/usr/bin/env node
import { getPool } from "../db.js";
function parseArgs(argv = process.argv.slice(2)) {
  const args = { providerKey: "", disabledBy: "platform_admin", reason: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    const value = item.includes("=") ? item.split(/=(.*)/s)[1] : argv[i + 1];
    const consume = !item.includes("=");
    if (item.startsWith("--provider-key")) { args.providerKey = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--disabled-by")) { args.disabledBy = value || args.disabledBy; if (consume) i += 1; }
    else if (item.startsWith("--reason")) { args.reason = value || ""; if (consume) i += 1; }
  }
  return args;
}
function clean(value = "", max = 191) { return String(value || "").trim().slice(0, max); }
function fail(code, message, details = {}) { return { ok: false, error: { code, message, details }, no_provider_call: true, no_spend_change: true, secrets_included: false }; }
export async function disableAdsProviderProfile(args = parseArgs()) {
  const providerKey = clean(args.providerKey, 128);
  if (!providerKey) return fail("ads_provider_profile_provider_key_required", "--provider-key is required.");
  const pool = getPool();
  const [[row]] = await pool.query(`SELECT provider_key, status, secrets_included FROM ads_provider_capability_profile_registry WHERE provider_key=? LIMIT 1`, [providerKey]);
  if (!row) return fail("ads_provider_profile_not_found", "Provider profile not found.", { provider_key: providerKey });
  if (Number(row.secrets_included || 0) !== 0) return fail("ads_provider_profile_secret_boundary_failed", "Profile is secret-marked.");
  await pool.query(
    `UPDATE ads_provider_capability_profile_registry
        SET status='disabled', execution_enabled_default=0,
            governance_contract_json=JSON_MERGE_PATCH(COALESCE(governance_contract_json, JSON_OBJECT()), JSON_OBJECT('disabled_by', ?, 'disable_reason', ?, 'disabled_at', NOW(), 'execution_enabled_default', false, 'secrets_included', false)),
            updated_at=NOW()
      WHERE provider_key=?`,
    [clean(args.disabledBy, 191), clean(args.reason, 512), providerKey]
  );
  return { ok: true, provider_key: providerKey, status: "disabled", execution_enabled_default: false, no_provider_call: true, no_spend_change: true, secrets_included: false };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  disableAdsProviderProfile(parseArgs()).then(async (r) => { process.stdout.write(`${JSON.stringify(r, null, 2)}\n`); await getPool().end().catch(() => {}); if (!r.ok) process.exitCode = 1; }).catch(async (err) => { process.stdout.write(`${JSON.stringify({ ok: false, error: { code: err.code || "ads_provider_profile_disable_failed", message: err.message }, no_provider_call: true, no_spend_change: true, secrets_included: false }, null, 2)}\n`); await getPool().end().catch(() => {}); process.exitCode = 1; });
}
