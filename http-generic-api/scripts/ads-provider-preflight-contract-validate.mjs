#!/usr/bin/env node
import { getPool } from "../db.js";

function parseArgs(argv = process.argv.slice(2)) {
  const args = { providerKey: "", includeInactive: false };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    const value = item.includes("=") ? item.split(/=(.*)/s)[1] : argv[i + 1];
    const consume = !item.includes("=");
    if (item.startsWith("--provider-key")) { args.providerKey = value || ""; if (consume) i += 1; }
    else if (item === "--include-inactive") args.includeInactive = true;
  }
  return args;
}

function clean(value = "", max = 191) { return String(value || "").trim().slice(0, max); }
function safeJson(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}
function gapWhen(condition, gap, gaps) { if (condition) gaps.push(gap); }

async function loadProfile(pool, providerKey, includeInactive) {
  const where = ["provider_key = ?", "secrets_included = 0"];
  if (!includeInactive) where.push("status IN ('active','draft')");
  const [[row]] = await pool.query(
    `SELECT provider_key, display_name, status, spend_capability_key, budget_meter_key,
            default_currency, credential_source, credential_app_key, primary_api_action_key,
            preflight_tool_key, preflight_family_key, preflight_ledger_table,
            preflight_validator_family_key, credential_readiness_tool_key,
            credential_readiness_ledger_table, execution_adapter_key,
            execution_enablement_family_key, execution_enabled_default,
            account_id_field, campaign_id_field, budget_resource_field,
            required_scopes_json, supported_operations_json, governance_contract_json,
            secrets_included
       FROM ads_provider_capability_profile_registry
      WHERE ${where.join(" AND ")}
      LIMIT 1`,
    [providerKey]
  );
  return row || null;
}

function evaluateProfile(row) {
  if (!row) {
    return {
      ok: true,
      decision: "blocked_ads_provider_profile_missing",
      ready_for_preflight_surface_contract: false,
      blocking_gaps: ["ads_provider_profile_missing"],
      no_provider_call: true,
      no_spend_change: true,
      secrets_included: false,
    };
  }
  const scopes = safeJson(row.required_scopes_json, []);
  const operations = safeJson(row.supported_operations_json, []);
  const governance = safeJson(row.governance_contract_json, {});
  const gaps = [];
  gapWhen(!["active", "draft"].includes(row.status), "ads_provider_profile_not_active_or_draft", gaps);
  gapWhen(!row.spend_capability_key, "spend_capability_key_missing", gaps);
  gapWhen(!row.budget_meter_key, "budget_meter_key_missing", gaps);
  gapWhen(!row.credential_app_key, "credential_app_key_missing", gaps);
  gapWhen(row.credential_source !== "user_connection", "credential_source_must_be_user_connection", gaps);
  gapWhen(!row.account_id_field, "account_id_field_missing", gaps);
  gapWhen(!row.campaign_id_field, "campaign_id_field_missing", gaps);
  gapWhen(!row.budget_resource_field, "budget_resource_field_missing", gaps);
  gapWhen(!Array.isArray(scopes) || scopes.length === 0, "required_scopes_missing", gaps);
  gapWhen(!Array.isArray(operations) || !operations.includes("budget_change"), "budget_change_operation_missing", gaps);
  gapWhen(Number(row.execution_enabled_default || 0) !== 0, "execution_enabled_default_must_be_false", gaps);
  gapWhen(Number(row.secrets_included || 0) !== 0, "profile_secret_boundary_failed", gaps);
  gapWhen(governance?.requires_capability_envelope !== true, "governance_requires_capability_envelope_missing", gaps);
  gapWhen(governance?.requires_budget_quota_authority !== true, "governance_requires_budget_quota_authority_missing", gaps);
  gapWhen(governance?.requires_preflight_ledger !== true, "governance_requires_preflight_ledger_missing", gaps);
  gapWhen(governance?.requires_credential_readiness_ledger !== true, "governance_requires_credential_readiness_ledger_missing", gaps);
  gapWhen(governance?.requires_execution_enablement_gate !== true, "governance_requires_execution_enablement_gate_missing", gaps);

  const hasExistingPreflightSurface = Boolean(row.preflight_tool_key && row.preflight_ledger_table && row.preflight_family_key && row.preflight_validator_family_key);
  const decision = gaps.length
    ? "blocked_ads_provider_preflight_contract"
    : hasExistingPreflightSurface
      ? "ready_existing_preflight_surface_contract"
      : "ready_for_preflight_surface_design";
  return {
    ok: true,
    decision,
    ready_for_preflight_surface_contract: gaps.length === 0,
    existing_preflight_surface_present: hasExistingPreflightSurface,
    blocking_gaps: gaps,
    provider_profile: {
      provider_key: row.provider_key,
      display_name: row.display_name,
      status: row.status,
      spend_capability_key: row.spend_capability_key,
      budget_meter_key: row.budget_meter_key,
      default_currency: row.default_currency,
      credential_source: row.credential_source,
      credential_app_key: row.credential_app_key,
      account_id_field: row.account_id_field,
      campaign_id_field: row.campaign_id_field,
      budget_resource_field: row.budget_resource_field,
      required_scopes: scopes,
      supported_operations: operations,
      primary_api_action_key: row.primary_api_action_key,
      preflight_tool_key: row.preflight_tool_key,
      preflight_family_key: row.preflight_family_key,
      preflight_ledger_table: row.preflight_ledger_table,
      preflight_validator_family_key: row.preflight_validator_family_key,
      credential_readiness_tool_key: row.credential_readiness_tool_key,
      credential_readiness_ledger_table: row.credential_readiness_ledger_table,
      execution_adapter_key: row.execution_adapter_key,
      execution_enablement_family_key: row.execution_enablement_family_key,
      execution_enabled_default: Boolean(row.execution_enabled_default),
      secrets_included: false,
    },
    preflight_contract: {
      required_decision_before_surface_creation: "ready_for_preflight_surface_design",
      required_profile_status: ["draft", "active"],
      required_execution_enabled_default: false,
      provider_specific_surfaces_created_elsewhere: true,
      preflight_tool_may_be_null_for_draft_profiles: true,
      real_provider_execution_forbidden: true,
      no_provider_call: true,
      no_spend_change: true,
      secrets_included: false,
    },
    no_provider_call: true,
    no_spend_change: true,
    secrets_included: false,
  };
}

export async function validateAdsProviderPreflightContract(args = parseArgs()) {
  const providerKey = clean(args.providerKey, 128);
  if (!providerKey) {
    return {
      ok: false,
      error: { code: "ads_provider_preflight_contract_provider_key_required", message: "--provider-key is required." },
      no_provider_call: true,
      no_spend_change: true,
      secrets_included: false,
    };
  }
  const pool = getPool();
  const row = await loadProfile(pool, providerKey, Boolean(args.includeInactive));
  return evaluateProfile(row);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  validateAdsProviderPreflightContract(parseArgs())
    .then(async (result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      await getPool().end().catch(() => {});
      if (!result.ready_for_preflight_surface_contract) process.exitCode = 1;
    })
    .catch(async (err) => {
      process.stdout.write(`${JSON.stringify({ ok: false, error: { code: err.code || "ads_provider_preflight_contract_failed", message: err.message }, no_provider_call: true, no_spend_change: true, secrets_included: false }, null, 2)}\n`);
      await getPool().end().catch(() => {});
      process.exitCode = 1;
    });
}
