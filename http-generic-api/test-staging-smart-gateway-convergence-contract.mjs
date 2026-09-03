import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const portable = path.join(root, "autopilot-portable-staging");
const wrapper = fs.readFileSync(path.join(portable, "Invoke-Staging-One-Click.ps1"), "utf8");
const core = fs.readFileSync(path.join(portable, "Invoke-Staging-One-Click-Core.ps1"), "utf8");
const converger = fs.readFileSync(path.join(portable, "Converge-StagingActivationGateway.ps1"), "utf8");
const policy = JSON.parse(fs.readFileSync(path.join(portable, "activation-gateway-smart-convergence-policy.json"), "utf8"));
const workflow = fs.readFileSync(path.join(root, ".github/workflows/staging-main-deploy-eligibility.yml"), "utf8");
const liveCertification = fs.readFileSync(path.join(root, "http-generic-api/scripts/staging-live-certification.mjs"), "utf8");
const manifestGenerator = fs.readFileSync(path.join(root, "http-generic-api/scripts/generate-portable-staging-manifest.mjs"), "utf8");
const portableManifest = JSON.parse(fs.readFileSync(path.join(portable, "manifest.json"), "utf8"));
const workerBuilder = fs.readFileSync(path.join(root, "http-generic-api/scripts/build-staging-worker.mjs"), "utf8");
const trustedIngress = fs.readFileSync(path.join(root, "http-generic-api/trustedIngressContract.js"), "utf8");
const activationGatewayRoutes = fs.readFileSync(path.join(root, "http-generic-api/routes/activationHostGatewayRoutes.js"), "utf8");
const stagingEnvExample = fs.readFileSync(path.join(root, "http-generic-api/.env.staging.example"), "utf8");

const protectedPortablePaths = [
  "autopilot-portable-staging/Invoke-Staging-One-Click-Core.ps1",
  "autopilot-portable-staging/Converge-StagingActivationGateway.ps1",
  "autopilot-portable-staging/activation-gateway-smart-convergence-policy.json",
];
for (const relativePath of protectedPortablePaths) {
  assert.ok(manifestGenerator.includes(`"${relativePath}"`), `portable manifest writer must register ${relativePath}`);
  assert.ok(portableManifest.files.some((entry) => entry.path === relativePath), `portable manifest must hash ${relativePath}`);
}

assert.equal(policy.contract, "mad4b.staging.activation-gateway-smart-convergence-policy.v1");
assert.equal(policy.environment, "staging");
assert.equal(policy.enabled_by_switch, "EnableActivationGateway");
assert.equal(policy.typed_recovery.requires_preflight_status, "passed");
assert.equal(policy.typed_recovery.requires_exact_preflight_commit, true);
assert.deepEqual(policy.typed_recovery.allowed_gateway_drift_keys, [
  "gateway_exact_commit",
  "gateway_policy_not_stale",
  "gateway_policy_hash_current",
  "gateway_policy_key_current",
  "gateway_recovery_trusted_ingress",
]);
assert.equal(policy.typed_recovery.gateway_health_unreachable_auto_mutation, false);
assert.equal(policy.typed_recovery.non_gateway_blocker_auto_mutation, false);
assert.equal(policy.typed_recovery.schema_bundle_explicit_mode_auto_mutation, false);
assert.equal(policy.typed_recovery.maximum_core_retries_after_convergence, 1);
assert.equal(policy.deployment_authority.workflow, ".github/workflows/staging-main-deploy-eligibility.yml");
assert.equal(policy.deployment_authority.operation, "deploy_activation_worker");
assert.equal(policy.deployment_authority.confirmation, "DEPLOY_STAGING_ACTIVATION_WORKER");
assert.equal(policy.deployment_authority.source_sha, "exact_current_origin_main");
assert.equal(policy.deployment_authority.worker, "mad4b-activation-gateway-staging");
assert.equal(policy.deployment_authority.direct_cloudflare_api_from_launcher, false);
assert.equal(policy.deployment_authority.local_cloudflare_api_token_read, false);
assert.equal(policy.deployment_authority.reuse_existing_exact_sha_dispatch, true);
assert.equal(policy.postconditions.recovery_origin_trust_exact_required, true);
assert.equal(policy.postconditions.recovery_ingress_replay_scope, "single_filesystem");
assert.equal(policy.postconditions.origin_trust_artifact, "staging-activation-origin-trust-{{source_sha}}");
assert.equal(policy.mutation_scope.provider_mutation_scope, "staging_activation_worker_exact_sha_only");
assert.equal(policy.mutation_scope.local_origin_trust_config_mutation, "conditional_non_secret");
assert.equal(policy.mutation_scope.cloudflare_dns_mutation, false);
assert.equal(policy.mutation_scope.database_mutation, false);
assert.equal(policy.mutation_scope.production_deploy, false);
assert.equal(policy.mutation_scope.production_mutation, false);
assert.equal(policy.evidence.provider_mutation_must_be_reported_truthfully, true);
assert.equal(policy.evidence.origin_trust_mutation_must_be_reported_truthfully, true);
assert.equal(policy.evidence.secrets_included, false);

assert.match(wrapper, /Invoke-Staging-One-Click-Core\.ps1/);
assert.match(wrapper, /Converge-StagingActivationGateway\.ps1/);
assert.match(wrapper, /staging-schema-governance-preflight\.json/);
assert.match(wrapper, /certification_blocking_failures/);
assert.match(wrapper, /certification_degraded_reasons/);
assert.match(wrapper, /gateway_exact_commit/);
assert.match(wrapper, /gateway_policy_not_stale/);
assert.match(wrapper, /gateway_policy_hash_current/);
assert.match(wrapper, /gateway_policy_key_current/);
assert.match(wrapper, /gateway_recovery_trusted_ingress/);
assert.match(wrapper, /Test-LocalRecoveryTrustExact/);
assert.match(wrapper, /REMOTE_MCP_TRUSTED_INGRESS_PUBLIC_KEY/);
assert.match(wrapper, /REMOTE_MCP_EXPECTED_DEPLOYMENT_SHA/);
assert.match(wrapper, /RECOVERY_STAGING_INGRESS_REPLAY_DIRECTORY/);
assert.match(wrapper, /activation_recovery_trusted_ingress_ready/);
assert.doesNotMatch(wrapper, /gateway_health_reachable['"]/);
assert.match(wrapper, /if \(\$RequireSchemaBundle -or \$ApplySchemaBundle\) \{ return \$null \}/);
assert.match(wrapper, /preflight\.status -ne 'passed'/);
assert.match(wrapper, /preflight\.safety\.production_access -ne \$false/);
assert.match(wrapper, /preflight\.safety\.provider_access -ne \$false/);
assert.match(wrapper, /preflight\.safety\.database_mutation -ne \$false/);
assert.match(wrapper, /preflight\.safety\.migration_apply -ne \$false/);
assert.match(wrapper, /\$first = Invoke-Core/);
assert.match(wrapper, /\$recovery = Get-GatewayDriftRecovery \$first\.exit_code/);
assert.match(wrapper, /\$convergence = Invoke-GatewayConvergence \$recovery/);
assert.match(wrapper, /\$second = Invoke-Core/);
assert.equal((wrapper.match(/\$second = Invoke-Core/g) || []).length, 1);
assert.match(wrapper, /\$previousErrorActionPreference = \$ErrorActionPreference/);
assert.match(wrapper, /\$ErrorActionPreference = 'Continue'/);
assert.match(wrapper, /2>&1 \| ForEach-Object \{ \[string\]\$_ \}/);
assert.match(wrapper, /\$exitCode = \[int\]\$LASTEXITCODE/);
assert.match(wrapper, /finally \{\s*\$ErrorActionPreference = \$previousErrorActionPreference\s*\}/s);
assert.match(wrapper, /exit_code = \$exitCode/);
assert.match(wrapper, /\$convergenceLines = @\(& powershell\.exe @\(/);
assert.match(wrapper, /\) 2>&1 \| ForEach-Object \{ \[string\]\$_ \}\)/);
assert.match(wrapper, /\$convergenceExitCode = \[int\]\$LASTEXITCODE/);
assert.match(wrapper, /Write-Lines \$convergenceLines/);
assert.ok(wrapper.indexOf("Write-Lines $convergenceLines") < wrapper.indexOf("$report = Read-TypedState $convergenceReportPath"));
assert.doesNotMatch(wrapper, /\n\s*& powershell\.exe @\(\s*\n\s*'-NoLogo'.*\n\s*if \(\$LASTEXITCODE -ne 0\)/s);
assert.doesNotMatch(wrapper, /return \[pscustomobject\]@\{ exit_code = \[int\]\$LASTEXITCODE/);
assert.match(wrapper, /provider_mutation -NotePropertyValue \$mutated/);
assert.match(wrapper, /cloudflare_worker_mutation -NotePropertyValue \$mutated/);
assert.match(wrapper, /cloudflare_dns_mutation -NotePropertyValue \$false/);
assert.match(wrapper, /production_mutation -NotePropertyValue \$false/);
assert.match(wrapper, /secrets_included -NotePropertyValue \$false/);
assert.doesNotMatch(wrapper, /CLOUDFLARE_API_TOKEN/);
assert.doesNotMatch(wrapper, /api\.cloudflare\.com/);
assert.doesNotMatch(wrapper, /auth\.mad4b\.com|mcp\.mad4b\.com|activation\.mad4b\.com/);

assert.match(converger, /https:\/\/activation-dev\.mad4b\.com\/health/);
assert.match(converger, /sourceCommit/);
assert.match(converger, /workerBuildSha/);
assert.match(converger, /policyHash/);
assert.match(converger, /policyKey/);
assert.match(converger, /secretsIncluded/);
assert.match(converger, /stale -eq \$false/);
assert.match(converger, /staging-activation-origin-trust-\$ExpectedCommit/);
assert.match(converger, /gh run download/);
assert.match(converger, /origin-trust\.json/);
assert.match(converger, /REMOTE_MCP_TRUSTED_INGRESS_PUBLIC_KEY/);
assert.match(converger, /REMOTE_MCP_TRUSTED_INGRESS_KEY_ID/);
assert.match(converger, /REMOTE_MCP_EXPECTED_DEPLOYMENT_SHA/);
assert.match(converger, /\/app\/data\/recovery-ingress/);
assert.match(converger, /final_origin_trust/);
assert.match(converger, /recovery_ingress_replay_scope/);
assert.match(converger, /ls-remote.*refs\/heads\/main/s);
assert.match(converger, /--event workflow_dispatch/);
assert.match(converger, /\$parsedRuns = \(\$raw \| Out-String\) \| ConvertFrom-Json -ErrorAction Stop/);
assert.match(converger, /\$runs = if \(\$null -eq \$parsedRuns\) \{ @\(\) \} else \{ @\(\$parsedRuns\) \}/);
assert.match(converger, /\$null -ne \$_/);
assert.match(converger, /\$_.PSObject.Properties.Name -contains 'headSha'/);
assert.doesNotMatch(converger, /try \{ \$runs = @\(\(\$raw \| Out-String\) \| ConvertFrom-Json/);
assert.match(converger, /status -ne 'completed'/);
assert.match(converger, /operation=deploy_activation_worker/);
assert.match(converger, /source_sha=\$ExpectedCommit/);
assert.match(converger, /confirmation=DEPLOY_STAGING_ACTIVATION_WORKER/);
assert.match(converger, /Wait-WorkflowRun/);
assert.match(converger, /Wait-GatewayExactHealth/);
assert.match(converger, /staging_activation_worker_exact_sha_only/);
assert.match(converger, /cloudflare_dns_mutation = \$false/);
assert.match(converger, /production_mutation = \$false/);
assert.match(converger, /database_mutation = \$false/);
assert.match(converger, /ruleset_mutation = \$false/);
assert.doesNotMatch(converger, /CLOUDFLARE_API_TOKEN/);
assert.doesNotMatch(converger, /api\.cloudflare\.com/);
assert.doesNotMatch(converger, /auth\.mad4b\.com|mcp\.mad4b\.com|activation\.mad4b\.com/);

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
  typed_gateway_only_recovery: true,
  recovery_trusted_ingress_convergence: true,
  recovery_ingress_replay_scope: policy.postconditions.recovery_ingress_replay_scope,
  exact_main_dispatch: true,
  existing_dispatch_reuse: true,
  exact_public_readback: true,
  portable_integrity_dependencies_registered: true,
  certification_probe_remains_read_only: true,
  native_stderr_preserves_exit_code: true,
  production_mutation: false,
  cloudflare_dns_mutation: false,
  secrets_included: false,
}));
