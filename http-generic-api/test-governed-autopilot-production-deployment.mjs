import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL(".", import.meta.url).pathname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const r7 = read(".github/workflows/hostinger-production-runtime-readback-r7.yml");
const exactCandidate = read(".github/workflows/production-promotion-exact-candidate-validation.yml");
const ci = read(".github/workflows/ci.yml");
const authRoutes = read("http-generic-api/routes/authRoutes.js");

assert.match(r7, /push:\n\s+branches: \[Production\]/);
assert.match(r7, /github\.event_name == 'push' && github\.ref == 'refs\/heads\/Production'/);
assert.match(r7, /expected_production_sha=\$\{EVENT_SHA\}/);
assert.match(r7, /expected_production_sha=\(\[0-9a-f\]\{40\}\)/);
assert.match(r7, /test "\$\{?remote_production_sha\}?" = "\$\{EXPECTED_PRODUCTION_SHA\}"/);
assert.match(r7, /version_sha_exact/);
assert.match(r7, /deployment_sha_exact/);
assert.match(r7, /branch_exact/);
assert.match(r7, /const productionCurrent = allHttpSuccess && versionShaExact && deploymentShaExact && branchExact/);
assert.match(r7, /public_get_only: true/);
assert.match(r7, /provider_mutation_performed: false/);
assert.match(r7, /deployment_performed: false/);
assert.match(r7, /database_mutation_performed: false/);
assert.match(r7, /secrets_included: false/);
assert.match(r7, /runtime_activation_pending_or_sha_mismatch/);
assert.match(r7, /production_current/);
assert.match(r7, /trigger_mode=production_push/);
assert.match(r7, /TRIGGER_MODE: \$\{\{ steps\.trigger\.outputs\.trigger_mode \}\}/);

assert.match(exactCandidate, /VALIDATE_EXACT_PRODUCTION_CANDIDATE/);
assert.match(exactCandidate, /expected_head_sha/);
assert.match(exactCandidate, /source-pinned refs moved/);
assert.match(exactCandidate, /candidate_tree_matches_base: true/);
assert.match(exactCandidate, /deployment_executed: false/);
assert.match(exactCandidate, /provider_call_executed: false/);
assert.match(exactCandidate, /credential_payload_read: false/);

assert.match(ci, /TENANT_GPT_SSO_SIGNING_SECRET/);
assert.match(authRoutes, /requireConfiguredSsoSigningSecret/);
assert.match(authRoutes, /at least 32 characters/);

for (const workflow of [r7, exactCandidate]) {
  assert.doesNotMatch(workflow, /PRODUCTION_MUTATION_AUTHORIZED=true/);
  assert.doesNotMatch(workflow, /DATABASE_MUTATED=true/);
  assert.doesNotMatch(workflow, /MIGRATION_APPLIED=true/);
}

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.governed-autopilot-production-deployment.v1",
  exact_sha: true,
  source_pin_freshness: true,
  production_secret_startup_contract: true,
  post_deploy_r7_readback: true,
  pending_runtime_classification: true,
  provider_mutation: false,
  database_mutation: false,
  secrets_included: false,
}));
