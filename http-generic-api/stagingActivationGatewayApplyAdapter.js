import crypto from "node:crypto";
import { createCloudflareApiClient } from "./activationGatewayRolloutTool.js";
import { buildStagingActivationGatewayBundle } from "./stagingActivationGatewayBundle.js";
import { readEnvironmentConvergenceRegistry } from "./environmentConvergenceRegistry.js";
import {
  capabilityEnvelopeError,
  resolveCapabilityExecutionEnvelope,
} from "./capabilityResolutionEnvelopeGuard.js";

const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000";
const SHA_RE = /^[a-f0-9]{40}$/u;
const SHA256_RE = /^[a-f0-9]{64}$/u;
const SAFE_NONCE_RE = /^[A-Za-z0-9._:-]{8,128}$/u;
const STAGING_POLICY_HASH = "c6468e051b8456d4d3ffc6478cdb98f7048b69c8ca6742f4dca27e1eb4023f32";
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
  if (compact(gateway?.expected_policy_hash).toLowerCase() !== STAGING_POLICY_HASH) errors.push("policy_hash");
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
  if (!pool || !auth?.user_id) return null;
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

async function assertEnvelopeForApply({ pool, auth, input, expectedCommitSha, workspaceId }) {
  const envelope = await resolveCapabilityExecutionEnvelope({
    pool,
    envelopeId: input.capability_envelope_id,
    source: input,
    acceptedAppKeys: ["cloudflare"],
    acceptedIntents: [STAGING_OPERATION_INTENT],
    expectedTenantId: auth?.tenant_id || PLATFORM_TENANT_ID,
    expectedUserId: auth?.user_id || "",
    expectedCommitSha,
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
  const [rows] = await pool.query(
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
  const [certRows] = await pool.query(
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
  if (!certRows?.[0]) throw adapterError("staging_activation_gateway_dispatch_certification_missing", "Staging Activation Gateway apply certification is missing or expired.", 403);
  return { ...envelope, certification: certRows[0] };
}

async function claimEnvelope(pool, envelopeId, executionRef) {
  const [result] = await pool.query(
    `UPDATE capability_resolution_envelope_ledger
        SET execution_status='referenced', execution_ref=?, updated_at=NOW()
      WHERE envelope_id=?
        AND execution_status='not_executed'
        AND (execution_ref IS NULL OR execution_ref='')`,
    [executionRef, envelopeId],
  );
  if (Number(result?.affectedRows || 0) !== 1) throw adapterError("staging_activation_gateway_capability_envelope_replay_blocked", "Capability envelope was already claimed, consumed, failed, or cancelled.", 409, { envelope_id: envelopeId, replay_blocked: true });
}

async function finalizeEnvelope(pool, envelopeId, executionRef, status) {
  const [result] = await pool.query(
    `UPDATE capability_resolution_envelope_ledger
        SET execution_status=?, execution_ref=?, updated_at=NOW()
      WHERE envelope_id=? AND execution_status='referenced' AND execution_ref=?`,
    [status, executionRef, envelopeId, executionRef],
  );
  if (Number(result?.affectedRows || 0) !== 1) throw adapterError("staging_activation_gateway_capability_envelope_finalize_failed", "Capability envelope final state could not be persisted.", 500, { envelope_id: envelopeId, execution_status: status });
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
  if (!response?.ok) throw adapterError(`staging_activation_gateway_${label}_failed`, `Staging Activation Gateway ${label.replaceAll("_", " ")} failed.`, 502, { status: Number(response?.status || 0), errors: Array.isArray(response?.errors) ? response.errors.slice(0, 5) : [] });
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

function buildUploadForm(bundle, compatibilityDate = "2026-08-31") {
  const formData = new FormData();
  formData.append("metadata", new Blob([JSON.stringify({ main_module: "worker-staging.mjs", compatibility_date: compatibilityDate })], { type: "application/json" }), "metadata.json");
  for (const file of bundle.files) formData.append(file.name, new Blob([file.content], { type: file.type }), file.name);
  return formData;
}

async function rollback({ client, accountId, scriptName, previousDeployment }) {
  if (previousDeployment?.id && deploymentVersions(previousDeployment).length) {
    const response = await client.request({ apiPath: `/accounts/${accountId}/workers/scripts/${scriptName}/deployments`, method: "POST", body: { strategy: "percentage", versions: deploymentVersions(previousDeployment) } });
    return { ok: response?.ok === true, mode: "restore_previous_deployment_versions", previous_deployment_id: previousDeployment.id, secrets_included: false };
  }
  const response = await client.request({ apiPath: `/accounts/${accountId}/workers/scripts/${scriptName}`, method: "DELETE" });
  return { ok: response?.ok === true || Number(response?.status) === 404, mode: "delete_new_unrouted_script", secrets_included: false };
}

export async function buildStagingActivationGatewayApplyPlan(input = {}, deps = {}) {
  const registry = deps.registry || readEnvironmentConvergenceRegistry();
  const { gateway, target, binding_id: bindingId } = requiredProfile(registry);
  const pool = deps.pool || null;
  const auth = deps.auth || {};
  const expectedSourceCommit = compact(input.expected_source_commit, 64).toLowerCase();
  const expectedPolicyHash = compact(input.expected_policy_hash, 64).toLowerCase();
  if (!SHA_RE.test(expectedSourceCommit)) throw adapterError("staging_activation_gateway_expected_commit_invalid", "An exact 40-character expected_source_commit is required.");
  if (!SHA256_RE.test(expectedPolicyHash) || expectedPolicyHash !== compact(gateway.expected_policy_hash).toLowerCase()) throw adapterError("staging_activation_gateway_expected_policy_hash_mismatch", "expected_policy_hash must match the Staging profile.", 409);
  const binding = await resolveServerResourceBinding(pool, bindingId);
  assertCallerCannotSelectTarget(input, binding);
  const workspace = await resolveWorkspace(pool, auth, input);
  const bundle = await buildStagingActivationGatewayBundle({ sourceSha: expectedSourceCommit, repositoryRoot: deps.repositoryRoot, lifetimeHours: deps.lifetimeHours, now: deps.now });
  if (bundle.policy_hash !== expectedPolicyHash) throw adapterError("staging_activation_gateway_built_policy_hash_mismatch", "Built Staging Gateway policy does not match the exact environment profile.", 409);
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
    required_confirmation: `DEPLOY_STAGING_ACTIVATION_GATEWAY_${expectedPolicyHash.slice(0, 12).toUpperCase()}`,
    required_capability: {
      app_key: "cloudflare",
      capability_key: STAGING_CAPABILITY_KEY,
      operation_intent: STAGING_OPERATION_INTENT,
      runtime_surface: STAGING_RUNTIME_SURFACE,
      capability_envelope_required_for_apply: true,
      approval_required_for_apply: true,
    },
    checks,
    trust_bundle_contract: bundle.origin_trust.contract,
    provider_target_caller_selectable: false,
    provider_credentials_returned: false,
    workflow_dispatch: false,
    production_mutation: false,
    database_mutation: false,
    secrets_included: false,
    ...(deps.includeInternal === true ? { _internal: { bundle, client, workspace } } : {}),
  };
}

export async function runStagingActivationGatewayApply(input = {}, deps = {}) {
  const mode = compact(input.mode || "dry_run", 16).toLowerCase();
  if (!["dry_run", "apply"].includes(mode)) throw adapterError("staging_activation_gateway_mode_invalid", "mode must be dry_run or apply.");
  const plan = await buildStagingActivationGatewayApplyPlan(input, { ...deps, includeInternal: true });
  const publicPlan = { ...plan };
  delete publicPlan._internal;
  if (mode === "dry_run") return { ...publicPlan, mode, execution: { will_execute: false, executed: false } };
  if (!plan.apply_ready) throw adapterError("staging_activation_gateway_apply_not_ready", "Staging Activation Gateway apply plan is not ready.", 409, { failed_checks: plan.checks.filter((check) => !check.ok).map((check) => check.key) });
  if (compact(input.confirm, 128) !== plan.required_confirmation) throw adapterError("staging_activation_gateway_confirmation_mismatch", "Typed confirmation does not match the Staging policy hash.", 403, { expected_confirmation: plan.required_confirmation });
  const nonce = compact(input.execution_nonce, 128);
  if (!SAFE_NONCE_RE.test(nonce)) throw adapterError("staging_activation_gateway_execution_nonce_invalid", "Apply requires execution_nonce with 8 to 128 safe characters.");
  const pool = deps.pool;
  const auth = deps.auth || {};
  const workspaceId = plan.workspace?.workspace_id || compact(input.workspace_id, 64);
  const envelope = await assertEnvelopeForApply({ pool, auth, input, expectedCommitSha: plan.expected_source_commit, workspaceId });
  const executionRef = `staging-activation-gateway:${nonce}`.slice(0, 191);
  const executionNonceSha256 = sha256(nonce);
  await claimEnvelope(pool, envelope.envelope_id, executionRef);

  const bundle = plan._internal.bundle;
  const client = plan._internal.client;
  const accountId = plan.resource_binding.account_id;
  const scriptName = plan.resource_binding.script_name;
  const fetchImpl = deps.smokeFetch || deps.fetchImpl || globalThis.fetch;
  let writesStarted = false;
  let previousDeployment = null;
  let rollbackResult = null;
  try {
    const deploymentsBefore = await providerRequest(client, { apiPath: `/accounts/${accountId}/workers/scripts/${scriptName}/deployments`, method: "GET" }, "inventory_read").catch((error) => {
      if (error?.details?.status === 404) return { result: [] };
      throw error;
    });
    previousDeployment = deploymentList(deploymentsBefore)[0] || null;
    await providerRequest(client, { apiPath: `/accounts/${accountId}/workers/scripts/${scriptName}`, method: "PUT", formData: buildUploadForm(bundle) }, "worker_upload");
    writesStarted = true;
    for (const [name, value] of Object.entries(bundle.worker_secrets)) {
      await providerRequest(client, { apiPath: `/accounts/${accountId}/workers/scripts/${scriptName}/secrets`, method: "PUT", body: { name, text: String(value), type: "secret_text" } }, "worker_secret_write");
    }
    const deploymentsAfter = await providerRequest(client, { apiPath: `/accounts/${accountId}/workers/scripts/${scriptName}/deployments`, method: "GET" }, "deployment_readback");
    const currentDeployment = deploymentList(deploymentsAfter)[0] || null;
    if (!currentDeployment?.id) throw adapterError("staging_activation_gateway_deployment_readback_missing", "Cloudflare deployment readback did not return a deployment ID.", 502);

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

    await deps.audit?.({
      action: "activation_gateway.staging_apply",
      resource_type: "cloudflare_worker",
      resource_id: scriptName,
      payload: { binding_id: plan.resource_binding.binding_id, deployment_id: currentDeployment.id, source_commit: plan.expected_source_commit, policy_hash: plan.expected_policy_hash, capability_envelope_id: envelope.envelope_id, execution_nonce_sha256: executionNonceSha256, production_mutation: false, database_mutation: false, secrets_included: false },
    });
    await finalizeEnvelope(pool, envelope.envelope_id, executionRef, "executed");
    return {
      ...publicPlan,
      mode: "apply",
      classification: "staging_activation_gateway_apply_succeeded",
      execution: { will_execute: true, executed: true },
      deployment: { deployment_id: currentDeployment.id, source_commit: plan.expected_source_commit, policy_hash: plan.expected_policy_hash, public_host: plan.profile_binding.public_host },
      recovery_trust_bundle: bundle.origin_trust,
      readback: { health: { status: health.status, ok: healthOk }, ready: { status: ready.status, ok: trustOk } },
      rollback: { required: false, previous_deployment_id: previousDeployment?.id || null },
      provider_target_caller_selectable: false,
      provider_credentials_returned: false,
      workflow_dispatch: false,
      production_mutation: false,
      database_mutation: false,
      secrets_included: false,
    };
  } catch (error) {
    if (writesStarted) {
      try { rollbackResult = await rollback({ client, accountId, scriptName, previousDeployment }); }
      catch (rollbackError) { rollbackResult = { ok: false, error: compact(rollbackError?.message, 300), secrets_included: false }; }
    }
    try { await finalizeEnvelope(pool, envelope.envelope_id, executionRef, "failed"); } catch {}
    throw adapterError(error?.code || "staging_activation_gateway_apply_failed", error?.message || "Staging Activation Gateway apply failed.", error?.status || 502, { ...(error?.details || {}), rollback: rollbackResult, replay_blocked: true });
  }
}
