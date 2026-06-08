#!/usr/bin/env node
import crypto, { randomUUID } from "node:crypto";
import { getPool } from "../db.js";
import { resolveCapabilityExecutionEnvelope } from "../capabilityResolutionEnvelopeGuard.js";
import { runBudgetQuotaAuthorityDryRun } from "./budget-quota-authority-dry-run.mjs";

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    capabilityEnvelopeId: "",
    tenantId: "",
    userId: "",
    workspaceId: "",
    workspaceKey: "",
    brandKey: "",
    customerId: "",
    campaignId: "",
    campaignBudgetResourceName: "",
    requestedAmountMinor: null,
    currency: "USD",
    meterKey: "google_ads_budget_minor",
    explain: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    const value = item.includes("=") ? item.split(/=(.*)/s)[1] : argv[i + 1];
    const consume = !item.includes("=");
    if (item.startsWith("--capability-envelope-id") || item.startsWith("--capability_envelope_id")) { args.capabilityEnvelopeId = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--tenant-id")) { args.tenantId = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--user-id")) { args.userId = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--workspace-id")) { args.workspaceId = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--workspace-key")) { args.workspaceKey = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--brand-key")) { args.brandKey = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--customer-id")) { args.customerId = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--campaign-id")) { args.campaignId = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--campaign-budget-resource-name")) { args.campaignBudgetResourceName = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--requested-amount-minor")) { args.requestedAmountMinor = Number(value); if (consume) i += 1; }
    else if (item.startsWith("--currency")) { args.currency = String(value || "USD").toUpperCase(); if (consume) i += 1; }
    else if (item.startsWith("--meter-key")) { args.meterKey = value || args.meterKey; if (consume) i += 1; }
    else if (item === "--explain") args.explain = true;
  }
  return args;
}

function clean(value = "", max = 191) {
  return String(value || "").trim().slice(0, max);
}

function amountMinor(value) {
  return Number.isFinite(value) ? Math.trunc(value) : null;
}

function sha256Json(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function blockingGapCount(result = {}) {
  return Array.isArray(result.blocking_gaps) ? result.blocking_gaps.length : 0;
}

function extractBudgetAuthorityId(result = {}) {
  return result?.budget_quota?.matched_authority?.authority_id || null;
}

function baseContext(args = {}, requestedAmountMinor = null) {
  return {
    tenant_id: clean(args.tenantId, 64) || null,
    user_id: clean(args.userId, 64) || null,
    workspace_id: clean(args.workspaceId, 64) || null,
    workspace_key: clean(args.workspaceKey, 191) || null,
    brand_key: clean(args.brandKey, 191) || null,
    app_key: "google_ads",
    capability_key: "google_ads_budget_change",
    operation_intent: "spend_budget_update",
    customer_id: clean(args.customerId, 64) || null,
    campaign_id: clean(args.campaignId, 64) || null,
    campaign_budget_resource_name: clean(args.campaignBudgetResourceName, 191) || null,
    requested_amount_minor: requestedAmountMinor,
    currency: clean(args.currency || "USD", 16).toUpperCase(),
    meter_key: clean(args.meterKey || "google_ads_budget_minor", 128),
  };
}

function blocked(status, details = {}) {
  return { ok: true, decision: status, ready_for_dispatch: false, ...details, secrets_included: false };
}

async function recordGoogleAdsBudgetPreflight({ pool, args, requestedAmountMinor, result }) {
  const preflightId = randomUUID();
  const payload = {
    ...result,
    preflight_id: preflightId,
    no_provider_call: result.no_provider_call !== false,
    no_spend_change: result.no_spend_change !== false,
    secrets_included: false,
  };
  const hash = sha256Json(payload);
  try {
    await pool.query(
      `INSERT INTO google_ads_budget_preflight_ledger
        (preflight_id, tenant_id, user_id, workspace_id, workspace_key, brand_key,
         capability_envelope_id, budget_authority_id, decision, ready_for_dispatch,
         requested_amount_minor, currency, meter_key, blocking_gap_count,
         preflight_json, preflight_sha256, no_provider_call, no_spend_change, secrets_included)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 0)`,
      [
        preflightId,
        clean(args.tenantId, 64) || null,
        clean(args.userId, 64) || null,
        clean(args.workspaceId, 64) || null,
        clean(args.workspaceKey, 191) || null,
        clean(args.brandKey, 191) || null,
        clean(args.capabilityEnvelopeId, 64) || result?.envelope?.envelope_id || null,
        extractBudgetAuthorityId(result),
        clean(result.decision || "unknown", 128),
        result.ready_for_dispatch ? 1 : 0,
        requestedAmountMinor,
        clean(args.currency || "USD", 16).toUpperCase(),
        clean(args.meterKey || "google_ads_budget_minor", 128),
        blockingGapCount(result),
        JSON.stringify(payload),
        hash,
      ]
    );
    return { ...payload, preflight_sha256: hash, preflight_recorded: true };
  } catch (err) {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(err?.code)) {
      return {
        ...payload,
        preflight_sha256: hash,
        preflight_recorded: false,
        preflight_record_error: err.code,
        secrets_included: false,
      };
    }
    throw err;
  }
}

export async function runGoogleAdsBudgetChangePreflight(args = parseArgs()) {
  const pool = getPool();
  const requestedAmountMinor = amountMinor(args.requestedAmountMinor);
  if (!requestedAmountMinor || requestedAmountMinor <= 0) {
    return recordGoogleAdsBudgetPreflight({
      pool,
      args,
      requestedAmountMinor,
      result: blocked("blocked_invalid_requested_amount", {
        request_context: baseContext(args, requestedAmountMinor),
        blocking_gaps: ["requested_amount_minor_required_positive_integer"],
        no_provider_call: true,
        no_spend_change: true,
      }),
    });
  }
  const envelope = await resolveCapabilityExecutionEnvelope({
    pool,
    envelopeId: clean(args.capabilityEnvelopeId, 64),
    source: { capability_envelope_id: clean(args.capabilityEnvelopeId, 64) },
    acceptedAppKeys: ["google_ads"],
    acceptedIntents: ["google_ads_budget_change", "spend_budget_update", "campaign_budget_update", "budget_update", "write"],
    expectedTenantId: clean(args.tenantId, 64),
    expectedUserId: clean(args.userId, 64),
  });
  if (!envelope.ok) {
    return recordGoogleAdsBudgetPreflight({
      pool,
      args,
      requestedAmountMinor,
      result: blocked(envelope.status || "blocked_capability_envelope", {
        request_context: baseContext(args, requestedAmountMinor),
        blocking_gaps: [envelope.status || "capability_envelope_not_ready"],
        envelope,
        no_provider_call: true,
        no_spend_change: true,
      }),
    });
  }
  const budget = await runBudgetQuotaAuthorityDryRun({
    tenantId: clean(args.tenantId, 64),
    workspaceId: clean(args.workspaceId, 64),
    workspaceKey: clean(args.workspaceKey, 191),
    brandKey: clean(args.brandKey, 191),
    appKey: "google_ads",
    capabilityKey: "google_ads_budget_change",
    operationIntent: "spend_budget_update",
    meterKey: clean(args.meterKey || "google_ads_budget_minor", 128),
    requestedAmountMinor,
    requestedUnits: null,
    currency: clean(args.currency || "USD", 16).toUpperCase(),
    explain: Boolean(args.explain),
  });
  if (budget.decision !== "ready_for_dispatch") {
    return recordGoogleAdsBudgetPreflight({
      pool,
      args,
      requestedAmountMinor,
      result: blocked(budget.decision || "blocked_budget_quota_authority", {
        request_context: baseContext(args, requestedAmountMinor),
        blocking_gaps: budget.blocking_gaps?.length ? budget.blocking_gaps : [budget.decision || "budget_quota_authority_not_ready"],
        envelope: {
          envelope_id: envelope.envelope_id,
          envelope_status: envelope.envelope_status,
          decision: envelope.decision,
          secrets_included: false,
        },
        budget_quota: budget,
        no_provider_call: true,
        no_spend_change: true,
      }),
    });
  }
  return recordGoogleAdsBudgetPreflight({
    pool,
    args,
    requestedAmountMinor,
    result: {
      ok: true,
      decision: "ready_for_dispatch",
      ready_for_dispatch: true,
      request_context: baseContext(args, requestedAmountMinor),
      envelope: {
        envelope_id: envelope.envelope_id,
        envelope_status: envelope.envelope_status,
        decision: envelope.decision,
        selected_source_tier: envelope.selected_source_tier,
        secrets_included: false,
      },
      budget_quota: budget,
      no_provider_call: true,
      no_spend_change: true,
      secrets_included: false,
    },
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runGoogleAdsBudgetChangePreflight(parseArgs())
    .then(async (result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      await getPool().end().catch(() => {});
    })
    .catch(async (err) => {
      process.stdout.write(`${JSON.stringify({ ok: false, error: { code: err.code || "google_ads_budget_change_preflight_failed", message: err.message }, secrets_included: false }, null, 2)}\n`);
      await getPool().end().catch(() => {});
      process.exitCode = 1;
    });
}
