import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTIVATION_GATEWAY_ROLLOUT_CONTRACT,
  activationGatewayTypedConfirmation,
  buildActivationGatewayRolloutPlan,
  buildActivationGatewayUploadForm,
  runActivationGatewayDarkDeploy,
} from "./activationGatewayRolloutTool.js";
import { policyHash, stableJson } from "../edge/activation-gateway/src/gateway.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const accountId = "dd1024b934e907723484568d97c7c74c";
const sourceCommit = "a".repeat(40);
const tenantId = "00000000-0000-0000-0000-000000000000";
const userId = "00000000-0000-4000-a000-000000000002";
const workspaceId = "11111111-1111-4111-a111-111111111111";
const envelopeId = "22222222-2222-4222-a222-222222222222";
const policy = JSON.parse(fs.readFileSync(path.join(repoRoot, "edge/activation-gateway/generated/route-policy.json"), "utf8"));
const policyHashValue = await policyHash(policy, crypto.webcrypto);
assert.equal(policyHashValue, policy.content_hash_sha256);

async function signedEnvironment() {
  const pair = await crypto.webcrypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicJwk = await crypto.webcrypto.subtle.exportKey("jwk", pair.publicKey);
  const attestation = {
    content_hash_sha256: policyHashValue,
    deployment_id: "signed-rollout-fixture",
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    source_commit: sourceCommit,
    surface_registry_version: Number(policy.surface_registry_version),
  };
  const signature = await crypto.webcrypto.subtle.sign(
    { name: "Ed25519" },
    pair.privateKey,
    new TextEncoder().encode(stableJson(attestation)),
  );
  return {
    CLOUDFLARE_API_TOKEN: "test-token-never-returned",
    CLOUDFLARE_ACCOUNT_ID: accountId,
    ACTIVATION_GATEWAY_DARK_DEPLOY_ENABLED: "true",
    ACTIVATION_GATEWAY_DEPLOYMENT_ATTESTATION_JSON: JSON.stringify({ ...attestation, signature_b64url: Buffer.from(signature).toString("base64url") }),
    ACTIVATION_GATEWAY_POLICY_PUBLIC_KEY_JWK: JSON.stringify(publicJwk),
  };
}

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
    capability_key: ACTIVATION_GATEWAY_ROLLOUT_CONTRACT.capability_key,
    operation_intent: ACTIVATION_GATEWAY_ROLLOUT_CONTRACT.operation_intent,
    risk_class: "critical",
    selected_source_tier: "platform_managed_fallback",
    selected_runtime_surface: ACTIVATION_GATEWAY_ROLLOUT_CONTRACT.runtime_surface,
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
  const pool = {
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
          binding_id: ACTIVATION_GATEWAY_ROLLOUT_CONTRACT.resource_binding_id,
          tenant_id: tenantId,
          workspace_id: null,
          user_id: null,
          resource_type: "cloudflare_worker",
          resource_uri: `cloudflare://accounts/${accountId}/workers/scripts/${ACTIVATION_GATEWAY_ROLLOUT_CONTRACT.script_name}`,
          resource_ref_json: JSON.stringify({ account_id: accountId, script_name: ACTIVATION_GATEWAY_ROLLOUT_CONTRACT.script_name }),
          recipe_key: "activation_gateway_dark_deploy",
          permission_level: "admin",
          allowed_modes_json: JSON.stringify(["dry_run", "dark_deploy"]),
          authority_source: "migration_seed",
          expires_at: null,
          status: "active",
        }]];
      }
      if (normalized.includes("FROM capability_resolution_envelope_ledger") && normalized.includes("SELECT envelope_id")) return [[envelopeRow]];
      if (normalized.includes("FROM capability_resolution_envelope_ledger") && normalized.includes("SELECT capability_key")) {
        return [[{ capability_key: ACTIVATION_GATEWAY_ROLLOUT_CONTRACT.capability_key, workspace_id: workspaceId, apply_allowed: 1, readback_required: 1 }]];
      }
      if (normalized.includes("FROM runtime_dispatch_certification_registry")) {
        return [[{ certification_key: "activation_gateway_dark_deploy_v1", certification_status: "bounded_dark_deploy_contract_certified", dispatch_allowed: 1, apply_allowed: 1, requires_readback: 1, expires_at: null }]];
      }
      if (normalized.startsWith("UPDATE capability_resolution_envelope_ledger") && normalized.includes("execution_status=\'referenced\'")) return [{ affectedRows: claimAffectedRows }];
      if (normalized.startsWith("UPDATE capability_resolution_envelope_ledger") && normalized.includes("SET execution_status=?")) return [{ affectedRows: finalizeAffectedRows }];
      throw new Error(`Unexpected SQL in rollout test: ${normalized}`);
    },
  };
  return pool;
}

function response(status, result, success = status >= 200 && status < 300) {
  return { ok: success, status, result, errors: success ? [] : [{ code: status, message: "fixture failure" }], messages: [], secrets_included: false };
}

function createCloudflareFixture({ healthOk = true, readyOk = true, withPrevious = true } = {}) {
  const requests = [];
  let uploaded = false;
  let rollbackRequested = false;
  const previousDeployment = withPrevious
    ? { id: "prev-deployment", versions: [{ version_id: "prev-version", percentage: 100 }] }
    : null;
  const latestDeployment = { id: "new-deployment", versions: [{ version_id: "new-version", percentage: 100 }] };
  const rollbackDeployment = { id: "rollback-deployment", versions: [{ version_id: "prev-version", percentage: 100 }] };
  const client = {
    token_present: true,
    requests,
    async request(args) {
      requests.push(args);
      const { apiPath, method = "GET" } = args;
      if (apiPath === `/accounts/${accountId}/workers/subdomain` && method === "GET") return response(200, { subdomain: "mad4b-fixture" });
      if (apiPath.endsWith(`/workers/scripts/${ACTIVATION_GATEWAY_ROLLOUT_CONTRACT.script_name}/deployments`) && method === "GET") {
        if (rollbackRequested) return response(200, { deployments: [rollbackDeployment] });
        if (uploaded) return response(200, { deployments: [latestDeployment] });
        return withPrevious ? response(200, { deployments: [previousDeployment] }) : response(404, null, false);
      }
      if (apiPath.endsWith(`/workers/scripts/${ACTIVATION_GATEWAY_ROLLOUT_CONTRACT.script_name}/subdomain`) && method === "GET") {
        return uploaded ? response(200, { enabled: true, previews_enabled: false }) : response(404, null, false);
      }
      if (apiPath.endsWith(`/workers/scripts/${ACTIVATION_GATEWAY_ROLLOUT_CONTRACT.script_name}`) && method === "PUT") {
        assert.ok(args.formData instanceof FormData);
        const names = [...args.formData.keys()];
        assert.deepEqual(names.sort(), ["generated/route-policy.json", "metadata", "src/gateway.mjs", "src/worker.mjs"].sort());
        uploaded = true;
        return response(200, { etag: "fixture-upload" });
      }
      if (apiPath.endsWith(`/workers/scripts/${ACTIVATION_GATEWAY_ROLLOUT_CONTRACT.script_name}/secrets`) && method === "PUT") {
        assert.equal(args.body.type, "secret_text");
        assert.ok([ACTIVATION_GATEWAY_ROLLOUT_CONTRACT.attestation_secret, ACTIVATION_GATEWAY_ROLLOUT_CONTRACT.public_key_secret].includes(args.body.name));
        assert.ok(args.body.text);
        return response(200, { name: args.body.name, type: "secret_text" });
      }
      if (apiPath.endsWith(`/workers/scripts/${ACTIVATION_GATEWAY_ROLLOUT_CONTRACT.script_name}/subdomain`) && method === "POST") {
        assert.deepEqual(args.body, { enabled: true, previews_enabled: false });
        return response(200, { enabled: true, previews_enabled: false });
      }
      if (apiPath.endsWith(`/workers/scripts/${ACTIVATION_GATEWAY_ROLLOUT_CONTRACT.script_name}/deployments`) && method === "POST") {
        rollbackRequested = true;
        assert.deepEqual(args.body.versions, [{ version_id: "prev-version", percentage: 100 }]);
        return response(200, rollbackDeployment);
      }
      if (apiPath.endsWith(`/workers/scripts/${ACTIVATION_GATEWAY_ROLLOUT_CONTRACT.script_name}`) && method === "DELETE") {
        rollbackRequested = true;
        return response(200, null);
      }
      throw new Error(`Unexpected Cloudflare fixture request: ${method} ${apiPath}`);
    },
  };
  const smokeFetch = async (url) => {
    if (String(url).endsWith("/health")) {
      return new Response(JSON.stringify({
        ok: healthOk,
        service: "activation-gateway",
        policyHash: policyHashValue,
        sourceCommit,
        deploymentId: "signed-rollout-fixture",
      }), { status: healthOk ? 200 : 503, headers: { "content-type": "application/json" } });
    }
    if (String(url).endsWith("/ready")) {
      return new Response(JSON.stringify({ ok: readyOk, service: "activation-gateway", policyHash: policyHashValue }), { status: readyOk ? 200 : 503, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected smoke URL: ${url}`);
  };
  return { client, smokeFetch, requests, get rollbackRequested() { return rollbackRequested; } };
}

const env = await signedEnvironment();
const auth = { tenant_id: tenantId, user_id: userId, is_admin: true, mode: "backend_api_key" };
const baseInput = {
  account_id: accountId,
  script_name: ACTIVATION_GATEWAY_ROLLOUT_CONTRACT.script_name,
  expected_source_commit: sourceCommit,
  expected_policy_hash: policyHashValue,
  workspace_id: workspaceId,
  resource_binding_id: ACTIVATION_GATEWAY_ROLLOUT_CONTRACT.resource_binding_id,
};

{
  const fixture = createCloudflareFixture();
  const plan = await buildActivationGatewayRolloutPlan(baseInput, { repoRoot, env, auth, pool: createPool(), cloudflareClient: fixture.client });
  assert.equal(plan.apply_ready, true);
  assert.equal(plan.custom_domain_binding_allowed, false);
  assert.equal(plan.dns_mutation_allowed, false);
  assert.equal(plan.policy.policy_hash_sha256, policyHashValue);
  assert.equal(plan.attestation.source_commit, sourceCommit);
  assert.equal(plan.required_confirmation, activationGatewayTypedConfirmation(policyHashValue));
  assert.equal(plan.resource_binding.ok, true);
  assert.equal("_internal" in plan, false);
  assert.ok(fixture.requests.every((request) => request.method === "GET"));
  const serialized = JSON.stringify(plan);
  assert.equal(serialized.includes(env.CLOUDFLARE_API_TOKEN), false);
  assert.equal(serialized.includes(JSON.parse(env.ACTIVATION_GATEWAY_DEPLOYMENT_ATTESTATION_JSON).signature_b64url), false);
}

{
  const fixture = createCloudflareFixture();
  const blocked = await buildActivationGatewayRolloutPlan({ ...baseInput, account_id: "e".repeat(32) }, { repoRoot, env, auth, pool: createPool(), cloudflareClient: fixture.client });
  assert.equal(blocked.apply_ready, false);
  assert.equal(blocked.provider_calls_made, 0);
  assert.equal(blocked.resource_binding.ok, false);
  assert.equal(fixture.requests.length, 0);
}

{
  const fixture = createCloudflareFixture();
  const dryRun = await runActivationGatewayDarkDeploy({ ...baseInput, mode: "dry_run" }, { repoRoot, env, auth, pool: createPool(), cloudflareClient: fixture.client });
  assert.equal(dryRun.execution.executed, false);
  assert.ok(fixture.requests.every((request) => request.method === "GET"));
}

{
  const fixture = createCloudflareFixture();
  const pool = createPool();
  const audit = [];
  const result = await runActivationGatewayDarkDeploy({
    ...baseInput,
    mode: "apply",
    capability_envelope_id: envelopeId,
    execution_nonce: "rollout-success-001",
    confirm: activationGatewayTypedConfirmation(policyHashValue),
  }, {
    repoRoot,
    env,
    auth,
    pool,
    cloudflareClient: fixture.client,
    smokeFetch: fixture.smokeFetch,
    audit: async (entry) => audit.push(entry),
  });
  assert.equal(result.execution.executed, true);
  assert.equal(result.deployment.deployment_id, "new-deployment");
  assert.equal(result.deployment.custom_domain_bound, false);
  assert.equal(result.deployment.dns_changed, false);
  assert.equal(result.smoke_readback.health.ok, true);
  assert.equal(result.smoke_readback.ready.ok, true);
  assert.equal(audit.length, 1);
  assert.equal(result.capability_envelope.execution_status, "executed");
  assert.match(result.capability_envelope.execution_nonce_sha256, /^[a-f0-9]{64}$/);
  assert.ok(pool.queries.some(({ sql, params }) => String(sql).includes("SET execution_status=?") && params[0] === "executed"));
  assert.ok(fixture.requests.some((request) => request.method === "PUT" && request.apiPath.endsWith(`/workers/scripts/${ACTIVATION_GATEWAY_ROLLOUT_CONTRACT.script_name}`)));
  assert.equal(fixture.requests.some((request) => request.apiPath.includes("/dns_records")), false);
  assert.equal(JSON.stringify(result).includes(env.ACTIVATION_GATEWAY_DEPLOYMENT_ATTESTATION_JSON), false);
}

{
  const fixture = createCloudflareFixture();
  await assert.rejects(
    runActivationGatewayDarkDeploy({ ...baseInput, mode: "apply", capability_envelope_id: envelopeId, confirm: "WRONG" }, { repoRoot, env, auth, pool: createPool(), cloudflareClient: fixture.client, smokeFetch: fixture.smokeFetch }),
    (err) => err?.code === "activation_gateway_typed_confirmation_mismatch",
  );
  assert.equal(fixture.requests.some((request) => ["PUT", "POST", "DELETE", "PATCH"].includes(request.method)), false);
}

{
  const fixture = createCloudflareFixture();
  await assert.rejects(
    runActivationGatewayDarkDeploy({ ...baseInput, mode: "apply", capability_envelope_id: envelopeId, execution_nonce: "short", confirm: activationGatewayTypedConfirmation(policyHashValue) }, { repoRoot, env, auth, pool: createPool(), cloudflareClient: fixture.client, smokeFetch: fixture.smokeFetch }),
    (err) => err?.code === "activation_gateway_execution_nonce_invalid",
  );
  assert.equal(fixture.requests.some((request) => ["PUT", "POST", "DELETE", "PATCH"].includes(request.method)), false);
}

{
  const fixture = createCloudflareFixture();
  await assert.rejects(
    runActivationGatewayDarkDeploy({ ...baseInput, mode: "apply", capability_envelope_id: envelopeId, execution_nonce: "rollout-replay-001", confirm: activationGatewayTypedConfirmation(policyHashValue) }, { repoRoot, env, auth, pool: createPool({ claimAffectedRows: 0 }), cloudflareClient: fixture.client, smokeFetch: fixture.smokeFetch }),
    (err) => err?.code === "activation_gateway_capability_envelope_replay_blocked" && err?.details?.replay_blocked === true,
  );
  assert.equal(fixture.requests.some((request) => ["PUT", "POST", "DELETE", "PATCH"].includes(request.method)), false);
}

{
  const fixture = createCloudflareFixture({ healthOk: false, readyOk: true, withPrevious: true });
  await assert.rejects(
    runActivationGatewayDarkDeploy({
      ...baseInput,
      mode: "apply",
      capability_envelope_id: envelopeId,
      execution_nonce: "rollout-failure-001",
      confirm: activationGatewayTypedConfirmation(policyHashValue),
    }, {
      repoRoot,
      env,
      auth,
      pool: createPool(),
      cloudflareClient: fixture.client,
      smokeFetch: fixture.smokeFetch,
    }),
    (err) => err?.code === "activation_gateway_dark_deploy_readback_failed" && err?.details?.rollback?.ok === true,
  );
  assert.equal(fixture.rollbackRequested, true);
}

{
  const fixture = createCloudflareFixture();
  await assert.rejects(
    buildActivationGatewayRolloutPlan({ ...baseInput, custom_domain: "activation.mad4b.com" }, { repoRoot, env, auth, pool: createPool(), cloudflareClient: fixture.client }),
    (err) => err?.code === "activation_gateway_dns_not_allowed",
  );
}

{
  const bundle = {
    files: [
      { name: "src/worker.mjs", content: "export default {};", type: "application/javascript+module" },
      { name: "src/gateway.mjs", content: "export {};", type: "application/javascript+module" },
      { name: "generated/route-policy.json", content: "{}", type: "application/json" },
    ],
  };
  const { formData, metadata } = buildActivationGatewayUploadForm(bundle, { enforceHost: false });
  assert.equal(metadata.main_module, "src/worker.mjs");
  assert.deepEqual(metadata.bindings, [{ type: "plain_text", name: "ACTIVATION_GATEWAY_ENFORCE_HOST", text: "false" }]);
  assert.equal([...formData.keys()].length, 4);
}

console.log("Activation Gateway rollout tool tests passed.");
