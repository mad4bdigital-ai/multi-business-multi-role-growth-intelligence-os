#!/usr/bin/env node
import crypto, { randomUUID } from "node:crypto";
import { getPool } from "../db.js";
import { runCapabilityResolutionDryRun } from "./capability-resolution-dry-run.mjs";

function parseArgs(argv = process.argv.slice(2)) {
  const passthrough = [];
  const args = { requestedBy: "gpt_admin", ttlMinutes: 60 };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--requested-by") args.requestedBy = argv[++i] || args.requestedBy;
    else if (item.startsWith("--requested-by=")) args.requestedBy = item.slice("--requested-by=".length);
    else if (item === "--ttl-minutes") args.ttlMinutes = Number(argv[++i] || args.ttlMinutes);
    else if (item.startsWith("--ttl-minutes=")) args.ttlMinutes = Number(item.slice("--ttl-minutes=".length));
    else passthrough.push(item);
  }
  return { ...args, passthrough };
}

function sha256Json(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function safeText(value = "", max = 191) {
  return String(value || "").trim().slice(0, max);
}

function redactDangerousKeys(value) {
  if (Array.isArray(value)) return value.map(redactDangerousKeys);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (/secret|token|api[_-]?key|private[_-]?key|ciphertext|credential_value|password/i.test(key) && key !== "secrets_included") {
      out[key] = "[redacted_by_capability_envelope_ledger]";
    } else {
      out[key] = redactDangerousKeys(raw);
    }
  }
  return out;
}

function envelopeStatus(decision = "") {
  if (decision === "ready_for_dispatch") return "ready_for_dispatch";
  if (decision === "ready_requires_approval") return "ready_requires_approval";
  if (String(decision || "").startsWith("blocked")) return "blocked";
  return "dry_run";
}

function buildDryRunArgs(passthrough = []) {
  const args = {
    tenantId: "",
    userId: "",
    workspaceId: "",
    workspaceKey: "",
    workspaceType: "",
    userRole: "",
    brandKey: "",
    businessActivityType: "",
    appKey: "",
    capabilityKey: "",
    operationIntent: "read",
    runtimeSurface: "",
    requestedSourceTier: "",
    explain: false,
  };
  for (let i = 0; i < passthrough.length; i += 1) {
    const item = passthrough[i];
    const [key, inlineValue] = item.includes("=") ? item.split(/=(.*)/s).filter((_, idx) => idx < 2) : [item, null];
    const value = inlineValue ?? passthrough[i + 1];
    const consume = inlineValue === null;
    if (key === "--tenant-id") { args.tenantId = value || ""; if (consume) i += 1; }
    else if (key === "--user-id") { args.userId = value || ""; if (consume) i += 1; }
    else if (key === "--workspace-id") { args.workspaceId = value || ""; if (consume) i += 1; }
    else if (key === "--workspace-key") { args.workspaceKey = value || ""; if (consume) i += 1; }
    else if (key === "--workspace-type") { args.workspaceType = value || ""; if (consume) i += 1; }
    else if (key === "--user-role") { args.userRole = value || ""; if (consume) i += 1; }
    else if (key === "--brand-key") { args.brandKey = value || ""; if (consume) i += 1; }
    else if (key === "--business-activity-type") { args.businessActivityType = value || ""; if (consume) i += 1; }
    else if (key === "--app-key") { args.appKey = value || ""; if (consume) i += 1; }
    else if (key === "--capability-key") { args.capabilityKey = value || ""; if (consume) i += 1; }
    else if (key === "--operation-intent") { args.operationIntent = value || "read"; if (consume) i += 1; }
    else if (key === "--runtime-surface") { args.runtimeSurface = value || ""; if (consume) i += 1; }
    else if (key === "--requested-source-tier") { args.requestedSourceTier = value || ""; if (consume) i += 1; }
    else if (key === "--explain") args.explain = true;
  }
  return args;
}

export function buildBindingContext(passthrough = []) {
  const context = { plan_id: "", plan_item_id: "", resource_uri: "", recipe_key: "", expected_commit_sha: "" };
  for (let i = 0; i < passthrough.length; i += 1) {
    const item = passthrough[i];
    const [key, inlineValue] = item.includes("=") ? item.split(/=(.*)/s).filter((_, idx) => idx < 2) : [item, null];
    const value = inlineValue ?? passthrough[i + 1];
    const consume = inlineValue === null;
    if (key === "--plan-id") { context.plan_id = safeText(value, 64); if (consume) i += 1; }
    else if (key === "--plan-item-id") { context.plan_item_id = safeText(value, 64); if (consume) i += 1; }
    else if (key === "--resource-uri") { context.resource_uri = safeText(value, 512); if (consume) i += 1; }
    else if (key === "--recipe-key") { context.recipe_key = safeText(value, 191); if (consume) i += 1; }
    else if (key === "--expected-commit-sha") { context.expected_commit_sha = safeText(value, 64).toLowerCase(); if (consume) i += 1; }
  }
  if (context.expected_commit_sha && !/^[0-9a-f]{40}$/.test(context.expected_commit_sha)) {
    const err = new Error("--expected-commit-sha must be a 40-character hexadecimal commit SHA.");
    err.code = "capability_resolution_expected_commit_sha_invalid";
    throw err;
  }
  if (context.resource_uri && !/^[a-z][a-z0-9+.-]*:\/\//i.test(context.resource_uri)) {
    const err = new Error("--resource-uri must be an absolute governed resource URI.");
    err.code = "capability_resolution_resource_uri_invalid";
    throw err;
  }
  return Object.fromEntries(Object.entries(context).filter(([, value]) => Boolean(value)));
}
export async function createCapabilityResolutionEnvelopeLedger(args = parseArgs()) {
  const dryRunArgs = buildDryRunArgs(args.passthrough);
  const bindingContext = buildBindingContext(args.passthrough);
  const dryRun = await runCapabilityResolutionDryRun(dryRunArgs);
  const envelope = redactDangerousKeys({
    ...dryRun,
    request_context: { ...(dryRun.request_context || {}), ...bindingContext },
    capability: { ...(dryRun.capability || {}), recipe_key: bindingContext.recipe_key || null, expected_commit_sha: bindingContext.expected_commit_sha || null },
    inputs: { ...bindingContext },
    ledger_created_by: safeText(args.requestedBy),
    secrets_included: false,
  });
  const envelopeHash = sha256Json(envelope);
  const envelopeId = randomUUID();
  const ttl = Math.max(5, Math.min(Number(args.ttlMinutes || 60), 1440));
  const pool = getPool();
  const status = envelopeStatus(envelope.decision);
  const ctx = envelope.request_context || {};
  const cap = envelope.capability || {};
  const selected = envelope.selected_source || {};
  const gates = envelope.gates || {};
  const authority = envelope.authority || {};
  await pool.query(
    `INSERT INTO capability_resolution_envelope_ledger
      (envelope_id, tenant_id, user_id, workspace_id, workspace_key, brand_key,
       app_key, capability_key, operation_intent, risk_class, selected_source_tier,
       selected_runtime_surface, authority_status, decision, envelope_status,
       dispatch_allowed, apply_allowed, approval_required, quota_required, audit_required, readback_required,
       blocking_gap_count, envelope_sha256, envelope_json, requested_by, expires_at, secrets_included)
     VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), 0)`,
    [
      envelopeId,
      safeText(ctx.tenant_id, 64) || null,
      safeText(ctx.user_id, 64) || null,
      safeText(ctx.workspace_id, 64) || null,
      safeText(ctx.workspace_key, 191) || null,
      safeText(ctx.brand_key, 191) || null,
      safeText(cap.app_key, 128) || null,
      safeText(cap.capability_key, 191) || null,
      safeText(ctx.operation_intent || dryRunArgs.operationIntent, 128) || null,
      safeText(cap.risk_class, 64) || null,
      safeText(selected.selected_source_tier, 96) || null,
      safeText(selected.selected_runtime_surface, 128) || null,
      safeText(authority.status, 64) || null,
      safeText(envelope.decision, 96) || null,
      status,
      gates.dispatch_allowed === true ? 1 : 0,
      gates.apply_allowed === true ? 1 : 0,
      gates.approval_required === true ? 1 : 0,
      gates.quota_required === true ? 1 : 0,
      gates.audit_required !== false ? 1 : 0,
      gates.readback_required === true ? 1 : 0,
      Array.isArray(envelope.blocking_gaps) ? envelope.blocking_gaps.length : 0,
      envelopeHash,
      JSON.stringify(envelope),
      safeText(args.requestedBy, 191) || "gpt_admin",
      ttl,
    ]
  );
  return {
    ok: true,
    envelope_id: envelopeId,
    envelope_status: status,
    decision: envelope.decision,
    selected_source_tier: selected.selected_source_tier || null,
    authority_status: authority.status || null,
    dispatch_allowed: gates.dispatch_allowed === true,
    apply_allowed: gates.apply_allowed === true,
    approval_required: gates.approval_required === true,
    quota_required: gates.quota_required === true,
    blocking_gap_count: Array.isArray(envelope.blocking_gaps) ? envelope.blocking_gaps.length : 0,
    envelope_sha256: envelopeHash,
    expires_in_minutes: ttl,
    secrets_included: false,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createCapabilityResolutionEnvelopeLedger(parseArgs())
    .then(async (result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      await getPool().end().catch(() => {});
    })
    .catch(async (err) => {
      process.stdout.write(`${JSON.stringify({ ok: false, error: { code: err.code || "capability_resolution_envelope_create_failed", message: err.message }, secrets_included: false }, null, 2)}\n`);
      await getPool().end().catch(() => {});
      process.exitCode = 1;
    });
}
