#!/usr/bin/env node
import crypto, { randomUUID } from "node:crypto";
import { getPool } from "../db.js";
import { closeGovernancePool, getGovernancePool } from "../governanceDb.js";
import { SAFE_FALSE_SECRET_METADATA_KEYS } from "../capabilityEnvelopeSecretPolicy.js";
import { resolveRepositoryCapabilityAuthority } from "../repositoryAuthorityContextResolver.js";
import { buildGithubRepositoryPolicyCapabilityBinding } from "../githubRepositoryPolicyController.js";
import { runCapabilityResolutionDryRun } from "./capability-resolution-dry-run.mjs";

const REPOSITORY_POLICY_CAPABILITY_KEY = "repository_policy_controller";
const REPOSITORY_POLICY_OPERATION_INTENT = "github_repository_policy_apply";
const REPOSITORY_POLICY_RUNTIME_SURFACE = "system_layer";
const REPOSITORY_POLICY_SOURCE_TIER = "platform_managed_fallback";
const DEFAULT_REPOSITORY_BINDING_KEY = "growth_intelligence_platform.github.primary.production";

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

export function redactDangerousKeys(value) {
  if (Array.isArray(value)) return value.map(redactDangerousKeys);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    const safeFalseMetadata = SAFE_FALSE_SECRET_METADATA_KEYS.has(key) && raw === false;
    if (/secret|token|api[_-]?key|private[_-]?key|ciphertext|credential_value|password/i.test(key) && !safeFalseMetadata) {
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

export function buildDryRunArgs(passthrough = []) {
  const args = { tenantId:"", userId:"", principalType:"", principalId:"", workspaceId:"", workspaceKey:"", workspaceType:"", userRole:"", brandKey:"", businessActivityType:"", appKey:"", capabilityKey:"", operationIntent:"read", operationMode:"", resourceType:"", resourceUri:"", resourceBranch:"", expectedCommitSha:"", recipeKey:"", runtimeSurface:"", requestedSourceTier:"", explain:false };
  for (let i = 0; i < passthrough.length; i += 1) {
    const item = passthrough[i];
    const [key, inlineValue] = item.includes("=") ? item.split(/=(.*)/s).filter((_, idx) => idx < 2) : [item, null];
    const value = inlineValue ?? passthrough[i + 1];
    const consume = inlineValue === null;
    if (key === "--tenant-id") { args.tenantId = value || ""; if (consume) i += 1; }
    else if (key === "--user-id") { args.userId = value || ""; if (consume) i += 1; }
    else if (key === "--principal-type") { args.principalType = value || ""; if (consume) i += 1; }
    else if (key === "--principal-id") { args.principalId = value || ""; if (consume) i += 1; }
    else if (key === "--workspace-id") { args.workspaceId = value || ""; if (consume) i += 1; }
    else if (key === "--workspace-key") { args.workspaceKey = value || ""; if (consume) i += 1; }
    else if (key === "--workspace-type") { args.workspaceType = value || ""; if (consume) i += 1; }
    else if (key === "--user-role") { args.userRole = value || ""; if (consume) i += 1; }
    else if (key === "--brand-key") { args.brandKey = value || ""; if (consume) i += 1; }
    else if (key === "--business-activity-type") { args.businessActivityType = value || ""; if (consume) i += 1; }
    else if (key === "--app-key") { args.appKey = value || ""; if (consume) i += 1; }
    else if (key === "--capability-key") { args.capabilityKey = value || ""; if (consume) i += 1; }
    else if (key === "--operation-intent") { args.operationIntent = value || "read"; if (consume) i += 1; }
    else if (key === "--operation-mode") { args.operationMode = value || ""; if (consume) i += 1; }
    else if (key === "--resource-type") { args.resourceType = value || ""; if (consume) i += 1; }
    else if (key === "--resource-uri") { args.resourceUri = value || ""; if (consume) i += 1; }
    else if (key === "--resource-branch" || key === "--branch") { args.resourceBranch = value || ""; if (consume) i += 1; }
    else if (key === "--expected-commit-sha") { args.expectedCommitSha = String(value || "").toLowerCase(); if (consume) i += 1; }
    else if (key === "--expected-branch-sha") { args.expectedCommitSha = String(value || args.expectedCommitSha).toLowerCase(); if (consume) i += 1; }
    else if (key === "--expected-base-sha") { if (!args.expectedCommitSha) args.expectedCommitSha = String(value || "").toLowerCase(); if (consume) i += 1; }
    else if (key === "--recipe-key") { args.recipeKey = value || ""; if (consume) i += 1; }
    else if (key === "--runtime-surface") { args.runtimeSurface = value || ""; if (consume) i += 1; }
    else if (key === "--requested-source-tier") { args.requestedSourceTier = value || ""; if (consume) i += 1; }
    else if (key === "--explain") args.explain = true;
  }
  return args;
}

export function buildBindingContext(passthrough = []) {
  const context = { plan_id:"", plan_item_id:"", resource_uri:"", resource_branch:"", recipe_key:"", repository_binding_key:"", expected_commit_sha:"", binding_sha256:"", capability_sha256:"" };
  for (let i = 0; i < passthrough.length; i += 1) {
    const item = passthrough[i];
    const [key, inlineValue] = item.includes("=") ? item.split(/=(.*)/s).filter((_, idx) => idx < 2) : [item, null];
    const value = inlineValue ?? passthrough[i + 1];
    const consume = inlineValue === null;
    if (key === "--plan-id") { context.plan_id = safeText(value, 64); if (consume) i += 1; }
    else if (key === "--plan-item-id") { context.plan_item_id = safeText(value, 64); if (consume) i += 1; }
    else if (key === "--resource-uri") { context.resource_uri = safeText(value, 512); if (consume) i += 1; }
    else if (key === "--resource-branch" || key === "--branch") { context.resource_branch = safeText(value, 255); if (consume) i += 1; }
    else if (key === "--recipe-key") { context.recipe_key = safeText(value, 191); if (consume) i += 1; }
    else if (key === "--repository-binding-key") { context.repository_binding_key = safeText(value, 191); if (consume) i += 1; }
    else if (key === "--expected-commit-sha") { context.expected_commit_sha = safeText(value, 64).toLowerCase(); if (consume) i += 1; }
    else if (key === "--expected-branch-sha") { context.expected_commit_sha = safeText(value, 64).toLowerCase(); if (consume) i += 1; }
    else if (key === "--expected-base-sha") { if (!context.expected_commit_sha) context.expected_commit_sha = safeText(value, 64).toLowerCase(); if (consume) i += 1; }
    else if (key === "--binding-sha256") { context.binding_sha256 = safeText(value, 64).toLowerCase(); if (consume) i += 1; }
    else if (key === "--capability-sha256") { context.capability_sha256 = safeText(value, 64).toLowerCase(); if (consume) i += 1; }
  }
  if (context.expected_commit_sha && !/^[0-9a-f]{40}$/.test(context.expected_commit_sha)) throw Object.assign(new Error("--expected-commit-sha must be a 40-character hexadecimal commit SHA."), { code:"capability_resolution_expected_commit_sha_invalid" });
  for (const [field, flag] of [["binding_sha256","--binding-sha256"],["capability_sha256","--capability-sha256"]]) if (context[field] && !/^[0-9a-f]{64}$/.test(context[field])) throw Object.assign(new Error(`${flag} must be a 64-character hexadecimal SHA-256 fingerprint.`), { code:`capability_resolution_${field}_invalid` });
  if (context.resource_uri && !/^[a-z][a-z0-9+.-]*:\/\//i.test(context.resource_uri)) throw Object.assign(new Error("--resource-uri must be an absolute governed resource URI."), { code:"capability_resolution_resource_uri_invalid" });
  return Object.fromEntries(Object.entries(context).filter(([, value]) => Boolean(value)));
}

export function ledgerPrincipalId(requestContext = {}) {
  return safeText(requestContext.user_id || requestContext?.principal?.principal_id, 64) || null;
}

function repositoryPolicyEnvelopeRequested(dryRunArgs = {}) {
  return dryRunArgs.appKey === "github"
    && dryRunArgs.capabilityKey === REPOSITORY_POLICY_CAPABILITY_KEY
    && dryRunArgs.operationIntent === REPOSITORY_POLICY_OPERATION_INTENT;
}

function exactRepositoryPolicySurface(dryRunArgs = {}) {
  return (!dryRunArgs.runtimeSurface || dryRunArgs.runtimeSurface === REPOSITORY_POLICY_RUNTIME_SURFACE)
    && (!dryRunArgs.requestedSourceTier || dryRunArgs.requestedSourceTier === REPOSITORY_POLICY_SOURCE_TIER);
}

export async function buildRepositoryPolicyEnvelopeDryRun({ dryRunArgs = {}, bindingContext = {}, pool = getPool() } = {}) {
  if (!repositoryPolicyEnvelopeRequested(dryRunArgs)) return null;
  if (!exactRepositoryPolicySurface(dryRunArgs)) {
    const err = new Error("Repository policy envelopes require runtime_surface=system_layer and source_tier=platform_managed_fallback.");
    err.code = "repository_policy_capability_surface_mismatch";
    throw err;
  }
  if (!bindingContext.expected_commit_sha || !bindingContext.binding_sha256 || !bindingContext.capability_sha256 || !bindingContext.resource_uri) {
    const err = new Error("Repository policy envelope creation requires exact resource URI, main SHA, binding SHA-256 and policy/capability SHA-256 from the reviewed plan.");
    err.code = "repository_policy_capability_exact_binding_required";
    throw err;
  }
  const repositoryBindingKey = bindingContext.repository_binding_key || DEFAULT_REPOSITORY_BINDING_KEY;
  const resolved = await resolveRepositoryCapabilityAuthority({
    bindingKey: repositoryBindingKey,
    capabilityKey: REPOSITORY_POLICY_CAPABILITY_KEY,
    pool,
  });
  const authority = resolved.authority || {};
  const capability = resolved.capability || {};
  if (authority.provider_key !== "github" || authority.app_key !== "github" || authority.default_branch !== "main") {
    const err = new Error("Repository policy envelope authority must resolve to the governed GitHub main repository binding.");
    err.code = "repository_policy_repository_authority_invalid";
    throw err;
  }
  if (capability.operation_intent !== REPOSITORY_POLICY_OPERATION_INTENT || capability.effect_class !== "external_write") {
    const err = new Error("Repository policy capability binding must authorize github_repository_policy_apply as external_write.");
    err.code = "repository_policy_repository_capability_invalid";
    throw err;
  }
  const controllerBinding = buildGithubRepositoryPolicyCapabilityBinding({
    target: { owner: authority.canonical_owner, repo: authority.canonical_name, default_branch: authority.default_branch },
    expected_main_sha: bindingContext.expected_commit_sha,
    expected_policy_fingerprint: bindingContext.capability_sha256,
  });
  if (!controllerBinding
      || controllerBinding.resource_uri !== bindingContext.resource_uri
      || controllerBinding.binding_sha256 !== bindingContext.binding_sha256
      || controllerBinding.capability_sha256 !== bindingContext.capability_sha256) {
    const err = new Error("Repository policy capability binding drifted from the reviewed controller plan.");
    err.code = "repository_policy_capability_binding_mismatch";
    throw err;
  }
  const tenantId = safeText(authority.tenant_id, 64);
  const workspaceId = safeText(authority.workspace_id, 64);
  const brandKey = safeText(authority.brand_target_key, 191);
  const userId = safeText(dryRunArgs.userId, 64);
  if (!tenantId || !userId) {
    const err = new Error("Repository policy envelope requires resolved repository tenant authority and an explicit admin user id.");
    err.code = "repository_policy_capability_principal_required";
    throw err;
  }
  if (dryRunArgs.tenantId && safeText(dryRunArgs.tenantId, 64) !== tenantId) {
    const err = new Error("Requested tenant does not match repository authority tenant.");
    err.code = "repository_policy_capability_tenant_mismatch";
    throw err;
  }
  if (dryRunArgs.workspaceId && safeText(dryRunArgs.workspaceId, 64) !== workspaceId) {
    const err = new Error("Requested workspace does not match repository authority workspace.");
    err.code = "repository_policy_capability_workspace_mismatch";
    throw err;
  }
  return {
    schema_version: "capability_resolution_dry_run.v1",
    request_context: {
      tenant_id: tenantId,
      user_id: userId,
      workspace_id: workspaceId || null,
      workspace_key: safeText(dryRunArgs.workspaceKey, 191) || null,
      workspace_type: safeText(dryRunArgs.workspaceType, 64) || null,
      user_role: safeText(dryRunArgs.userRole, 64) || "Admin",
      brand_key: brandKey || null,
      business_activity_type: safeText(dryRunArgs.businessActivityType, 191) || null,
      operation_intent: REPOSITORY_POLICY_OPERATION_INTENT,
    },
    capability: {
      app_key: "github",
      capability_key: REPOSITORY_POLICY_CAPABILITY_KEY,
      risk_class: "high",
      effect_class: "external_write",
      repository_capability_binding_key: capability.capability_binding_key,
      repository_policy_key: capability.policy_key || null,
      repository_readback_contract_key: capability.readback_contract_key || null,
      recipe_key: bindingContext.recipe_key || null,
      expected_commit_sha: controllerBinding.expected_commit_sha,
      policy_fingerprint: controllerBinding.expected_policy_fingerprint,
      secrets_included: false,
    },
    selected_source: {
      selected_source_tier: REPOSITORY_POLICY_SOURCE_TIER,
      selected_runtime_surface: REPOSITORY_POLICY_RUNTIME_SURFACE,
      active_credential_binding_count: 0,
      credential_source_candidates: [],
      provider_auth_source: "server_side_github_app",
      secrets_included: false,
    },
    authority: {
      status: "resolved_repository_authority",
      authorization_source: "repository_authority_bindings",
      repository_binding_key: authority.binding_key,
      repository_binding_sha256: resolved.binding_sha256,
      repository_capability_sha256: resolved.capability_sha256,
      repository: `${authority.canonical_owner}/${authority.canonical_name}`,
      resource_uri: controllerBinding.resource_uri,
      secrets_included: false,
    },
    gates: {
      dispatch_allowed: true,
      apply_allowed: false,
      approval_required: true,
      quota_required: false,
      audit_required: true,
      readback_required: true,
      secrets_included: false,
    },
    decision: "ready_requires_approval",
    blocking_gaps: [],
    inputs: {
      repository_binding_key: authority.binding_key,
      resource_uri: controllerBinding.resource_uri,
      expected_commit_sha: controllerBinding.expected_commit_sha,
      binding_sha256: controllerBinding.binding_sha256,
      capability_sha256: controllerBinding.capability_sha256,
      repository_binding_sha256: resolved.binding_sha256,
      repository_capability_sha256: resolved.capability_sha256,
    },
    provider_call_executed: false,
    external_write_executed: false,
    credential_payload_read: false,
    secrets_included: false,
  };
}

export async function createCapabilityResolutionEnvelopeLedger(args = parseArgs(), deps = {}) {
  const dryRunArgs = buildDryRunArgs(args.passthrough);
  const bindingContext = buildBindingContext(args.passthrough);
  const readPool = deps.readPool || getPool();
  const repositoryPolicyDryRun = await buildRepositoryPolicyEnvelopeDryRun({ dryRunArgs, bindingContext, pool: readPool });
  const runDryRun = deps.runDryRun || runCapabilityResolutionDryRun;
  const dryRun = repositoryPolicyDryRun || await runDryRun(dryRunArgs);
  const envelope = redactDangerousKeys({
    ...dryRun,
    request_context: { ...(dryRun.request_context || {}), ...bindingContext },
    capability: { ...(dryRun.capability || {}), recipe_key: bindingContext.recipe_key || dryRun.capability?.recipe_key || null, expected_commit_sha: bindingContext.expected_commit_sha || dryRun.capability?.expected_commit_sha || null },
    inputs: { ...(dryRun.inputs || {}), ...bindingContext },
    ledger_created_by: safeText(args.requestedBy),
    secrets_included: false,
  });
  const envelopeHash = sha256Json(envelope);
  const envelopeId = randomUUID();
  const ttl = Math.max(5, Math.min(Number(args.ttlMinutes || 60), 1440));
  const status = envelopeStatus(envelope.decision);
  const ctx = envelope.request_context || {};
  const cap = envelope.capability || {};
  const selected = envelope.selected_source || {};
  const gates = envelope.gates || {};
  const authority = envelope.authority || {};
  const writerPool = deps.writerPool || getGovernancePool();
  await writerPool.query(`INSERT INTO capability_resolution_envelope_ledger
      (envelope_id, tenant_id, user_id, workspace_id, workspace_key, brand_key, app_key, capability_key, operation_intent, risk_class, selected_source_tier, selected_runtime_surface, authority_status, decision, envelope_status, dispatch_allowed, apply_allowed, approval_required, quota_required, audit_required, readback_required, blocking_gap_count, envelope_sha256, envelope_json, requested_by, expires_at, secrets_included)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), 0)`, [
      envelopeId, safeText(ctx.tenant_id,64)||null, ledgerPrincipalId(ctx), safeText(ctx.workspace_id,64)||null, safeText(ctx.workspace_key,191)||null, safeText(ctx.brand_key,191)||null, safeText(cap.app_key,128)||null, safeText(cap.capability_key,191)||null, safeText(ctx.operation_intent || dryRunArgs.operationIntent,128)||null, safeText(cap.risk_class,64)||null, safeText(selected.selected_source_tier,96)||null, safeText(selected.selected_runtime_surface,128)||null, safeText(authority.status,64)||null, safeText(envelope.decision,96)||null, status, gates.dispatch_allowed===true?1:0, gates.apply_allowed===true?1:0, gates.approval_required===true?1:0, gates.quota_required===true?1:0, gates.audit_required!==false?1:0, gates.readback_required===true?1:0, Array.isArray(envelope.blocking_gaps)?envelope.blocking_gaps.length:0, envelopeHash, JSON.stringify(envelope), safeText(args.requestedBy,191)||"gpt_admin", ttl
    ]);
  return {
    ok:true,
    envelope_id:envelopeId,
    envelope_status:status,
    decision:envelope.decision,
    selected_source_tier:selected.selected_source_tier||null,
    authority_status:authority.status||null,
    dispatch_allowed:gates.dispatch_allowed===true,
    apply_allowed:gates.apply_allowed===true,
    approval_required:gates.approval_required===true,
    quota_required:gates.quota_required===true,
    blocking_gap_count:Array.isArray(envelope.blocking_gaps)?envelope.blocking_gaps.length:0,
    envelope_sha256:envelopeHash,
    expires_in_minutes:ttl,
    provider_call_executed:false,
    external_write_executed:false,
    credential_payload_read:false,
    secrets_included:false,
  };
}

async function closePools() {
  await closeGovernancePool().catch(() => {});
  try { await getPool().end(); } catch { }
}

if (import.meta.url === `file://${process.argv[1]}`) createCapabilityResolutionEnvelopeLedger(parseArgs()).then(async result => { process.stdout.write(`${JSON.stringify(result,null,2)}\n`); await closePools(); }).catch(async err => { process.stdout.write(`${JSON.stringify({ok:false,error:{code:err.code||"capability_resolution_envelope_create_failed",message:err.message,details:err.details||undefined},secrets_included:false},null,2)}\n`); await closePools(); process.exitCode=1; });
