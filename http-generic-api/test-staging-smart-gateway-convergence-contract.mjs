import assert from "node:assert/strict";
import "./test-staging-convergence-acknowledgement-cli.mjs";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ACTIVATION_GATEWAY_ROLLOUT_CONTRACT,
  buildActivationGatewayRolloutPlan,
} from "./activationGatewayRolloutTool.js";
import { buildStagingActivationGatewayBundle } from "./stagingActivationGatewayBundle.js";
import { runStagingActivationGatewayApply, _testingStagingGatewayTransaction } from "./stagingActivationGatewayApplyAdapter.js";
import { openStagingGatewayArtifact, sealStagingGatewayArtifact } from "./stagingGatewayExecutionPlanStore.js";
import {
  buildStagingActivationTrustInstallPlan,
  installStagingActivationTrust,
  STAGING_ACTIVATION_TRUST_ENV_ALLOWLIST,
} from "./stagingActivationTrustInstaller.js";

const root = path.resolve(import.meta.dirname, "..");
const portable = path.join(root, "autopilot-portable-staging");
const wrapper = fs.readFileSync(path.join(portable, "Invoke-Staging-One-Click.ps1"), "utf8");
const core = fs.readFileSync(path.join(portable, "Invoke-Staging-One-Click-Core.ps1"), "utf8");
const converger = fs.readFileSync(path.join(portable, "Converge-StagingActivationGateway.ps1"), "utf8");
const policy = JSON.parse(fs.readFileSync(path.join(portable, "activation-gateway-smart-convergence-policy.json"), "utf8"));
const registry = JSON.parse(fs.readFileSync(path.join(root, "http-generic-api/config/environment-convergence-registry.json"), "utf8"));
const bridge = fs.readFileSync(path.join(root, "http-generic-api/scripts/staging-environment-convergence-plan.mjs"), "utf8");
const workflow = fs.readFileSync(path.join(root, ".github/workflows/staging-main-deploy-eligibility.yml"), "utf8");
const liveCertification = fs.readFileSync(path.join(root, "http-generic-api/scripts/staging-live-certification.mjs"), "utf8");
const manifestGenerator = fs.readFileSync(path.join(root, "http-generic-api/scripts/generate-portable-staging-manifest.mjs"), "utf8");
const portableManifest = JSON.parse(fs.readFileSync(path.join(portable, "manifest.json"), "utf8"));
const workerBuilder = fs.readFileSync(path.join(root, "http-generic-api/scripts/build-staging-worker.mjs"), "utf8");
const serverBundleSource = fs.readFileSync(path.join(root, "http-generic-api/stagingActivationGatewayBundle.js"), "utf8");
const serverAdapterSource = fs.readFileSync(path.join(root, "http-generic-api/stagingActivationGatewayApplyAdapter.js"), "utf8");
const trustInstallerSource = fs.readFileSync(path.join(root, "http-generic-api/stagingActivationTrustInstaller.js"), "utf8");
const rolloutWrapperSource = fs.readFileSync(path.join(root, "http-generic-api/activationGatewayRolloutTool.js"), "utf8");
const productionRolloutSource = fs.readFileSync(path.join(root, "http-generic-api/activationGatewayRolloutToolProduction.js"), "utf8");
const migrationSource = fs.readFileSync(path.join(root, "http-generic-api/migrations/20260911_staging_activation_gateway_apply_adapter.sql"), "utf8");
const hardeningMigrationSource = fs.readFileSync(path.join(root, "http-generic-api/migrations/20260912_staging_activation_gateway_transaction_hardening.sql"), "utf8");
const trustedIngress = fs.readFileSync(path.join(root, "http-generic-api/trustedIngressContract.js"), "utf8");
const activationGatewayRoutes = fs.readFileSync(path.join(root, "http-generic-api/routes/activationHostGatewayRoutes.js"), "utf8");
const stagingEnvExample = fs.readFileSync(path.join(root, "http-generic-api/.env.staging.example"), "utf8");
const stagingWorker = fs.readFileSync(path.join(root, "edge/activation-gateway/src/worker-staging.mjs"), "utf8");

const protectedPortablePaths = [
  "autopilot-portable-staging/Invoke-Staging-One-Click.ps1",
  "autopilot-portable-staging/Invoke-Staging-One-Click-Core.ps1",
  "autopilot-portable-staging/Converge-StagingActivationGateway.ps1",
  "autopilot-portable-staging/activation-gateway-smart-convergence-policy.json",
];
for (const relativePath of protectedPortablePaths) {
  assert.ok(manifestGenerator.includes(`"${relativePath}"`), `portable manifest writer must register ${relativePath}`);
  assert.ok(portableManifest.files.some((entry) => entry.path === relativePath), `portable manifest must hash ${relativePath}`);
}

const staging = registry.profiles.staging.activation_gateway;
const bindingId = "5a2b04f8-bb99-4f65-a924-0f55d3080376";
const accountId = "dd1024b934e907723484568d97c7c74c";
const scriptName = "mad4b-activation-gateway-staging";
const sourceSha = "a".repeat(40);
const convergencePlanSha = "e".repeat(64);

assert.equal(policy.contract, "mad4b.staging.activation-gateway-smart-convergence-policy.v3");
assert.equal(policy.environment, "staging");
assert.equal(policy.enabled_by_switch, "EnableActivationGateway");
assert.equal(policy.shared_convergence_registry, "http-generic-api/config/environment-convergence-registry.json");
assert.equal(policy.shared_convergence_bridge, "http-generic-api/scripts/staging-environment-convergence-plan.mjs");
assert.equal(policy.local_trust_installer, "http-generic-api/scripts/install-staging-activation-trust.mjs");
assert.equal(policy.typed_recovery.requires_preflight_status, "passed");
assert.equal(policy.typed_recovery.requires_exact_preflight_commit, true);
assert.equal(policy.typed_recovery.classification_source, "environment_convergence_registry");
assert.equal(policy.typed_recovery.hardcoded_gateway_drift_allowlist_in_launcher, false);
assert.equal(policy.typed_recovery.next_action_source, "report.convergence.next_governed_handoff");
assert.equal(policy.typed_recovery.maximum_core_retries_after_convergence, 1);
assert.deepEqual(policy.typed_recovery.retry_reason_allowlist, ["exact_public_gateway_trust_installed_locally"]);
assert.equal(policy.deployment_authority.target_authority_model, "server_governed");
assert.equal(policy.deployment_authority.current_authority_adapter, "staging_activation_gateway_profile_apply");
assert.equal(policy.deployment_authority.current_apply_capability, "activation_gateway_dark_deploy");
assert.equal(policy.deployment_authority.current_apply_ready, true);
assert.equal(policy.deployment_authority.apply_block_reason, null);
assert.equal(policy.deployment_authority.resource_binding_id, bindingId);
assert.equal(policy.deployment_authority.launcher_workflow_dispatch_allowed, false);
assert.equal(policy.deployment_authority.legacy_helper_workflow_dispatch_allowed, false);
assert.equal(policy.deployment_authority.direct_cloudflare_api_from_launcher, false);
assert.equal(policy.deployment_authority.local_cloudflare_api_token_read, false);
assert.equal(policy.deployment_authority.caller_selected_provider_target_allowed, false);
assert.equal(policy.policy_identity.policy_key, "activation_gateway_staging");
assert.equal(policy.policy_identity.expected_policy_hash, staging.expected_policy_hash);
assert.equal(policy.policy_identity.public_host, "activation-dev.mad4b.com");
assert.equal(policy.policy_identity.bundle_key, "activation_gateway_staging_worker");
assert.equal(policy.policy_identity.entrypoint, "edge/activation-gateway/src/worker-staging.mjs");
assert.equal(policy.policy_identity.caller_policy_path_override_allowed, false);
assert.equal(policy.policy_identity.plan_hash_binds_policy_hash, true);
assert.equal(policy.postconditions.public_recovery_trust_bundle_required, true);
assert.equal(policy.postconditions.public_recovery_trust_contract, "mad4b.staging.activation-recovery-origin-trust.v2");
assert.equal(policy.mutation_scope.provider_mutation_from_launcher, false);
assert.equal(policy.mutation_scope.provider_mutation_from_legacy_helper, false);
assert.equal(policy.mutation_scope.server_governed_worker_apply, true);
assert.equal(policy.mutation_scope.local_origin_trust_config_mutation_from_launcher, true);
assert.equal(policy.mutation_scope.local_origin_trust_config_mutation_scope, "eight_key_allowlist_after_exact_public_evidence_only");
assert.equal(policy.mutation_scope.local_origin_trust_config_mutation_from_legacy_helper, false);
assert.equal(policy.mutation_scope.cloudflare_worker_mutation_from_orchestrator, false);
assert.equal(policy.mutation_scope.cloudflare_dns_mutation, false);
assert.equal(policy.mutation_scope.database_mutation, false);
assert.equal(policy.mutation_scope.production_deploy, false);
assert.equal(policy.mutation_scope.production_mutation, false);
assert.equal(policy.evidence.legacy_helper_contract, "mad4b.staging.activation-gateway-convergence.v3");
assert.equal(policy.evidence.server_bundle_contract, "mad4b.staging.activation-gateway-server-bundle.v1");
assert.equal(policy.evidence.public_trust_contract, "mad4b.staging.activation-recovery-origin-trust.v2");
assert.equal(policy.evidence.secrets_included, false);

assert.equal(staging.current_authority_adapter, "staging_activation_gateway_profile_apply");
assert.equal(staging.legacy_authority_adapter, "staging_activation_worker_workflow");
assert.equal(staging.apply_capability, "activation_gateway_dark_deploy");
assert.equal(staging.governed_apply_ready, true);
assert.equal(staging.apply_block_reason, null);
assert.equal(staging.execution_target.resource_binding.resource_binding_id, bindingId);
assert.equal(staging.execution_target.runtime_surface, "activation_gateway_dark_deploy");
assert.equal(staging.execution_target.bundle_binding.bundle_key, "activation_gateway_staging_worker");
assert.equal(staging.execution_target.bundle_binding.entrypoint, "edge/activation-gateway/src/worker-staging.mjs");
assert.equal(registry.dependencies.activation_gateway.checks.gateway_recovery_trusted_ingress.repairability, "governed");
for (const requiredBoundaryPath of [
  "autopilot-portable-staging/Invoke-Staging-One-Click.ps1",
  "autopilot-portable-staging/Converge-StagingActivationGateway.ps1",
  "http-generic-api/scripts/staging-environment-convergence-plan.mjs",
]) {
  assert.ok(registry.orchestrator_boundary.orchestrators.includes(requiredBoundaryPath), `${requiredBoundaryPath} must be guarded by the orchestrator boundary`);
}

assert.match(wrapper, /Invoke-Staging-One-Click-Core\.ps1/u);
assert.match(wrapper, /staging-environment-convergence-plan\.mjs/u);
assert.match(wrapper, /install-staging-activation-trust\.mjs/u);
assert.match(wrapper, /Invoke-LocalRecoveryTrustRefresh/u);
assert.match(wrapper, /'--mode','dry_run'/u);
assert.match(wrapper, /'--mode','apply'/u);
assert.match(wrapper, /exact_public_gateway_trust_installed_locally/u);
assert.match(wrapper, /local_origin_trust_mutation_scope/u);
assert.match(wrapper, /eight_key_allowlist_after_exact_public_evidence_only/u);
assert.match(wrapper, /\$classification = \$bridge\.report\.convergence/u);
assert.match(wrapper, /\$handoff = \$classification\.next_governed_handoff/u);
assert.match(wrapper, /environment_convergence_next_governed_handoff/u);
assert.match(wrapper, /environment_convergence_plan_sha256/u);
assert.match(wrapper, /Test-LocalRecoveryTrustExact/u);
assert.doesNotMatch(wrapper, /Get-GatewayDriftRecovery/u);
assert.doesNotMatch(wrapper, /Invoke-GatewayConvergence/u);
assert.doesNotMatch(wrapper, /Converge-StagingActivationGateway\.ps1/u);
for (const hardcodedDriftKey of [
  "gateway_exact_commit",
  "gateway_policy_not_stale",
  "gateway_policy_hash_current",
  "gateway_policy_key_current",
  "gateway_recovery_trusted_ingress",
]) {
  assert.equal(wrapper.includes(hardcodedDriftKey), false, `launcher must not classify ${hardcodedDriftKey} locally`);
}
assert.match(wrapper, /provider_mutation -NotePropertyValue \$false/u);
assert.match(wrapper, /cloudflare_worker_mutation -NotePropertyValue \$false/u);
assert.match(wrapper, /cloudflare_dns_mutation -NotePropertyValue \$false/u);
assert.match(wrapper, /production_mutation -NotePropertyValue \$false/u);
assert.match(wrapper, /secrets_included -NotePropertyValue \$false/u);

assert.match(bridge, /runEnvironmentConvergence/u);
assert.match(bridge, /readEnvironmentConvergenceRegistry/u);
assert.match(bridge, /certification_blocking_failures/u);
assert.match(bridge, /certification_degraded_reasons/u);
assert.match(bridge, /gateway_recovery_trusted_ingress/u);
assert.match(bridge, /mad4b\.staging-environment-convergence-bridge\.v1/u);
assert.match(bridge, /provider_mutation: false/u);
assert.match(bridge, /workflow_dispatch: false/u);
assert.match(bridge, /production_mutation: false/u);
assert.match(bridge, /database_mutation: false/u);

assert.match(converger, /mad4b\.staging\.activation-gateway-convergence\.v3/u);
assert.match(converger, /legacy_adapter_retired/u);
assert.match(converger, /workflow_dispatch_allowed = \$false/u);
assert.match(converger, /provider_mutation_allowed = \$false/u);
assert.match(converger, /local_origin_trust_mutation_allowed = \$false/u);
assert.match(converger, /provider_mutation = \$false/u);
assert.match(converger, /workflow_dispatch = \$false/u);
assert.match(converger, /cloudflare_worker_mutation = \$false/u);
assert.match(converger, /production_mutation = \$false/u);
assert.match(converger, /database_mutation = \$false/u);
assert.match(converger, /secrets_included = \$false/u);
assert.doesNotMatch(converger, /gh\s+workflow\s+run/iu);
assert.doesNotMatch(converger, /gh\s+api\s+--method\s+POST/iu);
assert.doesNotMatch(converger, /gh\s+run\s+download/iu);
assert.doesNotMatch(converger, /\/dispatches/u);
assert.doesNotMatch(converger, /Set-StagingEnvValue/u);

for (const orchestratorSource of [wrapper, converger, bridge]) {
  assert.doesNotMatch(orchestratorSource, /CLOUDFLARE_API_TOKEN/u);
  assert.doesNotMatch(orchestratorSource, /api\.cloudflare\.com\/client\/v4/iu);
  assert.doesNotMatch(orchestratorSource, /wrangler\s+deploy/iu);
  assert.doesNotMatch(orchestratorSource, /gh\s+workflow\s+run/iu);
}

assert.match(rolloutWrapperSource, /activationGatewayRolloutToolProduction\.js/u);
assert.match(rolloutWrapperSource, /stagingActivationGatewayApplyAdapter\.js/u);
assert.match(productionRolloutSource, /script_name: "mad4b-activation-gateway"/u);
assert.doesNotMatch(productionRolloutSource, /staging_activation_gateway_profile_apply/u);
assert.match(serverAdapterSource, /staging_activation_gateway_profile_apply/u);
assert.match(serverAdapterSource, /platform_resource_authority_bindings/u);
assert.match(serverAdapterSource, /STAGING_ACTIVATION_GATEWAY_APPLY_ENABLED/u);
assert.match(serverAdapterSource, /staging_activation_gateway_caller_target_override_forbidden/u);
assert.match(serverAdapterSource, /recovery_trust_bundle/u);
assert.doesNotMatch(serverAdapterSource, /gh\s+workflow\s+run/iu);
assert.doesNotMatch(serverAdapterSource, /wrangler\s+deploy/iu);
assert.doesNotMatch(serverAdapterSource, /custom_domain_binding_allowed:\s*true/iu);
assert.doesNotMatch(serverAdapterSource, /dns_write_allowed:\s*true/iu);
assert.match(serverBundleSource, /ACTIVATION_GATEWAY_INGRESS_PRIVATE_KEY_JWK/u);
assert.match(serverBundleSource, /ACTIVATION_GATEWAY_INGRESS_PUBLIC_KEY_PEM/u);
assert.match(serverBundleSource, /mad4b\.staging\.activation-recovery-origin-trust\.v2/u);
assert.match(serverBundleSource, /provider_credentials_included: false/u);
assert.match(stagingWorker, /recoveryTrustedIngress/u);
assert.match(stagingWorker, /ACTIVATION_GATEWAY_INGRESS_PUBLIC_KEY_PEM/u);
assert.match(trustInstallerSource, /STAGING_ACTIVATION_TRUST_ENV_ALLOWLIST/u);
assert.match(trustInstallerSource, /REMOTE_MCP_EXPECTED_DEPLOYMENT_SHA/u);
assert.doesNotMatch(trustInstallerSource, /CLOUDFLARE_API_TOKEN/u);
assert.doesNotMatch(trustInstallerSource, /api\.cloudflare\.com/iu);
assert.match(migrationSource, /5a2b04f8-bb99-4f65-a924-0f55d3080376/u);
assert.match(migrationSource, /mad4b-activation-gateway-staging/u);
assert.match(migrationSource, /activation_gateway\.staging_apply/u);
assert.match(migrationSource, /caller_selected_provider_target/u);
assert.match(migrationSource, /dns_write_allowed', FALSE/u);
assert.match(migrationSource, /production_mutation_allowed', FALSE/u);

// The legacy workflow remains deployment infrastructure but is not callable by AutoPilot.
assert.match(workflow, /operation == 'deploy_activation_worker'/u);
assert.match(workflow, /DEPLOY_STAGING_ACTIVATION_WORKER/u);
assert.match(workflow, /mad4b-activation-gateway-staging/u);
assert.match(workflow, /test "\$\(git rev-parse origin\/main\)" = "\$SOURCE_SHA"/u);
assert.match(workflow, /\.sourceCommit == \$sha/u);
assert.match(workflow, /\.workerBuildSha == \$sha/u);
assert.match(workflow, /\.stale == false/u);
assert.match(workflow, /\.secretsIncluded == false/u);
assert.match(workflow, /origin-trust\.json/u);

assert.match(workerBuilder, /writeStagingActivationGatewayBundle/u);
assert.match(workerBuilder, /public_recovery_trust_embedded: true/u);
assert.match(workerBuilder, /provider_credentials_included: false/u);
assert.match(trustedIngress, /trustedIngressPublicKey/u);
assert.match(trustedIngress, /replaceAll\("\\\\n", "\\n"\)/u);
assert.match(activationGatewayRoutes, /createFileRecoveryEvidenceStore/u);
assert.match(activationGatewayRoutes, /RECOVERY_STAGING_INGRESS_REPLAY_DIRECTORY/u);
assert.match(activationGatewayRoutes, /runtime_class !== "local_windows_docker"/u);
assert.match(activationGatewayRoutes, /effectiveIngressReplayStore/u);
assert.match(stagingEnvExample, /^REMOTE_MCP_TRUSTED_INGRESS_MODE=signature$/mu);
assert.match(stagingEnvExample, /^REMOTE_MCP_TRUSTED_INGRESS_KEY_ID=$/mu);
assert.match(stagingEnvExample, /^REMOTE_MCP_EXPECTED_DEPLOYMENT_SHA=$/mu);
assert.match(stagingEnvExample, /^RECOVERY_STAGING_INGRESS_REPLAY_DIRECTORY=\/app\/data\/recovery-ingress$/mu);
assert.doesNotMatch(stagingEnvExample, /^ACTIVATION_GATEWAY_INGRESS_PRIVATE_KEY_JWK=/mu);

assert.match(liveCertification, /loadActivationGatewayProfilePolicy\("staging"/u);
assert.doesNotMatch(liveCertification, /STAGING_CERT_GATEWAY_POLICY_PATH/u);
assert.match(liveCertification, /gateway_health_reachable/u);
assert.match(liveCertification, /gateway_exact_commit/u);
assert.match(liveCertification, /gateway_policy_hash_current/u);
assert.match(liveCertification, /read_only_probe: true/u);
assert.match(liveCertification, /provider_mutation: false/u);

assert.match(core, /\$existingId = \(& docker @\(\$composeArgs \+ @\('ps','-q','app'\)\)/u);
assert.match(core, /Invoke-Checked 'docker' \(\$composeArgs \+ @\('stop','--timeout','15','app'\)\)/u);
assert.match(core, /Existing app did not stop before the Windows loopback port transition/u);
assert.ok(
  core.indexOf("Invoke-Checked 'docker' ($composeArgs + @('stop','--timeout','15','app'))")
    < core.indexOf("Invoke-Checked 'docker' ($composeArgs + @('up','-d','--no-build','app'))"),
  "Windows loopback transition must stop the existing app before changing host-port binding",
);
assert.match(core, /mad4b\.staging-dual-mode-one-click\.v1/u);
assert.match(core, /production_mutation = \$false/u);
assert.match(core, /provider_mutation = \$false/u);

assert.equal(ACTIVATION_GATEWAY_ROLLOUT_CONTRACT.script_name, "mad4b-activation-gateway");
const dryRunQueries = [];
const dryRunPool = {
  async query(sql, params = []) {
    dryRunQueries.push({ sql: String(sql), params });
    if (String(sql).includes("FROM platform_resource_authority_bindings")) {
      assert.deepEqual(params, [bindingId]);
      return [[{
        binding_id: bindingId,
        tenant_id: "00000000-0000-0000-0000-000000000000",
        workspace_id: null,
        user_id: null,
        resource_type: "cloudflare_worker",
        resource_uri: `cloudflare://accounts/${accountId}/workers/scripts/${scriptName}`,
        resource_ref_json: JSON.stringify({ provider: "cloudflare", account_id: accountId, script_name: scriptName, profile_key: "activation_gateway_staging", workers_dev_only: true, dns_write_allowed: false, custom_domain_binding_allowed: false, secrets_included: false }),
        recipe_key: "staging_activation_gateway_apply",
        permission_level: "admin",
        allowed_modes_json: JSON.stringify(["dry_run", "staging_apply"]),
        authority_source: "migration_seed",
        expires_at: null,
        status: "active",
      }]];
    }
    if (String(sql).includes("FROM workspace_registry")) {
      return [[{ workspace_id: "11111111-1111-4111-8111-111111111111", tenant_id: "00000000-0000-0000-0000-000000000000", workspace_key: "platform-admin", display_name: "Platform Admin", workspace_type: "platform_admin", bootstrap_status: "ready" }]];
    }
    throw new Error(`Unexpected SQL in Staging dry-run contract: ${sql}`);
  },
};
const fakeCloudflareClient = { token_present: true, async request() { throw new Error("dry-run must not call Cloudflare"); } };
const auth = { tenant_id: "00000000-0000-0000-0000-000000000000", principal_type: "user", user_id: "22222222-2222-4222-8222-222222222222" };
const rolloutPlan = await buildActivationGatewayRolloutPlan({
  mode: "dry_run",
  account_id: accountId,
  expected_source_commit: sourceSha,
  expected_policy_hash: staging.expected_policy_hash, environment_convergence_plan_sha256: convergencePlanSha,
}, {
  pool: dryRunPool,
  auth,
  env: { STAGING_ACTIVATION_GATEWAY_APPLY_ENABLED: "true", DEPLOYMENT_MANIFEST_JSON: JSON.stringify({ repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os", branch: "main", commit_sha: sourceSha }) },
  cloudflareClient: fakeCloudflareClient,
  registry,
  repositoryRoot: root,
  now: () => Date.parse("2026-09-11T12:00:00.000Z"),
});
assert.equal(rolloutPlan.adapter, "staging_activation_gateway_profile_apply");
assert.equal(rolloutPlan.apply_ready, true);
assert.equal(rolloutPlan.resource_binding.binding_id, bindingId);
assert.equal(rolloutPlan.resource_binding.account_id, accountId);
assert.equal(rolloutPlan.resource_binding.script_name, scriptName);
assert.equal(rolloutPlan.provider_target_caller_selectable, false);
assert.equal(rolloutPlan.workflow_dispatch, false);
assert.equal(rolloutPlan.production_mutation, false);
assert.equal(rolloutPlan.secrets_included, false);
assert.equal(dryRunQueries.some((entry) => entry.sql.includes("platform_resource_authority_bindings")), true);
const servicePlan = await buildActivationGatewayRolloutPlan({ account_id: accountId, expected_source_commit: sourceSha,
  expected_policy_hash: staging.expected_policy_hash, environment_convergence_plan_sha256: convergencePlanSha }, {
  pool: dryRunPool, auth: { mode: "backend_api_key", principal_type: "admin", is_admin: true },
  env: { STAGING_ACTIVATION_GATEWAY_APPLY_ENABLED: "true", DEPLOYMENT_MANIFEST_JSON: JSON.stringify({
    repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os", branch: "main", commit_sha: sourceSha }) },
  cloudflareClient: fakeCloudflareClient, registry, repositoryRoot: root,
});
assert.equal(servicePlan.workspace.workspace_type, "platform_admin");
assert.equal(rolloutPlan.environment_convergence_plan_sha256, convergencePlanSha);
assert.match(rolloutPlan.required_confirmation, new RegExp(`^DEPLOY_STAGING_GATEWAY_${sourceSha.slice(0, 12).toUpperCase()}_[0-9A-F]{12}$`, "u"));
assert.equal(rolloutPlan.required_capability.approval_required_for_apply, false);
assert.equal(rolloutPlan.required_capability.operator_acknowledgement_is_execution_authority, false);
assert.match(hardeningMigrationSource, /certification_status='pending', dispatch_allowed=0, apply_allowed=0/u);
assert.match(hardeningMigrationSource, /staging_activation_gateway_execution_artifacts/u);
const storageEnv = { TOKEN_ENCRYPTION_KEY: "f".repeat(64) };
const encrypted = sealStagingGatewayArtifact({ bundle: { secret: "private-test" } }, { env: storageEnv, planId: rolloutPlan.plan_id });
assert.equal(encrypted.includes("private-test"), false);
assert.equal(openStagingGatewayArtifact(encrypted, { env: storageEnv, planId: rolloutPlan.plan_id }).bundle.secret, "private-test");
assert.throws(() => openStagingGatewayArtifact(encrypted, { env: storageEnv, planId: crypto.randomUUID() }), /failed authentication/u);
assert.notEqual((await buildActivationGatewayRolloutPlan({ account_id: accountId, expected_source_commit: sourceSha,
  expected_policy_hash: staging.expected_policy_hash, environment_convergence_plan_sha256: convergencePlanSha },
{ pool: dryRunPool, auth, env: { STAGING_ACTIVATION_GATEWAY_APPLY_ENABLED: "true", DEPLOYMENT_MANIFEST_JSON: JSON.stringify({ repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os", branch: "main", commit_sha: sourceSha }) },
  cloudflareClient: fakeCloudflareClient, registry, repositoryRoot: root })).plan_sha256, rolloutPlan.plan_sha256);
const savedArtifacts = new Map();
const savedPlans = new Map();
const envelopeBindings = new Map();
const envelopeStates = new Map();
const governancePool = {
  async query(sql, params = []) {
    const statement = String(sql);
    if (statement.includes("FROM capability_resolution_envelope_ledger") && statement.includes("envelope_json")) {
      const state = envelopeStates.get(params[0]); return [state ? [state] : []];
    }
    if (statement.includes("FROM capability_resolution_envelope_ledger") && statement.includes("capability_key"))
      return [[{ capability_key: "admin_cloudflare_v1", workspace_id: "11111111-1111-4111-8111-111111111111" }]];
    if (statement.includes("INSERT IGNORE INTO staging_activation_gateway_envelope_plan_bindings")) {
      if (!envelopeBindings.has(params[0])) envelopeBindings.set(params[0], { plan_id: params[1], plan_sha256: params[2],
        environment_convergence_plan_sha256: params[3], principal_type: params[4], principal_id: params[5] });
      return [{ affectedRows: 1 }];
    }
    if (statement.includes("FROM staging_activation_gateway_envelope_plan_bindings"))
      return [envelopeBindings.has(params[0]) ? [envelopeBindings.get(params[0])] : []];
    if (statement.includes("FROM runtime_dispatch_certification_registry"))
      return [[{ certification_status: "certified", dispatch_allowed: 1, apply_allowed: 1, requires_readback: 1 }]];
    if (statement.includes("UPDATE capability_resolution_envelope_ledger")) {
      const id = params.at(-1); const state = envelopeStates.get(id);
      if (!state || (statement.includes("execution_status IN") && !["not_executed", "referenced"].includes(state.execution_status))) return [{ affectedRows: 0 }];
      state.execution_status = statement.includes("'executed'") ? "executed" : statement.includes("'cancelled'") ? "cancelled" : "referenced";
      state.execution_ref = params[0];
      return [{ affectedRows: 1 }];
    }
    if (statement.includes("UPDATE staging_activation_gateway_execution_plans")) {
      const id = statement.includes("status='claimed'") ? params[0] : params[2];
      const state = savedPlans.get(id); if (!state) return [{ affectedRows: 0 }];
      if (statement.includes("status='claimed'")) { if (state.status !== "ready") return [{ affectedRows: 0 }]; state.status = "claimed"; }
      else { if (state.status !== params[3]) return [{ affectedRows: 0 }]; state.status = params[0]; }
      return [{ affectedRows: 1 }];
    }
    if (statement.includes("SELECT status FROM staging_activation_gateway_execution_plans"))
      return [[{ status: savedPlans.get(params[0])?.status }]];
    if (String(sql).includes("FROM staging_activation_gateway_execution_plans p")) {
      const row = savedPlans.get(params[0]);
      return [row && row.status === "ready" && row.plan_sha256 === params[1] && row.environment_convergence_plan_sha256 === params[2]
        ? [{ ...row, encrypted_artifact: savedArtifacts.get(row.bundle_ref) }] : []];
    }
    return dryRunPool.query(sql, params);
  },
  async getConnection() {
    return {
      async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
      async query(sql, params) {
        if (String(sql).includes("INSERT INTO staging_activation_gateway_execution_artifacts")) {
          savedArtifacts.set(params[0], params[1]); return [{ affectedRows: 1 }];
        }
        if (String(sql).includes("INSERT INTO staging_activation_gateway_execution_plans")) {
          const body = JSON.parse(params[2]);
          savedPlans.set(params[0], {
            plan_id: params[0], plan_sha256: params[1], plan_body_json: params[2],
            environment_convergence_plan_sha256: params[3], expected_source_commit: params[4],
            expected_policy_hash: params[5], resource_binding_id: params[6], workspace_id: params[7],
            bundle_sha256: params[8], secret_set_sha256: params[9], trust_key_id: params[10],
            trust_public_key_sha256: params[11], bundle_ref: params[12], expires_at: body.expires_at,
            status: "ready",
          }); return [{ affectedRows: 1 }];
        }
        throw new Error(`Unexpected execution plan store query: ${sql}`);
      },
    };
  },
};
const runtimePool = {
  async query(sql, params) {
    if (/\b(?:INSERT|UPDATE|DELETE)\b/iu.test(String(sql)) || String(sql).includes("staging_activation_gateway_execution_plans") || String(sql).includes("staging_activation_gateway_execution_artifacts") || String(sql).includes("staging_activation_gateway_envelope_plan_bindings"))
      throw new Error("runtime pool has no governance mutation authority");
    return governancePool.query(sql, params);
  },
  async getConnection() { throw new Error("runtime pool cannot write execution plans"); },
};
const adapterSource = fs.readFileSync(path.join(root, "http-generic-api/stagingActivationGatewayApplyAdapter.js"), "utf8");
assert.doesNotMatch(adapterSource, /UPDATE\s+capability_resolution_envelope_ledger/iu);
assert.match(adapterSource, /markCapabilityEnvelopeReferenced\(\{ writerPool: governancePool/iu);
assert.match(adapterSource, /transitionCapabilityEnvelopeLifecycle\(\{ writerPool: governancePool/iu);
await assert.rejects(runtimePool.query("INSERT INTO staging_activation_gateway_execution_plans VALUES (?)", ["forbidden"]), /runtime pool has no governance mutation authority/u);
await assert.rejects(runtimePool.getConnection(), /runtime pool cannot write execution plans/u);
const executionEnv = { ...storageEnv, STAGING_ACTIVATION_GATEWAY_APPLY_ENABLED: "true", DEPLOYMENT_MANIFEST_JSON: JSON.stringify({ repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os", branch: "main", commit_sha: sourceSha }) };
const dryRunInput = { mode: "dry_run", account_id: accountId, expected_source_commit: sourceSha,
  expected_policy_hash: staging.expected_policy_hash, environment_convergence_plan_sha256: convergencePlanSha };
const executionDeps = { runtimePool, governancePool, auth, env: executionEnv, cloudflareClient: fakeCloudflareClient,
  registry, repositoryRoot: root };
const firstExecution = await runStagingActivationGatewayApply(dryRunInput, executionDeps);
const secondExecution = await runStagingActivationGatewayApply(dryRunInput, executionDeps);
assert.notEqual(firstExecution.plan_sha256, secondExecution.plan_sha256);
assert.notEqual(firstExecution.plan_id, secondExecution.plan_id);
assert.equal(savedPlans.size, 2);
const originalBundle = openStagingGatewayArtifact(savedArtifacts.get(firstExecution.bundle_ref),
  { env: executionEnv, planId: firstExecution.plan_id }).bundle;
const otherBundle = openStagingGatewayArtifact(savedArtifacts.get(secondExecution.bundle_ref),
  { env: executionEnv, planId: secondExecution.plan_id }).bundle;
const versionForm = _testingStagingGatewayTransaction.buildUploadForm(originalBundle, firstExecution);
const versionMetadata = JSON.parse(await versionForm.get("metadata").text());
assert.equal(versionMetadata.bindings.length, originalBundle.worker_secret_names.length);
assert.equal(versionMetadata.bindings.every((binding) => binding.type === "secret_text"
  && binding.text === originalBundle.worker_secrets[binding.name]), true);
assert.equal(versionMetadata.annotations["workers/message"], `staging gateway plan ${firstExecution.plan_sha256}`);
const previous = { id: "previous", versions: [{ version_id: "old-version", percentage: 100 }] };
const rollbackCalls = [];
const rollbackClient = { async request(request) {
  rollbackCalls.push(request);
  if (request.method === "POST") return { ok: true };
  return { ok: true, result: [{ id: "restored", versions: previous.versions }] };
} };
const previousHealth = { ok: true, body: { ok: true, sourceCommit: "old" } };
const previousReady = { ok: true, body: { ok: true, trustedIngress: { key_id: "old-key" } } };
const rollbackFetch = async (url) => new Response(JSON.stringify(url.endsWith("/health")
  ? previousHealth.body : previousReady.body), { status: 200 });
const restored = await _testingStagingGatewayTransaction.rollback({ client: rollbackClient,
  accountId, scriptName, previousDeployment: previous, scriptExistedBefore: true,
  previousHealth, previousReady, fetchImpl: rollbackFetch, publicHost: staging.public_host });
assert.equal(restored.rollback_verified, true);
assert.match(rollbackCalls[0].apiPath, /\/deployments\?force=true$/u);
assert.deepEqual(rollbackCalls[0].body.versions, previous.versions);
const unknownPrevious = await _testingStagingGatewayTransaction.rollback({ client: rollbackClient,
  accountId, scriptName, previousDeployment: null, scriptExistedBefore: true });
assert.equal(unknownPrevious.rollback_verified, false);
assert.equal(unknownPrevious.manual_recovery_required, true);
assert.equal(rollbackCalls.some((call) => call.method === "DELETE"), false);
assert.notEqual(originalBundle.origin_trust.public_key, otherBundle.origin_trust.public_key);
assert.equal(originalBundle.source_sha, sourceSha);
const applyIdentity = { ...dryRunInput, mode: "apply", plan_id: firstExecution.plan_id,
  plan_sha256: firstExecution.plan_sha256, confirm: firstExecution.required_confirmation,
  execution_nonce: "nonce:12345678" };
await assert.rejects(runStagingActivationGatewayApply({ ...applyIdentity,
  environment_convergence_plan_sha256: "d".repeat(64) }, executionDeps),
(error) => error.code === "staging_activation_gateway_stale_plan");
await assert.rejects(runStagingActivationGatewayApply(applyIdentity, { ...executionDeps,
  repositoryRoot: "/this-path-must-not-be-read-during-apply" }),
(error) => error.code === "staging_activation_gateway_audit_required");
assert.equal(savedPlans.size, 2);
function registerEnvelope(plan, id) {
  envelopeStates.set(id, {
    envelope_id: id, tenant_id: auth.tenant_id, user_id: auth.user_id,
    workspace_id: "11111111-1111-4111-8111-111111111111", app_key: "cloudflare",
    capability_key: "admin_cloudflare_v1", operation_intent: "activation_gateway.staging_apply",
    selected_runtime_surface: "activation_gateway_dark_deploy", envelope_status: "ready_for_dispatch",
    execution_status: "not_executed", decision: "ready_for_dispatch", dispatch_allowed: 1,
    apply_allowed: 1, readback_required: 1, approval_required: 0, blocking_gap_count: 0,
    envelope_json: JSON.stringify({ request_context: { resource_uri: firstExecution.resource_binding.resource_uri,
      expected_commit_sha: sourceSha, binding_sha256: plan.plan_sha256,
      capability_sha256: convergencePlanSha, principal: { principal_type: "user", principal_id: auth.user_id } } }),
  });
}
registerEnvelope(firstExecution, "pre-audit-failure-envelope");
let providerWrites = 0;
const noWriteProvider = { token_present: true, async request(request) {
  if (request.method !== "GET") providerWrites += 1;
  throw new Error("provider must not be called after failed pre-audit");
} };
await assert.rejects(runStagingActivationGatewayApply({ ...applyIdentity,
  capability_envelope_id: "pre-audit-failure-envelope" }, { ...executionDeps,
  cloudflareClient: noWriteProvider, audit: async () => { throw new Error("audit storage offline"); },
  repositoryRoot: "/this-path-must-not-be-read-during-apply" }),
(error) => error.code === "staging_activation_gateway_apply_failed" && error.details?.rollback_verified === false);
assert.equal(providerWrites, 0);
assert.equal(savedPlans.get(firstExecution.plan_id).status, "failed");
assert.equal(envelopeStates.get("pre-audit-failure-envelope").execution_status, "cancelled");
await assert.rejects(runStagingActivationGatewayApply({ ...applyIdentity,
  capability_envelope_id: "pre-audit-failure-envelope" }, { ...executionDeps, audit: async () => {} }),
(error) => error.code === "staging_activation_gateway_stale_plan");
registerEnvelope(secondExecution, "successful-execution-envelope");
const candidateVersionId = "99999999-9999-4999-8999-999999999999";
const providerCalls = [];
let deployedCandidate = false;
let currentCandidateBundle = otherBundle;
const providerClient = { token_present: true, async request(request) {
  providerCalls.push(request);
  if (request.method === "GET" && request.apiPath.endsWith(`/scripts/${scriptName}`)) return { ok: true, result: {} };
  if (request.method === "GET" && request.apiPath.endsWith("/deployments"))
    return { ok: true, result: [{ id: deployedCandidate ? "candidate" : "previous", versions: [{
      version_id: deployedCandidate ? candidateVersionId : "old-version", percentage: 100 }] }] };
  if (request.method === "POST" && request.apiPath.endsWith("/versions"))
    return { ok: true, result: { id: candidateVersionId } };
  if (request.method === "POST" && request.apiPath.endsWith("/deployments?force=true")) {
    deployedCandidate = false; return { ok: true };
  }
  if (request.method === "POST" && request.apiPath.endsWith("/deployments")) {
    deployedCandidate = true; return { ok: true };
  }
  throw new Error(`Unexpected provider request: ${request.method} ${request.apiPath}`);
} };
const candidateHealth = { ok: true, stale: false, policyKey: staging.policy_key,
  policyHash: staging.expected_policy_hash, sourceCommit: sourceSha, workerBuildSha: sourceSha };
const candidateReady = { ok: true, policyHash: staging.expected_policy_hash, upstreamSourceCommit: sourceSha,
  recoveryTrustedIngress: otherBundle.origin_trust };
const smokeFetch = async (url) => new Response(JSON.stringify(deployedCandidate
  ? (url.endsWith("/health") ? candidateHealth : { ...candidateReady, recoveryTrustedIngress: currentCandidateBundle.origin_trust })
  : (url.endsWith("/health")
    ? { ok: true, sourceCommit: "b".repeat(40), policyHash: staging.expected_policy_hash }
    : { ok: true, upstreamSourceCommit: "b".repeat(40), recoveryTrustedIngress: {
      key_id: "old-key", public_key: "old-public" } })), { status: 200 });
const auditActions = [];
const applied = await runStagingActivationGatewayApply({ ...dryRunInput, mode: "apply",
  plan_id: secondExecution.plan_id, plan_sha256: secondExecution.plan_sha256,
  confirm: secondExecution.required_confirmation, capability_envelope_id: "successful-execution-envelope",
  execution_nonce: "nonce:second:12345" }, { ...executionDeps, cloudflareClient: providerClient,
  smokeFetch, audit: async ({ action }) => { auditActions.push(action); },
  repositoryRoot: "/this-path-must-not-be-read-during-apply" });
assert.equal(applied.execution.executed, true);
assert.equal(applied.deployment.version_id, candidateVersionId);
assert.deepEqual(auditActions, ["activation_gateway.staging_apply.intent", "activation_gateway.staging_apply"]);
assert.equal(providerCalls.filter((call) => call.method === "POST" && call.apiPath.endsWith("/versions")).length, 1);
assert.equal(providerCalls.filter((call) => call.method === "POST" && call.apiPath.endsWith("/deployments")).length, 1);
assert.equal(providerCalls.filter((call) => call.method === "PUT").length, 0);
assert.equal(savedPlans.get(secondExecution.plan_id).status, "succeeded");
assert.equal(envelopeStates.get("successful-execution-envelope").execution_status, "executed");
const thirdExecution = await runStagingActivationGatewayApply(dryRunInput, executionDeps);
deployedCandidate = false;
currentCandidateBundle = openStagingGatewayArtifact(savedArtifacts.get(thirdExecution.bundle_ref),
  { env: executionEnv, planId: thirdExecution.plan_id }).bundle;
registerEnvelope(thirdExecution, "post-audit-failure-envelope");
await assert.rejects(runStagingActivationGatewayApply({ ...dryRunInput, mode: "apply",
  plan_id: thirdExecution.plan_id, plan_sha256: thirdExecution.plan_sha256,
  confirm: thirdExecution.required_confirmation, capability_envelope_id: "post-audit-failure-envelope",
  execution_nonce: "nonce:third:123456" }, { ...executionDeps, cloudflareClient: providerClient,
  smokeFetch, audit: async ({ action }) => {
    if (action === "activation_gateway.staging_apply") throw new Error("durable post-audit unavailable");
  } }), (error) => error.details?.rollback?.rollback_verified === true);
assert.equal(savedPlans.get(thirdExecution.plan_id).status, "failed");
assert.equal(envelopeStates.get("post-audit-failure-envelope").execution_status, "cancelled");
assert.equal(providerCalls.some((call) => call.apiPath.endsWith("/deployments?force=true")), true);
await assert.rejects(
  buildActivationGatewayRolloutPlan({ mode: "dry_run", account_id: "f".repeat(32), expected_source_commit: sourceSha, expected_policy_hash: staging.expected_policy_hash, environment_convergence_plan_sha256: convergencePlanSha }, { pool: dryRunPool, auth, env: { STAGING_ACTIVATION_GATEWAY_APPLY_ENABLED: "true", DEPLOYMENT_MANIFEST_JSON: JSON.stringify({ repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os", branch: "main", commit_sha: sourceSha }) }, cloudflareClient: fakeCloudflareClient, registry, repositoryRoot: root }),
  (error) => error?.code === "staging_activation_gateway_account_assertion_mismatch",
);
await assert.rejects(
  buildActivationGatewayRolloutPlan({ mode: "dry_run", account_id: accountId, resource_binding_id: "caller-selected-binding", expected_source_commit: sourceSha, expected_policy_hash: staging.expected_policy_hash, environment_convergence_plan_sha256: convergencePlanSha }, { pool: dryRunPool, auth, env: { STAGING_ACTIVATION_GATEWAY_APPLY_ENABLED: "true", DEPLOYMENT_MANIFEST_JSON: JSON.stringify({ repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os", branch: "main", commit_sha: sourceSha }) }, cloudflareClient: fakeCloudflareClient, registry, repositoryRoot: root }),
  (error) => error?.code === "staging_activation_gateway_caller_target_override_forbidden",
);

const bundle = await buildStagingActivationGatewayBundle({ sourceSha, repositoryRoot: root, now: () => Date.parse("2026-09-11T12:00:00.000Z") });
assert.equal(bundle.policy_hash, staging.expected_policy_hash);
assert.equal(bundle.origin_trust.contract, "mad4b.staging.activation-recovery-origin-trust.v2");
assert.equal(bundle.origin_trust.deployment_sha, sourceSha);
assert.equal(bundle.origin_trust.canonical_host, "activation-dev.mad4b.com");
assert.equal(bundle.origin_trust.audience, "https://dev.mad4b.com");
assert.equal(bundle.origin_trust.issuer, "https://activation-dev.mad4b.com");
assert.match(bundle.origin_trust.public_key, /^-----BEGIN PUBLIC KEY-----\n/u);
assert.equal(bundle.origin_trust.provider_credentials_included, false);
assert.equal(bundle.worker_secret_names.includes("ACTIVATION_GATEWAY_INGRESS_PRIVATE_KEY_JWK"), true);
assert.equal(bundle.worker_secret_names.includes("ACTIVATION_GATEWAY_INGRESS_PUBLIC_KEY_PEM"), true);
assert.equal(bundle.files.find((file) => file.name === "worker-staging.mjs")?.content.includes("recoveryTrustedIngress"), true);

const trustSha = "b".repeat(40);
const { publicKey } = crypto.generateKeyPairSync("ed25519");
const publicPem = publicKey.export({ type: "spki", format: "pem" }).replaceAll("\r", "");
const keyId = "activation-staging-test-key-20260911";
const trustBundle = {
  contract: "mad4b.staging.activation-recovery-origin-trust.v2",
  deployment_sha: trustSha,
  source_commit: trustSha,
  worker_build_sha: trustSha,
  worker_bundle_sha256: "c".repeat(64),
  policy_hash: staging.expected_policy_hash,
  gateway_host: staging.public_host,
  canonical_host: staging.public_host,
  audience: "https://dev.mad4b.com",
  issuer: "https://activation-dev.mad4b.com",
  key_id: keyId,
  public_key: publicPem,
  trusted_ingress_mode: "signature",
  strip_caller_headers: true,
  replay_store_scope: "single_filesystem",
  provider_credentials_included: false,
  production_deploy: false,
  database_mutation: false,
  secrets_included: false,
};
const fakeGatewayFetch = async (url) => {
  if (String(url).endsWith("/health")) return new Response(JSON.stringify({ ok: true, stale: false, policyKey: staging.policy_key, policyHash: staging.expected_policy_hash, sourceCommit: trustSha, workerBuildSha: trustSha, secretsIncluded: false }), { status: 200 });
  if (String(url).endsWith("/ready")) return new Response(JSON.stringify({ ok: true, policyHash: staging.expected_policy_hash, upstreamSourceCommit: trustSha, recoveryTrustedIngress: trustBundle, secretsIncluded: false }), { status: 200 });
  throw new Error(`Unexpected Gateway URL: ${url}`);
};
const trustPlan = await buildStagingActivationTrustInstallPlan({ expectedSha: trustSha, fetchImpl: fakeGatewayFetch, registry });
assert.equal(trustPlan.ready, true);
assert.deepEqual([...trustPlan.allowed_env_keys].sort(), [...STAGING_ACTIVATION_TRUST_ENV_ALLOWLIST].sort());
assert.equal(trustPlan.provider_mutation, false);
assert.equal(trustPlan.cloudflare_mutation, false);
assert.equal(trustPlan.workflow_dispatch, false);
assert.equal(trustPlan.production_mutation, false);
assert.equal(trustPlan.database_mutation, false);

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "mad4b-staging-trust-"));
const envFile = path.join(tempDirectory, ".env.staging");
const unrelatedToken = "local-tunnel-token-must-remain-unchanged";
fs.writeFileSync(envFile, [
  "PORT=8080",
  "REMOTE_MCP_TRUST_PROXY_HOST_HEADERS=true",
  "REMOTE_MCP_TRUSTED_INGRESS_MODE=signature",
  "REMOTE_MCP_TRUSTED_INGRESS_STRIP_CALLER_HEADERS=true",
  "REMOTE_MCP_TRUSTED_INGRESS_PUBLIC_KEY=OLD_PUBLIC_KEY",
  "REMOTE_MCP_TRUSTED_INGRESS_KEY_ID=old-key-0000000001",
  "REMOTE_MCP_TRUSTED_INGRESS_CANONICAL_HOST=activation-dev.mad4b.com",
  "REMOTE_MCP_TRUSTED_INGRESS_AUDIENCE=https://dev.mad4b.com",
  "REMOTE_MCP_TRUSTED_INGRESS_ISSUER=https://activation-dev.mad4b.com",
  `REMOTE_MCP_EXPECTED_DEPLOYMENT_SHA=${"d".repeat(40)}`,
  "RECOVERY_STAGING_INGRESS_REPLAY_DIRECTORY=/app/data/recovery-ingress",
  "DATABASE_MUTATED=false",
  "PRODUCTION_MUTATION_AUTHORIZED=false",
  `CLOUDFLARE_TUNNEL_TOKEN=${unrelatedToken}`,
  "",
].join("\n"), "utf8");
const installed = await installStagingActivationTrust({ expectedSha: trustSha, envFile, mode: "apply", fetchImpl: fakeGatewayFetch, registry });
assert.equal(installed.ready, true);
assert.equal(installed.mutated, true);
assert.equal(installed.mutation_scope, "local_staging_trust_allowlist_only");
const installedEnv = fs.readFileSync(envFile, "utf8");
assert.match(installedEnv, new RegExp(`^REMOTE_MCP_TRUSTED_INGRESS_KEY_ID=${keyId}$`, "mu"));
assert.match(installedEnv, new RegExp(`^REMOTE_MCP_EXPECTED_DEPLOYMENT_SHA=${trustSha}$`, "mu"));
assert.match(installedEnv, /^REMOTE_MCP_TRUSTED_INGRESS_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----\\n/mu);
assert.match(installedEnv, /^REMOTE_MCP_TRUST_PROXY_HOST_HEADERS=true$/mu);
assert.match(installedEnv, /^RECOVERY_STAGING_INGRESS_REPLAY_DIRECTORY=\/app\/data\/recovery-ingress$/mu);
assert.match(installedEnv, /^DATABASE_MUTATED=false$/mu);
assert.match(installedEnv, /^PRODUCTION_MUTATION_AUTHORIZED=false$/mu);
assert.match(installedEnv, new RegExp(`^CLOUDFLARE_TUNNEL_TOKEN=${unrelatedToken}$`, "mu"));
const beforeMismatch = fs.readFileSync(envFile, "utf8");
const mismatchFetch = async (url) => {
  const other = "e".repeat(40);
  if (String(url).endsWith("/health")) return new Response(JSON.stringify({ ok: true, stale: false, policyKey: staging.policy_key, policyHash: staging.expected_policy_hash, sourceCommit: other, workerBuildSha: other }), { status: 200 });
  return new Response(JSON.stringify({ ok: true, policyHash: staging.expected_policy_hash, upstreamSourceCommit: other, recoveryTrustedIngress: { ...trustBundle, deployment_sha: other, source_commit: other, worker_build_sha: other } }), { status: 200 });
};
await assert.rejects(
  installStagingActivationTrust({ expectedSha: trustSha, envFile, mode: "apply", fetchImpl: mismatchFetch, registry }),
  (error) => error?.code === "staging_trust_install_not_ready",
);
assert.equal(fs.readFileSync(envFile, "utf8"), beforeMismatch);
fs.rmSync(tempDirectory, { recursive: true, force: true });

console.log(JSON.stringify({
  ok: true,
  contract: policy.contract,
  shared_convergence_engine_consumed_by_autopilot: true,
  hardcoded_launcher_drift_classifier_removed: true,
  server_governed_staging_apply_ready: true,
  profile_bound_provider_target: true,
  caller_target_override_blocked: true,
  production_rollout_implementation_preserved: true,
  public_recovery_trust_emitted: true,
  bounded_local_trust_resume: true,
  legacy_dispatch_helper_retired: true,
  policy_hash_bound_to_profile: true,
  recovery_trusted_ingress_owned_by_shared_registry: true,
  legacy_workflow_retained_as_non_launcher_infrastructure: true,
  portable_integrity_dependencies_registered: true,
  certification_probe_remains_read_only: true,
  provider_mutation_from_autopilot: false,
  workflow_dispatch_from_autopilot: false,
  production_mutation: false,
  cloudflare_dns_mutation: false,
  secrets_included: false,
}));
