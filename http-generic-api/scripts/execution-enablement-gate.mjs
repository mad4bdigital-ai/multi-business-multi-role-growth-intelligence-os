#!/usr/bin/env node
import { getPool } from "../db.js";

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    familyKey: "",
    adapterKey: "",
    tenantId: "",
    workspaceId: "",
    workspaceKey: "",
    preflightId: "",
    capabilityEnvelopeId: "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    const value = item.includes("=") ? item.split(/=(.*)/s)[1] : argv[i + 1];
    const consume = !item.includes("=");
    if (item.startsWith("--family-key")) { args.familyKey = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--adapter-key")) { args.adapterKey = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--tenant-id")) { args.tenantId = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--workspace-id")) { args.workspaceId = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--workspace-key")) { args.workspaceKey = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--preflight-id")) { args.preflightId = value || ""; if (consume) i += 1; }
    else if (item.startsWith("--capability-envelope-id")) { args.capabilityEnvelopeId = value || ""; if (consume) i += 1; }
  }
  return args;
}

function clean(value = "", max = 191) {
  return String(value || "").trim().slice(0, max);
}

function blocked(decision, gaps, extra = {}) {
  return {
    ok: true,
    decision,
    execution_enabled: false,
    ready_for_provider_execution: false,
    blocking_gaps: gaps,
    ...extra,
    no_provider_call: true,
    no_spend_change: true,
    secrets_included: false,
  };
}

async function loadEnablementRows(pool, args) {
  try {
    const [rows] = await pool.query(
      `SELECT enablement_id, family_key, adapter_key, tenant_id, workspace_id, workspace_key,
              status, required_approver, max_risk_level, requires_preflight_gate,
              requires_credential_readiness, requires_budget_authority, requires_live_readback,
              execution_enabled, policy_json, expires_at, secrets_included
         FROM execution_enablement_registry
        WHERE family_key = ?
          AND adapter_key = ?
          AND secrets_included = 0
          AND (tenant_id IS NULL OR tenant_id = ?)
          AND (workspace_id IS NULL OR workspace_id = ?)
          AND (workspace_key IS NULL OR workspace_key = ?)
        ORDER BY execution_enabled DESC, priority DESC, updated_at DESC
        LIMIT 10`,
      [
        clean(args.familyKey, 128),
        clean(args.adapterKey, 191),
        clean(args.tenantId, 64) || null,
        clean(args.workspaceId, 64) || null,
        clean(args.workspaceKey, 191) || null,
      ]
    );
    return rows;
  } catch (err) {
    if (err?.code === "ER_NO_SUCH_TABLE") return null;
    throw err;
  }
}

function evaluate(rows, args) {
  if (rows === null) {
    return blocked("blocked_execution_enablement_registry_missing", ["execution_enablement_registry_missing"]);
  }
  if (!rows.length) {
    return blocked("blocked_execution_enablement_missing_or_disabled", ["execution_enablement_row_missing"]);
  }
  const active = rows.find((row) => row.status === "active" && Number(row.execution_enabled || 0) === 1);
  if (!active) {
    return blocked("blocked_execution_enablement_missing_or_disabled", ["execution_enablement_not_active_or_disabled"], {
      candidate_count: rows.length,
      candidates: rows.map((row) => ({
        enablement_id: row.enablement_id,
        status: row.status,
        execution_enabled: Boolean(row.execution_enabled),
        expires_at: row.expires_at,
        secrets_included: false,
      })),
    });
  }
  if (active.expires_at && new Date(active.expires_at).getTime() <= Date.now()) {
    return blocked("blocked_execution_enablement_expired", ["execution_enablement_expired"], {
      enablement_id: active.enablement_id,
    });
  }
  return {
    ok: true,
    decision: "ready_for_provider_execution_enablement",
    execution_enabled: true,
    ready_for_provider_execution: true,
    enablement: {
      enablement_id: active.enablement_id,
      family_key: active.family_key,
      adapter_key: active.adapter_key,
      tenant_id: active.tenant_id,
      workspace_id: active.workspace_id,
      workspace_key: active.workspace_key,
      required_approver: active.required_approver,
      max_risk_level: active.max_risk_level,
      requires_preflight_gate: Boolean(active.requires_preflight_gate),
      requires_credential_readiness: Boolean(active.requires_credential_readiness),
      requires_budget_authority: Boolean(active.requires_budget_authority),
      requires_live_readback: Boolean(active.requires_live_readback),
      expires_at: active.expires_at,
      secrets_included: false,
    },
    request_context: {
      family_key: clean(args.familyKey, 128),
      adapter_key: clean(args.adapterKey, 191),
      tenant_id: clean(args.tenantId, 64) || null,
      workspace_id: clean(args.workspaceId, 64) || null,
      workspace_key: clean(args.workspaceKey, 191) || null,
      preflight_id: clean(args.preflightId, 64) || null,
      capability_envelope_id: clean(args.capabilityEnvelopeId, 64) || null,
    },
    no_provider_call: true,
    no_spend_change: true,
    secrets_included: false,
  };
}

export async function runExecutionEnablementGate(args = parseArgs()) {
  if (!clean(args.familyKey, 128) || !clean(args.adapterKey, 191)) {
    return blocked("blocked_execution_enablement_required_fields_missing", ["family_key_required", "adapter_key_required"]);
  }
  const pool = getPool();
  const rows = await loadEnablementRows(pool, args);
  return {
    ...evaluate(rows, args),
    request_context: {
      family_key: clean(args.familyKey, 128),
      adapter_key: clean(args.adapterKey, 191),
      tenant_id: clean(args.tenantId, 64) || null,
      workspace_id: clean(args.workspaceId, 64) || null,
      workspace_key: clean(args.workspaceKey, 191) || null,
      preflight_id: clean(args.preflightId, 64) || null,
      capability_envelope_id: clean(args.capabilityEnvelopeId, 64) || null,
    },
    no_provider_call: true,
    no_spend_change: true,
    secrets_included: false,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runExecutionEnablementGate(parseArgs())
    .then(async (result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      await getPool().end().catch(() => {});
      if (!result.execution_enabled) process.exitCode = 1;
    })
    .catch(async (err) => {
      process.stdout.write(`${JSON.stringify({ ok: false, error: { code: err.code || "execution_enablement_gate_failed", message: err.message }, no_provider_call: true, no_spend_change: true, secrets_included: false }, null, 2)}\n`);
      await getPool().end().catch(() => {});
      process.exitCode = 1;
    });
}
