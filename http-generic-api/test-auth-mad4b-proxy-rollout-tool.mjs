import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT,
  authMad4bProxyTypedConfirmation,
  buildAuthMad4bProxyRolloutPlan,
  buildAuthMad4bProxyUploadForm,
  runAuthMad4bProxyRollout,
} from "./authMad4bProxyRolloutTool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const bundleRoot = path.join(repoRoot, "edge/auth-mad4b-proxy");
const tenantId = "00000000-0000-0000-0000-000000000000";
const userId = "00000000-0000-4000-a000-000000000002";
const workspaceId = "11111111-1111-4111-a111-111111111111";
const envelopeId = "22222222-2222-4222-a222-222222222222";
const sourceCommit = "a".repeat(40);

function bundleHash() {
  const files = AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.worker_modules.map((descriptor) => ({
    ...descriptor,
    content: fs.readFileSync(path.join(bundleRoot, descriptor.path), "utf8"),
  }));
  const hash = crypto.createHash("sha256");
  for (const file of [...files].sort((left, right) => left.name.localeCompare(right.name))) {
    hash.update(file.name);
    hash.update("\0");
    hash.update(file.content.replace(/\r\n?/g, "\n"));
    hash.update("\0");
  }
  return { files, hash: hash.digest("hex") };
}

const bundle = bundleHash();
const env = { CLOUDFLARE_API_TOKEN: "fixture-token-never-returned" };
const auth = { tenant_id: tenantId, user_id: userId, is_admin: true, mode: "backend_api_key" };

function createPool({ claimAffectedRows = 1, finalizeAffectedRows = 1 } = {}) {
  const queries = [];
  const envelopeRow = {
    envelope_id: envelopeId,
    tenant_id: tenantId,
    user_id: userId,
    workspace_id: workspaceId,
    workspace_key: "platform-admin",
    brand_key: null,
    app_key: "cloudflare",
    capability_key: AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.capability_key,
    operation_intent: AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.operation_intent,
    risk_class: "critical",
    selected_source_tier: "platform_managed_fallback",
    selected_runtime_surface: AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.runtime_surface,
    authority_status: "passed",
    decision: "ready_for_dispatch",
    envelope_status: "ready_for_dispatch",
    dispatch_allowed: 1,
    apply_allowed: 1,
    approval_required: 0,
    quota_required: 1,
    audit_required: 1,
    readback_required: 1,
    blocking_gap_count: 0,
    execution_status: "not_executed",
    expires_at: new Date(Date.now() + 60 * 60 * 1000),
    secrets_included: 0,
    envelope_sha256: "b".repeat(64),
    envelope_json: JSON.stringify({ request_context: { expected_commit_sha: sourceCommit } }),
  };
  return {
    queries,
    async query(sql, params = []) {
      queries.push({ sql, params });
      const normalized = String(sql).replace(/\s+/g, " ").trim();
      if (normalized.includes("FROM workspace_registry w") && normalized.includes("w.workspace_id=?")) {
        return [[{ workspace_id: workspaceId, tenant_id: tenantId, workspace_key: "platform-admin", display_name: "Platform Admin", workspace_type: "platform_admin", bootstrap_status: "ready" }]];
      }
      if (normalized.includes("FROM workspace_registry w") && normalized.includes("w.bootstrap_status='ready'")) {
        return [[{ workspace_id: workspaceId, tenant_id: tenantId, workspace_key: "platform-admin", display_name: "Platform Admin", workspace_type: "platform_admin", bootstrap_status: "ready" }]];
      }
      if (normalized.includes("FROM platform_resource_authority_bindings")) {
        return [[{
          binding_id: AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.resource_binding_id,
          tenant_id: tenantId,
          workspace_id: null,
          user_id: null,
          resource_type: AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.resource_type,
          resource_uri: `cloudflare://accounts/${AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.account_id}/workers/scripts/${AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.script_name}`,
          resource_ref_json: JSON.stringify({ account_id: AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.account_id, script_name: AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.script_name }),
          recipe_key: "auth_mad4b_proxy_deploy",
          permission_level: "admin",
          allowed_modes_json: JSON.stringify(["dry_run", "deploy"]),
          authority_source: "migration_seed",
          expires_at: null,
          status: "active",
        }]];
      }
      if (normalized.includes("FROM capability_resolution_envelope_ledger") && normalized.includes("SELECT envelope_id")) return [[envelopeRow]];
      if (normalized.includes("FROM capability_resolution_envelope_ledger") && normalized.includes("SELECT capability_key")) {
        return [[{ capability_key: AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.capability_key, workspace_id: workspaceId, apply_allowed: 1, readback_required: 1 }]];
      }
      if (normalized.includes("FROM runtime_dispatch_certification_registry")) {
        return [[{ certification_key: AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.certification_key, certification_status: "bounded_worker_deploy_contract_certified", dispatch_allowed: 1, apply_allowed: 1, requires_readback: 1, expires_at: null }]];
      }
      if (normalized.startsWith("UPDATE capability_resolution_envelope_ledger") && normalized.includes("execution_status='referenced'")) return [{ affectedRows: claimAffectedRows }];
      if (normalized.startsWith("UPDATE capability_resolution_envelope_ledger") && normalized.includes("SET execution_status=?")) return [{ affectedRows: finalizeAffectedRows }];
      throw new Error(`Unexpected SQL in auth proxy rollout test: ${normalized}`);
    },
  };
}

function response(status, result, success = status >= 200 && status < 300) {
  return { ok: success, status, result, errors: success ? [] : [{ code: status, message: "fixture failure" }], messages: [], secrets_included: false };
}

function createCloudflareFixture({ sourceOk = true, healthOk = true } = {}) {
  const requests = [];
  const previousDeployment = { id: "prev-deployment", versions: [{ version_id: "prev-version", percentage: 100 }] };
  const latestDeployment = { id: "new-deployment", versions: [{ version_id: "new-version", percentage: 100 }] };
  const rollbackDeployment = { id: "rollback-deployment", versions: [{ version_id: "prev-version", percentage: 100 }] };
  let uploaded = false;
  let rollbackRequested = false;
  const client = {
    token_present: true,
    requests,
    async request(args) {
      requests.push(args);
      const { apiPath, method = "GET" } = args;
      if (apiPath.endsWith(`/workers/scripts/${AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.script_name}/deployments`) && method === "GET") {
        if (rollbackRequested) return response(200, { deployments: [rollbackDeployment] });
        return response(200, { deployments: [uploaded ? latestDeployment : previousDeployment] });
      }
      if (apiPath.endsWith(`/workers/scripts/${AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.script_name}`) && method === "PUT") {
        assert.ok(args.formData instanceof FormData);
        assert.deepEqual([...args.formData.keys()].sort(), ["metadata", "src/proxy.mjs", "src/worker.mjs"].sort());
        uploaded = true;
        return response(200, { etag: "fixture-upload" });
      }
      if (apiPath.endsWith(`/workers/scripts/${AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.script_name}/deployments`) && method === "POST") {
        rollbackRequested = true;
        assert.deepEqual(args.body, { strategy: "percentage", versions: [{ version_id: "prev-version", percentage: 100 }] });
        return response(200, rollbackDeployment);
      }
      throw new Error(`Unexpected Cloudflare fixture request: ${method} ${apiPath}`);
    },
  };
  const sourceReadback = async () => ({
    ok: sourceOk,
    status: 200,
    module_matches: bundle.files.map((file) => ({ name: file.name, present: sourceOk })),
    raw_hash_sha256: "c".repeat(64),
    secrets_included: false,
  });
  const smokeFetch = async () => new Response(
    JSON.stringify({ ok: healthOk, service: "http-generic-api" }),
    { status: healthOk ? 200 : 503, headers: { "content-type": "application/json" } },
  );
  return { client, sourceReadback, smokeFetch, requests, get rollbackRequested() { return rollbackRequested; } };
}

const baseInput = {
  account_id: AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.account_id,
  script_name: AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.script_name,
  expected_source_commit: sourceCommit,
  expected_bundle_hash: bundle.hash,
  workspace_id: workspaceId,
  resource_binding_id: AUTH_MAD4B_PROXY_ROLLOUT_CONTRACT.resource_binding_id,
};

{
  const fixture = createCloudflareFixture();
  const plan = await buildAuthMad4bProxyRolloutPlan(baseInput, {
    repoRoot,
    bundleRoot,
    env,
    auth,
    pool: createPool(),
    cloudflareClient: fixture.client,
    resolveGitHead: async () => sourceCommit,
  });
  assert.equal(plan.apply_ready, true);
  assert.equal(plan.bundle_hash_sha256, bundle.hash);
  assert.equal(plan.required_confirmation, authMad4bProxyTypedConfirmation(bundle.hash));
  assert.equal(plan.resource_binding.ok, true);
  assert.equal(plan.cloudflare_inventory.previous_deployment_id, "prev-deployment");
  assert.equal(plan.readback_contract.includes("worker_source_contains_exact_modules"), true);
  assert.equal("_internal" in plan, false);
  assert.ok(fixture.requests.every((request) => request.method === "GET"));
  assert.equal(JSON.stringify(plan).includes(env.CLOUDFLARE_API_TOKEN), false);
}

{
  const fixture = createCloudflareFixture();
  await assert.rejects(
    buildAuthMad4bProxyRolloutPlan({ ...baseInput, script_name: "another-worker" }, {
      repoRoot,
      bundleRoot,
      env,
      auth,
      pool: createPool(),
      cloudflareClient: fixture.client,
      resolveGitHead: async () => sourceCommit,
    }),
    (error) => error?.code === "auth_mad4b_proxy_resource_mismatch",
  );
  assert.equal(fixture.requests.length, 0);
}

{
  const fixture = createCloudflareFixture();
  await assert.rejects(
    buildAuthMad4bProxyRolloutPlan({ ...baseInput, route: "auth.mad4b.com/*" }, {
      repoRoot,
      bundleRoot,
      env,
      auth,
      pool: createPool(),
      cloudflareClient: fixture.client,
      resolveGitHead: async () => sourceCommit,
    }),
    (error) => error?.code === "auth_mad4b_proxy_scope_not_allowed",
  );
}

{
  const fixture = createCloudflareFixture();
  const pool = createPool();
  const audit = [];
  const result = await runAuthMad4bProxyRollout({
    ...baseInput,
    mode: "apply",
    capability_envelope_id: envelopeId,
    execution_nonce: "auth-proxy-success-001",
    confirm: authMad4bProxyTypedConfirmation(bundle.hash),
  }, {
    repoRoot,
    bundleRoot,
    env,
    auth,
    pool,
    cloudflareClient: fixture.client,
    sourceReadback: fixture.sourceReadback,
    smokeFetch: fixture.smokeFetch,
    resolveGitHead: async () => sourceCommit,
    audit: async (entry) => audit.push(entry),
  });
  assert.equal(result.execution.executed, true);
  assert.equal(result.deployment.deployment_id, "new-deployment");
  assert.equal(result.deployment.dns_changed, false);
  assert.equal(result.deployment.routes_changed, false);
  assert.equal(result.deployment.subdomain_changed, false);
  assert.equal(result.deployment.secrets_changed, false);
  assert.equal(result.source_readback.ok, true);
  assert.equal(result.health_readback.ok, true);
  assert.equal(audit.length, 1);
  assert.equal(result.capability_envelope.execution_status, "executed");
  assert.ok(pool.queries.some(({ sql, params }) => String(sql).includes("SET execution_status=?") && params[0] === "executed"));
  assert.equal(fixture.requests.some((request) => request.apiPath.includes("/dns_records")), false);
  assert.equal(fixture.requests.some((request) => request.apiPath.includes("/routes")), false);
  assert.equal(fixture.requests.some((request) => request.apiPath.includes("/secrets")), false);
}

{
  const fixture = createCloudflareFixture({ sourceOk: false });
  await assert.rejects(
    runAuthMad4bProxyRollout({
      ...baseInput,
      mode: "apply",
      capability_envelope_id: envelopeId,
      execution_nonce: "auth-proxy-failure-001",
      confirm: authMad4bProxyTypedConfirmation(bundle.hash),
    }, {
      repoRoot,
      bundleRoot,
      env,
      auth,
      pool: createPool(),
      cloudflareClient: fixture.client,
      sourceReadback: fixture.sourceReadback,
      smokeFetch: fixture.smokeFetch,
      resolveGitHead: async () => sourceCommit,
    }),
    (error) => error?.code === "auth_mad4b_proxy_deploy_readback_failed" && error?.details?.rollback?.ok === true,
  );
  assert.equal(fixture.rollbackRequested, true);
}

{
  const fixture = createCloudflareFixture();
  await assert.rejects(
    runAuthMad4bProxyRollout({
      ...baseInput,
      mode: "apply",
      capability_envelope_id: envelopeId,
      execution_nonce: "auth-proxy-replay-001",
      confirm: authMad4bProxyTypedConfirmation(bundle.hash),
    }, {
      repoRoot,
      bundleRoot,
      env,
      auth,
      pool: createPool({ claimAffectedRows: 0 }),
      cloudflareClient: fixture.client,
      sourceReadback: fixture.sourceReadback,
      smokeFetch: fixture.smokeFetch,
      resolveGitHead: async () => sourceCommit,
    }),
    (error) => error?.code === "auth_mad4b_proxy_capability_envelope_replay_blocked",
  );
  assert.equal(fixture.requests.some((request) => request.method === "PUT"), false);
}

{
  const { formData, metadata } = buildAuthMad4bProxyUploadForm({ files: bundle.files });
  assert.equal(metadata.main_module, "src/worker.mjs");
  assert.deepEqual(metadata.bindings, []);
  assert.deepEqual([...formData.keys()].sort(), ["metadata", "src/proxy.mjs", "src/worker.mjs"].sort());
}

console.log("auth mad4b proxy rollout tool tests passed");
