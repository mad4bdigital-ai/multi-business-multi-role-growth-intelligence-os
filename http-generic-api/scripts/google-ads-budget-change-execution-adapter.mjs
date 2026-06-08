#!/usr/bin/env node
import { getPool } from "../db.js";
import { requireValidatedPreflightForExecution } from "../preflightLedgerExecutionGate.js";
import { runExecutionEnablementGate } from "./execution-enablement-gate.mjs";

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    preflightId: "",
    expectedEnvelopeId: "",
    tenantId: "",
    workspaceId: "",
    workspaceKey: "",
    customerId: "",
    campaignId: "",
    campaignBudgetResourceName: "",
    requestedAmountMinor: null,
    currency: "USD",
    executionRef: "google_ads_budget_change_execution_adapter_skeleton",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    const value = item.includes("=") ? item.split(/=(.*)/s)[1] : argv[i + 1];
    const consume = !item.includes("=");
    if (item.startsWith("--preflight-id")) { args.preflightId = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--expected-envelope-id")) { args.expectedEnvelopeId = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--tenant-id")) { args.tenantId = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--workspace-id")) { args.workspaceId = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--workspace-key")) { args.workspaceKey = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--customer-id")) { args.customerId = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--campaign-id")) { args.campaignId = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--campaign-budget-resource-name")) { args.campaignBudgetResourceName = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--requested-amount-minor")) { args.requestedAmountMinor = Number(value); if (consume) i += 1; }
    else if (item.startsWith("--currency")) { args.currency = String(value || "USD").toUpperCase(); if (consume) i += 1; }
    else if (item.startsWith("--execution-ref")) { args.executionRef = value || args.executionRef; if (consume) i += 1; }
  }
  return args;
}

function clean(value = "", max = 191) {
  return String(value || "").trim().slice(0, max);
}

function minor(value) {
  return Number.isFinite(value) ? Math.trunc(value) : null;
}

async function recordSkeletonAttempt({ args, gate, enablement, decision, blockingGaps = [] }) {
  try {
    await getPool().query(
      `INSERT INTO google_ads_budget_execution_gate_audit
        (audit_id, preflight_id, capability_envelope_id, decision, requested_amount_minor,
         currency, blocking_gap_count, audit_json, no_provider_call, no_spend_change, secrets_included)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, 1, 1, 0)`,
      [
        clean(args.preflightId, 64) || null,
        gate?.capability_envelope_id || clean(args.expectedEnvelopeId, 64) || null,
        decision,
        minor(args.requestedAmountMinor),
        clean(args.currency || "USD", 16).toUpperCase(),
        blockingGaps.length,
        JSON.stringify({
          execution_ref: clean(args.executionRef, 191),
          decision,
          blocking_gaps: blockingGaps,
          gate: gate || null,
          enablement: enablement || null,
          requested_amount_minor: minor(args.requestedAmountMinor),
          currency: clean(args.currency || "USD", 16).toUpperCase(),
          customer_id: clean(args.customerId, 64) || null,
          campaign_id: clean(args.campaignId, 64) || null,
          campaign_budget_resource_name: clean(args.campaignBudgetResourceName, 191) || null,
          adapter_status: "skeleton_no_provider_call",
          no_provider_call: true,
          no_spend_change: true,
          secrets_included: false,
        }),
      ]
    );
  } catch (err) {
    if (!["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(err?.code)) throw err;
  }
}

export async function runGoogleAdsBudgetChangeExecutionAdapter(args = parseArgs()) {
  const gate = await requireValidatedPreflightForExecution({
    familyKey: "google_ads_budget",
    preflightId: clean(args.preflightId, 64),
    expectedEnvelopeId: clean(args.expectedEnvelopeId, 64),
    expectedDecision: "ready_for_dispatch",
    executionRef: clean(args.executionRef, 191),
  });
  const requestedAmountMinor = minor(args.requestedAmountMinor);
  const gaps = [];
  if (requestedAmountMinor !== null && gate.requested_amount_minor !== requestedAmountMinor) gaps.push("requested_amount_mismatch_with_preflight");
  if (clean(args.currency || "USD", 16).toUpperCase() !== gate.currency) gaps.push("currency_mismatch_with_preflight");
  if (gaps.length) {
    await recordSkeletonAttempt({ args, gate, decision: "blocked_execution_request_mismatch", blockingGaps: gaps });
    return {
      ok: true,
      decision: "blocked_execution_request_mismatch",
      ready_for_provider_execution: false,
      blocking_gaps: gaps,
      gate,
      no_provider_call: true,
      no_spend_change: true,
      secrets_included: false,
    };
  }
  const enablement = await runExecutionEnablementGate({
    familyKey: "google_ads_budget",
    adapterKey: "google_ads_budget_change_execution_adapter",
    tenantId: clean(args.tenantId, 64),
    workspaceId: clean(args.workspaceId, 64),
    workspaceKey: clean(args.workspaceKey, 191),
    preflightId: clean(args.preflightId, 64),
    capabilityEnvelopeId: gate.capability_envelope_id,
  });
  if (!enablement.execution_enabled) {
    const enablementGaps = enablement.blocking_gaps?.length ? enablement.blocking_gaps : [enablement.decision || "execution_enablement_missing_or_disabled"];
    await recordSkeletonAttempt({ args, gate, enablement, decision: enablement.decision || "blocked_execution_enablement_missing_or_disabled", blockingGaps: enablementGaps });
    return {
      ok: true,
      decision: enablement.decision || "blocked_execution_enablement_missing_or_disabled",
      ready_for_provider_execution: false,
      blocking_gaps: enablementGaps,
      gate,
      enablement,
      no_provider_call: true,
      no_spend_change: true,
      secrets_included: false,
    };
  }
  await recordSkeletonAttempt({ args, gate, enablement, decision: "blocked_google_ads_execution_adapter_not_implemented", blockingGaps: ["provider_execution_not_implemented"] });
  return {
    ok: true,
    decision: "blocked_google_ads_execution_adapter_not_implemented",
    ready_for_provider_execution: false,
    blocking_gaps: ["provider_execution_not_implemented"],
    gate,
    enablement,
    customer_id: clean(args.customerId, 64) || null,
    campaign_id: clean(args.campaignId, 64) || null,
    campaign_budget_resource_name: clean(args.campaignBudgetResourceName, 191) || null,
    requested_amount_minor: requestedAmountMinor,
    currency: clean(args.currency || "USD", 16).toUpperCase(),
    adapter_status: "skeleton_only",
    no_provider_call: true,
    no_spend_change: true,
    secrets_included: false,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runGoogleAdsBudgetChangeExecutionAdapter(parseArgs())
    .then(async (result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      await getPool().end().catch(() => {});
    })
    .catch(async (err) => {
      process.stdout.write(`${JSON.stringify({ ok: false, error: { code: err.code || "google_ads_budget_execution_adapter_failed", message: err.message, details: err.details || undefined }, no_provider_call: true, no_spend_change: true, secrets_included: false }, null, 2)}\n`);
      await getPool().end().catch(() => {});
      process.exitCode = 1;
    });
}
