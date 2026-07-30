import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  capabilityEnvelopeError,
  resolveCapabilityExecutionEnvelope,
} from "./capabilityResolutionEnvelopeGuard.js";
import { createCloudflareApiClient } from "./activationGatewayRolloutTool.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_BUNDLE_ROOT = path.resolve(DEFAULT_REPO_ROOT, "edge/auth-mad4b-proxy");
const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000";

export const AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT = Object.freeze({
  account_id: "dd1024b934e907723484568d97c7c74c",
  script_name: "auth-mad4b-proxy",
  compatibility_date: "2024-01-01",
  worker_modules: Object.freeze([
    Object.freeze({ name: "src/worker.mjs", path: "src/worker.mjs", type: "application/javascript+module" }),
    Object.freeze({ name: "src/proxy.mjs", path: "src/proxy.mjs", type: "application/javascript+module" }),
  ]),
  capability_key: "admin_cloudflare_v1",
  operation_intent: "auth_mad4b_proxy.deploy",
  runtime_surface: "auth_mad4b_proxy_deploy",
  resource_binding_id: "177b60cd-427e-4564-abf3-0ff70791a03c",
  certification_key: "auth_mad4b_proxy_deploy_v1",
  resource_type: "cloudflare_worker",
  health_url: "https://auth.mad4b.com/health",
  no_dns: true,
  no_route_mutation: true,
  no_subdomain_mutation: true,
  no_secret_mutation: true,
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

function rolloutError(code, message, status = 400, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = { ...details, secrets_included: false };
  return error;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function deploymentList(response) {
  if (Array.isArray(response?.result)) return response.result;
  if (Array.isArray(response?.result?.deployments)) return response.result.deployments;
  return [];
}

function deploymentVersions(deployment) {
  return Array.isArray(deployment?.versions)
    ? deployment.versions
      .map((item) => ({ version_id: item?.version_id, percentage: Number(item?.percentage) }))
      .filter((item) => item.version_id && item.percentage > 0)
    : [];
}

function safeProviderFailure(response = {}) {
  return {
    status: Number(response?.status || 0),
    errors: Array.isArray(response?.errors)
      ? response.errors.slice(0, 5).map((item) => ({ code: item?.code ?? null, message: compact(item?.message, 300) || null }))
      : [],
    secrets_included: false,
  };
}

async function readBundle(bundleRoot = DEFAULT_BUNDLE_ROOT) {
  const files = [];
  for (const descriptor of AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.worker_modules) {
    const absolutePath = path.join(bundleRoot, ...descriptor.path.split("/"));
    files.push({ ...descriptor, content: await fs.readFile(absolutePath, "utf8") });
  }
  const hash = crypto.createHash("sha256");
  for (const file of [...files].sort((left, right) => left.name.localeCompare(right.name))) {
    hash.update(file.name);
    hash.update("\0");
    hash.update(file.content.replace(/\r\n?/g, "\n"));
    hash.update("\0");
  }
  return { files, bundle_hash_sha256: hash.digest("hex") };
}

async function resolveGitHead(repoRoot = DEFAULT_REPO_ROOT) {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, timeout: 10000 });
    const head = compact(stdout, 64).toLowerCase();
    return /^[a-f0-9]{40}$/.test(head) ? head : null;
  } catch {
    return null;
  }
}

export function authMad4bProxyTypedConfirmation(bundleHash) {
  const hash = compact(bundleHash, 64).toUpperCase();
  if (!/^[A-F0-9]{64}$/.test(hash)) {
    throw rolloutError("auth_mad4b_proxy_bundle_hash_invalid", "A 64-character bundle hash is required to derive typed confirmation.");
  }
  return `DEPLOY_AUTH_MAD4B_PROXY_${hash.slice(0, 12)}`;
}

export function buildAuthMad4bProxyUploadForm(bundle) {
  const formData = new FormData();
  const metadata = {
    main_module: "src/worker.mjs",
    compatibility_date: AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.compatibility_date,
    bindings: [],
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

async function resolveResourceBinding(pool, auth = {}, input = {}) {
  if (!pool) return { ok: false, status: "resource_binding_store_unavailable", secrets_included: false };
  const bindingId = compact(input.resource_binding_id || AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.resource_binding_id, 64);
  const [rows] = await pool.query(
    `SELECT binding_id, tenant_id, workspace_id, user_id, resource_type, resource_uri,
            resource_ref_json, recipe_key, permission_level, allowed_modes_json,
            authority_source, expires_at, status
       FROM platform_resource_authority_bindings
      WHERE binding_id=?
      LIMIT 1`,
    [bindingId],
  );
  const row = rows?.[0] || null;
  if (!row) return { ok: false, status: "auth_mad4b_proxy_resource_binding_missing", binding_id: bindingId, secrets_included: false };
  const expectedUri = `cloudflare://accounts/${AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.account_id}/workers/scripts/${AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.script_name}`;
  const modes = parseJson(row.allowed_modes_json, []);
  const checks = {
    active: row.status === "active" && (!row.expires_at || new Date(row.expires_at).getTime() > Date.now()),
    resource_type: row.resource_type === AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.resource_type,
    resource_uri: row.resource_uri === expectedUri,
    recipe: row.recipe_key === "auth_mad4b_proxy_deploy",
    permission: row.permission_level === "admin",
    mode: Array.isArray(modes) && modes.includes("deploy"),
    tenant: !row.tenant_id || row.tenant_id === compact(auth.tenant_id || PLATFORM_TENANT_ID, 64),
    workspace: !row.workspace_id || row.workspace_id === compact(input.workspace_id, 64),
    user: !row.user_id || row.user_id === compact(auth.user_id, 64),
  };
  return {
    ok: Object.values(checks).every(Boolean),
    status: Object.values(checks).every(Boolean) ? "auth_mad4b_proxy_resource_binding_valid" : "auth_mad4b_proxy_resource_binding_invalid",
    binding_id: row.binding_id,
    resource_uri: row.resource_uri,
    permission_level: row.permission_level,
    allowed_modes: Array.isArray(modes) ? modes : [],
    checks,
    secrets_included: false,
  };
}

async function cloudflareInventory(client) {
  const apiPath = `/accounts/${AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.account_id}/workers/scripts/${AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.script_name}/deployments`;
  const deployments = await client.request({ apiPath, method: "GET" });
  const rows = deployments.ok ? deploymentList(deployments) : [];
  return {
    provider_calls_made: 1,
    read_ok: deployments.ok,
    read_error: deployments.ok ? null : safeProviderFailure(deployments),
    deployments: rows,
    previous_deployment: rows[0] || null,
    secrets_included: false,
  };
}

function check(key, ok, details = {}) {
  return { key, ok: Boolean(ok), ...details, secrets_included: false };
}

export async function buildAuthMad4bProxyRolloutPlan(input = {}, deps = {}) {
  if (input.zone_id || input.dns_record || input.route || input.custom_domain || input.subdomain_enabled !== undefined) {
    throw rolloutError("auth_mad4b_proxy_scope_not_allowed", "This deployment surface does not permit DNS, route, custom-domain, or subdomain mutations.");
  }
  const requestedAccount = compact(input.account_id || AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.account_id, 64).toLowerCase();
  const requestedScript = compact(input.script_name || AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.script_name, 128);
  if (requestedAccount !== AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.account_id || requestedScript !== AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.script_name) {
    throw rolloutError("auth_mad4b_proxy_resource_mismatch", "The rollout tool is restricted to the exact auth-mad4b-proxy Worker resource.", 403);
  }

  const repoRoot = deps.repoRoot || DEFAULT_REPO_ROOT;
  const bundle = await readBundle(deps.bundleRoot || DEFAULT_BUNDLE_ROOT);
  const gitHead = await (deps.resolveGitHead || resolveGitHead)(repoRoot);
  const expectedSourceCommit = compact(input.expected_source_commit, 64).toLowerCase();
  const expectedBundleHash = compact(input.expected_bundle_hash, 64).toLowerCase();
  const pool = deps.pool || null;
  const auth = deps.auth || {};
  const workspace = await resolveWorkspace(pool, auth, input);
  const resourceBinding = await resolveResourceBinding(pool, auth, { ...input, workspace_id: input.workspace_id || workspace?.workspace_id });
  const client = deps.cloudflareClient || createCloudflareApiClient({
    fetchImpl: deps.fetchImpl,
    token: (deps.env || process.env).CLOUDFLARE_API_TOKEN,
    timeoutMs: deps.cloudflareTimeoutMs,
  });
  const inventory = workspace?.workspace_id && resourceBinding.ok
    ? await cloudflareInventory(client)
    : { provider_calls_made: 0, read_ok: false, read_error: { status: 0, errors: [{ code: "auth_mad4b_proxy_resource_authority_required", message: "Workspace and exact Worker resource binding are required before inventory reads." }], secrets_included: false }, deployments: [], previous_deployment: null, secrets_included: false };

  const checks = [
    check("expected_bundle_hash_matches", /^[a-f0-9]{64}$/.test(expectedBundleHash) && expectedBundleHash === bundle.bundle_hash_sha256, { expected_bundle_hash: expectedBundleHash || null, bundle_hash_sha256: bundle.bundle_hash_sha256 }),
    check("git_head_resolved", Boolean(gitHead), { git_head: gitHead }),
    check("expected_source_commit_matches_git_head", /^[a-f0-9]{40}$/.test(expectedSourceCommit) && expectedSourceCommit === gitHead, { expected_source_commit: expectedSourceCommit || null, git_head: gitHead }),
    check("workspace_resolved", Boolean(workspace?.workspace_id), { workspace_id: workspace?.workspace_id || null }),
    check("resource_binding_valid", resourceBinding.ok, { binding_id: resourceBinding.binding_id || null, binding_status: resourceBinding.status }),
    check("cloudflare_token_present", Boolean(client.token_present ?? (deps.env || process.env).CLOUDFLARE_API_TOKEN)),
    check("cloudflare_inventory_read_clean", inventory.read_ok, { read_error: inventory.read_error }),
    check("rollback_target_identified", Boolean(inventory.previous_deployment?.id), { previous_deployment_id: inventory.previous_deployment?.id || null }),
  ];
  const applyReady = checks.every((item) => item.ok);

  return {
    ok: true,
    tool: "auth_mad4b_proxy_rollout",
    mode: "dry_run",
    classification: applyReady ? "auth_mad4b_proxy_deploy_ready" : "auth_mad4b_proxy_deploy_blocked",
    apply_ready: applyReady,
    account_id: AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.account_id,
    script_name: AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.script_name,
    source_commit: gitHead,
    bundle_hash_sha256: bundle.bundle_hash_sha256,
    module_names: bundle.files.map((file) => file.name),
    workspace: workspace ? { workspace_id: workspace.workspace_id, workspace_key: workspace.workspace_key, workspace_type: workspace.workspace_type } : null,
    resource_binding: resourceBinding,
    cloudflare_inventory: {
      deployment_count: inventory.deployments.length,
      previous_deployment_id: inventory.previous_deployment?.id || null,
      rollback_deployment_identified: Boolean(inventory.previous_deployment?.id),
      read_error: inventory.read_error,
    },
    required_confirmation: authMad4bProxyTypedConfirmation(bundle.bundle_hash_sha256),
    required_capability: {
      app_key: "cloudflare",
      capability_key: AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.capability_key,
      operation_intent: AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.operation_intent,
      runtime_surface: AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.runtime_surface,
      capability_envelope_required_for_apply: true,
      approval_required_for_apply: true,
    },
    readback_contract: [
      "new_deployment_id_present",
      "worker_source_contains_exact_modules",
      "health_status_200",
      "health_response_is_json",
      "no_dns_route_subdomain_or_secret_mutation",
    ],
    rollback_contract: {
      mode: "restore_previous_deployment_versions",
      previous_deployment_id: inventory.previous_deployment?.id || null,
    },
    checks,
    provider_calls_made: inventory.provider_calls_made,
    execution: { will_execute: false, executed: false },
    secrets_included: false,
    ...(deps.includeInternal === true ? { _internal: { bundle, inventory, client } } : {}),
  };
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
  if (Number(result?.affectedRows || 0) !== 1) {
    throw rolloutError("auth_mad4b_proxy_capability_envelope_replay_blocked", "Capability envelope was already claimed, consumed, failed, or cancelled.", 409, { envelope_id: envelopeId, replay_blocked: true });
  }
}

async function finalizeEnvelope(pool, envelopeId, executionRef, status) {
  const [result] = await pool.query(
    `UPDATE capability_resolution_envelope_ledger
        SET execution_status=?, updated_at=NOW()
      WHERE envelope_id=? AND execution_status='referenced' AND execution_ref=?`,
    [status, envelopeId, executionRef],
  );
  if (Number(result?.affectedRows || 0) !== 1) {
    throw rolloutError("auth_mad4b_proxy_capability_envelope_finalize_failed", "Capability envelope final execution state could not be persisted.", 500);
  }
}

async function assertEnvelope({ pool, auth, input, expectedCommitSha, workspaceId }) {
  const envelope = await resolveCapabilityExecutionEnvelope({
    pool,
    envelopeId: input.capability_envelope_id,
    source: input,
    acceptedAppKeys: ["cloudflare"],
    acceptedIntents: [AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.operation_intent, "cloudflare.worker.deploy"],
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
    throw rolloutError("auth_mad4b_proxy_capability_envelope_apply_not_allowed", "Capability envelope must allow apply and require readback.", 403, { envelope_id: envelope.envelope_id });
  }
  const [rows] = await pool.query(
    `SELECT capability_key, workspace_id, apply_allowed, readback_required
       FROM capability_resolution_envelope_ledger WHERE envelope_id=? LIMIT 1`,
    [envelope.envelope_id],
  );
  const row = rows?.[0] || null;
  if (!row || row.capability_key !== AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.capability_key) {
    throw rolloutError("auth_mad4b_proxy_capability_envelope_key_mismatch", "Capability envelope is not bound to the Cloudflare admin capability.", 403);
  }
  if (row.workspace_id && workspaceId && row.workspace_id !== workspaceId) {
    throw rolloutError("auth_mad4b_proxy_capability_envelope_workspace_mismatch", "Capability envelope workspace does not match the rollout workspace.", 403);
  }
  const [certRows] = await pool.query(
    `SELECT certification_key, certification_status, dispatch_allowed, apply_allowed, requires_readback, expires_at
       FROM runtime_dispatch_certification_registry
      WHERE certification_key=? AND dispatch_allowed=1 AND apply_allowed=1 AND requires_readback=1
        AND (expires_at IS NULL OR expires_at>NOW()) LIMIT 1`,
    [AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.certification_key],
  );
  if (!certRows?.[0]) {
    throw rolloutError("auth_mad4b_proxy_dispatch_certification_missing", "Auth proxy deployment certification is missing or expired.", 403);
  }
  return { ...envelope, certification: certRows[0] };
}

async function readWorkerSource({ fetchImpl = globalThis.fetch, token, bundle }) {
  if (!token) throw rolloutError("cloudflare_token_missing", "CLOUDFLARE_API_TOKEN is not configured.", 503);
  const url = `https://api.cloudflare.com/client/v4/accounts/${AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.account_id}/workers/scripts/${AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.script_name}`;
  const response = await fetchImpl(url, { method: "GET", headers: { Authorization: `Bearer ${token}` }, redirect: "manual" });
  const text = await response.text().catch(() => "");
  return {
    ok: response.ok && bundle.files.every((file) => text.includes(file.content)),
    status: response.status,
    module_matches: bundle.files.map((file) => ({ name: file.name, present: text.includes(file.content) })),
    raw_hash_sha256: sha256(text),
    secrets_included: false,
  };
}

async function readHealth(fetchImpl = globalThis.fetch) {
  try {
    const response = await fetchImpl(`${AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.health_url}?edge_readback=${Date.now()}`, {
      method: "GET",
      redirect: "manual",
      headers: { "x-request-id": crypto.randomUUID(), accept: "application/json" },
    });
    const text = await response.text().catch(() => "");
    const body = parseJson(text, null);
    return {
      ok: response.status === 200 && body && typeof body === "object" && !text.toLowerCase().includes("<html"),
      status: response.status,
      json_present: Boolean(body && typeof body === "object"),
      html_present: text.toLowerCase().includes("<html"),
      secrets_included: false,
    };
  } catch (error) {
    return { ok: false, status: 0, error: compact(error?.message, 200), json_present: false, html_present: false, secrets_included: false };
  }
}

async function rollback(client, previousDeployment) {
  const versions = deploymentVersions(previousDeployment);
  if (!previousDeployment?.id || !versions.length) {
    return { ok: false, mode: "restore_previous_deployment_versions", error: "rollback_target_missing", secrets_included: false };
  }
  const response = await client.request({
    apiPath: `/accounts/${AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.account_id}/workers/scripts/${AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.script_name}/deployments`,
    method: "POST",
    body: { strategy: "percentage", versions },
  });
  const readback = await client.request({
    apiPath: `/accounts/${AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.account_id}/workers/scripts/${AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.script_name}/deployments`,
    method: "GET",
  });
  const current = deploymentList(readback)[0] || null;
  return {
    ok: response.ok && readback.ok && JSON.stringify(deploymentVersions(current)) === JSON.stringify(versions),
    mode: "restore_previous_deployment_versions",
    previous_deployment_id: previousDeployment.id,
    rollback_deployment_id: current?.id || null,
    secrets_included: false,
  };
}

export async function runAuthMad4bProxyRollout(input = {}, deps = {}) {
  const mode = compact(input.mode || "dry_run", 16).toLowerCase();
  if (!["dry_run", "apply"].includes(mode)) {
    throw rolloutError("auth_mad4b_proxy_rollout_mode_invalid", "mode must be dry_run or apply.");
  }
  const plan = await buildAuthMad4bProxyRolloutPlan(input, { ...deps, includeInternal: true });
  const publicPlan = { ...plan };
  delete publicPlan._internal;
  if (mode === "dry_run") return { ...publicPlan, tool: "auth_mad4b_proxy_rollout", mode, execution: { will_execute: false, executed: false } };
  if (!plan.apply_ready) {
    throw rolloutError("auth_mad4b_proxy_deploy_not_ready", "Auth proxy deployment plan is not ready.", 409, { failed_checks: plan.checks.filter((item) => !item.ok).map((item) => item.key) });
  }
  if (compact(input.confirm, 128) !== plan.required_confirmation) {
    throw rolloutError("auth_mad4b_proxy_typed_confirmation_mismatch", "Typed confirmation does not match the current bundle hash.", 403, { expected_confirmation: plan.required_confirmation });
  }
  const executionNonce = compact(input.execution_nonce, 128);
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(executionNonce)) {
    throw rolloutError("auth_mad4b_proxy_execution_nonce_invalid", "Apply requires execution_nonce with 8 to 128 safe characters.");
  }
  const pool = deps.pool;
  if (!pool) throw rolloutError("auth_mad4b_proxy_database_required", "Database access is required for apply.", 500);
  const auth = deps.auth || {};
  const executionRef = `auth-mad4b-proxy:${executionNonce}`.slice(0, 191);
  const executionNonceSha256 = sha256(executionNonce);
  const envelope = await assertEnvelope({
    pool,
    auth,
    input,
    expectedCommitSha: plan.source_commit,
    workspaceId: plan.workspace?.workspace_id || compact(input.workspace_id, 64),
  });
  await claimEnvelope(pool, envelope.envelope_id, executionRef);

  const client = plan._internal.client;
  const bundle = plan._internal.bundle;
  const previousDeployment = plan._internal.inventory.previous_deployment;
  const { formData } = buildAuthMad4bProxyUploadForm(bundle);
  let writesStarted = false;
  let rollbackResult = null;
  let providerCalls = plan.provider_calls_made;

  try {
    const upload = await client.request({
      apiPath: `/accounts/${AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.account_id}/workers/scripts/${AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.script_name}`,
      method: "PUT",
      formData,
    });
    providerCalls += 1;
    if (!upload.ok) throw rolloutError("auth_mad4b_proxy_worker_upload_failed", "Cloudflare Worker upload failed.", 502, safeProviderFailure(upload));
    writesStarted = true;

    const deployments = await client.request({
      apiPath: `/accounts/${AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.account_id}/workers/scripts/${AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.script_name}/deployments`,
      method: "GET",
    });
    providerCalls += 1;
    const currentDeployment = deploymentList(deployments)[0] || null;
    const sourceReadback = deps.sourceReadback
      ? await deps.sourceReadback({ bundle, deployment: currentDeployment })
      : await readWorkerSource({ fetchImpl: deps.fetchImpl || globalThis.fetch, token: (deps.env || process.env).CLOUDFLARE_API_TOKEN, bundle });
    const health = await readHealth(deps.smokeFetch || deps.fetchImpl || globalThis.fetch);
    const readbackOk = deployments.ok
      && Boolean(currentDeployment?.id)
      && currentDeployment.id !== previousDeployment?.id
      && sourceReadback.ok
      && health.ok;
    if (!readbackOk) {
      throw rolloutError("auth_mad4b_proxy_deploy_readback_failed", "Auth proxy deployment readback failed.", 502, {
        deployment_present: Boolean(currentDeployment?.id),
        deployment_changed: Boolean(currentDeployment?.id && currentDeployment.id !== previousDeployment?.id),
        source_readback_ok: sourceReadback.ok,
        health_status: health.status,
        health_ok: health.ok,
      });
    }

    await deps.audit?.({
      action: "auth_mad4b_proxy.deploy",
      resource_type: AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.resource_type,
      resource_id: AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.script_name,
      payload: {
        account_id: AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.account_id,
        deployment_id: currentDeployment.id,
        previous_deployment_id: previousDeployment?.id || null,
        source_commit: plan.source_commit,
        bundle_hash_sha256: plan.bundle_hash_sha256,
        capability_envelope_id: envelope.envelope_id,
        execution_nonce_sha256: executionNonceSha256,
        secrets_included: false,
      },
    });
    await finalizeEnvelope(pool, envelope.envelope_id, executionRef, "executed");
    return {
      ...publicPlan,
      mode: "apply",
      classification: "auth_mad4b_proxy_deploy_succeeded",
      execution: { will_execute: true, executed: true },
      deployment: {
        deployment_id: currentDeployment.id,
        previous_deployment_id: previousDeployment?.id || null,
        dns_changed: false,
        routes_changed: false,
        subdomain_changed: false,
        secrets_changed: false,
      },
      source_readback: sourceReadback,
      health_readback: health,
      capability_envelope: {
        envelope_id: envelope.envelope_id,
        certification_key: envelope.certification.certification_key,
        execution_status: "executed",
        execution_nonce_sha256: executionNonceSha256,
        replay_blocked: false,
      },
      rollback: { required: false, target_identified: true, previous_deployment_id: previousDeployment?.id || null },
      provider_calls_made: providerCalls,
      secrets_included: false,
    };
  } catch (error) {
    if (writesStarted) {
      try { rollbackResult = await rollback(client, previousDeployment); }
      catch (rollbackError) { rollbackResult = { ok: false, mode: "restore_previous_deployment_versions", error: compact(rollbackError?.message, 300), secrets_included: false }; }
    }
    try {
      await deps.audit?.({
        action: "auth_mad4b_proxy.deploy_failed",
        resource_type: AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.resource_type,
        resource_id: AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.script_name,
        payload: {
          account_id: AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.account_id,
          source_commit: plan.source_commit,
          bundle_hash_sha256: plan.bundle_hash_sha256,
          capability_envelope_id: envelope.envelope_id,
          execution_nonce_sha256: executionNonceSha256,
          rollback: rollbackResult,
          error_code: error?.code || "auth_mad4b_proxy_deploy_failed",
          secrets_included: false,
        },
      });
    } catch {}
    try { await finalizeEnvelope(pool, envelope.envelope_id, executionRef, "failed"); } catch {}
    throw rolloutError(error?.code || "auth_mad4b_proxy_deploy_failed", error?.message || "Auth proxy deployment failed.", error?.status || 502, { ...(error?.details || {}), rollback: rollbackResult, replay_blocked: true });
  }
}
