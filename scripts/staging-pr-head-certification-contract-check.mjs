import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const bridge = read("autopilot-portable-staging/Invoke-StagingPrHeadCertification.ps1");
const certification = read("autopilot-portable-staging/Invoke-StagingCertification.ps1");
const oneClick = read("autopilot-portable-staging/One-Click-Staging.ps1");
const autoDeploy = read("autopilot-portable-staging/Auto-Deploy-Staging.ps1");
const generator = read("http-generic-api/scripts/generate-portable-staging-manifest.mjs");
const compose = read("http-generic-api/docker-compose.staging.yml");
const phaseB = read("http-generic-api/stagingRecoveryAuthorityBindingPhaseB.js");
const prHeadReadinessTest = read("http-generic-api/test-staging-pr-head-recovery-readiness.mjs");
const declaration = JSON.parse(read(".changes/e2e/runtime-composition-x0-evidence-baseline-20260906.json"));

assert.match(bridge, /CERTIFY_STAGING_PR_HEAD/);
assert.match(bridge, /Get-VerifiedPullRequest "preflight"/);
assert.match(bridge, /Get-VerifiedPullRequest "postflight"/);
assert.match(bridge, /STAGING_CERT_AUTHORITY_MODE = "pull_request_head"/);
assert.match(bridge, /STAGING_CERT_PR_NUMBER/);
assert.match(bridge, /STAGING_CERT_PR_REPOSITORY/);
assert.match(bridge, /repos\/\$ExpectedRepository\/pulls\/\$PrNumber/);
assert.match(bridge, /Pull request base must remain main/);
assert.match(bridge, /Cross-repository pull requests are forbidden/);
assert.match(bridge, /Pull request head SHA changed/);
assert.match(bridge, /Start-AutoPilot\.ps1/);
assert.match(bridge, /certification_status/);
assert.match(bridge, /Gate X0 requires live Staging certification status=ready/);
assert.match(bridge, /artifact_set_complete/);
assert.match(bridge, /production_deploy/);
assert.match(bridge, /database_mutated/);
assert.match(bridge, /migration_applied/);
assert.match(bridge, /provider_mutation/);
assert.match(bridge, /ruleset_mutation/);
assert.match(bridge, /source_tree_self_attestation = \$false/);
assert.match(bridge, /production_mutation_allowed = \$false/);
assert.match(bridge, /release_certification = \$false/);
assert.match(bridge, /external_gateway_mutation = \$false/);
assert.match(bridge, /gatewayCertificationScope -ne "excluded_external_gateway"/);
assert.match(bridge, /secrets_included = \$false/);

assert.match(certification, /function Assert-CertificationAuthority/);
assert.match(certification, /STAGING_CERT_AUTHORITY_MODE/);
assert.match(certification, /pull_request_head/);
assert.match(certification, /STAGING_CERT_PR_REPOSITORY/);
assert.match(certification, /STAGING_CERT_PR_NUMBER/);
assert.match(certification, /GitHub pull-request authority readback/);
assert.match(certification, /\$pr\.base\.ref -ne "main"/);
assert.match(certification, /\$pr\.head\.repo\.full_name -ne \$repository/);
assert.match(certification, /\$pr\.head\.ref -ne \$Ref/);
assert.match(certification, /\$pr\.head\.sha/);
assert.match(certification, /Local repository HEAD is not the exact PR head during certification/);
assert.match(certification, /STAGING_CERTIFICATION_PR_HEAD_AUTHORITY/);
assert.match(certification, /gatewayCertificationScope = if \(\$script:CertificationAuthorityMode -eq "pull_request_head"\) \{ "excluded_external_gateway" \}/);
assert.doesNotMatch(certification, /if \(\$Ref -ne "main"\) \{ Fail "Portable Staging certification is main-only" \}/);

assert.match(compose, /STAGING_CERT_AUTHORITY_MODE: "\$\{STAGING_CERT_AUTHORITY_MODE:-\}"/);
assert.match(compose, /STAGING_CERT_PR_NUMBER: "\$\{STAGING_CERT_PR_NUMBER:-\}"/);
assert.match(compose, /STAGING_CERT_PR_REPOSITORY: "\$\{STAGING_CERT_PR_REPOSITORY:-\}"/);
assert.match(phaseB, /STAGING_PR_HEAD_READINESS_CONTRACT/);
assert.match(phaseB, /prHeadReadinessContext/);
assert.match(phaseB, /getCurrentCertificationId: async \(\) => null/);
assert.match(phaseB, /pr_head_certification_only: true/);
assert.match(phaseB, /production_authority_eligible: false/);
assert.match(prHeadReadinessTest, /stale_release_pointer_ignored/);
assert.match(prHeadReadinessTest, /production_authority_expanded: false/);

assert.match(oneClick, /if \(\$Ref -ne "main"\) \{ Fail "One-click Auto Pilot is main-only" \}/);
assert.match(autoDeploy, /Only the policy ref/);
assert.match(generator, /autopilot-portable-staging\/Invoke-StagingPrHeadCertification\.ps1/);

const scope = new Set(declaration.scope?.include || []);
for (const required of [
  "autopilot-portable-staging/Invoke-StagingCertification.ps1",
  "autopilot-portable-staging/Invoke-StagingPrHeadCertification.ps1",
  "http-generic-api/docker-compose.staging.yml",
  "http-generic-api/stagingRecoveryAuthorityBindingPhaseB.js",
  "http-generic-api/test-staging-pr-head-recovery-readiness.mjs",
  "http-generic-api/scripts/generate-portable-staging-manifest.mjs",
  "scripts/staging-pr-head-certification-contract-check.mjs",
]) {
  assert.equal(scope.has(required), true, `X0 scope is missing ${required}`);
}

const journeys = declaration.phases?.flatMap((phase) => phase.e2e_journeys || []) || [];
const x0 = journeys.find((journey) => journey.id === "runtime-composition-x0-passive-evidence-baseline");
assert.ok(x0, "X0 journey is missing");
assert.equal(
  x0.tests?.some((entry) =>
    entry.path === "scripts/staging-pr-head-certification-contract-check.mjs"),
  true,
  "X0 must execute the PR-head certification bridge contract check",
);
assert.equal(
  x0.tests?.some((entry) =>
    entry.path === "test-staging-pr-head-recovery-readiness.mjs"),
  true,
  "X0 must execute the PR-head Recovery readiness isolation test",
);
assert.equal(
  x0.assertions?.some((entry) => entry.includes("same-repository open non-draft pull request")),
  true,
  "X0 must declare the exact PR-head authority invariant",
);
assert.equal(
  x0.assertions?.some((entry) => entry.includes("main-only Auto Deploy and One-Click")),
  true,
  "X0 must preserve main-only deployment supervisors",
);
assert.equal(
  x0.assertions?.some((entry) => entry.includes("release certification pointer")),
  true,
  "X0 must keep PR-head readiness isolated from release certification state",
);

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.staging-pr-head-certification-bridge.v1",
  exact_pr_head_revalidated_preflight: true,
  exact_pr_head_revalidated_postflight: true,
  certifier_revalidates_authority: true,
  main_only_supervisors_preserved: true,
  pr_head_readiness_isolated_from_release_certification: true,
  pr_head_production_authority_expanded: false,
  gate_x0_requires_ready: true,
  external_gateway_excluded_from_pr_head_authority: true,
  release_certification: false,
  production_mutation_allowed: false,
  source_tree_self_attestation: false,
  secrets_included: false,
}));
