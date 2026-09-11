import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  capabilityEnvelopeError,
  resolveCapabilityExecutionEnvelope,
} from "./capabilityResolutionEnvelopeGuard.js";
import {
  policyHash,
  verifyDeploymentAttestation,
} from "./activationGatewayAttestation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_BUNDLE_ROOT = path.resolve(__dirname, "activation-gateway-runtime");
const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000";

export const ACTIVATION_GATEWAY_ROLLOUT_CONTRACT = Object.freeze({
  account_id_pattern: "^[a-f0-9]{32}$",
  script_name: "mad4b-activation-gateway",
  policy_path: "activation-gateway-runtime/generated/route-policy.json",
  worker_modules: Object.freeze([
    Object.freeze({ name: "src/worker.mjs", path: "src/worker.mjs", type: "application/javascript+module" }),
    Object.freeze({ name: "src/gateway.mjs", path: "src/gateway.mjs", type: "application/javascript+module" }),
    Object.freeze({ name: "generated/route-policy.json", path: "generated/route-policy.json", type: "application/json" }),
  ]),
  compatibility_date: "2026-06-25",
  capability_key: "admin_cloudflare_v1",
  operation_intent: "activation_gateway.dark_deploy",
  runtime_surface: "activation_gateway_dark_deploy",
  resource_binding_id: "8be421f5-49d3-4bda-a0f6-3cf8a04ee227",
  resource_type: "cloudflare_worker",
  feature_flag: "ACTIVATION_GATEWAY_DARK_DEPLOY_ENABLED",
  attestation_secret: "ACTIVATION_GATEWAY_DEPLOYMENT_ATTESTATION_JSON",
  public_key_secret: "ACTIVATION_GATEWAY_POLICY_PUBLIC_KEY_JWK",
  no_dns: true,
  no_custom_domain: true,
  secrets_included: false,
});

function compact(value, max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

function parseJson(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function truthy(value) {
  return ["1", "true", "yes", "on", "enabled"].includes(String(value ?? "").trim().toLowerCase());
}

function requireExecutionNonce(input = {}) {
  const key = compact(input.execution_nonce || input.executionNonce, 128);
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    throw rolloutError("activation_gateway_execution_nonce_invalid", "Apply requires execution_nonce with 8 to 128 safe characters.", 400);
  }
  return key;
}

function activationGatewayExecutionRef(executionNonce) {
  return `activation-gateway:${executionNonce}`.slice(0, 191);
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function rolloutError(code, message, status = 400, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.details = { ...details, secrets_included: false };
  return err;
}

function safeProviderFailure(response = {}) {
  const errors = Array.isArray(response.errors)
    ? response.errors.slice(0, 5).map((item) => ({ code: item?.code ?? null, message: compact(item?.message, 300) || null }))
    : [];
  return { status: Number(response.status || 0), errors, secrets_included: false };
}

function normalizeCloudflareEnvelope(status, parsed, rawText = "") {
  const success = parsed && typeof parsed === "object" && Object.prototype.hasOwnProperty.call(parsed, "success")
    ? parsed.success !== false
    : status >= 200 && status < 300;
  return {
    ok: status >= 200 && status < 300 && success,
    status,
    result: parsed && typeof parsed === "object" && Object.prototype.hasOwnProperty.call(parsed, "result") ? parsed.result : parsed,
    errors: Array.isArray(parsed?.errors) ? parsed.errors : [],
    messages: Array.isArray(parsed?.messages) ? parsed.messages : [],
    raw_present: !parsed && Boolean(rawText),
    secrets_included: false,
  };
}

export function createCloudflareApiClient({
  fetchImpl = globalThis.fetch,
  token = process.env.CLOUDFLARE_API_TOKEN,
  apiBase = "https://api.cloudflare.com/client/v4",
  timeoutMs = 30000,
} = {}) {
  if (typeof fetchImpl !== "function") throw rolloutError("cloudflare_fetch_unavailable", "Cloudflare fetch implementation is unavailable.", 500);
  return {
    token_present: Boolean(token),
    async request({ apiPath, method = "GET", body, formData, params } = {}) {
      const normalizedPath = compact(apiPath, 1000);
      const normalizedMethod = compact(method || "GET", 16).toUpperCase();
      if (!normalizedPath.startsWith("/accounts/")) {
        throw rolloutError("activation_gateway_cloudflare_path_not_allowed", "Activation Gateway rollout only permits account-scoped Workers API paths.", 400, { api_path: normalizedPath });
      }
      if (!token) throw rolloutError("cloudflare_token_missing", "CLOUDFLARE_API_TOKEN is not configured.", 503);
      const url = new URL(normalizedPath.replace(/^\/+/, ""), apiBase.endsWith("/") ? apiBase : `${apiBase}/`);
      for (const [key, value] of Object.entries(params || {})) {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs || 30000)));
      try {
        const headers = { Authorization: `Bearer ${token}` };
        const options = { method: normalizedMethod, headers, redirect: "manual", signal: controller.signal };
        if (formData) {
          options.body = formData;
        } else if (body !== undefined && normalizedMethod !== "GET" && normalizedMethod !== "HEAD") {
          headers["Content-Type"] = "application/json";
          options.body = JSON.stringify(body);
        }
        const response = await fetchImpl(url, options);
        const text = await response.text().catch(() => "");
        const parsed = parseJson(text, null);
        return normalizeCloudflareEnvelope(response.status, parsed, text);
      } catch (err) {
        if (err?.name === "AbortError") throw rolloutError("cloudflare_request_timeout", "Cloudflare request timed out.", 504, { method: normalizedMethod, api_path: normalizedPath });
        throw rolloutError("cloudflare_request_failed", "Cloudflare request failed.", 502, { method: normalizedMethod, api_path: normalizedPath, reason: compact(err?.message, 300) });
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

async function readGatewayBundle(bundleRoot = DEFAULT_BUNDLE_ROOT) {
  const files = [];
  for (const descriptor of ACTIVATION_GATEWAY_ROLLOUT_CONTRACT.worker_modules) {
    const absolutePath = path.join(bundleRoot, ...descriptor.path.split("/"));
    files.push({ ...descriptor, content: await fs.readFile(absolutePath, "utf8") });
  }
  const policyFile = files.find((item) => item.name === "generated/route-policy.json");
  const policy = parseJson(policyFile?.content, null);
  if (!policy) throw rolloutError("activation_gateway_policy_invalid", "Activation Gateway route policy is not valid JSON.", 500);
  const hash = crypto.createHash("sha256");
  for (const file of [...files].sort((left, right) => left.name.localeCompare(right.name))) {
    hash.update(file.name);
    hash.update("\0");
    hash.update(file.content.replace(/\r\n?/g, "\n"));
    hash.update("\0");
  }
  return { files, policy, bundle_hash_sha256: hash.digest("hex") };
}

export function activationGatewayTypedConfirmation(policyHashValue) {
  const hash = compact(policyHashValue, 64).toUpperCase();
  if (!/^[A-F0-9]{64}$/.test(hash)) throw rolloutError("activation_gateway_policy_hash_invalid", "A 64-character policy hash is required to derive typed confirmation.");
  return `DEPLOY_ACTIVATION_GATEWAY_${hash.slice(0, 12)}`;
}

export function buildActivationGatewayUploadForm(bundle, {
  compatibilityDate = ACTIVATION_GATEWAY_ROLLOUT_CONTRACT.compatibility_date,
  enforceHost = false,
} = {}) {
  const formData = new FormData();
  const metadata = {
    main_module: "src/worker.mjs",
    compatibility_date: compatibilityDate,
    bindings: [
      { type: "plain_text", name: "ACTIVATION_GATEWAY_ENFORCE_HOST", text: enforceHost ? "true" : "false" },
    ],
  };
  formData.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }), "metadata.json");
  for (const file of bundle.files) {
    formData.append(file.name, new Blob([file.content], { type: file.type }), file.name);
  }
  return { formData, metadata };
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

async function resolveResourceBinding(pool, auth = {}, input = {}, accountId, scriptName) {
  if (!pool) return { ok: false, status: "resource_binding_store_unavailable", binding_id: null, secrets_included: false };
  const bindingId = compact(input.resource_binding_id || ACTIVATION_GATEWAY_ROLLOUT_CONTRACT.resource_binding_id, 64);
  const [rows] = await pool.query(
    `SELECT binding_id, tenant_id, workspace_id, user_id, resource_type, resource_uri, resource_ref_json,
            recipe_key, permission_level, allowed_modes_json, authority_source, expires_at, status
       FROM platform_resource_authority_bindings
      WHERE binding_id=?
      LIMIT 1`,
    [bindingId],
  );
  const row = rows?.[0] || null;
  if (!row) return { ok: false, status: "activation_gateway_resource_binding_missing", binding_id: bindingId, secrets_included: false };
  const expectedUri = `cloudflare://accounts/${accountId}/workers/scripts/${scriptName}`;
  const modes = parseJson(row.allowed_modes_json, []);
  const tenantId = compact(auth.tenant_id || PLATFORM_TENANT_ID, 64);
  const workspaceId = compact(input.workspace_id, 64);
  const userId = compact(auth.user_id, 64);
  const checks = {
    active: row.status === "active" && (!row.expires_at || new Date(row.expires_at).getTime() > Date.now()),
    resource_type: row.resource_type === ACTIVATION_GATEWAY_ROLLOUT_CONTRACT.resource_type,
    resource_uri: row.resource_uri === expectedUri,
    recipe: row.recipe_key === "activation_gateway_dark_deploy",
    permission: row.permission_level === "admin",
    mode: Array.isArray(modes) && modes.includes("dark_deploy"),
    tenant: !row.tenant_id || row.tenant_id === tenantId,
    workspace: !row.workspace_id || row.workspace_id === workspaceId,
    user: !row.user_id || row.user_id === userId,
  };
  return {
    ok: Object.values(checks).every(Boolean),
    status: Object.values(checks).every(Boolean) ? "activation_gateway_resource_binding_valid" : "activation_gateway_resource_binding_invalid",
    binding_id: row.binding_id,
    resource_uri: row.resource_uri,
    permission_level: row.permission_level,
    allowed_modes: Array.isArray(modes) ? modes : [],
    checks,
    secrets_included: false,
  };
}

function extractAccountSubdomain(response) {
  const candidate = compact(response?.result?.subdomain || response?.result?.name || response?.result, 255).replace(/\.workers\.dev$/i, "");
  return /^[a-z0-9-]{1,63}$/i.test(candidate) ? candidate.toLowerCase() : null;
}

function deploymentList(response) {
  if (Array.isArray(response?.result)) return response.result;
  if (Array.isArray(response?.result?.deployments)) return response.result.deployments;
  return [];
}

async function cloudflareInventory(client, accountId, scriptName) {
  let providerCalls = 0;
  const request = async (args) => {
    providerCalls += 1;
    try { return await client.request(args); }
    catch (err) {
      return {
        ok: false,
        status: Number(err?.status || 0),
        result: null,
        errors: [{ code: err?.code || "cloudflare_request_failed", message: compact(err?.message, 300) }],
        messages: [],
        secrets_included: false,
      };
    }
  };
  const accountSubdomain = await request({ apiPath: `/accounts/${accountId}/workers/subdomain`, method: "GET" });
  const deployments = await request({ apiPath: `/accounts/${accountId}/workers/scripts/${scriptName}/deployments`, method: "GET" });
  const scriptSubdomain = await request({ apiPath: `/accounts/${accountId}/workers/scripts/${scriptName}/subdomain`, method: "GET" });
  const accountSubdomainName = accountSubdomain.ok ? extractAccountSubdomain(accountSubdomain) : null;
  const deploymentRows = deployments.ok ? deploymentList(deployments) : [];
  const scriptMissing = [404].includes(Number(deployments.status)) && [404].includes(Number(scriptSubdomain.status));
  return {
    provider_calls_made: providerCalls,
    account_subdomain: accountSubdomainName,
    account_subdomain_ready: Boolean(accountSubdomainName),
    script_exists: deployments.ok || scriptSubdomain.ok,
    script_missing: scriptMissing,
    script_subdomain_enabled: Boolean(scriptSubdomain?.result?.enabled),
    script_previews_enabled: Boolean(scriptSubdomain?.result?.previews_enabled),
    deployments: deploymentRows,
    previous_deployment: deploymentRows[0] || null,
    read_errors: [
      ...(!accountSubdomain.ok ? [{ surface: "account_subdomain", ...safeProviderFailure(accountSubdomain) }] : []),
      ...(!deployments.ok && deployments.status !== 404 ? [{ surface: "deployments", ...safeProviderFailure(deployments) }] : []),
      ...(!scriptSubdomain.ok && scriptSubdomain.status !== 404 ? [{ surface: "script_subdomain", ...safeProviderFailure(scriptSubdomain) }] : []),
    ],
    secrets_included: false,
  };
}

function requiredCheck(key, ok, details = {}) {
  return { key, ok: Boolean(ok), ...details, secrets_included: false };
}

export async function buildActivationGatewayRolloutPlan(input = {}, deps = {}) {
  const bundleRoot = deps.bundleRoot || DEFAULT_BUNDLE_ROOT;
  const env = deps.env || process.env;
  const pool = deps.pool || null;
  const auth = deps.auth || {};
  const accountId = compact(input.account_id || env.CLOUDFLARE_ACCOUNT_ID, 64).toLowerCase();
  const scriptName = compact(input.script_name || ACTIVATION_GATEWAY_ROLLOUT_CONTRACT.script_name, 128);
  if (!new RegExp(ACTIVATION_GATEWAY_ROLLOUT_CONTRACT.account_id_pattern).test(accountId)) {
    throw rolloutError("activation_gateway_account_id_invalid", "A valid 32-character Cloudflare account ID is required.");
  }
  if (!/^[a-z0-9-]{1,128}$/.test(scriptName)) {
    throw rolloutError("activation_gateway_script_name_invalid", "Activation Gateway script name is invalid.");
  }
  if (input.custom_domain || input.zone_id || input.dns_record) {
    throw rolloutError("activation_gateway_dns_not_allowed", "Dark deploy does not permit DNS or custom-domain changes.", 400);
  }

  const bundle = await readGatewayBundle(bundleRoot);
  const calculatedPolicyHash = await policyHash(bundle.policy);
  const expectedPolicyHash = compact(input.expected_policy_hash || bundle.policy.content_hash_sha256, 64).toLowerCase();
  const expectedSourceCommit = compact(input.expected_source_commit, 64).toLowerCase();
  const attestation = await verifyDeploymentAttestation(bundle.policy, env);
  const workspace = await resolveWorkspace(pool, auth, input);
  const resourceBinding = await resolveResourceBinding(pool, auth, { ...input, workspace_id: input.workspace_id || workspace?.workspace_id }, accountId, scriptName);
  const client = deps.cloudflareClient || createCloudflareApiClient({ fetchImpl: deps.fetchImpl, token: env.CLOUDFLARE_API_TOKEN, timeoutMs: deps.cloudflareTimeoutMs });
  const inventoryAuthorized = Boolean(workspace?.workspace_id) && resourceBinding.ok;
  const inventory = inventoryAuthorized
    ? await cloudflareInventory(client, accountId, scriptName)
    : {
      provider_calls_made: 0,
      account_subdomain: null,
      account_subdomain_ready: false,
      script_exists: false,
      script_missing: false,
      script_subdomain_enabled: false,
      script_previews_enabled: false,
      deployments: [],
      previous_deployment: null,
      read_errors: [{
        surface: "inventory",
        status: 0,
        errors: [{ code: "activation_gateway_resource_authority_required", message: "Workspace and exact Worker resource binding must be valid before Cloudflare inventory reads." }],
        secrets_included: false,
      }],
      secrets_included: false,
    };
  const featureGateEnabled = truthy(env[ACTIVATION_GATEWAY_ROLLOUT_CONTRACT.feature_flag]);
  const sourceCommitMatches = Boolean(expectedSourceCommit) && attestation.ok && compact(attestation.sourceCommit, 64).toLowerCase() === expectedSourceCommit;
  const checks = [
    requiredCheck("policy_hash_self_consistent", calculatedPolicyHash === bundle.policy.content_hash_sha256, { calculated_policy_hash: calculatedPolicyHash }),
    requiredCheck("expected_policy_hash_matches", expectedPolicyHash === bundle.policy.content_hash_sha256, { expected_policy_hash: expectedPolicyHash }),
    requiredCheck("signed_attestation_valid_and_fresh", attestation.ok && !attestation.stale, { attestation_code: attestation.code || null, expires_at: attestation.attestation?.expires_at || null }),
    requiredCheck("expected_source_commit_matches", sourceCommitMatches, { expected_source_commit: expectedSourceCommit || null, attested_source_commit: attestation.ok ? attestation.sourceCommit : null }),
    requiredCheck("workspace_resolved", Boolean(workspace?.workspace_id), { workspace_id: workspace?.workspace_id || null }),
    requiredCheck("resource_binding_valid", resourceBinding.ok, { binding_id: resourceBinding.binding_id, binding_status: resourceBinding.status }),
    requiredCheck("cloudflare_token_present", Boolean(client.token_present ?? env.CLOUDFLARE_API_TOKEN)),
    requiredCheck("workers_dev_account_subdomain_present", inventory.account_subdomain_ready, { account_subdomain: inventory.account_subdomain }),
    requiredCheck("cloudflare_inventory_read_clean", inventory.read_errors.length === 0, { read_error_count: inventory.read_errors.length }),
    requiredCheck("dark_deploy_feature_gate_enabled", featureGateEnabled, { feature_flag: ACTIVATION_GATEWAY_ROLLOUT_CONTRACT.feature_flag }),
  ];
  const applyReady = checks.every((check) => check.ok);
  const temporaryHostname = inventory.account_subdomain
    ? `${scriptName}.${inventory.account_subdomain}.workers.dev`
    : null;

  return {
    ok: true,
    tool: "activation_gateway_rollout_plan",
    mode: "dry_run",
    classification: applyReady ? "activation_gateway_dark_deploy_ready" : "activation_gateway_dark_deploy_blocked",
    apply_ready: applyReady,
    account_id: accountId,
    script_name: scriptName,
    temporary_hostname: temporaryHostname,
    custom_domain_binding_allowed: false,
    dns_mutation_allowed: false,
    policy: {
      policy_key: bundle.policy.policy_key,
      policy_hash_sha256: bundle.policy.content_hash_sha256,
      calculated_policy_hash_sha256: calculatedPolicyHash,
      bundle_hash_sha256: bundle.bundle_hash_sha256,
      surface_registry_version: Number(bundle.policy.surface_registry_version),
      route_count: Array.isArray(bundle.policy.routes) ? bundle.policy.routes.length : 0,
      mutation_route_count: Array.isArray(bundle.policy.routes) ? bundle.policy.routes.filter((route) => route.mutation === true).length : 0,
    },
    attestation: {
      valid: attestation.ok,
      stale: Boolean(attestation.stale),
      code: attestation.code || null,
      deployment_id: attestation.ok ? attestation.deploymentId : null,
      source_commit: attestation.ok ? attestation.sourceCommit : null,
      expires_at: attestation.attestation?.expires_at || null,
    },
    workspace: workspace ? { workspace_id: workspace.workspace_id, workspace_key: workspace.workspace_key, workspace_type: workspace.workspace_type } : null,
    resource_binding: resourceBinding,
    cloudflare_inventory: {
      account_subdomain: inventory.account_subdomain,
      script_exists: inventory.script_exists,
      script_subdomain_enabled: inventory.script_subdomain_enabled,
      deployment_count: inventory.deployments.length,
      previous_deployment_id: inventory.previous_deployment?.id || null,
      rollback_deployment_identified: Boolean(inventory.previous_deployment?.id),
      read_errors: inventory.read_errors,
    },
    required_confirmation: activationGatewayTypedConfirmation(bundle.policy.content_hash_sha256),
    required_capability: {
      app_key: "cloudflare",
      capability_key: ACTIVATION_GATEWAY_ROLLOUT_CONTRACT.capability_key,
      operation_intent: ACTIVATION_GATEWAY_ROLLOUT_CONTRACT.operation_intent,
      runtime_surface: ACTIVATION_GATEWAY_ROLLOUT_CONTRACT.runtime_surface,
      capability_envelope_required_for_apply: true,
      approval_required_for_apply: true,
    },
    readback_contract: [
      "worker_script_present",
      "deployment_id_present",
      "script_workers_dev_subdomain_enabled",
      "health_status_200",
      "health_policy_hash_matches",
      "health_source_commit_matches",
      "ready_status_200",
      "ready_policy_hash_matches",
    ],
    rollback_contract: inventory.previous_deployment?.id
      ? { mode: "restore_previous_deployment_versions", previous_deployment_id: inventory.previous_deployment.id }
      : { mode: "delete_new_unrouted_script" },
    checks,
    provider_calls_made: inventory.provider_calls_made,
    execution: { will_execute: false, executed: false },
    secrets: {
      attestation_secret_present: Boolean(env[ACTIVATION_GATEWAY_ROLLOUT_CONTRACT.attestation_secret]),
      public_key_secret_present: Boolean(env[ACTIVATION_GATEWAY_ROLLOUT_CONTRACT.public_key_secret]),
      values_returned: false,
    },
    secrets_included: false,
    ...(deps.includeInternal === true ? { _internal: { inventory, bundle, workspace, resourceBinding, client } } : {}),
  };
}

async function readSmokeJson(fetchImpl, url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs || 10000)));
  try {
    const response = await fetchImpl(url, { method: "GET", redirect: "manual", signal: controller.signal, headers: { "x-request-id": crypto.randomUUID() } });
    const text = await response.text().catch(() => "");
    return { status: response.status, ok: response.ok, body: parseJson(text, null), secrets_included: false };
  } catch (err) {
    return { status: 0, ok: false, error: err?.name === "AbortError" ? "timeout" : compact(err?.message, 200), body: null, secrets_included: false };
  } finally {
    clearTimeout(timer);
  }
}

function deploymentVersions(deployment) {
  return Array.isArray(deployment?.versions)
    ? deployment.versions.map((item) => ({ version_id: item.version_id, percentage: Number(item.percentage) })).filter((item) => item.version_id && item.percentage > 0)
    : [];
}

async function rollbackActivationGateway({ client, accountId, scriptName, previousDeployment }) {
  if (previousDeployment?.id && deploymentVersions(previousDeployment).length) {
    const response = await client.request({
      apiPath: `/accounts/${accountId}/workers/scripts/${scriptName}/deployments`,
      method: "POST",
      body: { strategy: "percentage", versions: deploymentVersions(previousDeployment) },
    });
    const readback = await client.request({ apiPath: `/accounts/${accountId}/workers/scripts/${scriptName}/deployments`, method: "GET" });
    const current = deploymentList(readback)[0] || null;
    const expectedVersions = JSON.stringify(deploymentVersions(previousDeployment));
    const actualVersions = JSON.stringify(deploymentVersions(current));
    return {
      ok: response.ok && readback.ok && expectedVersions === actualVersions,
      mode: "restore_previous_deployment_versions",
      previous_deployment_id: previousDeployment.id,
      rollback_deployment_id: current?.id || null,
      provider_status: response.status,
      secrets_included: false,
    };
  }
  const response = await client.request({ apiPath: `/accounts/${accountId}/workers/scripts/${scriptName}`, method: "DELETE" });
  return { ok: response.ok || response.status === 404, mode: "delete_new_unrouted_script", provider_status: response.status, secrets_included: false };
}

async function claimCapabilityEnvelopeForApply({ pool, envelopeId, executionRef }) {
  const [result] = await pool.query(
    `UPDATE capability_resolution_envelope_ledger
        SET execution_status='referenced', execution_ref=?, updated_at=NOW()
      WHERE envelope_id=?
        AND execution_status='not_executed'
        AND (execution_ref IS NULL OR execution_ref='')`,
    [executionRef, envelopeId],
  );
  if (Number(result?.affectedRows || 0) !== 1) {
    throw rolloutError("activation_gateway_capability_envelope_replay_blocked", "Capability envelope was already claimed, consumed, failed, or cancelled.", 409, { envelope_id: envelopeId, replay_blocked: true });
  }
  return { ok: true, envelope_id: envelopeId, execution_ref: executionRef, execution_status: "referenced", secrets_included: false };
}

async function finalizeCapabilityEnvelopeExecution({ pool, envelopeId, executionRef, status }) {
  if (!["executed", "failed"].includes(status)) throw rolloutError("activation_gateway_envelope_status_invalid", "Capability envelope final status is invalid.", 500);
  const [result] = await pool.query(
    `UPDATE capability_resolution_envelope_ledger
        SET execution_status=?, updated_at=NOW()
      WHERE envelope_id=?
        AND execution_status='referenced'
        AND execution_ref=?`,
    [status, envelopeId, executionRef],
  );
  if (Number(result?.affectedRows || 0) !== 1) {
    throw rolloutError("activation_gateway_capability_envelope_finalize_failed", "Capability envelope final execution state could not be persisted.", 500, { envelope_id: envelopeId, execution_status: status });
  }
  return { ok: true, envelope_id: envelopeId, execution_ref: executionRef, execution_status: status, secrets_included: false };
}

async function assertEnvelopeForApply({ pool, auth, input, expectedCommitSha, workspaceId }) {
  const envelope = await resolveCapabilityExecutionEnvelope({
    pool,
    envelopeId: input.capability_envelope_id,
    source: input,
    acceptedAppKeys: ["cloudflare"],
    acceptedIntents: [ACTIVATION_GATEWAY_ROLLOUT_CONTRACT.operation_intent, "cloudflare.worker.deploy"],
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
  if (!envelope.apply_allowed) throw rolloutError("activation_gateway_capability_envelope_apply_not_allowed", "Capability envelope does not allow Activation Gateway apply.", 403, { envelope_id: envelope.envelope_id });
  if (!envelope.readback_required) throw rolloutError("activation_gateway_capability_envelope_readback_required", "Capability envelope must require readback for Activation Gateway apply.", 403, { envelope_id: envelope.envelope_id });
  const [rows] = await pool.query(
    `SELECT capability_key, workspace_id, apply_allowed, readback_required
       FROM capability_resolution_envelope_ledger
      WHERE envelope_id=?
      LIMIT 1`,
    [envelope.envelope_id],
  );
  const row = rows?.[0] || null;
  if (!row || row.capability_key !== ACTIVATION_GATEWAY_ROLLOUT_CONTRACT.capability_key) {
    throw rolloutError("activation_gateway_capability_envelope_key_mismatch", "Capability envelope is not bound to the Activation Gateway Cloudflare capability.", 403, { envelope_id: envelope.envelope_id, capability_key: row?.capability_key || null });
  }
  if (row.workspace_id && workspaceId && row.workspace_id !== workspaceId) {
    throw rolloutError("activation_gateway_capability_envelope_workspace_mismatch", "Capability envelope workspace does not match the rollout workspace.", 403, { envelope_id: envelope.envelope_id });
  }
  const [certRows] = await pool.query(
    `SELECT certification_key, certification_status, dispatch_allowed, apply_allowed, requires_readback, expires_at
       FROM runtime_dispatch_certification_registry
      WHERE certification_key='activation_gateway_dark_deploy_v1'
        AND dispatch_allowed=1
        AND apply_allowed=1
        AND requires_readback=1
        AND (expires_at IS NULL OR expires_at>NOW())
      LIMIT 1`,
  );
  if (!certRows?.[0]) throw rolloutError("activation_gateway_dispatch_certification_missing", "Activation Gateway dark deploy certification is missing or expired.", 403);
  return { ...envelope, certification: certRows[0] };
}

export async function runActivationGatewayDarkDeploy(input = {}, deps = {}) {
  const mode = compact(input.mode || "dry_run", 16).toLowerCase();
  if (!["dry_run", "apply"].includes(mode)) throw rolloutError("activation_gateway_rollout_mode_invalid", "mode must be dry_run or apply.");
  const plan = await buildActivationGatewayRolloutPlan(input, { ...deps, includeInternal: true });
  const publicPlan = { ...plan };
  delete publicPlan._internal;
  if (mode === "dry_run") return { ...publicPlan, tool: "activation_gateway_dark_deploy", mode, execution: { will_execute: false, executed: false } };

  const env = deps.env || process.env;
  const pool = deps.pool;
  const auth = deps.auth || {};
  if (!pool) throw rolloutError("activation_gateway_database_required", "Database access is required for apply.", 500);
  if (!truthy(env[ACTIVATION_GATEWAY_ROLLOUT_CONTRACT.feature_flag])) {
    throw rolloutError("activation_gateway_dark_deploy_disabled", `Set ${ACTIVATION_GATEWAY_ROLLOUT_CONTRACT.feature_flag}=true only after approval and readiness.`, 403);
  }
  if (!plan.apply_ready) {
    throw rolloutError("activation_gateway_dark_deploy_not_ready", "Activation Gateway dark deploy plan is not ready.", 409, { failed_checks: plan.checks.filter((check) => !check.ok).map((check) => check.key) });
  }
  const expectedConfirm = plan.required_confirmation;
  if (compact(input.confirm, 128) !== expectedConfirm) {
    throw rolloutError("activation_gateway_typed_confirmation_mismatch", "Typed confirmation does not match the current policy hash.", 403, { expected_confirmation: expectedConfirm });
  }
  const expectedSourceCommit = compact(input.expected_source_commit, 64).toLowerCase();
  const expectedPolicyHash = compact(input.expected_policy_hash, 64).toLowerCase();
  if (expectedSourceCommit !== compact(plan.attestation.source_commit, 64).toLowerCase()) {
    throw rolloutError("activation_gateway_expected_commit_mismatch", "Expected source commit does not match signed attestation.", 409);
  }
  if (expectedPolicyHash !== plan.policy.policy_hash_sha256) {
    throw rolloutError("activation_gateway_expected_policy_hash_mismatch", "Expected policy hash does not match generated policy.", 409);
  }
  const executionNonce = requireExecutionNonce(input);
  const executionNonceSha256 = sha256Text(executionNonce);
  const executionRef = activationGatewayExecutionRef(executionNonce);
  const workspaceId = plan.workspace?.workspace_id || compact(input.workspace_id, 64);
  const envelope = await assertEnvelopeForApply({ pool, auth, input, expectedCommitSha: expectedSourceCommit, workspaceId });
  await claimCapabilityEnvelopeForApply({ pool, envelopeId: envelope.envelope_id, executionRef });

  const client = plan._internal.client;
  const bundle = plan._internal.bundle;
  const accountId = plan.account_id;
  const scriptName = plan.script_name;
  const previousDeployment = plan._internal.inventory.previous_deployment;
  const { formData } = buildActivationGatewayUploadForm(bundle, { enforceHost: false });
  const fetchImpl = deps.smokeFetch || deps.fetchImpl || globalThis.fetch;
  let writesStarted = false;
  let providerCalls = plan.provider_calls_made;
  let rollback = null;

  try {
    const upload = await client.request({ apiPath: `/accounts/${accountId}/workers/scripts/${scriptName}`, method: "PUT", formData });
    providerCalls += 1;
    if (!upload.ok) throw rolloutError("activation_gateway_worker_upload_failed", "Cloudflare Worker upload failed.", 502, safeProviderFailure(upload));
    writesStarted = true;

    const secrets = [
      [ACTIVATION_GATEWAY_ROLLOUT_CONTRACT.attestation_secret, env[ACTIVATION_GATEWAY_ROLLOUT_CONTRACT.attestation_secret]],
      [ACTIVATION_GATEWAY_ROLLOUT_CONTRACT.public_key_secret, env[ACTIVATION_GATEWAY_ROLLOUT_CONTRACT.public_key_secret]],
    ];
    const secretReadback = [];
    for (const [name, value] of secrets) {
      if (!value) throw rolloutError("activation_gateway_worker_secret_missing", `Required Worker secret ${name} is missing.`, 409, { secret_name: name });
      const response = await client.request({
        apiPath: `/accounts/${accountId}/workers/scripts/${scriptName}/secrets`,
        method: "PUT",
        body: { name, text: String(value), type: "secret_text" },
      });
      providerCalls += 1;
      if (!response.ok) throw rolloutError("activation_gateway_worker_secret_write_failed", `Cloudflare Worker secret ${name} could not be stored.`, 502, { secret_name: name, provider: safeProviderFailure(response) });
      secretReadback.push({ name, stored: true, value_returned: false });
    }

    const subdomainWrite = await client.request({
      apiPath: `/accounts/${accountId}/workers/scripts/${scriptName}/subdomain`,
      method: "POST",
      body: { enabled: true, previews_enabled: false },
    });
    providerCalls += 1;
    if (!subdomainWrite.ok) throw rolloutError("activation_gateway_worker_subdomain_enable_failed", "Worker subdomain could not be enabled.", 502, safeProviderFailure(subdomainWrite));

    const deploymentsReadback = await client.request({ apiPath: `/accounts/${accountId}/workers/scripts/${scriptName}/deployments`, method: "GET" });
    const subdomainReadback = await client.request({ apiPath: `/accounts/${accountId}/workers/scripts/${scriptName}/subdomain`, method: "GET" });
    providerCalls += 2;
    const currentDeployment = deploymentList(deploymentsReadback)[0] || null;
    const temporaryUrl = `https://${plan.temporary_hostname}`;
    const health = await readSmokeJson(fetchImpl, `${temporaryUrl}/health`, deps.smokeTimeoutMs);
    const ready = await readSmokeJson(fetchImpl, `${temporaryUrl}/ready`, deps.smokeTimeoutMs);
    const healthOk = health.ok && health.body?.ok === true && health.body?.policyHash === plan.policy.policy_hash_sha256 && compact(health.body?.sourceCommit, 64).toLowerCase() === expectedSourceCommit;
    const readyOk = ready.ok && ready.body?.ok === true && ready.body?.policyHash === plan.policy.policy_hash_sha256;
    const readbackOk = deploymentsReadback.ok && Boolean(currentDeployment?.id) && subdomainReadback.ok && subdomainReadback.result?.enabled === true && healthOk && readyOk;
    if (!readbackOk) {
      throw rolloutError("activation_gateway_dark_deploy_readback_failed", "Activation Gateway dark deploy readback failed.", 502, {
        deployment_present: Boolean(currentDeployment?.id),
        subdomain_enabled: subdomainReadback.result?.enabled === true,
        health_status: health.status,
        health_ok: healthOk,
        ready_status: ready.status,
        ready_ok: readyOk,
      });
    }

    await deps.audit?.({
      action: "activation_gateway.dark_deploy",
      resource_type: "cloudflare_worker",
      resource_id: scriptName,
      payload: { account_id: accountId, deployment_id: currentDeployment.id, policy_hash_sha256: plan.policy.policy_hash_sha256, source_commit: expectedSourceCommit, capability_envelope_id: envelope.envelope_id, execution_nonce_sha256: executionNonceSha256, secrets_included: false },
    });
    await finalizeCapabilityEnvelopeExecution({ pool, envelopeId: envelope.envelope_id, executionRef, status: "executed" });

    return {
      ...publicPlan,
      tool: "activation_gateway_dark_deploy",
      mode: "apply",
      classification: "activation_gateway_dark_deploy_succeeded",
      apply_ready: true,
      execution: { will_execute: true, executed: true },
      deployment: {
        deployment_id: currentDeployment.id,
        previous_deployment_id: previousDeployment?.id || null,
        temporary_url: temporaryUrl,
        script_subdomain_enabled: true,
        custom_domain_bound: false,
        dns_changed: false,
      },
      secret_readback: secretReadback,
      smoke_readback: {
        health: { status: health.status, ok: healthOk, policy_hash: health.body?.policyHash || null, source_commit: health.body?.sourceCommit || null },
        ready: { status: ready.status, ok: readyOk, policy_hash: ready.body?.policyHash || null },
      },
      capability_envelope: { envelope_id: envelope.envelope_id, certification_key: envelope.certification.certification_key, execution_status: "executed", execution_nonce_sha256: executionNonceSha256, replay_blocked: false },
      rollback: { required: false, target_identified: Boolean(previousDeployment?.id), previous_deployment_id: previousDeployment?.id || null },
      provider_calls_made: providerCalls,
      secrets_included: false,
    };
  } catch (err) {
    if (writesStarted) {
      try { rollback = await rollbackActivationGateway({ client, accountId, scriptName, previousDeployment }); }
      catch (rollbackErr) { rollback = { ok: false, mode: previousDeployment?.id ? "restore_previous_deployment_versions" : "delete_new_unrouted_script", error: compact(rollbackErr?.message, 300), secrets_included: false }; }
    }
    let failureAuditError = null;
    let envelopeFinalizeError = null;
    try {
      await deps.audit?.({
        action: "activation_gateway.dark_deploy_failed",
        resource_type: "cloudflare_worker",
        resource_id: scriptName,
        payload: { account_id: accountId, policy_hash_sha256: plan.policy.policy_hash_sha256, source_commit: expectedSourceCommit, capability_envelope_id: envelope.envelope_id, execution_nonce_sha256: executionNonceSha256, rollback, error_code: err?.code || "activation_gateway_dark_deploy_failed", secrets_included: false },
      });
    } catch (auditErr) {
      failureAuditError = { code: auditErr?.code || "activation_gateway_failure_audit_failed", message: compact(auditErr?.message, 300), secrets_included: false };
    }
    try {
      await finalizeCapabilityEnvelopeExecution({ pool, envelopeId: envelope.envelope_id, executionRef, status: "failed" });
    } catch (finalizeErr) {
      envelopeFinalizeError = { code: finalizeErr?.code || "activation_gateway_capability_envelope_finalize_failed", message: compact(finalizeErr?.message, 300), secrets_included: false };
    }
    throw rolloutError(err?.code || "activation_gateway_dark_deploy_failed", err?.message || "Activation Gateway dark deploy failed.", err?.status || 502, { ...(err?.details || {}), rollback, failure_audit_error: failureAuditError, envelope_finalize_error: envelopeFinalizeError, replay_blocked: true });
  }
}
