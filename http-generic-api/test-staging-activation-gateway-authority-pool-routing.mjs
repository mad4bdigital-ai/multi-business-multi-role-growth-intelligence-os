import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildActivationGatewayRolloutPlan } from "./activationGatewayRolloutTool.js";

const root = path.resolve(import.meta.dirname, "..");
const registry = JSON.parse(fs.readFileSync(
  path.join(root, "http-generic-api/config/environment-convergence-registry.json"),
  "utf8",
));
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

console.log(JSON.stringify({
  ok: true,
  runtime_authority_reads: runtimeAuthorityReads,
  governance_authority_reads: governanceAuthorityReads,
  runtime_workspace_reads: runtimeWorkspaceReads,
  production_mutation: false,
  provider_mutation: false,
  secrets_included: false,
}));
