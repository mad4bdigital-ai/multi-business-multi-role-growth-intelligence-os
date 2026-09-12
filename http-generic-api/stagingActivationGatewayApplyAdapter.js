import crypto from "node:crypto";
import { createCloudflareApiClient } from "./activationGatewayRolloutTool.js";
import { readCanonicalDeploymentIdentity } from "./deploymentManifest.js";
import { buildStagingActivationGatewayBundle, stableJson } from "./stagingActivationGatewayBundle.js";
import {
  saveStagingGatewayExecutionPlan, loadStagingGatewayExecutionPlan,
  claimStagingGatewayExecutionPlan, transitionStagingGatewayExecutionPlan,
} from "./stagingGatewayExecutionPlanStore.js";
import {
  loadActivationGatewayProfilePolicy,
  readEnvironmentConvergenceRegistry,
} from "./environmentConvergenceRegistry.js";
import {
  capabilityEnvelopeError,
  resolveCapabilityExecutionEnvelope,
  markCapabilityEnvelopeReferenced,
  transitionCapabilityEnvelopeLifecycle,
} from "./capabilityResolutionEnvelopeGuard.js";

const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000";
const SHA_RE = /^[a-f0-9]{40}$/u;
const SHA256_RE = /^[a-f0-9]{64}$/u;
const SAFE_NONCE_RE = /^[A-Za-z0-9._:-]{8,128}$/u;
const STAGING_SCRIPT_NAME = "mad4b-activation-gateway-staging";
const STAGING_CERTIFICATION_KEY = "staging_activation_gateway_apply_v1";
const STAGING_CAPABILITY_KEY = "admin_cloudflare_v1";
const STAGING_OPERATION_INTENT = "activation_gateway.staging_apply";
const STAGING_RUNTIME_SURFACE = "activation_gateway_dark_deploy";

function compact(value, max = 1024) {
  return String(value ?? "").trim().slice(0, max);
}

function parseJson(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function adapterError(code, message, status = 400, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = { ...details, secrets_included: false };
  return error;
}

function truthy(value) {
  return ["1", "true", "yes", "on", "enabled"].includes(String(value ?? "").trim().toLowerCase());
}

async function canonicalRuntimeCommit(deps) {
  if (typeof deps.resolveCurrentCommit === "function") return compact(await deps.resolveCurrentCommit(), 64).toLowerCase();
  const identity = readCanonicalDeploymentIdentity({ env: deps.env || process.env, requireManifest: true });
  if (!identity.ok || identity.repository !== "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os"
    || identity.branch !== "main") return "";
  return identity.sha;
}

function requiredProfile(registry = readEnvironmentConvergenceRegistry()) {
  const profile = registry?.profiles?.staging;
  const gateway = profile?.activation_gateway;
  const target = gateway?.execution_target;
  const resource = target?.resource_binding;
  const bundle = target?.bundle_binding;
  const errors = [];
  if (profile?.state_machine !== "environment_convergence.v1") errors.push("state_machine");
  if (profile?.source_branch !== "main") errors.push("source_branch");
  if (gateway?.policy_key !== "activation_gateway_staging") errors.push("policy_key");
  if (gateway?.public_host !== "activation-dev.mad4b.com") errors.push("public_host");
  try {
    loadActivationGatewayProfilePolicy("staging", { registry });
  } catch {
    errors.push("policy_hash");
  }
  if (gateway?.current_authority_adapter !== "staging_activation_gateway_profile_apply") errors.push("authority_adapter");
  if (gateway?.target_authority_model !== "server_governed") errors.push("authority_model");
  if (gateway?.apply_capability !== STAGING_RUNTIME_SURFACE || gateway?.governed_apply_ready !== true) errors.push("apply_capability");
  if (gateway?.apply_block_reason !== null) errors.push("apply_block_reason");
  if (target?.contract !== "mad4b.environment-convergence-execution-target.v1") errors.push("execution_target_contract");
  if (target?.component !== "activation_gateway" || target?.target_key !== "activation_gateway_staging") errors.push("target_key");
  if (bundle?.bundle_key !== "activation_gateway_staging_worker") errors.push("bundle_key");
  if (bundle?.entrypoint !== "edge/activation-gateway/src/worker-staging.mjs") errors.push("entrypoint");
  if (bundle?.policy_path !== gateway?.policy_path) errors.push("policy_path");
  if (resource?.resource_type !== "cloudflare_worker" || !compact(resource?.resource_binding_id, 64)) errors.push("resource_binding");
  if (target?.runtime_surface !== STAGING_RUNTIME_SURFACE) errors.push("runtime_surface");
  if (errors.length) throw adapterError("staging_activation_gateway_profile_invalid", "Staging Activation Gateway apply profile is not execution-ready.", 503, { invalid_fields: errors });
  return { profile, gateway, target, binding_id: compact(resource.resource_binding_id, 64) };
}

export function isStagingActivationGatewayApplyRequest(input = {}, registry = readEnvironmentConvergenceRegistry()) {
  const expectedHash = compact(input.expected_policy_hash, 64).toLowerCase();
  const profileHash = compact(registry?.profiles?.staging?.activation_gateway?.expected_policy_hash, 64).toLowerCase();
  const script = compact(input.script_name, 128);
  return (Boolean(expectedHash) && expectedHash === profileHash)
    || script === STAGING_SCRIPT_NAME;
}

function assertCallerCannotSelectTarget(input, resolved) {
  for (const forbidden of ["resource_binding_id", "policy_path", "bundle_key", "entrypoint", "public_host", "cloudflare_resource_id", "zone_id", "custom_domain", "dns_record"]) {
    if (input?.[forbidden] !== undefined && input?.[forbidden] !== null && String(input[forbidden]).trim() !== "") {
      throw adapterError("staging_activation_gateway_caller_target_override_forbidden", `Caller-selected ${forbidden} is forbidden for Staging Activation Gateway apply.`, 403, { field: forbidden });
    }
  }
  const assertedAccount = compact(input.account_id, 64).toLowerCase();
  const assertedScript = compact(input.script_name, 128);
  if (assertedAccount && assertedAccount !== resolved.account_id) {
    throw adapterError("staging_activation_gateway_account_assertion_mismatch", "Caller account assertion does not match the server-resolved Staging resource binding.", 409);
  }
  if (assertedScript && assertedScript !== resolved.script_name) {
    throw adapterError("staging_activation_gateway_script_assertion_mismatch", "Caller script assertion does not match the server-resolved Staging resource binding.", 409);
  }
}

async function resolveServerResourceBinding(pool, bindingId) {
  if (!pool) throw adapterError("staging_activation_gateway_database_required", "Database access is required to resolve the server-owned Staging resource binding.", 500);
  const [rows] = await pool.query(
    `SELECT binding_id, tenant_id, workspace_id, user_id, resource_type, resource_uri, resource_ref_json,
            recipe_key, permission_level, allowed_modes_json, authority_source, expires_at, status
       FROM platform_resource_authority_bindings
      WHERE binding_id=?
      LIMIT 1`,
    [bindingId],
  );
  const row = rows?.[0] || null;
  if (!row) throw adapterError("staging_activation_gateway_resource_binding_missing", "The profile-owned Staging Worker resource binding is missing.", 503, { binding_id: bindingId });
  const ref = parseJson(row.resource_ref_json, {});
  const accountId = compact(ref?.account_id, 64).toLowerCase();
  const scriptName = compact(ref?.script_name, 128);
  const modes = parseJson(row.allowed_modes_json, []);
  const expectedUri = `cloudflare://accounts/${accountId}/workers/scripts/${scriptName}`;
  const checks = {
    active: row.status === "active" && (!row.expires_at || new Date(row.expires_at).getTime() > Date.now()),
    resource_type: row.resource_type === "cloudflare_worker",
    resource_uri: row.resource_uri === expectedUri,
    recipe: row.recipe_key === "staging_activation_gateway_apply",
    permission: row.permission_level === "admin",
    mode: Array.isArray(modes) && modes.includes("staging_apply"),
    account_id: /^[a-f0-9]{32}$/u.test(accountId),
    script_name: scriptName === STAGING_SCRIPT_NAME,
    provider: compact(ref?.provider).toLowerCase() === "cloudflare",
    workers_dev_only: ref?.workers_dev_only === true,
    dns_write_forbidden: ref?.dns_write_allowed === false,
    custom_domain_forbidden: ref?.custom_domain_binding_allowed === false,
  };
  if (!Object.values(checks).every(Boolean)) {
    throw adapterError("staging_activation_gateway_resource_binding_invalid", "The profile-owned Staging Worker resource binding is invalid.", 503, { binding_id: bindingId, checks });
  }
  return Object.freeze({
    binding_id: bindingId,
    account_id: accountId,
    script_name: scriptName,
    resource_uri: row.resource_uri,
    allowed_modes: modes,
    authority_source: row.authority_source || null,
    secrets_included: false,
  });
}

async function resolveWorkspace(pool, auth = {}, input = {}) {
  if (!pool) return null;
  if (!auth?.user_id) {
    const principal = canonicalPrincipal(auth);
    if (principal.type !== "service" || principal.id !== "platform_admin") return null;
    const [serviceRows] = await pool.query(
      `SELECT workspace_id, tenant_id, workspace_key, display_name, workspace_type, bootstrap_status
         FROM workspace_registry WHERE tenant_id=? AND workspace_type='platform_admin'
           AND bootstrap_status='ready' LIMIT 1`, [PLATFORM_TENANT_ID],
    );
    const resolved = serviceRows?.[0] || null;
    return input.workspace_id && input.workspace_id !== resolved?.workspace_id ? null : resolved;
  }
  const tenantId = compact(auth.tenant_id || PLATFORM_TENANT_ID, 64);
  if (input.workspace_id) {
    const [rows] = await pool.query(
      `SELECT w.workspace_id, w.tenant_id, w.workspace_key, w.display_name, w.workspace_type, w.bootstrap_status
         FROM workspace_registry w
         JOIN memberships m ON m.tenant_id=w.tenant_id AND m.user_id=? AND m.status='active'
        WHERE w.workspace_id=? AND w.tenant_id=?
        LIMIT 1`,
      [auth.user_id, input.workspace_id, tenantId],
    );
    return rows?.[0] || null;
  }
  const [rows] = await pool.query(
    `SELECT w.workspace_id, w.tenant_id, w.workspace_key, w.display_name, w.workspace_type, w.bootstrap_status
       FROM workspace_registry w
       JOIN memberships m ON m.tenant_id=w.tenant_id AND m.user_id=? AND m.status='active'
      WHERE w.tenant_id=? AND w.bootstrap_status='ready'
      ORDER BY (w.workspace_type='platform_admin') DESC, w.updated_at DESC
      LIMIT 1`,
    [auth.user_id, tenantId],
  );
  return rows?.[0] || null;
}

function canonicalPrincipal(auth = {}) {
  if (auth.mode === "backend_api_key" && auth.principal_type === "admin" && auth.is_admin === true
    && !auth.user_id) return { type: "service", id: "platform_admin" };
  if (auth.principal_type === "service" && auth.principal_id === "platform_admin"
    && auth.tenant_id === PLATFORM_TENANT_ID && auth.service_mode === "platform_admin")
    return { type: "service", id: "platform_admin" };
  if (auth.principal_type === "user" && compact(auth.user_id, 191))
    return { type: "user", id: compact(auth.user_id, 191) };
  return { type: null, id: null };
}

async function assertEnvelopeForApply({ runtimePool, governancePool, auth, input, expectedCommitSha, workspaceId, plan }) {
  const { type: principalType, id: principalId } = canonicalPrincipal(auth);
  if (!principalId || !["user", "service"].includes(principalType)) {
    throw adapterError("staging_activation_gateway_principal_unresolved", "A canonical authenticated principal is required.", 403);
  }
  const envelope = await resolveCapabilityExecutionEnvelope({
    pool: runtimePool,
    envelopeId: input.capability_envelope_id,
    source: input,
    acceptedAppKeys: ["cloudflare"],
    acceptedIntents: [STAGING_OPERATION_INTENT],
    expectedTenantId: auth?.tenant_id || PLATFORM_TENANT_ID,
    expectedUserId: principalId,
    expectedWorkspaceId: workspaceId,
    expectedResourceUri: plan.resource_binding.resource_uri,
    expectedCommitSha,
    requireCommitHint: true,
    expectedBindingSha256: plan.plan_sha256,
    expectedCapabilitySha256: plan.environment_convergence_plan_sha256,
    requireReadyForDispatch: true,
    requireDispatchAllowed: true,
    requireNoApprovalRequired: true,
    requireNoBlockingGaps: true,
    requireNoSecrets: true,
  });
  if (!envelope.ok) throw capabilityEnvelopeError(envelope);
  if (!envelope.apply_allowed || !envelope.readback_required) {
    throw adapterError("staging_activation_gateway_capability_envelope_not_applicable", "Capability envelope must allow apply and require readback.", 403, { envelope_id: envelope.envelope_id });
  }
  const [rows] = await governancePool.query(
    `SELECT capability_key, workspace_id, apply_allowed, readback_required
       FROM capability_resolution_envelope_ledger
      WHERE envelope_id=?
      LIMIT 1`,
    [envelope.envelope_id],
  );
  const row = rows?.[0] || null;
  if (!row || row.capability_key !== STAGING_CAPABILITY_KEY) {
    throw adapterError("staging_activation_gateway_capability_envelope_key_mismatch", "Capability envelope is not bound to the Staging Activation Gateway Cloudflare capability.", 403, { envelope_id: envelope.envelope_id });
  }
  if (row.workspace_id && workspaceId && row.workspace_id !== workspaceId) {
    throw adapterError("staging_activation_gateway_capability_envelope_workspace_mismatch", "Capability envelope workspace does not match rollout workspace.", 403, { envelope_id: envelope.envelope_id });
  }
  await governancePool.query(
    `INSERT IGNORE INTO staging_activation_gateway_envelope_plan_bindings
       (envelope_id, plan_id, plan_sha256, environment_convergence_plan_sha256, principal_type, principal_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [envelope.envelope_id, plan.plan_id, plan.plan_sha256, plan.environment_convergence_plan_sha256,
      principalType, principalId],
  );
  const [bindingRows] = await governancePool.query(
    `SELECT plan_id, plan_sha256, environment_convergence_plan_sha256, principal_type, principal_id
       FROM staging_activation_gateway_envelope_plan_bindings WHERE envelope_id=? LIMIT 1`, [envelope.envelope_id],
  );
  const binding = bindingRows?.[0];
  if (!binding || binding.plan_id !== plan.plan_id || binding.plan_sha256 !== plan.plan_sha256
    || binding.environment_convergence_plan_sha256 !== plan.environment_convergence_plan_sha256
    || binding.principal_type !== principalType || binding.principal_id !== principalId) {
    throw adapterError("staging_activation_gateway_envelope_plan_binding_mismatch", "Capability envelope is not bound to this exact execution and convergence plan.", 403);
  }
  const [certRows] = await runtimePool.query(
    `SELECT certification_key, certification_status, dispatch_allowed, apply_allowed, requires_readback, expires_at
       FROM runtime_dispatch_certification_registry
      WHERE certification_key=?
        AND dispatch_allowed=1
        AND apply_allowed=1
        AND requires_readback=1
        AND (expires_at IS NULL OR expires_at>NOW())
      LIMIT 1`,
    [STAGING_CERTIFICATION_KEY],
  );
  if (!certRows?.[0] || certRows[0].certification_status !== "certified") throw adapterError("staging_activation_gateway_dispatch_certification_missing", "Independent Staging Activation Gateway apply certification is missing or expired.", 403);
  return { ...envelope, certification: certRows[0] };
}

function deploymentList(response) {
  if (Array.isArray(response?.result)) return response.result;
  if (Array.isArray(response?.result?.deployments)) return response.result.deployments;
  return [];
}

function deploymentVersions(deployment) {
  return Array.isArray(deployment?.versions)
    ? deployment.versions.map((item) => ({ version_id: item.version_id, percentage: Number(item.percentage) })).filter((item) => item.version_id && item.percentage > 0)
    : [];
}

async function providerRequest(client, args, label) {
  const response = await client.request(args);
  if (!response?.ok) throw adapterError(`staging_activation_gateway_${label}_failed`, `Staging Activation Gateway ${label.replaceAll("_", " ")} failed.`, 502, { status: Number(response?.status || 0) });
  return response;
}

async function readPublicJson(fetchImpl, url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs || 10000)));
  try {
    const response = await fetchImpl(url, { method: "GET", redirect: "manual", signal: controller.signal, headers: { "x-request-id": crypto.randomUUID() } });
    const text = await response.text().catch(() => "");
    return { status: response.status, ok: response.ok, body: parseJson(text, null), secrets_included: false };
  } catch (error) {
    return { status: 0, ok: false, error: compact(error?.message, 200), body: null, secrets_included: false };
  } finally {
    clearTimeout(timer);
  }
}

function buildUploadForm(bundle, plan, compatibilityDate = "2026-08-31") {
  const formData = new FormData();
  const bindings = Object.entries(bundle.worker_secrets).map(([name, text]) => ({ type: "secret_text", name, text: String(text) }));
  formData.append("metadata", new Blob([JSON.stringify({ main_module: "worker-staging.mjs", compatibility_date: compatibilityDate,
    bindings, annotations: { "workers/commit_sha": plan.expected_source_commit, "workers/message": `staging gateway plan ${plan.plan_sha256}` },
  })], { type: "application/json" }), "metadata.json");
  for (const file of bundle.files) formData.append(file.name, new Blob([file.content], { type: file.type }), file.name);
  return formData;
}

async function rollback({ client, accountId, scriptName, previousDeployment, scriptExistedBefore, previousHealth, previousReady, fetchImpl, publicHost, timeoutMs }) {
  if (previousDeployment?.id && deploymentVersions(previousDeployment).length) {
    const versions = deploymentVersions(previousDeployment);
    const apiPath = `/accounts/${accountId}/workers/scripts/${scriptName}/deployments`;
    const response = await client.request({ apiPath: `${apiPath}?force=true`, method: "POST", body: { strategy: "percentage", versions } });
    if (!response?.ok) return { attempted: true, rollback_verified: false, api_restore_ok: false, secrets_included: false };
    const current = deploymentList(await providerRequest(client, { apiPath, method: "GET" }, "rollback_inventory_read"))[0];
    const deploymentReadbackOk = stableJson(deploymentVersions(current).sort((a,b)=>a.version_id.localeCompare(b.version_id))) === stableJson(versions.sort((a,b)=>a.version_id.localeCompare(b.version_id)));
    const [health, ready] = await Promise.all([
      readPublicJson(fetchImpl, `https://${publicHost}/health`, timeoutMs),
      readPublicJson(fetchImpl, `https://${publicHost}/ready`, timeoutMs),
    ]);
    const healthIdentity = (body) => ({ sourceCommit: body?.sourceCommit, workerBuildSha: body?.workerBuildSha,
      policyHash: body?.policyHash, policyKey: body?.policyKey });
    const readyIdentity = (body) => {
      const trust = body?.recoveryTrustedIngress || body?.trustedIngress || {};
      return { upstreamSourceCommit: body?.upstreamSourceCommit, policyHash: body?.policyHash,
        key_id: trust.key_id, public_key: trust.public_key, policy_hash: trust.policy_hash,
        deployment_sha: trust.deployment_sha };
    };
    const publicHealthRestored = health.ok && previousHealth?.ok && health.body?.ok === true
      && stableJson(healthIdentity(health.body)) === stableJson(healthIdentity(previousHealth.body));
    const publicTrustRestored = ready.ok && previousReady?.ok && ready.body?.ok === true
      && stableJson(readyIdentity(ready.body)) === stableJson(readyIdentity(previousReady.body));
    return { attempted: true, api_restore_ok: true, deployment_readback_ok: deploymentReadbackOk,
      public_health_restored: publicHealthRestored, public_trust_restored: publicTrustRestored,
      rollback_verified: deploymentReadbackOk && publicHealthRestored && publicTrustRestored,
      previous_deployment_id: previousDeployment.id, secrets_included: false };
  }
  if (scriptExistedBefore !== false) return { attempted: false, rollback_verified: false, manual_recovery_required: true, secrets_included: false };
  const response = await client.request({ apiPath: `/accounts/${accountId}/workers/scripts/${scriptName}`, method: "DELETE" });
  const readback = await client.request({ apiPath: `/accounts/${accountId}/workers/scripts/${scriptName}`, method: "GET" });
  return { attempted: true, rollback_verified: (response?.ok === true || Number(response?.status) === 404) && Number(readback?.status) === 404,
    mode: "restore_proven_script_absence", secrets_included: false };
}

export async function buildStagingActivationGatewayApplyPlan(input = {}, deps = {}) {
  const registry = deps.registry || readEnvironmentConvergenceRegistry();
  const { gateway, target, binding_id: bindingId } = requiredProfile(registry);
  const pool = deps.runtimePool || deps.pool || null;
  const auth = deps.auth || {};
  const expectedSourceCommit = compact(input.expected_source_commit, 64).toLowerCase();
  const expectedPolicyHash = compact(input.expected_policy_hash, 64).toLowerCase();
  const actualSourceCommit = await canonicalRuntimeCommit(deps);
  const convergencePlanSha = compact(input.environment_convergence_plan_sha256, 64).toLowerCase();
  if (!SHA256_RE.test(convergencePlanSha)) throw adapterError("staging_activation_gateway_convergence_plan_invalid", "Exact acknowledged environment convergence plan SHA-256 is required.");
  if (!SHA_RE.test(expectedSourceCommit)) throw adapterError("staging_activation_gateway_expected_commit_invalid", "An exact 40-character expected_source_commit is required.");
  if (!SHA_RE.test(actualSourceCommit) || expectedSourceCommit !== actualSourceCommit) throw adapterError("staging_activation_gateway_runtime_commit_mismatch", "Server release commit cannot be proven equal to the execution plan.", 409);
  if (!SHA256_RE.test(expectedPolicyHash) || expectedPolicyHash !== compact(gateway.expected_policy_hash).toLowerCase()) throw adapterError("staging_activation_gateway_expected_policy_hash_mismatch", "expected_policy_hash must match the Staging profile.", 409);
  const binding = await resolveServerResourceBinding(pool, bindingId);
  assertCallerCannotSelectTarget(input, binding);
  const workspace = await resolveWorkspace(pool, auth, input);
  const bundle = await buildStagingActivationGatewayBundle({ sourceSha: expectedSourceCommit, repositoryRoot: deps.repositoryRoot, lifetimeHours: deps.lifetimeHours, now: deps.now });
  if (bundle.policy_hash !== expectedPolicyHash) throw adapterError("staging_activation_gateway_built_policy_hash_mismatch", "Built Staging Gateway policy does not match the exact environment profile.", 409);
  const bundleSha = sha256(stableJson({ files: bundle.files, worker_secrets: bundle.worker_secrets, origin_trust: bundle.origin_trust }));
  const secretSetSha = sha256(stableJson(bundle.worker_secrets));
  const planId = crypto.randomUUID();
  const planBody = { contract: "mad4b.staging.activation-gateway-execution-plan.v1", plan_id: planId,
    environment_convergence_plan_sha256: convergencePlanSha, expected_source_commit: expectedSourceCommit,
    expected_policy_hash: expectedPolicyHash, resource_binding_id: binding.binding_id,
    workspace_id: workspace?.workspace_id || null, account_id: binding.account_id, script_name: binding.script_name,
    bundle_sha256: bundleSha, secret_set_sha256: secretSetSha,
    trust_key_id: bundle.origin_trust.key_id, trust_public_key_sha256: sha256(bundle.origin_trust.public_key),
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString() };
  const planSha = sha256(stableJson(planBody));
  const client = deps.cloudflareClient || createCloudflareApiClient({ fetchImpl: deps.fetchImpl, token: (deps.env || process.env).CLOUDFLARE_API_TOKEN, timeoutMs: deps.cloudflareTimeoutMs });
  const featureEnabled = truthy((deps.env || process.env).STAGING_ACTIVATION_GATEWAY_APPLY_ENABLED);
  const checks = [
    { key: "profile_bound", ok: true },
    { key: "server_resource_binding_valid", ok: true },
    { key: "workspace_resolved", ok: Boolean(workspace?.workspace_id) },
    { key: "cloudflare_token_present_server_side", ok: Boolean(client.token_present ?? (deps.env || process.env).CLOUDFLARE_API_TOKEN) },
    { key: "staging_apply_feature_gate_enabled", ok: featureEnabled },
    { key: "exact_policy_hash", ok: bundle.policy_hash === expectedPolicyHash },
    { key: "exact_source_commit", ok: bundle.source_sha === expectedSourceCommit },
  ].map((item) => ({ ...item, secrets_included: false }));
  return {
    ok: true,
    tool: "activation_gateway_dark_deploy",
    adapter: "staging_activation_gateway_profile_apply",
    mode: "dry_run",
    environment: "staging",
    classification: checks.every((check) => check.ok) ? "staging_activation_gateway_apply_ready" : "staging_activation_gateway_apply_blocked",
    apply_ready: checks.every((check) => check.ok),
    ...planBody,
    plan_sha256: planSha,
    envelope_binding: { binding_sha256: planSha, capability_sha256: convergencePlanSha },
    bundle_ref: `staging-gateway:${planId}`,
    expected_source_commit: expectedSourceCommit,
    expected_policy_hash: expectedPolicyHash,
    profile_binding: {
      policy_key: gateway.policy_key,
      public_host: gateway.public_host,
      expected_policy_hash: gateway.expected_policy_hash,
      execution_target: target,
    },
    resource_binding: binding,
    workspace: workspace ? { workspace_id: workspace.workspace_id, workspace_key: workspace.workspace_key, workspace_type: workspace.workspace_type } : null,
    required_confirmation: `DEPLOY_STAGING_GATEWAY_${expectedSourceCommit.slice(0, 12).toUpperCase()}_${planSha.slice(0, 12).toUpperCase()}`,
    required_capability: {
      app_key: "cloudflare",
      capability_key: STAGING_CAPABILITY_KEY,
      operation_intent: STAGING_OPERATION_INTENT,
      runtime_surface: STAGING_RUNTIME_SURFACE,
      capability_envelope_required_for_apply: true,
      operator_acknowledgement_required_for_handoff: true,
      operator_acknowledgement_is_execution_authority: false,
      typed_confirmation_required_for_apply: true,
      approval_required_for_apply: false,
    },
    checks,
    trust_bundle_contract: bundle.origin_trust.contract,
    provider_target_caller_selectable: false,
    provider_credentials_returned: false,
    workflow_dispatch: false,
    staging_certification_ready: false,
    production_mutation: false,
    business_database_mutation: false,
    schema_mutation: false,
    governance_state_mutation: false,
    database_mutation: false,
    secrets_included: false,
    ...(deps.includeInternal === true ? { _internal: { bundle, client, workspace }, _planBody: planBody } : {}),
  };
}

export async function runStagingActivationGatewayApply(input = {}, deps = {}) {
  const mode = compact(input.mode || "dry_run", 16).toLowerCase();
  if (!["dry_run", "apply"].includes(mode)) throw adapterError("staging_activation_gateway_mode_invalid", "mode must be dry_run or apply.");
  const runtimePool = deps.runtimePool || deps.pool;
  const governancePool = deps.governancePool;
  if (!governancePool) throw adapterError("staging_activation_gateway_governance_database_required", "Dedicated Governance DB writer is required.", 503);
  const env = deps.env || process.env;
  if (mode === "dry_run") {
    const plan = await buildStagingActivationGatewayApplyPlan(input, { ...deps, includeInternal: true });
    const { _internal, _planBody, ...publicPlan } = plan;
    if (plan.apply_ready) await saveStagingGatewayExecutionPlan(governancePool, plan, _internal.bundle, { env });
    return { ...publicPlan, mode, execution: { will_execute: false, executed: false }, governance_state_mutation: plan.apply_ready };
  }
  const planId = compact(input.plan_id, 36);
  const planSha = compact(input.plan_sha256, 64).toLowerCase();
  const convergencePlanSha = compact(input.environment_convergence_plan_sha256, 64).toLowerCase();
  if (!/^[a-f0-9-]{36}$/u.test(planId) || !SHA256_RE.test(planSha) || !SHA256_RE.test(convergencePlanSha)) {
    throw adapterError("staging_activation_gateway_plan_identity_invalid", "Exact plan ID, plan SHA-256, and acknowledged convergence plan SHA-256 are required.");
  }
  const { row, bundle } = await loadStagingGatewayExecutionPlan(governancePool, { planId, planSha256: planSha, convergencePlanSha256: convergencePlanSha, env });
  const planBody = parseJson(row.plan_body_json);
  if (!planBody || sha256(stableJson(planBody)) !== planSha || planBody.plan_id !== planId
    || planBody.contract !== "mad4b.staging.activation-gateway-execution-plan.v1"
    || row.bundle_ref !== `staging-gateway:${planId}`
    || new Date(planBody.expires_at).getTime() !== new Date(row.expires_at).getTime()
    || planBody.environment_convergence_plan_sha256 !== convergencePlanSha
    || planBody.expected_source_commit !== row.expected_source_commit
    || planBody.expected_policy_hash !== row.expected_policy_hash
    || planBody.resource_binding_id !== row.resource_binding_id
    || planBody.workspace_id !== row.workspace_id
    || planBody.bundle_sha256 !== row.bundle_sha256 || planBody.secret_set_sha256 !== row.secret_set_sha256
    || planBody.trust_key_id !== row.trust_key_id || planBody.trust_public_key_sha256 !== row.trust_public_key_sha256) {
    throw adapterError("staging_activation_gateway_stale_plan", "Stored execution plan identity differs from its exact digest.", 409);
  }
  const registry = deps.registry || readEnvironmentConvergenceRegistry();
  const { gateway, binding_id: bindingId } = requiredProfile(registry);
  const binding = await resolveServerResourceBinding(runtimePool, bindingId);
  assertCallerCannotSelectTarget(input, binding);
  const auth = deps.auth || {};
  const workspace = await resolveWorkspace(runtimePool, auth, input);
  const expectedSourceCommit = compact(input.expected_source_commit, 64).toLowerCase();
  const expectedPolicyHash = compact(input.expected_policy_hash, 64).toLowerCase();
  const actualSourceCommit = await canonicalRuntimeCommit(deps);
  const bundleSha = sha256(stableJson({ files: bundle.files, worker_secrets: bundle.worker_secrets, origin_trust: bundle.origin_trust }));
  if (!SHA_RE.test(actualSourceCommit) || actualSourceCommit !== row.expected_source_commit
    || !workspace?.workspace_id || row.workspace_id !== workspace.workspace_id || row.resource_binding_id !== binding.binding_id
    || row.expected_source_commit !== expectedSourceCommit || row.expected_policy_hash !== expectedPolicyHash
    || row.expected_policy_hash !== compact(gateway.expected_policy_hash).toLowerCase()
    || bundle.source_sha !== row.expected_source_commit || bundle.policy_hash !== row.expected_policy_hash
    || row.bundle_sha256 !== bundleSha || row.secret_set_sha256 !== sha256(stableJson(bundle.worker_secrets))
    || row.trust_key_id !== bundle.origin_trust.key_id || row.trust_public_key_sha256 !== sha256(bundle.origin_trust.public_key)) {
    throw adapterError("staging_activation_gateway_stale_plan", "Stored execution artifact differs from current Staging authority or digest.", 409);
  }
  const requiredConfirmation = `DEPLOY_STAGING_GATEWAY_${expectedSourceCommit.slice(0, 12).toUpperCase()}_${planSha.slice(0, 12).toUpperCase()}`;
  if (compact(input.confirm, 128) !== requiredConfirmation) throw adapterError("staging_activation_gateway_confirmation_mismatch", "Typed confirmation does not match the exact execution plan.", 403, { expected_confirmation: requiredConfirmation });
  const plan = { plan_id: planId, plan_sha256: planSha, environment_convergence_plan_sha256: convergencePlanSha,
    envelope_binding: { binding_sha256: planSha, capability_sha256: convergencePlanSha },
    expected_source_commit: expectedSourceCommit, expected_policy_hash: expectedPolicyHash,
    profile_binding: { public_host: gateway.public_host }, resource_binding: binding,
    workspace: { workspace_id: workspace.workspace_id }, required_confirmation: requiredConfirmation,
    bundle_sha256: row.bundle_sha256, secret_set_sha256: row.secret_set_sha256 };
  const publicPlan = { ...plan };
  if (typeof deps.audit !== "function") throw adapterError("staging_activation_gateway_audit_required", "Durable audit sink is required before provider mutation.", 503);
  if (!truthy(env.STAGING_ACTIVATION_GATEWAY_APPLY_ENABLED)) throw adapterError("staging_activation_gateway_apply_disabled", "Staging apply feature gate is disabled.", 403);
  const nonce = compact(input.execution_nonce, 128);
  if (!SAFE_NONCE_RE.test(nonce)) throw adapterError("staging_activation_gateway_execution_nonce_invalid", "Apply requires execution_nonce with 8 to 128 safe characters.");
  const envelope = await assertEnvelopeForApply({ runtimePool, governancePool, auth, input, expectedCommitSha: plan.expected_source_commit, workspaceId: workspace.workspace_id, plan });
  const executionRef = `staging-activation-gateway:${nonce}`.slice(0, 191);
  const executionNonceSha256 = sha256(nonce);
  await claimStagingGatewayExecutionPlan(governancePool, { planId, planSha256: planSha, convergencePlanSha256: convergencePlanSha });

  const client = deps.cloudflareClient || createCloudflareApiClient({ fetchImpl: deps.fetchImpl, token: env.CLOUDFLARE_API_TOKEN, timeoutMs: deps.cloudflareTimeoutMs });
  const accountId = plan.resource_binding.account_id;
  const scriptName = plan.resource_binding.script_name;
  const fetchImpl = deps.smokeFetch || deps.fetchImpl || globalThis.fetch;
  let writesStarted = false;
  let previousDeployment = null;
  let scriptExistedBefore = null;
  let previousHealth = null;
  let previousReady = null;
  let envelopeClaimed = false;
  let rollbackResult = null;
  try {
    const referenced = await markCapabilityEnvelopeReferenced({ writerPool: governancePool, envelopeId: envelope.envelope_id, executionRef });
    if (!referenced.ok) throw adapterError("staging_activation_gateway_capability_envelope_reference_failed", "Capability envelope reference could not be persisted.", 409);
    envelopeClaimed = true;
    await transitionStagingGatewayExecutionPlan(governancePool, planId, "claimed", "executing");
    await deps.audit({ action: "activation_gateway.staging_apply.intent", resource_type: "cloudflare_worker", resource_id: scriptName,
      payload: { plan_id: planId, plan_sha256: planSha, environment_convergence_plan_sha256: convergencePlanSha,
        capability_envelope_id: envelope.envelope_id, resource_binding_id: binding.binding_id,
        expected_source_commit: expectedSourceCommit, expected_policy_hash: expectedPolicyHash,
        bundle_sha256: row.bundle_sha256, secret_set_sha256: row.secret_set_sha256,
        execution_nonce_sha256: executionNonceSha256, provider_mutation_performed: false, secrets_included: false } });
    const scriptBefore = await client.request({ apiPath: `/accounts/${accountId}/workers/scripts/${scriptName}`, method: "GET" });
    if (scriptBefore?.ok) scriptExistedBefore = true;
    else if (Number(scriptBefore?.status) === 404) scriptExistedBefore = false;
    else throw adapterError("staging_activation_gateway_script_inventory_failed", "Pre-write script existence could not be proven.", 502);
    const deploymentsBefore = await providerRequest(client, { apiPath: `/accounts/${accountId}/workers/scripts/${scriptName}/deployments`, method: "GET" }, "inventory_read").catch((error) => {
      if (error?.details?.status === 404 && scriptExistedBefore === false) return { result: [] };
      throw error;
    });
    previousDeployment = deploymentList(deploymentsBefore)[0] || null;
    if (scriptExistedBefore && (!previousDeployment?.id || !deploymentVersions(previousDeployment).length)) {
      throw adapterError("staging_activation_gateway_previous_deployment_unresolved", "Existing Worker has no exact previous deployment to restore.", 409);
    }
    if (previousDeployment) {
      previousHealth = await readPublicJson(fetchImpl, `https://${plan.profile_binding.public_host}/health`, deps.smokeTimeoutMs);
      previousReady = await readPublicJson(fetchImpl, `https://${plan.profile_binding.public_host}/ready`, deps.smokeTimeoutMs);
      const previousTrust = previousReady.body?.recoveryTrustedIngress || previousReady.body?.trustedIngress;
      if (!previousHealth.ok || !previousReady.ok
        || !SHA_RE.test(compact(previousHealth.body?.sourceCommit, 40).toLowerCase())
        || !SHA256_RE.test(compact(previousHealth.body?.policyHash, 64).toLowerCase())
        || !SHA_RE.test(compact(previousReady.body?.upstreamSourceCommit, 40).toLowerCase())
        || !compact(previousTrust?.key_id, 191) || !compact(previousTrust?.public_key, 4096)) {
        throw adapterError("staging_activation_gateway_previous_public_state_unresolved", "Previous public health and trust identity must be captured before provider mutation.", 409);
      }
    }
    writesStarted = true;
    const version = await providerRequest(client, { apiPath: `/accounts/${accountId}/workers/scripts/${scriptName}/versions`, method: "POST", formData: buildUploadForm(bundle, plan) }, "version_upload");
    const candidateVersionId = compact(version?.result?.id || version?.result?.version?.id, 191);
    if (!candidateVersionId) throw adapterError("staging_activation_gateway_candidate_version_missing", "Version Upload did not return an exact candidate version ID.", 502);
    await providerRequest(client, { apiPath: `/accounts/${accountId}/workers/scripts/${scriptName}/deployments`, method: "POST",
      body: { strategy: "percentage", versions: [{ version_id: candidateVersionId, percentage: 100 }] } }, "version_deploy");
    const deploymentsAfter = await providerRequest(client, { apiPath: `/accounts/${accountId}/workers/scripts/${scriptName}/deployments`, method: "GET" }, "deployment_readback");
    const currentDeployment = deploymentList(deploymentsAfter)[0] || null;
    if (!currentDeployment?.id || deploymentVersions(currentDeployment).length !== 1
      || deploymentVersions(currentDeployment)[0].version_id !== candidateVersionId
      || deploymentVersions(currentDeployment)[0].percentage !== 100) {
      throw adapterError("staging_activation_gateway_deployment_readback_missing", "Deployment readback did not prove the exact candidate version at 100%.", 502);
    }

    const health = await readPublicJson(fetchImpl, `https://${plan.profile_binding.public_host}/health`, deps.smokeTimeoutMs);
    const ready = await readPublicJson(fetchImpl, `https://${plan.profile_binding.public_host}/ready`, deps.smokeTimeoutMs);
    const healthOk = health.ok && health.body?.ok === true && health.body?.stale === false
      && compact(health.body?.sourceCommit, 64).toLowerCase() === plan.expected_source_commit
      && compact(health.body?.workerBuildSha, 64).toLowerCase() === plan.expected_source_commit
      && compact(health.body?.policyHash, 64).toLowerCase() === plan.expected_policy_hash
      && health.body?.policyKey === "activation_gateway_staging";
    const trust = ready.body?.recoveryTrustedIngress || ready.body?.trustedIngress || null;
    const trustOk = ready.ok && ready.body?.ok === true
      && compact(ready.body?.policyHash, 64).toLowerCase() === plan.expected_policy_hash
      && compact(ready.body?.upstreamSourceCommit, 64).toLowerCase() === plan.expected_source_commit
      && trust?.contract === bundle.origin_trust.contract
      && compact(trust?.deployment_sha, 64).toLowerCase() === plan.expected_source_commit
      && trust?.policy_hash === plan.expected_policy_hash
      && trust?.key_id === bundle.origin_trust.key_id
      && trust?.public_key === bundle.origin_trust.public_key
      && trust?.issuer === bundle.origin_trust.issuer
      && trust?.audience === bundle.origin_trust.audience
      && trust?.canonical_host === bundle.origin_trust.canonical_host
      && trust?.secrets_included === false;
    if (!healthOk || !trustOk) throw adapterError("staging_activation_gateway_public_readback_failed", "Exact public Staging Gateway health/ready/trust readback failed.", 502, { health_status: health.status, health_ok: healthOk, ready_status: ready.status, ready_ok: trustOk });

    await deps.audit({
      action: "activation_gateway.staging_apply",
      resource_type: "cloudflare_worker",
      resource_id: scriptName,
      payload: { plan_id: planId, plan_sha256: planSha, environment_convergence_plan_sha256: convergencePlanSha,
        binding_id: plan.resource_binding.binding_id, deployment_id: currentDeployment.id, candidate_version_id: candidateVersionId,
        source_commit: plan.expected_source_commit, policy_hash: plan.expected_policy_hash,
        capability_envelope_id: envelope.envelope_id, execution_nonce_sha256: executionNonceSha256,
        production_mutation: false, business_database_mutation: false, governance_state_mutation: true, secrets_included: false },
    });
    await transitionStagingGatewayExecutionPlan(governancePool, planId, "executing", "succeeded");
    const consumed = await transitionCapabilityEnvelopeLifecycle({ writerPool: governancePool, envelopeId: envelope.envelope_id, action: "consume", executionRef });
    if (!consumed.ok) throw adapterError("staging_activation_gateway_capability_envelope_finalize_failed", "Capability envelope consumption could not be persisted.", 500);
    return {
      ...publicPlan,
      mode: "apply",
      classification: "staging_activation_gateway_apply_succeeded",
      execution: { will_execute: true, executed: true },
      deployment: { deployment_id: currentDeployment.id, version_id: candidateVersionId, source_commit: plan.expected_source_commit, policy_hash: plan.expected_policy_hash, public_host: plan.profile_binding.public_host },
      recovery_trust_bundle: bundle.origin_trust,
      readback: { health: { status: health.status, ok: healthOk }, ready: { status: ready.status, ok: trustOk } },
      rollback: { required: false, previous_deployment_id: previousDeployment?.id || null },
      provider_target_caller_selectable: false,
      provider_credentials_returned: false,
      workflow_dispatch: false,
      staging_certification_ready: false,
      production_mutation: false,
      database_mutation: false,
      business_database_mutation: false,
      schema_mutation: false,
      governance_state_mutation: true,
      provider_mutation: true,
      secrets_included: false,
    };
  } catch (error) {
    if (writesStarted) {
      try { rollbackResult = await rollback({ client, accountId, scriptName, previousDeployment, scriptExistedBefore, previousHealth, previousReady, fetchImpl, publicHost: plan.profile_binding.public_host, timeoutMs: deps.smokeTimeoutMs }); }
      catch (rollbackError) { rollbackResult = { ok: false, error: compact(rollbackError?.message, 300), secrets_included: false }; }
    }
    let failureAuditError = null;
    try {
      await deps.audit({ action: "activation_gateway.staging_apply_failed", resource_type: "cloudflare_worker", resource_id: scriptName,
        payload: { plan_id: planId, plan_sha256: planSha, environment_convergence_plan_sha256: convergencePlanSha,
          capability_envelope_id: envelope.envelope_id, error_code: error?.code || "staging_activation_gateway_apply_failed",
          rollback_verified: rollbackResult?.rollback_verified === true, provider_write_attempted: writesStarted,
          secrets_included: false } });
    } catch (failure) { failureAuditError = compact(failure?.message, 300); }
    let planFailure = null;
    try {
      const [current] = await governancePool.query(`SELECT status FROM staging_activation_gateway_execution_plans WHERE plan_id=?`, [planId]);
      if (current?.[0]?.status === "executing" || current?.[0]?.status === "claimed" || current?.[0]?.status === "succeeded")
        await transitionStagingGatewayExecutionPlan(governancePool, planId, current[0].status, "failed");
    } catch (failure) { planFailure = compact(failure?.message, 300); }
    let envelopeFailure = null;
    if (envelopeClaimed) try { const cancelled = await transitionCapabilityEnvelopeLifecycle({ writerPool: governancePool, envelopeId: envelope.envelope_id, action: "cancel", executionRef, reason: "staging_apply_failed" });
    if (!cancelled.ok) throw adapterError("staging_activation_gateway_capability_envelope_finalize_failed", "Capability envelope cancellation could not be persisted.", 500); }
    catch (failure) { envelopeFailure = compact(failure?.message, 300); }
    throw adapterError(error?.code || "staging_activation_gateway_apply_failed", error?.message || "Staging Activation Gateway apply failed.", error?.status || 502,
      { ...(error?.details || {}), rollback: rollbackResult, rollback_verified: rollbackResult?.rollback_verified === true,
        plan_finalize_error: planFailure, envelope_finalize_error: envelopeFailure,
        failure_audit_error: failureAuditError, replay_blocked: true });
  }
}

export const _testingStagingGatewayTransaction = Object.freeze({ buildUploadForm, rollback, deploymentVersions });
