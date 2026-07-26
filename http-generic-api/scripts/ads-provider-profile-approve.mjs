#!/usr/bin/env node
import { getPool } from "../db.js";

function parseArgs(argv = process.argv.slice(2)) {
  const args = { requestId: "", approvedBy: "platform_admin", decisionNote: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    const value = item.includes("=") ? item.split(/=(.*)/s)[1] : argv[i + 1];
    const consume = !item.includes("=");
    if (item.startsWith("--request-id")) { args.requestId = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--approved-by")) { args.approvedBy = value || args.approvedBy; if (consume) i += 1; }
    else if (item.startsWith("--decision-note")) { args.decisionNote = value || ""; if (consume) i += 1; }
  }
  return args;
}
function clean(value = "", max = 191) { return String(value || "").trim().slice(0, max); }
function fail(code, message, details = {}) { return { ok: false, error: { code, message, details }, no_provider_call: true, no_spend_change: true, secrets_included: false }; }
function parseJson(value, fallback = {}) { try { return typeof value === "object" ? value : JSON.parse(String(value || "{}")); } catch { return fallback; } }

export async function approveAdsProviderProfile(args = parseArgs()) {
  const requestId = clean(args.requestId, 64);
  if (!requestId) return fail("ads_provider_profile_request_id_required", "--request-id is required.");
  const pool = getPool();
  const [[req]] = await pool.query(`SELECT * FROM ads_provider_profile_onboarding_requests WHERE request_id=? LIMIT 1`, [requestId]);
  if (!req) return fail("ads_provider_profile_request_not_found", "Request not found.", { request_id: requestId });
  if (req.request_status !== "pending_approval") return fail("ads_provider_profile_request_not_approvable", "Only pending_approval requests can be approved.", { request_status: req.request_status });
  if (Number(req.secrets_included || 0) !== 0) return fail("ads_provider_profile_request_secret_boundary_failed", "Request is secret-marked.");
  const profile = parseJson(req.profile_json, {});
  const approvedBy = clean(args.approvedBy, 191);
  const decisionNote = clean(args.decisionNote, 512) || "Approved as draft profile only; no provider execution.";
  await pool.query(
    `INSERT INTO ads_provider_capability_profile_registry (
       provider_key, display_name, provider_family, status, spend_capability_key,
       budget_meter_key, default_currency, credential_source, credential_app_key,
       primary_api_action_key, preflight_tool_key, preflight_family_key,
       preflight_ledger_table, preflight_validator_family_key, credential_readiness_tool_key,
       credential_readiness_ledger_table, execution_adapter_key, execution_enablement_family_key,
       execution_enabled_default, account_id_field, campaign_id_field, budget_resource_field,
       required_scopes_json, supported_operations_json, governance_contract_json, secrets_included
     ) VALUES (?, ?, 'ads_provider', 'draft', ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, ?, ?, ?, ?, ?, ?, 0)
     ON DUPLICATE KEY UPDATE
       display_name=VALUES(display_name), provider_family='ads_provider', status='draft',
       spend_capability_key=VALUES(spend_capability_key), budget_meter_key=VALUES(budget_meter_key),
       default_currency=VALUES(default_currency), credential_source=VALUES(credential_source),
       credential_app_key=VALUES(credential_app_key), primary_api_action_key=NULL,
       preflight_tool_key=NULL, preflight_family_key=NULL, preflight_ledger_table=NULL,
       preflight_validator_family_key=NULL, credential_readiness_tool_key=NULL,
       credential_readiness_ledger_table=NULL, execution_adapter_key=NULL,
       execution_enablement_family_key=NULL, execution_enabled_default=0,
       account_id_field=VALUES(account_id_field), campaign_id_field=VALUES(campaign_id_field),
       budget_resource_field=VALUES(budget_resource_field), required_scopes_json=VALUES(required_scopes_json),
       supported_operations_json=VALUES(supported_operations_json), governance_contract_json=VALUES(governance_contract_json),
       secrets_included=0, updated_at=CURRENT_TIMESTAMP`,
    [
      profile.provider_key,
      profile.display_name,
      profile.spend_capability_key,
      profile.budget_meter_key,
      profile.default_currency || "USD",
      profile.credential_source || "user_connection",
      profile.credential_app_key,
      profile.account_id_field || null,
      profile.campaign_id_field || null,
      profile.budget_resource_field || null,
      JSON.stringify(profile.required_scopes || []),
      JSON.stringify(profile.supported_operations || []),
      JSON.stringify(profile.governance_contract || {}),
    ]
  );
  await pool.query(`UPDATE ads_provider_profile_onboarding_requests SET request_status='approved', approved_by=?, approved_at=NOW(), decision_note=?, updated_at=NOW() WHERE request_id=?`, [approvedBy, decisionNote, requestId]);
  await pool.query(`UPDATE approval_holds SET status='approved', decision_by=?, decision_note=?, decided_at=NOW() WHERE hold_id=?`, [approvedBy, decisionNote, req.approval_hold_id]);
  return { ok: true, request_id: requestId, provider_key: profile.provider_key, profile_status: "draft", execution_enabled_default: false, no_provider_call: true, no_spend_change: true, secrets_included: false };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  approveAdsProviderProfile(parseArgs()).then(async (r) => { process.stdout.write(`${JSON.stringify(r, null, 2)}\n`); await getPool().end().catch(() => {}); if (!r.ok) process.exitCode = 1; }).catch(async (err) => { process.stdout.write(`${JSON.stringify({ ok: false, error: { code: err.code || "ads_provider_profile_approve_failed", message: err.message }, no_provider_call: true, no_spend_change: true, secrets_included: false }, null, 2)}\n`); await getPool().end().catch(() => {}); process.exitCode = 1; });
}
