import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildActivationGatewayRolloutPlan } from "./activationGatewayRolloutTool.js";
import { PLATFORM_ADMIN_WORKSPACE_AUTHORITY } from "./src/domain/authorityScope/platformAdminWorkspaceAuthority.generated.js";

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
const authority = PLATFORM_ADMIN_WORKSPACE_AUTHORITY;
const platformWorkspaceId = authority.identity.workspace_id;
const platformTenantId = authority.identity.tenant_id;
const platformSeedKey = authority.identity.seed_workspace_key;
const platformResolverKey = authority.resolver.candidate_workspace_key;
const platformAuthorityScope = authority.resolver.authority_scope_key;

let runtimeAuthorityReads = 0;
let runtimeWorkspaceReads = 0;
let governanceAuthorityReads = 0;
let providerCalls = 0;

function canonicalWorkspaceRow(overrides = {}) {
  return {
    workspace_id: platformWorkspaceId,
    tenant_id: platformTenantId,
    workspace_key: platformSeedKey,
    display_name: authority.identity.display_name,
    workspace_type: authority.identity.workspace_type,
    bootstrap_status: authority.identity.bootstrap_status,
    config_json: JSON.stringify({
      authority_scope_key: platformAuthorityScope,
      platform_admin_workspace: true,
    }),
    ...overrides,
  };
}

function runtimePoolWithRows(rows, options = {}) {
  return {
    async query(sql, params = []) {
      const statement = String(sql);
      if (statement.includes("platform_resource_authority_bindings")) {
        runtimeAuthorityReads += 1;
        throw new Error("Runtime DB must never serve platform_resource_authority_bindings.");
      }
      if (statement.includes("FROM workspace_registry")) {
        runtimeWorkspaceReads += 1;
        if (options.throwOnWorkspaceRead) throw new Error("runtime database unavailable");
        assert.doesNotMatch(statement, /workspace_type='platform_admin'/u);
        assert.match(statement, /workspace_id=\?/u);
        assert.match(statement, /workspace_key IN \(\?,\?\)/u);
        assert.match(statement, /\$\.authority_scope_key/u);
        assert.match(statement, /\$\.platform_admin_workspace/u);
        assert.deepEqual(params, [
          platformTenantId,
          platformWorkspaceId,
          platformSeedKey,
          platformResolverKey,
          platformAuthorityScope,
        ]);
        return [rows];
      }
      throw new Error(`Unexpected Runtime DB query: ${statement}`);
    },
  };
}

const runtimePool = runtimePoolWithRows([canonicalWorkspaceRow()]);

const governancePool = {
  async query(sql, params = []) {
    const statement = String(sql);
    if (statement.includes("FROM platform_resource_authority_bindings")) {
      governanceAuthorityReads += 1;
      assert.deepEqual(params, [bindingId]);
      return [[{
        binding_id: bindingId,
        tenant_id: platformTenantId,
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

const sharedDeps = {
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
    async request() { providerCalls += 1; throw new Error("dry-run must not call Cloudflare"); },
  },
  registry,
  repositoryRoot: root,
};

async function buildWithRuntime(runtimePoolValue) {
  return buildActivationGatewayRolloutPlan({
    mode: "dry_run",
    account_id: accountId,
    expected_source_commit: sourceSha,
    expected_policy_hash: staging.expected_policy_hash,
    environment_convergence_plan_sha256: convergencePlanSha,
  }, { ...sharedDeps, runtimePool: runtimePoolValue });
}

const plan = await buildWithRuntime(runtimePool);
assert.equal(plan.adapter, "staging_activation_gateway_profile_apply");
assert.equal(plan.resource_binding.binding_id, bindingId);
assert.equal(plan.workspace.workspace_id, platformWorkspaceId);
assert.equal(plan.workspace.workspace_key, platformSeedKey);
assert.equal(plan.workspace.workspace_type, authority.identity.workspace_type);
assert.equal(plan.workspace_readiness.status, "ready");
assert.equal(plan.workspace_readiness.ready, true);
assert.equal(plan.apply_ready, false);
assert.equal(runtimeAuthorityReads, 0);
assert.equal(governanceAuthorityReads, 1);
assert.equal(runtimeWorkspaceReads, 1);
assert.equal(providerCalls, 0);
assert.equal(plan.production_mutation, false);
assert.equal(plan.secrets_included, false);

const readinessCases = [
  {
    name: "missing",
    pool: runtimePoolWithRows([]),
    status: "canonical_missing",
    classification: "staging_activation_gateway_canonical_missing",
  },
  {
    name: "not-ready",
    pool: runtimePoolWithRows([canonicalWorkspaceRow({ bootstrap_status: "pending" })]),
    status: "canonical_not_ready",
    classification: "staging_activation_gateway_canonical_not_ready",
  },
  {
    name: "identity-conflict",
    pool: runtimePoolWithRows([canonicalWorkspaceRow({ display_name: "Conflicting Admin" })]),
    status: "canonical_identity_conflict",
    classification: "staging_activation_gateway_canonical_identity_conflict",
  },
  {
    name: "ambiguous",
    pool: runtimePoolWithRows([
      canonicalWorkspaceRow(),
      {
        workspace_id: "22222222-2222-4222-8222-222222222222",
        tenant_id: platformTenantId,
        workspace_key: platformResolverKey,
        display_name: "Other",
        workspace_type: "project",
        bootstrap_status: "ready",
        config_json: "{}",
      },
    ]),
    status: "canonical_ambiguous",
    classification: "staging_activation_gateway_canonical_ambiguous",
  },
  {
    name: "runtime-unavailable",
    pool: runtimePoolWithRows([], { throwOnWorkspaceRead: true }),
    status: "runtime_database_unavailable",
    classification: "staging_activation_gateway_runtime_database_unavailable",
  },
];

for (const item of readinessCases) {
  const beforeProviderCalls = providerCalls;
  const blocked = await buildWithRuntime(item.pool);
  assert.equal(blocked.workspace, null, item.name);
  assert.equal(blocked.workspace_readiness.status, item.status, item.name);
  assert.equal(blocked.workspace_readiness.ready, false, item.name);
  assert.equal(blocked.classification, item.classification, item.name);
  assert.equal(blocked.apply_ready, false, item.name);
  assert.equal(providerCalls, beforeProviderCalls, `${item.name} must not enter provider request path`);
  assert.equal(blocked.provider_credentials_returned, false);
  assert.equal(blocked.production_mutation, false);
  assert.equal(blocked.database_mutation, false);
}
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
  (error) => error?.code === "staging_activation_gateway_runtime_database_authority_mismatch"
    && error?.details?.cause_code === "PLATFORM_RESOURCE_AUTHORITY_RUNTIME_POOL_FORBIDDEN",
);

console.log("Activation Gateway rollout surface contract tests passed.");
