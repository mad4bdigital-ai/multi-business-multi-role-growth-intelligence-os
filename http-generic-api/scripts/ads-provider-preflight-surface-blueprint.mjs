#!/usr/bin/env node
import { getPool } from "../db.js";
import { validateAdsProviderPreflightContract } from "./ads-provider-preflight-contract-validate.mjs";

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

function normalizeKey(value = "") {
  return clean(value, 128)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96);
}

function fallbackSurfaceNames(profile = {}) {
  const providerKey = normalizeKey(profile.provider_key || "ads_provider");
  const capabilityKey = normalizeKey(profile.spend_capability_key || `${providerKey}_budget_change`);
  const familyKey = normalizeKey(capabilityKey.replace(/_budget_change$/, "_budget") || `${providerKey}_budget`);
  return {
    provider_key: providerKey,
    family_key: familyKey,
    spend_capability_key: capabilityKey,
    budget_meter_key: profile.budget_meter_key || `${providerKey}_budget_minor`,
    preflight_tool_key: `${capabilityKey}_preflight`,
    preflight_ledger_table: `${familyKey}_preflight_ledger`,
    preflight_validator_family_key: familyKey,
    credential_readiness_tool_key: `${providerKey}_credential_readiness_gate`,
    credential_readiness_ledger_table: `${providerKey}_credential_readiness_ledger`,
    execution_adapter_key: `${capabilityKey}_execution_adapter`,
    execution_enablement_family_key: familyKey,
  };
}

async function loadBlueprintPolicy() {
  try {
    const [[row]] = await getPool().query(
      `SELECT blueprint_key, status, policy_json, secrets_included
         FROM ads_provider_preflight_surface_blueprint_registry
        WHERE blueprint_key='ads_provider_preflight_surface_blueprint_v1'
          AND status='active'
          AND secrets_included=0
        LIMIT 1`
    );
    return row || null;
  } catch (err) {
    if (err?.code === "ER_NO_SUCH_TABLE") return null;
    throw err;
  }
}

function blocked(decision, gaps, extra = {}) {
  return {
    ok: true,
    decision,
    ready_for_surface_blueprint: false,
    blocking_gaps: gaps,
    ...extra,
    does_not_create_provider_surfaces: true,
    no_provider_call: true,
    no_spend_change: true,
    secrets_included: false,
  };
}

export async function buildAdsProviderPreflightSurfaceBlueprint(args = parseArgs()) {
  const providerKey = normalizeKey(args.providerKey);
  if (!providerKey) {
    return {
      ok: false,
      error: { code: "ads_provider_blueprint_provider_key_required", message: "--provider-key is required." },
      does_not_create_provider_surfaces: true,
      no_provider_call: true,
      no_spend_change: true,
      secrets_included: false,
    };
  }
  const policy = await loadBlueprintPolicy();
  if (!policy) return blocked("blocked_ads_provider_surface_blueprint_policy_missing", ["ads_provider_preflight_surface_blueprint_policy_missing"]);

  const contract = await validateAdsProviderPreflightContract({ providerKey, includeInactive: Boolean(args.includeInactive) });
  if (!contract.ready_for_preflight_surface_contract) {
    return blocked("blocked_ads_provider_preflight_contract_not_ready", contract.blocking_gaps || [contract.decision || "preflight_contract_not_ready"], { contract });
  }
  const profile = contract.provider_profile || {};
  const fallback = fallbackSurfaceNames(profile);
  const existing = {
    preflight_tool_key: profile.preflight_tool_key,
    preflight_family_key: profile.preflight_family_key,
    preflight_ledger_table: profile.preflight_ledger_table,
    preflight_validator_family_key: profile.preflight_validator_family_key,
    credential_readiness_tool_key: profile.credential_readiness_tool_key,
    credential_readiness_ledger_table: profile.credential_readiness_ledger_table,
    execution_adapter_key: profile.execution_adapter_key,
    execution_enablement_family_key: profile.execution_enablement_family_key,
  };
  const blueprint = {
    provider_key: providerKey,
    blueprint_key: "ads_provider_preflight_surface_blueprint_v1",
    blueprint_mode: contract.existing_preflight_surface_present ? "existing_surface_readback" : "proposed_surface_design",
    family_key: existing.preflight_family_key || fallback.family_key,
    spend_capability_key: profile.spend_capability_key || fallback.spend_capability_key,
    budget_meter_key: profile.budget_meter_key || fallback.budget_meter_key,
    preflight_tool_key: existing.preflight_tool_key || fallback.preflight_tool_key,
    preflight_ledger_table: existing.preflight_ledger_table || fallback.preflight_ledger_table,
    preflight_validator_family_key: existing.preflight_validator_family_key || fallback.preflight_validator_family_key,
    credential_readiness_tool_key: existing.credential_readiness_tool_key || fallback.credential_readiness_tool_key,
    credential_readiness_ledger_table: existing.credential_readiness_ledger_table || fallback.credential_readiness_ledger_table,
    execution_adapter_key: existing.execution_adapter_key || fallback.execution_adapter_key,
    execution_enablement_family_key: existing.execution_enablement_family_key || fallback.execution_enablement_family_key,
    required_contract_decision: contract.decision,
    required_tables: [
      existing.preflight_ledger_table || fallback.preflight_ledger_table,
      existing.credential_readiness_ledger_table || fallback.credential_readiness_ledger_table,
    ],
    required_tools: [
      existing.preflight_tool_key || fallback.preflight_tool_key,
      existing.credential_readiness_tool_key || fallback.credential_readiness_tool_key,
    ],
    creation_plan: {
      creates_surfaces: false,
      creates_tables: false,
      creates_tools: false,
      creates_credentials: false,
      creates_execution_adapter: false,
      requires_separate_provider_specific_pr: true,
      requires_provider_specific_guard_tests: true,
      requires_governed_migration: true,
      requires_dry_run_and_readback: true,
      no_provider_call: true,
      no_spend_change: true,
      secrets_included: false,
    },
  };
  return {
    ok: true,
    decision: contract.existing_preflight_surface_present ? "ready_existing_preflight_surface_blueprint" : "ready_proposed_preflight_surface_blueprint",
    ready_for_surface_blueprint: true,
    existing_preflight_surface_present: Boolean(contract.existing_preflight_surface_present),
    blueprint,
    contract,
    policy: {
      blueprint_key: policy.blueprint_key,
      status: policy.status,
      secrets_included: false,
    },
    does_not_create_provider_surfaces: true,
    no_provider_call: true,
    no_spend_change: true,
    secrets_included: false,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildAdsProviderPreflightSurfaceBlueprint(parseArgs())
    .then(async (result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      await getPool().end().catch(() => {});
      if (!result.ready_for_surface_blueprint) process.exitCode = 1;
    })
    .catch(async (err) => {
      process.stdout.write(`${JSON.stringify({ ok: false, error: { code: err.code || "ads_provider_preflight_surface_blueprint_failed", message: err.message }, does_not_create_provider_surfaces: true, no_provider_call: true, no_spend_change: true, secrets_included: false }, null, 2)}\n`);
      await getPool().end().catch(() => {});
      process.exitCode = 1;
    });
}
