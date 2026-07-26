#!/usr/bin/env node
import { getPool } from "../db.js";

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    tenantId: "",
    workspaceId: "",
    workspaceKey: "",
    brandKey: "",
    appKey: "",
    capabilityKey: "",
    operationIntent: "",
    meterKey: "",
    requestedAmountMinor: null,
    requestedUnits: null,
    currency: "USD",
    explain: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    const value = item.includes("=") ? item.split(/=(.*)/s)[1] : argv[i + 1];
    const consume = !item.includes("=");
    if (item.startsWith("--tenant-id")) { args.tenantId = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--workspace-id")) { args.workspaceId = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--workspace-key")) { args.workspaceKey = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--brand-key")) { args.brandKey = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--app-key")) { args.appKey = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--capability-key")) { args.capabilityKey = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--operation-intent")) { args.operationIntent = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--meter-key")) { args.meterKey = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--requested-amount-minor")) { args.requestedAmountMinor = Number(value); if (consume) i += 1; }
    else if (item.startsWith("--requested-units")) { args.requestedUnits = Number(value); if (consume) i += 1; }
    else if (item.startsWith("--currency")) { args.currency = String(value || "USD").toUpperCase(); if (consume) i += 1; }
    else if (item === "--explain") args.explain = true;
  }
  return args;
}

function clean(value = "", max = 191) {
  return String(value || "").trim().slice(0, max);
}

function toNumberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

async function findAuthorities(pool, args) {
  const [rows] = await pool.query(
    `SELECT authority_id, tenant_id, workspace_id, workspace_key, brand_key, app_key,
            capability_key, operation_intent, meter_key, currency, period,
            max_amount_minor, max_units, approval_required, required_role,
            approver_user_id, enforcement_action, status, priority, policy_json,
            secrets_included
       FROM budget_quota_authority_registry
      WHERE status = 'active'
        AND secrets_included = 0
        AND (tenant_id IS NULL OR tenant_id = ?)
        AND (workspace_id IS NULL OR workspace_id = ?)
        AND (workspace_key IS NULL OR workspace_key = ?)
        AND (brand_key IS NULL OR brand_key = ?)
        AND (app_key IS NULL OR app_key = ?)
        AND (capability_key IS NULL OR capability_key = ?)
        AND (operation_intent IS NULL OR operation_intent = ?)
        AND (meter_key IS NULL OR meter_key = ?)
      ORDER BY priority DESC, created_at DESC
      LIMIT 20`,
    [
      clean(args.tenantId, 64),
      clean(args.workspaceId, 64),
      clean(args.workspaceKey, 191),
      clean(args.brandKey, 191),
      clean(args.appKey, 128),
      clean(args.capabilityKey, 191),
      clean(args.operationIntent, 128),
      clean(args.meterKey, 128),
    ]
  );
  return rows;
}

function evaluate(rows, args) {
  const amount = toNumberOrNull(args.requestedAmountMinor);
  const units = toNumberOrNull(args.requestedUnits);
  if (!rows.length) {
    return {
      ok: true,
      decision: "blocked_missing_budget_quota_authority",
      authority_status: "missing",
      approval_required: true,
      blocking_gaps: ["budget_quota_authority_missing"],
      matched_authority: null,
      secrets_included: false,
    };
  }
  const matched = rows[0];
  const gaps = [];
  if (matched.currency && amount !== null && clean(matched.currency, 16).toUpperCase() !== clean(args.currency || "USD", 16).toUpperCase()) gaps.push("currency_mismatch");
  if (amount !== null && matched.max_amount_minor !== null && amount > Number(matched.max_amount_minor)) gaps.push("requested_amount_exceeds_budget_authority");
  if (units !== null && matched.max_units !== null && units > Number(matched.max_units)) gaps.push("requested_units_exceed_quota_authority");
  const approvalRequired = Boolean(Number(matched.approval_required || 0));
  return {
    ok: true,
    decision: gaps.length ? "blocked_budget_quota_limit" : approvalRequired ? "ready_requires_approval" : "ready_for_dispatch",
    authority_status: gaps.length ? "failed" : "passed",
    approval_required: approvalRequired || gaps.length > 0,
    blocking_gaps: gaps,
    matched_authority: {
      authority_id: matched.authority_id,
      scope: {
        tenant_id: matched.tenant_id,
        workspace_id: matched.workspace_id,
        workspace_key: matched.workspace_key,
        brand_key: matched.brand_key,
      },
      app_key: matched.app_key,
      capability_key: matched.capability_key,
      operation_intent: matched.operation_intent,
      meter_key: matched.meter_key,
      currency: matched.currency,
      period: matched.period,
      max_amount_minor: matched.max_amount_minor === null ? null : Number(matched.max_amount_minor),
      max_units: matched.max_units === null ? null : Number(matched.max_units),
      approval_required: approvalRequired,
      required_role: matched.required_role,
      approver_user_id: matched.approver_user_id,
      enforcement_action: matched.enforcement_action,
      priority: Number(matched.priority || 0),
    },
    secrets_included: false,
  };
}

export async function runBudgetQuotaAuthorityDryRun(args = parseArgs()) {
  const pool = getPool();
  const rows = await findAuthorities(pool, args);
  const evaluation = evaluate(rows, args);
  return {
    ok: true,
    request_context: {
      tenant_id: clean(args.tenantId, 64) || null,
      workspace_id: clean(args.workspaceId, 64) || null,
      workspace_key: clean(args.workspaceKey, 191) || null,
      brand_key: clean(args.brandKey, 191) || null,
      app_key: clean(args.appKey, 128) || null,
      capability_key: clean(args.capabilityKey, 191) || null,
      operation_intent: clean(args.operationIntent, 128) || null,
      meter_key: clean(args.meterKey, 128) || null,
      requested_amount_minor: toNumberOrNull(args.requestedAmountMinor),
      requested_units: toNumberOrNull(args.requestedUnits),
      currency: clean(args.currency || "USD", 16).toUpperCase(),
    },
    matched_count: rows.length,
    ...evaluation,
    explain: args.explain ? {
      notes: [
        "Budget/quota dry-run never executes spend, provider calls, or connector actions.",
        "A missing authority blocks spend-changing operations until a scoped authority row exists.",
        "Approval-required authorities must still flow through capability_resolution_envelope_approve before execution.",
      ],
    } : undefined,
    secrets_included: false,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runBudgetQuotaAuthorityDryRun(parseArgs())
    .then(async (result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      await getPool().end().catch(() => {});
    })
    .catch(async (err) => {
      process.stdout.write(`${JSON.stringify({ ok: false, error: { code: err.code || "budget_quota_authority_dry_run_failed", message: err.message }, secrets_included: false }, null, 2)}\n`);
      await getPool().end().catch(() => {});
      process.exitCode = 1;
    });
}
