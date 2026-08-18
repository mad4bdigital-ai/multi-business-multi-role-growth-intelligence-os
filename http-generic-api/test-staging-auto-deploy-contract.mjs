import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";

const root = path.resolve(new URL(".", import.meta.url).pathname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const policy = JSON.parse(read("autopilot-portable-staging/auto-deploy-policy.json"));
const workflow = read(".github/workflows/staging-main-deploy-eligibility.yml");
const liveWorkflow = read(".github/workflows/staging-live-certification.yml");
const promotionGates = JSON.parse(read(".github/contracts/production-promotion-supporting-gates.v1.json"));
const deployScript = read("autopilot-portable-staging/Auto-Deploy-Staging.ps1");
const pilotScript = read("autopilot-portable-staging/Start-AutoPilot.ps1");
const certificationHelper = read("autopilot-portable-staging/Invoke-StagingCertification.ps1");
const oneClickScript = read("autopilot-portable-staging/One-Click-Staging.ps1");
const installer = read("autopilot-portable-staging/Install-AutoDeployTask.ps1");
const dockerfile = read("http-generic-api/Dockerfile.staging");
const buildContextScript = read("http-generic-api/scripts/prepare-staging-build-context.mjs");
const compose = parse(read("http-generic-api/docker-compose.staging.yml"));
const gitignore = read(".gitignore");
const dockerignore = read(".dockerignore");

assert.equal(policy.contract, "mad4b.staging-auto-deploy.v1");
assert.equal(policy.ref, "main");
assert.equal(policy.deployment_mode, "local_windows_task_scheduler");
assert.equal(policy.requires_exact_commit, true);
assert.equal(policy.requires_ci_eligibility, true);
assert.deepEqual(policy.allowed_staging_hosts, ["dev.mad4b.com", "mcp_dev.mad4b.com", "activation-dev.mad4b.com"]);
assert.deepEqual(policy.forbidden_hosts, ["auth.mad4b.com", "mcp.mad4b.com", "activation.mad4b.com"]);
assert.equal(policy.activation_gateway.enabled_by_env, "ACTIVATION_STAGING_GATEWAY_ENABLED");
assert.equal(policy.activation_gateway.required_host, "activation-dev.mad4b.com");
assert.deepEqual(policy.safety, {
  production_deploy: false,
  hostinger_mutation: false,
  cloudflare_dns_mutation: false,
  database_mutation: false,
  migration_applied: false,
  provider_mutation: false,
});

assert.match(workflow, /on:\n  push:\n    branches: \[main\]/);
assert.match(workflow, /name: Staging Main Deploy Eligibility/);
assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
assert.match(workflow, /test "\$\(git rev-parse HEAD\)" = "\$EXPECTED_HEAD_SHA"/);
assert.match(workflow, /staging-environment-authority-closure\.mjs/);
assert.match(workflow, /test-staging-environment-certification-contract\.mjs/);
assert.match(workflow, /environment_authority_closure/);
assert.match(workflow, /staging_deploy_only: true/);
assert.match(workflow, /production_deploy: false/);
assert.match(workflow, /database_mutation: false/);
assert.match(workflow, /migration_apply: false/);
assert.match(workflow, /provider_mutation: false/);
assert.match(workflow, /ruleset_mutation: false/);
assert.match(workflow, /secrets_included: false/);
assert.match(workflow, /STAGING_AUTHORITY_REPORT_FILE: \$\{\{ runner\.temp \}\}/);
assert.doesNotMatch(workflow, /STAGING_AUTHORITY_REPORT_FILE: \.artifacts/);
assert.doesNotMatch(workflow, /CLOUDFLARE_TUNNEL_TOKEN|BACKEND_API_KEY|JWT_SECRET/);

assert.match(dockerfile, /ARG STAGING_BUILD_COMMIT/);
assert.match(dockerfile, /ARG STAGING_BUILD_BRANCH=main/);
assert.match(dockerfile, /ARG STAGING_BUILD_TREE/);
assert.match(dockerfile, /ARG STAGING_BUILD_CONTEXT_FILE_SET_SHA256/);
assert.match(dockerfile, /\.staging-build-context\.json/);
assert.match(dockerfile, /context_file_set_sha256/);
assert.match(dockerfile, /secrets_included:false/);
assert.match(dockerfile, /deployment-manifest\.json/);
assert.match(dockerfile, /# syntax=docker\/dockerfile:1\.7/);
assert.match(dockerfile, /type=cache,id=mad4b-staging-npm,target=\/root\/\.npm/);
assert.match(dockerfile, /org\.mad4b\.staging\.provenance\.contract/);
assert.match(dockerfile, /org\.mad4b\.staging\.build\.context_file_set_sha256/);
assert.match(dockerfile, /staging-route-policy\.json/);
assert.ok(dockerfile.indexOf("COPY http-generic-api/package.json") < dockerfile.indexOf("COPY --from=staging_provenance"), "dependency inputs must precede per-commit provenance copy");
assert.doesNotMatch(dockerfile, /new Date\(\)\.toISOString\(\)/);
assert.match(String(compose.services.app.build.context), /STAGING_BUILD_CONTEXT/);
assert.match(String(compose.services.app.build.args.STAGING_BUILD_COMMIT), /DEPLOY_COMMIT/);
assert.match(String(compose.services.app.build.args.STAGING_BUILD_BRANCH), /DEPLOY_BRANCH/);
assert.match(String(compose.services.app.build.args.STAGING_BUILD_TREE), /STAGING_BUILD_TREE/);
assert.match(String(compose.services.app.build.args.STAGING_BUILD_CONTEXT_FILE_SET_SHA256), /STAGING_BUILD_CONTEXT_FILE_SET_SHA256/);
assert.match(buildContextScript, /git.*archive/);
assert.match(buildContextScript, /git_archive_exact_commit/);
assert.match(buildContextScript, /local_ignored_files_included: false/);
assert.match(buildContextScript, /secrets_included: false/);

// The repository-root Docker build context must be deny-by-default so ignored
// local state (especially .env.staging) can never become part of image bytes.
assert.match(dockerignore, /^\*\*/m);
assert.match(dockerignore, /^!http-generic-api\/\*\*$/m);
assert.match(dockerignore, /^!edge\/activation-gateway\/generated\/route-policy\.staging\.json$/m);
assert.match(dockerignore, /^!canonical-manifest\.mjs$/m);
assert.match(dockerignore, /^!\.staging-build-context\.json$/m);
assert.match(dockerignore, /^http-generic-api\/\.env\.\*$/m);
assert.match(dockerignore, /^http-generic-api\/\.staging-data\/$/m);
assert.match(dockerignore, /^http-generic-api\/node_modules\/$/m);
assert.match(dockerignore, /^http-generic-api\/google-oauth-token\.json$/m);
assert.match(dockerignore, /^http-generic-api\/deployment-manifest\.json$/m);

assert.match(deployScript, /Get-LatestEligibility/);
assert.match(deployScript, /eligibility_check_name/);
assert.match(deployScript, /Start-AutoPilot\.ps1/);
assert.match(deployScript, /BuildMode/);
assert.match(deployScript, /Invoke-StagingCertification\.ps1/);
assert.match(deployScript, /alreadyCertified/);
assert.match(deployScript, /watcher will re-certify without redeploy/);
assert.match(deployScript, /validated_commit = \$Sha/);
assert.match(deployScript, /deployment state was not advanced/);
assert.match(deployScript, /certification_status/);
assert.match(deployScript, /AUTO_DEPLOY_FAIL_CLOSED/);
assert.match(deployScript, /production_deploy = \$false/);
assert.match(deployScript, /database_mutated = \$false/);
assert.match(deployScript, /migration_applied = \$false/);
assert.match(deployScript, /PollSeconds -lt \[int\]\$Policy\.minimum_poll_seconds/);
assert.doesNotMatch(deployScript, /auth\.mad4b\.com|mcp\.mad4b\.com|activation\.mad4b\.com/);
assert.match(pilotScript, /ACTIVATION_STAGING_GATEWAY_ENABLED/);
assert.match(pilotScript, /ValidateSet\(\"Smart\", \"ForceBuild\", \"SkipBuild\"\)/);
assert.match(pilotScript, /reused_exact_provenance/);
assert.match(pilotScript, /SkipBuild requested but no local app image matches exact commit\/tree\/context provenance/);
assert.match(pilotScript, /prepare-staging-build-context\.mjs/);
assert.match(pilotScript, /STAGING_BUILD_CONTEXT_FILE_SET_SHA256/);
assert.match(pilotScript, /STAGING_APP_IMAGE_ID/);
assert.match(pilotScript, /content-addressed sha256 digest/);
assert.match(pilotScript, /git_archive_exact_commit/);
assert.match(pilotScript, /Invoke-StagingCertification\.ps1/);
assert.match(pilotScript, /certification_status = "pending"/);
assert.match(pilotScript, /Staging is running but not release-ready/);
assert.match(certificationHelper, /staging-live-certification\.mjs/);
assert.match(certificationHelper, /STAGING_CERT_REQUIRE_READY=false/);
assert.match(certificationHelper, /STAGING_CERTIFICATION_DEGRADED/);
assert.match(certificationHelper, /STAGING_CERTIFICATION_BLOCKED/);
assert.match(certificationHelper, /database_readiness/);
assert.match(certificationHelper, /STAGING_CERT_EXPECTED_TREE/);
assert.match(certificationHelper, /STAGING_CERT_EXPECTED_CONTEXT_FILE_SET_SHA256/);
assert.match(certificationHelper, /STAGING_CERT_APP_IMAGE_ID/);
assert.match(oneClickScript, /ACTIVATION_STAGING_GATEWAY_ENABLED/);
assert.match(oneClickScript, /EligibilityNoRunGraceSeconds/);
assert.match(oneClickScript, /No Staging Main Deploy Eligibility workflow run was found/);
assert.match(oneClickScript, /BuildMode/);
assert.match(deployScript, /Global\\Mad4bPortableStagingAutoPilot/);
assert.doesNotMatch(deployScript, /CLOUDFLARE_TUNNEL_TOKEN\s*=/i);

const liveGate = promotionGates.gates.find((gate) => gate.id === "staging_live_certification");
assert.ok(liveGate, "Production promotion must register Staging live certification");
assert.equal(liveGate.workflow, "staging-live-certification.yml");
assert.equal(liveGate.required, true);
assert.equal(liveGate.effect, "read_only");
assert.deepEqual(liveGate.modes, ["human", "ai_policy"]);
assert.equal(liveGate.inputs.expected_candidate_sha, "{{candidate_sha}}");
assert.match(liveWorkflow, /expected_candidate_sha/);
assert.match(liveWorkflow, /git rev-parse HEAD\^1/);
assert.match(liveWorkflow, /git diff --quiet "\$release_cut_sha" HEAD/);
assert.match(liveWorkflow, /STAGING_CERT_REQUIRE_READY: "true"/);
assert.match(liveWorkflow, /https:\/\/dev\.mad4b\.com/);
assert.match(liveWorkflow, /staging-environment-authority-closure\.mjs/);
assert.match(liveWorkflow, /prepare-staging-build-context\.mjs/);
assert.match(liveWorkflow, /STAGING_CERT_EXPECTED_TREE/);
assert.match(liveWorkflow, /STAGING_CERT_EXPECTED_CONTEXT_FILE_SET_SHA256/);
assert.match(liveWorkflow, /artifact_set\.complete/);
assert.match(liveWorkflow, /staging-live-certification\.mjs/);
assert.match(liveWorkflow, /migration_apply:false/);
assert.match(liveWorkflow, /provider_mutation:false/);
assert.match(liveWorkflow, /secrets_included:false/);
assert.doesNotMatch(liveWorkflow, /BACKEND_API_KEY|JWT_SECRET|CLOUDFLARE_TUNNEL_TOKEN/);

assert.match(installer, /Register-ScheduledTask/);
assert.match(installer, /BuildMode/);
assert.match(installer, /LogonType Interactive/);
assert.match(installer, /New-ScheduledTaskTrigger -AtLogOn/);
assert.match(gitignore, /autopilot-portable-staging\/autopilot-state\.json/);
assert.match(gitignore, /autopilot-portable-staging\/auto-deploy-state\.json/);

console.log(JSON.stringify({
  ok: true,
  contract: policy.contract,
  trigger: "push:main",
  deploy_target: "local_staging_only",
  exact_image_provenance: true,
  docker_build_context_fail_closed: true,
  environment_authority_closure: true,
  live_certification: true,
  production_promotion_gate: true,
  production_deploy: false,
  secrets_included: false,
}));
