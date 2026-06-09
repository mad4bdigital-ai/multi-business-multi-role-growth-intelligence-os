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

function clean(value = "", max = 191) {
  return String(value || "").trim().slice(0, max);
}

function safeJson(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function normalizeProfile(row = {}) {
  return {
    provider_key: row.provider_key,
    display_name: row.display_name,
    provider_family: row.provider_family,
    status: row.status,
    spend_capability_key: row.spend_capability_key,
    budget_meter_key: row.budget_meter_key,
    default_currency: row.default_currency,
    credential_source: row.credential_source,
    credential_app_key: row.credential_app_key,
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
    account_id_field: row.account_id_field,
    campaign_id_field: row.campaign_id_field,
    budget_resource_field: row.budget_resource_field,
    required_scopes: safeJson(row.required_scopes_json, []),
    supported_operations: safeJson(row.supported_operations_json, []),
    governance_contract: safeJson(row.governance_contract_json, {}),
    no_provider_call: true,
    no_spend_change: true,
    secrets_included: false,
  };
}

export async function lookupAdsProviderProfile(args = parseArgs()) {
  const pool = getPool();
  const providerKey = clean(args.providerKey, 128);
  const params = [];
  const where = ["secrets_included = 0"];
  if (providerKey) { where.push("provider_key = ?"); params.push(providerKey); }
  if (!args.includeInactive) where.push("status = 'active'");
  const [rows] = await pool.query(
    `SELECT provider_key, display_name, provider_family, status,
            spend_capability_key, budget_meter_key, default_currency,
            credential_source, credential_app_key, primary_api_action_key,
            preflight_tool_key, preflight_family_key, preflight_ledger_table,
            preflight_validator_family_key, credential_readiness_tool_key,
            credential_readiness_ledger_table, execution_adapter_key,
            execution_enablement_family_key, execution_enabled_default,
            account_id_field, campaign_id_field, budget_resource_field,
            required_scopes_json, supported_operations_json, governance_contract_json
       FROM ads_provider_capability_profile_registry
      WHERE ${where.join(" AND ")}
      ORDER BY provider_key ASC
      LIMIT 50`,
    params
  );
  return {
    ok: true,
    provider_key: providerKey || null,
    count: rows.length,
    profiles: rows.map(normalizeProfile),
    no_provider_call: true,
    no_spend_change: true,
    secrets_included: false,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  lookupAdsProviderProfile(parseArgs())
    .then(async (result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      await getPool().end().catch(() => {});
    })
    .catch(async (err) => {
      process.stdout.write(`${JSON.stringify({ ok: false, error: { code: err.code || "ads_provider_profile_lookup_failed", message: err.message }, no_provider_call: true, no_spend_change: true, secrets_included: false }, null, 2)}\n`);
      await getPool().end().catch(() => {});
      process.exitCode = 1;
    });
}
