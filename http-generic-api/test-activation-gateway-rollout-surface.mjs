import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildActivationGatewayRolloutPlan } from "./activationGatewayRolloutTool.js";

const routes = fs.readFileSync("routes/gptToolsRoutes.js", "utf8");
const migration = fs.readFileSync("migrations/20260627_activation_gateway_rollout_surface.sql", "utf8");
const moduleSource = fs.readFileSync("activationGatewayRolloutToolProduction.js", "utf8");

for (const tool of ["activation_gateway_rollout_plan", "activation_gateway_dark_deploy"]) {
  assert.match(routes, new RegExp(`name: \\"${tool}\\"`));
  assert.match(routes, new RegExp(`toolKey === \\"${tool}\\"`));
  assert.match(migration, new RegExp(tool));
}

assert.match(routes, /activation_gateway_rollout_plan[\s\S]*read_only[\s\S]*no_external_write[\s\S]*no_dns[\s\S]*no_custom_domain/);
assert.match(routes, /activation_gateway_dark_deploy[\s\S]*dry_run_default_true[\s\S]*typed_confirmation[\s\S]*capability_envelope[\s\S]*rollback_required/);
assert.match(routes, /activation_gateway_dark_deploy[\s\S]*execution_nonce[\s\S]*minLength: 8[\s\S]*maxLength: 128/);
assert.match(routes, /additionalProperties: false/);
assert.doesNotMatch(routes, /ACTIVATION_GATEWAY_DEPLOYMENT_ATTESTATION_JSON[\s\S]*inputSchema/);
assert.doesNotMatch(routes, /ACTIVATION_GATEWAY_POLICY_PUBLIC_KEY_JWK[\s\S]*inputSchema/);

assert.match(migration, /activation_gateway_dark_deploy_authority_v1/);
assert.match(migration, /activation_gateway_dark_deploy_apply_policy_v1/);
assert.match(migration, /activation_gateway_dark_deploy_v1/);
assert.match(migration, /8be421f5-49d3-4bda-a0f6-3cf8a04ee227/);
assert.match(migration, /cloudflare:\/\/accounts\/dd1024b934e907723484568d97c7c74c\/workers\/scripts\/mad4b-activation-gateway/);
assert.match(migration, /'dns_write_allowed', FALSE/);
assert.match(migration, /'custom_domain_binding_allowed', FALSE/);
assert.match(migration, /'workers_dev_only', TRUE/);
assert.match(migration, /'single_use_envelope_required', TRUE/);
assert.match(migration, /'execution_nonce_required', TRUE/);
assert.match(migration, /Generic admin_cloudflare and Cloudflare DNS writes remain uncertified and blocked/);
assert.doesNotMatch(migration, /UPDATE\s+runtime_dispatch_certification_registry[\s\S]*certification_key\s*=\s*'admin_cloudflare_v1'/i);
assert.doesNotMatch(migration, /dns_records/i);

assert.match(moduleSource, /ACTIVATION_GATEWAY_DARK_DEPLOY_ENABLED/);
assert.match(moduleSource, /resolveCapabilityExecutionEnvelope/);
assert.match(moduleSource, /activation_gateway_capability_envelope_replay_blocked/);
assert.match(moduleSource, /execution_status='referenced'/);
assert.match(moduleSource, /execution_nonce_sha256/);
assert.match(moduleSource, /activation_gateway_typed_confirmation_mismatch/);
assert.match(moduleSource, /rollbackActivationGateway/);
assert.match(moduleSource, /health_policy_hash_matches/);
assert.match(moduleSource, /ready_policy_hash_matches/);
assert.match(moduleSource, /activation_gateway_dns_not_allowed/);
assert.match(moduleSource, /secrets_included: false/);
assert.doesNotMatch(moduleSource, /api\.cloudflare\.com\/client\/v4\/zones/);

const root = path.resolve(import.meta.dirname, "..");
const registry = JSON.parse(fs.readFileSync("config/environment-convergence-registry.json", "utf8"));
const staging = registry.profiles.staging.activation_gateway;
const bindingId = staging.execution_target.resource_binding.resource_binding_id;
const accountId = "dd1024b934e907723484568d97c7c74c";
const scriptName = "mad4b-activation-gateway-staging";
const sourceSha = "a".repeat(40);
const convergencePlanSha = "e".repeat(64);
const platformWorkspaceId = "11111111-1111-4111-8111-111111111111";

let runtimeAuthorityReads = 0;
let runtimeWorkspaceReads = 0;
let governanceAuthorityReads = 0;

const runtimePool = {
  async query(sql) {
    const statement = String(sql);
    if (statement.includes("platform_resource_authority_bindings")) {
      runtimeAuthorityReads += 1;
      throw new Error("Runtime DB must never serve platform_resource_authority_bindings.");
    }
    if (statement.includes("FROM workspace_registry")) {
      runtimeWorkspaceReads += 1;
      return [[{
        workspace_id: platformWorkspaceId,
        tenant_id: "00000000-0000-0000-0000-000000000000",
        workspace_key: "platform-admin",
        display_name: "Platform Admin",
        workspace_type: "platform_admin",
        bootstrap_status: "ready",
      }]];
    }
    throw new Error(`Unexpected Runtime DB query: ${statement}`);
  },
};

const governancePool = {
  async query(sql, params = []) {
    const statement = String(sql);
    if (statement.includes("FROM platform_resource_authority_bindings")) {
      governanceAuthorityReads += 1;
      assert.deepEqual(params, [bindingId]);
      return [[{
        binding_id: bindingId,
        tenant_id: "00000000-0000-0000-0000-000000000000",
        workspace_id: null,
        user_id: null,
        resource_type: "cloudflare_worker",
        resource_uri: `cloudflare://accounts/${accountId}/workers/scripts/${scriptName}`,
        resource_ref_json: JSON.stringify({
          provider: "cloudflare",
          account_id: accountId,
          script_name: scriptName,
          profile_key: "activation_gateway_staging",
          workers_dev_only: true,
          dns_write_allowed: false,
          custom_domain_binding_allowed: false,
          secrets_included: false,
        }),
        recipe_key: "staging_activation_gateway_apply",
        permission_level: "admin",
        allowed_modes_json: JSON.stringify(["dry_run", "staging_apply"]),
        authority_source: "migration_seed",
        expires_at: null,
        status: "active",
      }]];
    }
    throw new Error(`Unexpected Governance DB query: ${statement}`);
  },
};

const plan = await buildActivationGatewayRolloutPlan({
  mode: "dry_run",
  account_id: accountId,
  expected_source_commit: sourceSha,
  expected_policy_hash: staging.expected_policy_hash,
  environment_convergence_plan_sha256: convergencePlanSha,
}, {
  runtimePool,
  governancePool,
  auth: { mode: "backend_api_key", principal_type: "admin", is_admin: true },
  env: {
    STAGING_ACTIVATION_GATEWAY_APPLY_ENABLED: "false",
    DEPLOYMENT_MANIFEST_JSON: JSON.stringify({
      repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
      branch: "main",
      commit_sha: sourceSha,
    }),
  },
  cloudflareClient: {
    token_present: true,
    async request() { throw new Error("dry-run must not call Cloudflare"); },
  },
  registry,
  repositoryRoot: root,
});

assert.equal(plan.adapter, "staging_activation_gateway_profile_apply");
assert.equal(plan.resource_binding.binding_id, bindingId);
assert.equal(plan.workspace.workspace_id, platformWorkspaceId);
assert.equal(plan.apply_ready, false);
assert.equal(runtimeAuthorityReads, 0);
assert.equal(governanceAuthorityReads, 1);
assert.equal(runtimeWorkspaceReads, 1);
assert.equal(plan.production_mutation, false);
assert.equal(plan.secrets_included, false);

await assert.rejects(
  buildActivationGatewayRolloutPlan({
    mode: "dry_run",
    account_id: accountId,
    expected_source_commit: sourceSha,
    expected_policy_hash: staging.expected_policy_hash,
    environment_convergence_plan_sha256: convergencePlanSha,
  }, {
    runtimePool,
    governancePool: runtimePool,
    auth: { mode: "backend_api_key", principal_type: "admin", is_admin: true },
    env: {
      STAGING_ACTIVATION_GATEWAY_APPLY_ENABLED: "false",
      DEPLOYMENT_MANIFEST_JSON: JSON.stringify({
        repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
        branch: "main",
        commit_sha: sourceSha,
      }),
    },
    cloudflareClient: { token_present: true },
    registry,
    repositoryRoot: root,
  }),
  (error) => error?.code === "PLATFORM_RESOURCE_AUTHORITY_RUNTIME_POOL_FORBIDDEN",
);

console.log("Activation Gateway rollout surface contract tests passed.");
