#!/usr/bin/env node
import crypto, { randomUUID } from "node:crypto";
import { getPool } from "../db.js";

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    providerKey: "",
    displayName: "",
    spendCapabilityKey: "",
    budgetMeterKey: "",
    credentialAppKey: "",
    credentialSource: "user_connection",
    defaultCurrency: "USD",
    accountIdField: "account_id",
    campaignIdField: "campaign_id",
    budgetResourceField: "budget_resource_id",
    requiredScopes: [],
    supportedOperations: [],
    tenantId: "",
    workspaceId: "",
    workspaceKey: "",
    requestedBy: "platform_admin",
    reason: "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    const value = item.includes("=") ? item.split(/=(.*)/s)[1] : argv[i + 1];
    const consume = !item.includes("=");
    if (item.startsWith("--provider-key")) { args.providerKey = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--display-name")) { args.displayName = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--spend-capability-key")) { args.spendCapabilityKey = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--budget-meter-key")) { args.budgetMeterKey = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--credential-app-key")) { args.credentialAppKey = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--credential-source")) { args.credentialSource = value || args.credentialSource; if (consume) i += 1; }
    else if (item.startsWith("--default-currency")) { args.defaultCurrency = value || args.defaultCurrency; if (consume) i += 1; }
    else if (item.startsWith("--account-id-field")) { args.accountIdField = value || args.accountIdField; if (consume) i += 1; }
    else if (item.startsWith("--campaign-id-field")) { args.campaignIdField = value || args.campaignIdField; if (consume) i += 1; }
    else if (item.startsWith("--budget-resource-field")) { args.budgetResourceField = value || args.budgetResourceField; if (consume) i += 1; }
    else if (item.startsWith("--required-scopes")) { args.requiredScopes = splitList(value); if (consume) i += 1; }
    else if (item.startsWith("--supported-operations")) { args.supportedOperations = splitList(value); if (consume) i += 1; }
    else if (item.startsWith("--tenant-id")) { args.tenantId = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--workspace-id")) { args.workspaceId = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--workspace-key")) { args.workspaceKey = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--requested-by")) { args.requestedBy = value || args.requestedBy; if (consume) i += 1; }
    else if (item.startsWith("--reason")) { args.reason = value || ""; if (consume) i += 1; }
  }
  return args;
}

function splitList(value = "") { return String(value || "").split(",").map((x) => x.trim()).filter(Boolean); }
function clean(value = "", max = 191) { return String(value || "").trim().slice(0, max); }
function sha256Json(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function fail(code, message, details = {}) { return { ok: false, error: { code, message, details }, no_provider_call: true, no_spend_change: true, secrets_included: false }; }

export async function requestAdsProviderProfile(args = parseArgs()) {
  const providerKey = clean(args.providerKey, 128);
  const tenantId = clean(args.tenantId, 64);
  if (!providerKey || !clean(args.displayName) || !clean(args.spendCapabilityKey, 128) || !clean(args.budgetMeterKey, 128) || !clean(args.credentialAppKey, 128)) {
    return fail("ads_provider_profile_request_missing_required_fields", "--provider-key, --display-name, --spend-capability-key, --budget-meter-key, and --credential-app-key are required.");
  }
  if (!tenantId) return fail("ads_provider_profile_request_tenant_id_required", "--tenant-id is required because approval_holds are tenant-scoped.");
  const requestId = randomUUID();
  const holdId = randomUUID();
  const profile = {
    provider_key: providerKey,
    display_name: clean(args.displayName, 191),
    provider_family: "ads_provider",
    status_on_approval: "draft",
    spend_capability_key: clean(args.spendCapabilityKey, 128),
    budget_meter_key: clean(args.budgetMeterKey, 128),
    default_currency: clean(args.defaultCurrency, 16).toUpperCase() || "USD",
    credential_source: clean(args.credentialSource, 64) || "user_connection",
    credential_app_key: clean(args.credentialAppKey, 128),
    account_id_field: clean(args.accountIdField, 128),
    campaign_id_field: clean(args.campaignIdField, 128),
    budget_resource_field: clean(args.budgetResourceField, 128),
    required_scopes: args.requiredScopes,
    supported_operations: args.supportedOperations,
    governance_contract: {
      profile_execution_enabled_default_false: true,
      requires_capability_envelope: true,
      requires_budget_quota_authority: true,
      requires_preflight_ledger: true,
      requires_credential_readiness_ledger: true,
      requires_execution_enablement_gate: true,
      provider_specific_surfaces_not_created_by_request: true,
      no_provider_call: true,
      no_spend_change: true,
      secrets_included: false,
    },
    no_provider_call: true,
    no_spend_change: true,
    secrets_included: false,
  };
  const payload = { request_id: requestId, approval_hold_id: holdId, tenant_id: tenantId, workspace_id: clean(args.workspaceId, 64) || null, workspace_key: clean(args.workspaceKey, 191) || null, requested_by: clean(args.requestedBy, 191), reason: clean(args.reason, 512), profile, requested_at: new Date().toISOString(), secrets_included: false };
  const pool = getPool();
  await pool.query(
    `INSERT INTO ads_provider_profile_onboarding_requests
      (request_id, approval_hold_id, tenant_id, workspace_id, workspace_key, provider_key, display_name,
       request_status, requested_by, reason, profile_json, profile_sha256, secrets_included)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_approval', ?, ?, ?, ?, 0)`,
    [requestId, holdId, payload.tenant_id, payload.workspace_id, payload.workspace_key, providerKey, profile.display_name, payload.requested_by, payload.reason, JSON.stringify(profile), sha256Json(profile)]
  );
  await pool.query(
    `INSERT INTO approval_holds
      (hold_id, run_id, tenant_id, workspace_id, workspace_key, hold_type, requested_by, actor_id,
       actor_type, request_id, correlation_id, execution_context_json, assigned_to, required_role,
       status, created_at)
     VALUES (?, ?, ?, ?, ?, 'ads_provider_profile_onboarding', ?, ?, 'platform_admin', ?, ?, ?, ?, 'admin', 'pending', NOW())`,
    [holdId, requestId, payload.tenant_id, payload.workspace_id, payload.workspace_key, payload.requested_by, payload.requested_by, requestId, requestId, JSON.stringify(payload), payload.requested_by]
  );
  return { ok: true, request_id: requestId, approval_hold_id: holdId, request_status: "pending_approval", provider_key: providerKey, status_on_approval: "draft", no_provider_call: true, no_spend_change: true, secrets_included: false };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  requestAdsProviderProfile(parseArgs()).then(async (r) => { process.stdout.write(`${JSON.stringify(r, null, 2)}\n`); await getPool().end().catch(() => {}); if (!r.ok) process.exitCode = 1; }).catch(async (err) => { process.stdout.write(`${JSON.stringify({ ok: false, error: { code: err.code || "ads_provider_profile_request_failed", message: err.message }, no_provider_call: true, no_spend_change: true, secrets_included: false }, null, 2)}\n`); await getPool().end().catch(() => {}); process.exitCode = 1; });
}
