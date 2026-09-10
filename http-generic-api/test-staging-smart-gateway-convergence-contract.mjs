import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

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
const trustedIngress = fs.readFileSync(path.join(root, "http-generic-api/trustedIngressContract.js"), "utf8");
const activationGatewayRoutes = fs.readFileSync(path.join(root, "http-generic-api/routes/activationHostGatewayRoutes.js"), "utf8");
const stagingEnvExample = fs.readFileSync(path.join(root, "http-generic-api/.env.staging.example"), "utf8");

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

assert.equal(policy.contract, "mad4b.staging.activation-gateway-smart-convergence-policy.v2");
assert.equal(policy.environment, "staging");
assert.equal(policy.enabled_by_switch, "EnableActivationGateway");
assert.equal(policy.shared_convergence_registry, "http-generic-api/config/environment-convergence-registry.json");
assert.equal(policy.shared_convergence_bridge, "http-generic-api/scripts/staging-environment-convergence-plan.mjs");
assert.equal(policy.legacy_convergence_helper, "autopilot-portable-staging/Converge-StagingActivationGateway.ps1");
assert.equal(policy.typed_recovery.requires_preflight_status, "passed");
assert.equal(policy.typed_recovery.requires_exact_preflight_commit, true);
assert.equal(policy.typed_recovery.classification_source, "environment_convergence_registry");
assert.equal(policy.typed_recovery.hardcoded_gateway_drift_allowlist_in_launcher, false);
assert.equal(policy.typed_recovery.next_action_source, "report.convergence.next_governed_handoff");
assert.equal(policy.typed_recovery.maximum_core_retries_after_convergence, 0);
assert.equal(policy.deployment_authority.target_authority_model, "server_governed");
assert.equal(policy.deployment_authority.current_apply_capability, null);
assert.equal(policy.deployment_authority.current_apply_ready, false);
assert.equal(policy.deployment_authority.apply_block_reason, "server_governed_staging_activation_worker_adapter_required");
assert.equal(policy.deployment_authority.launcher_workflow_dispatch_allowed, false);
assert.equal(policy.deployment_authority.legacy_helper_workflow_dispatch_allowed, false);
assert.equal(policy.deployment_authority.direct_cloudflare_api_from_launcher, false);
assert.equal(policy.deployment_authority.local_cloudflare_api_token_read, false);
assert.equal(policy.policy_identity.policy_key, "activation_gateway_staging");
assert.equal(policy.policy_identity.expected_policy_hash, registry.profiles.staging.activation_gateway.expected_policy_hash);
assert.equal(policy.policy_identity.public_host, "activation-dev.mad4b.com");
assert.equal(policy.policy_identity.caller_policy_path_override_allowed, false);
assert.equal(policy.policy_identity.plan_hash_binds_policy_hash, true);
assert.equal(policy.mutation_scope.provider_mutation_from_launcher, false);
assert.equal(policy.mutation_scope.provider_mutation_from_legacy_helper, false);
assert.equal(policy.mutation_scope.local_origin_trust_config_mutation_from_launcher, false);
assert.equal(policy.mutation_scope.local_origin_trust_config_mutation_from_legacy_helper, false);
assert.equal(policy.mutation_scope.cloudflare_worker_mutation_from_orchestrator, false);
assert.equal(policy.mutation_scope.cloudflare_dns_mutation, false);
assert.equal(policy.mutation_scope.database_mutation, false);
assert.equal(policy.mutation_scope.production_deploy, false);
assert.equal(policy.mutation_scope.production_mutation, false);
assert.equal(policy.evidence.bridge_contract, "mad4b.staging-environment-convergence-bridge.v1");
assert.equal(policy.evidence.legacy_helper_contract, "mad4b.staging.activation-gateway-convergence.v2");
assert.equal(policy.evidence.plan_contract, "mad4b.environment-convergence-plan.v1");
assert.equal(policy.evidence.secrets_included, false);

assert.equal(registry.profiles.staging.activation_gateway.current_authority_adapter, null);
assert.equal(registry.profiles.staging.activation_gateway.legacy_authority_adapter, "staging_activation_worker_workflow");
assert.equal(registry.profiles.staging.activation_gateway.apply_capability, null);
assert.equal(registry.profiles.staging.activation_gateway.governed_apply_ready, false);
assert.equal(registry.dependencies.activation_gateway.checks.gateway_recovery_trusted_ingress.repairability, "governed");
for (const requiredBoundaryPath of [
  "autopilot-portable-staging/Invoke-Staging-One-Click.ps1",
  "autopilot-portable-staging/Converge-StagingActivationGateway.ps1",
  "http-generic-api/scripts/staging-environment-convergence-plan.mjs",
]) {
  assert.ok(registry.orchestrator_boundary.orchestrators.includes(requiredBoundaryPath), `${requiredBoundaryPath} must be guarded by the orchestrator boundary`);
}

assert.match(wrapper, /Invoke-Staging-One-Click-Core\.ps1/);
assert.match(wrapper, /staging-environment-convergence-plan\.mjs/);
assert.match(wrapper, /Invoke-SharedConvergence/);
assert.match(wrapper, /\$classification = \$bridge\.report\.convergence/);
assert.match(wrapper, /\$handoff = \$classification\.next_governed_handoff/);
assert.match(wrapper, /environment_convergence_next_governed_handoff/);
assert.match(wrapper, /environment_convergence_plan_sha256/);
assert.match(wrapper, /governed_authority_required/);
assert.match(wrapper, /Server-governed Staging Activation Gateway apply authority is required/);
assert.match(wrapper, /Test-LocalRecoveryTrustExact/);
assert.doesNotMatch(wrapper, /Get-GatewayDriftRecovery/);
assert.doesNotMatch(wrapper, /Invoke-GatewayConvergence/);
assert.doesNotMatch(wrapper, /Converge-StagingActivationGateway\.ps1/);
assert.doesNotMatch(wrapper, /\$second = Invoke-Core/);
for (const hardcodedDriftKey of [
  "gateway_exact_commit",
  "gateway_policy_not_stale",
  "gateway_policy_hash_current",
  "gateway_policy_key_current",
  "gateway_recovery_trusted_ingress",
]) {
  assert.equal(wrapper.includes(hardcodedDriftKey), false, `launcher must not classify ${hardcodedDriftKey} locally`);
}
assert.match(wrapper, /provider_mutation -NotePropertyValue \$false/);
assert.match(wrapper, /cloudflare_worker_mutation -NotePropertyValue \$false/);
assert.match(wrapper, /cloudflare_dns_mutation -NotePropertyValue \$false/);
assert.match(wrapper, /production_mutation -NotePropertyValue \$false/);
assert.match(wrapper, /secrets_included -NotePropertyValue \$false/);

assert.match(bridge, /runEnvironmentConvergence/);
assert.match(bridge, /readEnvironmentConvergenceRegistry/);
assert.match(bridge, /certification_blocking_failures/);
assert.match(bridge, /certification_degraded_reasons/);
assert.match(bridge, /gateway_recovery_trusted_ingress/);
assert.match(bridge, /mad4b\.staging-environment-convergence-bridge\.v1/);
assert.match(bridge, /provider_mutation: false/);
assert.match(bridge, /workflow_dispatch: false/);
assert.match(bridge, /production_mutation: false/);
assert.match(bridge, /database_mutation: false/);

assert.match(converger, /mad4b\.staging\.activation-gateway-convergence\.v2/);
assert.match(converger, /governed_authority_required/);
assert.match(converger, /server_governed_staging_activation_worker_adapter_required|apply_block_reason/);
assert.match(converger, /workflow_dispatch_allowed = \$false/);
assert.match(converger, /provider_mutation_allowed = \$false/);
assert.match(converger, /local_origin_trust_mutation_allowed = \$false/);
assert.match(converger, /provider_mutation = \$false/);
assert.match(converger, /workflow_dispatch = \$false/);
assert.match(converger, /cloudflare_worker_mutation = \$false/);
assert.match(converger, /production_mutation = \$false/);
assert.match(converger, /database_mutation = \$false/);
assert.match(converger, /secrets_included = \$false/);
assert.doesNotMatch(converger, /gh\s+workflow\s+run/i);
assert.doesNotMatch(converger, /gh\s+api\s+--method\s+POST/i);
assert.doesNotMatch(converger, /gh\s+run\s+download/i);
assert.doesNotMatch(converger, /\/dispatches/);
assert.doesNotMatch(converger, /Set-StagingEnvValue/);

for (const orchestratorSource of [wrapper, converger, bridge]) {
  assert.doesNotMatch(orchestratorSource, /CLOUDFLARE_API_TOKEN/);
  assert.doesNotMatch(orchestratorSource, /api\.cloudflare\.com\/client\/v4/i);
  assert.doesNotMatch(orchestratorSource, /wrangler\s+deploy/i);
  assert.doesNotMatch(orchestratorSource, /gh\s+workflow\s+run/i);
}

// The legacy workflow remains governed deployment infrastructure, but it is no longer
// an execution primitive available to the AutoPilot/convergence helper boundary.
assert.match(workflow, /operation == 'deploy_activation_worker'/);
assert.match(workflow, /DEPLOY_STAGING_ACTIVATION_WORKER/);
assert.match(workflow, /mad4b-activation-gateway-staging/);
assert.match(workflow, /test "\$\(git rev-parse origin\/main\)" = "\$SOURCE_SHA"/);
assert.match(workflow, /\.sourceCommit == \$sha/);
assert.match(workflow, /\.workerBuildSha == \$sha/);
assert.match(workflow, /\.stale == false/);
assert.match(workflow, /\.secretsIncluded == false/);
assert.match(workflow, /staging-activation-origin-trust-\$\{\{ inputs\.source_sha \}\}/);
assert.match(workflow, /origin-trust\.json/);
assert.ok(
  workflow.indexOf("Verify public exact-SHA health readback") < workflow.indexOf("Upload deployed Recovery origin trust"),
  "Origin trust must only be published after exact public Worker readback",
);

assert.match(workerBuilder, /ACTIVATION_GATEWAY_INGRESS_PRIVATE_KEY_JWK/);
assert.match(workerBuilder, /ACTIVATION_GATEWAY_INGRESS_KEY_ID/);
assert.match(workerBuilder, /mad4b\.staging\.activation-recovery-origin-trust\.v1/);
assert.match(workerBuilder, /origin-trust\.json/);
assert.match(workerBuilder, /public_key_pem_escaped/);
assert.match(workerBuilder, /secrets_included: false/);
assert.match(trustedIngress, /trustedIngressPublicKey/);
assert.match(trustedIngress, /replaceAll\("\\\\n", "\\n"\)/);
assert.match(activationGatewayRoutes, /createFileRecoveryEvidenceStore/);
assert.match(activationGatewayRoutes, /RECOVERY_STAGING_INGRESS_REPLAY_DIRECTORY/);
assert.match(activationGatewayRoutes, /runtime_class !== "local_windows_docker"/);
assert.match(activationGatewayRoutes, /effectiveIngressReplayStore/);
assert.match(stagingEnvExample, /^REMOTE_MCP_TRUSTED_INGRESS_MODE=signature$/m);
assert.match(stagingEnvExample, /^REMOTE_MCP_TRUSTED_INGRESS_KEY_ID=$/m);
assert.match(stagingEnvExample, /^REMOTE_MCP_EXPECTED_DEPLOYMENT_SHA=$/m);
assert.match(stagingEnvExample, /^RECOVERY_STAGING_INGRESS_REPLAY_DIRECTORY=\/app\/data\/recovery-ingress$/m);
assert.doesNotMatch(stagingEnvExample, /^ACTIVATION_GATEWAY_INGRESS_PRIVATE_KEY_JWK=/m);

assert.match(liveCertification, /loadActivationGatewayProfilePolicy\("staging"/);
assert.doesNotMatch(liveCertification, /STAGING_CERT_GATEWAY_POLICY_PATH/);
assert.match(liveCertification, /gateway_health_reachable/);
assert.match(liveCertification, /gateway_exact_commit/);
assert.match(liveCertification, /gateway_policy_hash_current/);
assert.match(liveCertification, /read_only_probe: true/);
assert.match(liveCertification, /provider_mutation: false/);

assert.match(core, /\$existingId = \(& docker @\(\$composeArgs \+ @\('ps','-q','app'\)\)/);
assert.match(core, /Invoke-Checked 'docker' \(\$composeArgs \+ @\('stop','--timeout','15','app'\)\)/);
assert.match(core, /Existing app did not stop before the Windows loopback port transition/);
assert.ok(
  core.indexOf("Invoke-Checked 'docker' ($composeArgs + @('stop','--timeout','15','app'))")
    < core.indexOf("Invoke-Checked 'docker' ($composeArgs + @('up','-d','--no-build','app'))"),
  "Windows loopback transition must stop the existing app before changing host-port binding",
);
assert.match(core, /mad4b\.staging-dual-mode-one-click\.v1/);
assert.match(core, /production_mutation = \$false/);
assert.match(core, /provider_mutation = \$false/);

console.log(JSON.stringify({
  ok: true,
  contract: policy.contract,
  shared_convergence_engine_consumed_by_autopilot: true,
  hardcoded_launcher_drift_classifier_removed: true,
  legacy_dispatch_helper_retired: true,
  staging_apply_fail_closed_until_server_governed_adapter: true,
  policy_hash_bound_to_profile: true,
  recovery_trusted_ingress_owned_by_shared_registry: true,
  legacy_workflow_retained_as_non_launcher_infrastructure: true,
  portable_integrity_dependencies_registered: true,
  certification_probe_remains_read_only: true,
  production_mutation: false,
  cloudflare_dns_mutation: false,
  secrets_included: false,
}));
