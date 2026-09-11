import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTIVATION_GATEWAY_ROLLOUT_CONTRACT,
  buildActivationGatewayRolloutPlan,
} from "./activationGatewayRolloutTool.js";
import { buildStagingActivationGatewayBundle } from "./stagingActivationGatewayBundle.js";
import { readEnvironmentConvergenceRegistry } from "./environmentConvergenceRegistry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const registry = readEnvironmentConvergenceRegistry();
const staging = registry.profiles.staging.activation_gateway;
const bindingId = "5a2b04f8-bb99-4f65-a924-0f55d3080376";
const accountId = "dd1024b934e907723484568d97c7c74c";
const scriptName = "mad4b-activation-gateway-staging";
const sourceSha = "a".repeat(40);

assert.equal(ACTIVATION_GATEWAY_ROLLOUT_CONTRACT.script_name, "mad4b-activation-gateway");
assert.equal(staging.current_authority_adapter, "staging_activation_gateway_profile_apply");
assert.equal(staging.apply_capability, "activation_gateway_dark_deploy");
assert.equal(staging.governed_apply_ready, true);
assert.equal(staging.apply_block_reason, null);
assert.equal(staging.execution_target.resource_binding.resource_binding_id, bindingId);
assert.equal(staging.execution_target.runtime_surface, "activation_gateway_dark_deploy");
assert.equal(staging.execution_target.bundle_binding.bundle_key, "activation_gateway_staging_worker");
assert.equal(staging.execution_target.bundle_binding.entrypoint, "edge/activation-gateway/src/worker-staging.mjs");

const queries = [];
const pool = {
  async query(sql, params = []) {
    queries.push({ sql: String(sql), params });
    if (String(sql).includes("FROM platform_resource_authority_bindings")) {
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
    if (String(sql).includes("FROM workspace_registry")) {
      return [[{
        workspace_id: "11111111-1111-4111-8111-111111111111",
        tenant_id: "00000000-0000-0000-0000-000000000000",
        workspace_key: "platform-admin",
        display_name: "Platform Admin",
        workspace_type: "platform_admin",
        bootstrap_status: "ready",
      }]];
    }
    throw new Error(`Unexpected SQL in dry-run adapter test: ${sql}`);
  },
};
const cloudflareClient = {
  token_present: true,
  async request() { throw new Error("dry-run Staging plan must not call provider APIs"); },
};
const auth = {
  tenant_id: "00000000-0000-0000-0000-000000000000",
  user_id: "22222222-2222-4222-8222-222222222222",
};

const plan = await buildActivationGatewayRolloutPlan({
  mode: "dry_run",
  account_id: accountId,
  expected_source_commit: sourceSha,
  expected_policy_hash: staging.expected_policy_hash,
}, {
  pool,
  auth,
  env: { STAGING_ACTIVATION_GATEWAY_APPLY_ENABLED: "true" },
  cloudflareClient,
  registry,
  repositoryRoot: root,
  now: () => Date.parse("2026-09-11T12:00:00.000Z"),
});

assert.equal(plan.adapter, "staging_activation_gateway_profile_apply");
assert.equal(plan.environment, "staging");
assert.equal(plan.apply_ready, true);
assert.equal(plan.expected_source_commit, sourceSha);
assert.equal(plan.expected_policy_hash, staging.expected_policy_hash);
assert.equal(plan.profile_binding.policy_key, "activation_gateway_staging");
assert.equal(plan.profile_binding.public_host, "activation-dev.mad4b.com");
assert.equal(plan.profile_binding.execution_target.resource_binding.resource_binding_id, bindingId);
assert.equal(plan.resource_binding.account_id, accountId);
assert.equal(plan.resource_binding.script_name, scriptName);
assert.equal(plan.resource_binding.binding_id, bindingId);
assert.equal(plan.provider_target_caller_selectable, false);
assert.equal(plan.provider_credentials_returned, false);
assert.equal(plan.workflow_dispatch, false);
assert.equal(plan.production_mutation, false);
assert.equal(plan.database_mutation, false);
assert.equal(plan.secrets_included, false);
assert.equal(queries.some((entry) => entry.sql.includes("platform_resource_authority_bindings")), true);

await assert.rejects(
  buildActivationGatewayRolloutPlan({
    mode: "dry_run",
    account_id: "f".repeat(32),
    expected_source_commit: sourceSha,
    expected_policy_hash: staging.expected_policy_hash,
  }, { pool, auth, env: { STAGING_ACTIVATION_GATEWAY_APPLY_ENABLED: "true" }, cloudflareClient, registry, repositoryRoot: root }),
  (error) => error?.code === "staging_activation_gateway_account_assertion_mismatch",
);

await assert.rejects(
  buildActivationGatewayRolloutPlan({
    mode: "dry_run",
    account_id: accountId,
    resource_binding_id: "caller-selected-binding",
    expected_source_commit: sourceSha,
    expected_policy_hash: staging.expected_policy_hash,
  }, { pool, auth, env: { STAGING_ACTIVATION_GATEWAY_APPLY_ENABLED: "true" }, cloudflareClient, registry, repositoryRoot: root }),
  (error) => error?.code === "staging_activation_gateway_caller_target_override_forbidden",
);

const bundle = await buildStagingActivationGatewayBundle({
  sourceSha,
  repositoryRoot: root,
  now: () => Date.parse("2026-09-11T12:00:00.000Z"),
});
assert.equal(bundle.policy.policy_key, "activation_gateway_staging");
assert.equal(bundle.policy.public_host, "activation-dev.mad4b.com");
assert.equal(bundle.policy_hash, staging.expected_policy_hash);
assert.equal(bundle.worker_build_identity.source_sha, sourceSha);
assert.equal(bundle.origin_trust.contract, "mad4b.staging.activation-recovery-origin-trust.v2");
assert.equal(bundle.origin_trust.deployment_sha, sourceSha);
assert.equal(bundle.origin_trust.canonical_host, "activation-dev.mad4b.com");
assert.equal(bundle.origin_trust.audience, "https://dev.mad4b.com");
assert.equal(bundle.origin_trust.issuer, "https://activation-dev.mad4b.com");
assert.match(bundle.origin_trust.public_key, /^-----BEGIN PUBLIC KEY-----\n/u);
assert.equal(bundle.origin_trust.provider_credentials_included, false);
assert.equal(bundle.origin_trust.production_deploy, false);
assert.equal(bundle.origin_trust.database_mutation, false);
assert.equal(bundle.origin_trust.secrets_included, false);
assert.equal(bundle.worker_secret_names.includes("ACTIVATION_GATEWAY_INGRESS_PRIVATE_KEY_JWK"), true);
assert.equal(bundle.worker_secret_names.includes("ACTIVATION_GATEWAY_INGRESS_PUBLIC_KEY_PEM"), true);
assert.equal(bundle.files.find((file) => file.name === "worker-staging.mjs")?.content.includes("recoveryTrustedIngress"), true);

const wrapperSource = fs.readFileSync(path.join(__dirname, "activationGatewayRolloutTool.js"), "utf8");
const productionSource = fs.readFileSync(path.join(__dirname, "activationGatewayRolloutToolProduction.js"), "utf8");
const adapterSource = fs.readFileSync(path.join(__dirname, "stagingActivationGatewayApplyAdapter.js"), "utf8");
assert.match(wrapperSource, /activationGatewayRolloutToolProduction\.js/u);
assert.match(wrapperSource, /stagingActivationGatewayApplyAdapter\.js/u);
assert.match(productionSource, /script_name: "mad4b-activation-gateway"/u);
assert.doesNotMatch(productionSource, /staging_activation_gateway_profile_apply/u);
assert.doesNotMatch(adapterSource, /gh\s+workflow\s+run/iu);
assert.doesNotMatch(adapterSource, /wrangler\s+deploy/iu);
assert.doesNotMatch(adapterSource, /custom_domain_binding_allowed:\s*true/iu);
assert.doesNotMatch(adapterSource, /dns_write_allowed:\s*true/iu);

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.staging.activation-gateway-apply-adapter.test.v1",
  profile_bound_target: true,
  caller_target_override_blocked: true,
  production_rollout_preserved: true,
  public_recovery_trust_emitted: true,
  workflow_dispatch: false,
  production_mutation: false,
  secrets_included: false,
}));
