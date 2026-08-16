#!/usr/bin/env node

import { getPool } from "../db.js";
import { closeGovernancePool } from "../governanceDb.js";
import { createCapabilityResolutionEnvelopeLedger } from "./capability-resolution-envelope-create.mjs";
import { runCapabilityResolutionDryRun } from "./capability-resolution-dry-run.mjs";
import {
  buildRuntimeBreakGlassApprovalScope,
  fingerprintRuntimeBreakGlassApprovalScope,
  parseRuntimeBreakGlassScopeJson,
  RUNTIME_BREAK_GLASS_SCOPE_BINDING_CONTRACT,
} from "../runtimeBreakGlassScopeBinding.js";
import { RUNTIME_BREAK_GLASS_OPERATION_INTENT } from "../runtimeBreakGlassLifecycle.js";

export const RUNTIME_BREAK_GLASS_AUTHORITY_APP_KEY = "remote_ssh_runtime";
export const RUNTIME_BREAK_GLASS_AUTHORITY_CAPABILITY_KEY = "remote_ssh.exec_allowlisted";
export const RUNTIME_BREAK_GLASS_AUTHORITY_RUNTIME_SURFACE = "runtime_break_glass_bounded_file_patch";
export const RUNTIME_BREAK_GLASS_CRITICAL_DRY_RUN_INTENT = "ssh_runtime_break_glass_bounded_file_patch";

const RESERVED_AUTHORITY_FLAGS = new Set([
  "--app-key",
  "--capability-key",
  "--operation-intent",
  "--runtime-surface",
  "--expected-commit-sha",
  "--expected-branch-sha",
  "--expected-base-sha",
]);

function parseFlagName(item = "") {
  return String(item).split("=", 1)[0];
}

function parseArgs(argv = process.argv.slice(2)) {
  const passthrough = [];
  const args = { requestedBy: "gpt_admin", ttlMinutes: 60, scopeJson: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--requested-by") args.requestedBy = argv[++i] || args.requestedBy;
    else if (item.startsWith("--requested-by=")) args.requestedBy = item.slice("--requested-by=".length);
    else if (item === "--ttl-minutes") args.ttlMinutes = Number(argv[++i] || args.ttlMinutes);
    else if (item.startsWith("--ttl-minutes=")) args.ttlMinutes = Number(item.slice("--ttl-minutes=".length));
    else if (item === "--runtime-break-glass-scope-json") args.scopeJson = argv[++i] || "";
    else if (item.startsWith("--runtime-break-glass-scope-json=")) args.scopeJson = item.slice("--runtime-break-glass-scope-json=".length);
    else if (/--(?:runtime-)?break-glass-scope-sha256(?:=|$)/i.test(item)) {
      const error = new Error("Runtime break-glass scope SHA-256 is issuer-computed and cannot be supplied by the caller.");
      error.code = "runtime_break_glass_scope_fingerprint_caller_supplied";
      throw error;
    } else passthrough.push(item);
  }
  if (!args.scopeJson) {
    const error = new Error("--runtime-break-glass-scope-json is required.");
    error.code = "runtime_break_glass_scope_json_required";
    throw error;
  }
  if (!Number.isFinite(args.ttlMinutes) || args.ttlMinutes < 5 || args.ttlMinutes > 1440) {
    const error = new Error("--ttl-minutes must be between 5 and 1440 minutes.");
    error.code = "runtime_break_glass_envelope_ttl_invalid";
    throw error;
  }
  return args;
}

function rejectAuthorityFlagOverrides(passthrough = []) {
  for (const item of passthrough) {
    const flag = parseFlagName(item);
    if (!RESERVED_AUTHORITY_FLAGS.has(flag)) continue;
    const error = new Error(`${flag} is fixed by the governed runtime break-glass issuer and cannot be caller overridden.`);
    error.code = "runtime_break_glass_authority_flag_override_forbidden";
    error.details = { flag, secrets_included: false };
    throw error;
  }
}

function assertEnvelopeCoversIncidentExpiry(scope, ttlMinutes, now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const scopeExpiryMs = new Date(scope.authorization_expires_at).getTime();
  if (!Number.isFinite(nowMs) || !Number.isFinite(scopeExpiryMs) || scopeExpiryMs <= nowMs) {
    const error = new Error("Runtime break-glass authorization must still be active when its governed envelope is issued.");
    error.code = "runtime_break_glass_scope_authorization_expired";
    throw error;
  }
  const envelopeExpiryMs = nowMs + Number(ttlMinutes) * 60_000;
  if (scopeExpiryMs > envelopeExpiryMs) {
    const error = new Error("Capability-envelope TTL must cover the full incident authorization window.");
    error.code = "runtime_break_glass_scope_exceeds_envelope_ttl";
    error.details = {
      authorization_expires_at: scope.authorization_expires_at,
      ttl_minutes: Number(ttlMinutes),
      minimum_ttl_minutes: Math.ceil((scopeExpiryMs - nowMs) / 60_000),
      secrets_included: false,
    };
    throw error;
  }
}

export function buildRuntimeBreakGlassEnvelopeBinding(scopeInput, passthrough = [], { ttlMinutes = 60, now = new Date() } = {}) {
  rejectAuthorityFlagOverrides(passthrough);
  const scope = buildRuntimeBreakGlassApprovalScope(scopeInput);
  assertEnvelopeCoversIncidentExpiry(scope, ttlMinutes, now);
  const scopeSha256 = fingerprintRuntimeBreakGlassApprovalScope(scopeInput);
  return {
    scope,
    scope_sha256: scopeSha256,
    passthrough: [
      ...passthrough,
      "--app-key", RUNTIME_BREAK_GLASS_AUTHORITY_APP_KEY,
      "--capability-key", RUNTIME_BREAK_GLASS_AUTHORITY_CAPABILITY_KEY,
      "--operation-intent", RUNTIME_BREAK_GLASS_CRITICAL_DRY_RUN_INTENT,
      "--runtime-surface", RUNTIME_BREAK_GLASS_AUTHORITY_RUNTIME_SURFACE,
      "--expected-commit-sha", scope.expected_commit_sha,
    ],
  };
}

export function decorateRuntimeBreakGlassDryRun(dryRun = {}, binding = {}) {
  const scope = binding.scope || {};
  const scopeSha256 = binding.scope_sha256 || "";
  const requestContext = dryRun?.request_context || {};
  const capability = dryRun?.capability || {};
  const selected = dryRun?.selected_source || {};
  const gates = dryRun?.gates || {};
  const blockingGaps = Array.isArray(dryRun?.blocking_gaps) ? dryRun.blocking_gaps : [];

  const exactCriticalAuthority =
    String(requestContext.operation_intent || "") === RUNTIME_BREAK_GLASS_CRITICAL_DRY_RUN_INTENT
    && String(capability.app_key || "") === RUNTIME_BREAK_GLASS_AUTHORITY_APP_KEY
    && String(capability.capability_key || "") === RUNTIME_BREAK_GLASS_AUTHORITY_CAPABILITY_KEY
    && String(capability.risk_class || "").toLowerCase() === "critical"
    && String(selected.selected_runtime_surface || "") === RUNTIME_BREAK_GLASS_AUTHORITY_RUNTIME_SURFACE
    && dryRun.decision === "ready_requires_approval"
    && gates.dispatch_allowed === true
    && gates.apply_allowed === false
    && gates.approval_required === true
    && gates.audit_required === true
    && gates.readback_required === true
    && blockingGaps.length === 0;
  if (!exactCriticalAuthority) {
    const error = new Error("Runtime break-glass envelope dry-run did not resolve the exact critical, approval-required governed authority surface.");
    error.code = "runtime_break_glass_envelope_dry_run_not_approval_ready";
    error.details = {
      decision: dryRun?.decision || null,
      risk_class: capability.risk_class || null,
      selected_runtime_surface: selected.selected_runtime_surface || null,
      dispatch_allowed: gates.dispatch_allowed === true,
      apply_allowed: gates.apply_allowed === true,
      approval_required: gates.approval_required === true,
      blocking_gap_count: blockingGaps.length,
      secrets_included: false,
    };
    throw error;
  }
  const observedCommit = String(capability.expected_commit_sha || requestContext.expected_commit_sha || scope.expected_commit_sha || "").trim().toLowerCase();
  if (observedCommit && observedCommit !== scope.expected_commit_sha) {
    const error = new Error("Resolved capability dry-run expected commit does not match the normalized runtime break-glass scope.");
    error.code = "runtime_break_glass_envelope_commit_mismatch";
    throw error;
  }

  return {
    ...dryRun,
    request_context: {
      ...requestContext,
      operation_intent: RUNTIME_BREAK_GLASS_OPERATION_INTENT,
      expected_commit_sha: scope.expected_commit_sha,
      break_glass_id: scope.break_glass_id,
      incident_id: scope.incident_id,
      runtime_break_glass_scope_sha256: scopeSha256,
      runtime_break_glass_scope_contract: RUNTIME_BREAK_GLASS_SCOPE_BINDING_CONTRACT,
      runtime_break_glass_risk_classification_intent: RUNTIME_BREAK_GLASS_CRITICAL_DRY_RUN_INTENT,
    },
    capability: {
      ...capability,
      app_key: RUNTIME_BREAK_GLASS_AUTHORITY_APP_KEY,
      capability_key: RUNTIME_BREAK_GLASS_AUTHORITY_CAPABILITY_KEY,
      risk_class: "critical",
      expected_commit_sha: scope.expected_commit_sha,
    },
    selected_source: {
      ...selected,
      selected_runtime_surface: RUNTIME_BREAK_GLASS_AUTHORITY_RUNTIME_SURFACE,
    },
    authority: {
      ...(dryRun.authority || {}),
      runtime_break_glass_scope_sha256: scopeSha256,
      runtime_break_glass_scope_contract: RUNTIME_BREAK_GLASS_SCOPE_BINDING_CONTRACT,
    },
    inputs: {
      ...(dryRun.inputs || {}),
      break_glass_id: scope.break_glass_id,
      incident_id: scope.incident_id,
      expected_commit_sha: scope.expected_commit_sha,
      runtime_break_glass_scope_sha256: scopeSha256,
    },
    secrets_included: false,
  };
}

export async function createRuntimeBreakGlassCapabilityEnvelope(args = parseArgs(), deps = {}) {
  const scopeInput = parseRuntimeBreakGlassScopeJson(args.scopeJson);
  const binding = buildRuntimeBreakGlassEnvelopeBinding(scopeInput, args.passthrough, { ttlMinutes: args.ttlMinutes, now: deps.now || new Date() });
  const runDryRun = deps.runDryRun || runCapabilityResolutionDryRun;
  const result = await createCapabilityResolutionEnvelopeLedger(
    {
      requestedBy: args.requestedBy,
      ttlMinutes: args.ttlMinutes,
      passthrough: binding.passthrough,
    },
    {
      ...(deps.readPool ? { readPool: deps.readPool } : {}),
      ...(deps.writerPool ? { writerPool: deps.writerPool } : {}),
      runDryRun: async (dryRunArgs) => decorateRuntimeBreakGlassDryRun(await runDryRun(dryRunArgs), binding),
    },
  );
  return {
    ...result,
    break_glass_id: binding.scope.break_glass_id,
    incident_id: binding.scope.incident_id,
    expected_commit_sha: binding.scope.expected_commit_sha,
    runtime_break_glass_scope_sha256: binding.scope_sha256,
    runtime_break_glass_scope_contract: RUNTIME_BREAK_GLASS_SCOPE_BINDING_CONTRACT,
    authority_app_key: RUNTIME_BREAK_GLASS_AUTHORITY_APP_KEY,
    authority_capability_key: RUNTIME_BREAK_GLASS_AUTHORITY_CAPABILITY_KEY,
    authority_runtime_surface: RUNTIME_BREAK_GLASS_AUTHORITY_RUNTIME_SURFACE,
    secrets_included: false,
  };
}

async function closePools() {
  await closeGovernancePool().catch(() => {});
  try { await getPool().end(); } catch { }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let args;
  try {
    args = parseArgs();
    createRuntimeBreakGlassCapabilityEnvelope(args)
      .then(async (result) => {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        await closePools();
      })
      .catch(async (error) => {
        process.stdout.write(`${JSON.stringify({ ok: false, error: { code: error.code || "runtime_break_glass_capability_envelope_create_failed", message: error.message, details: error.details || undefined }, secrets_included: false }, null, 2)}\n`);
        await closePools();
        process.exitCode = 1;
      });
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: { code: error.code || "runtime_break_glass_capability_envelope_args_invalid", message: error.message }, secrets_included: false }, null, 2)}\n`);
    process.exitCode = 1;
  }
}
