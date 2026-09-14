import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const portable = path.join(root, "autopilot-portable-staging");
const manifestPath = path.join(root, "http-generic-api", "config", "staging-governance-authority-seed-manifest.json");
const seedPath = path.join(root, "http-generic-api", "config", "staging-governance-authority-seed.sql");
const helperPath = path.join(portable, "Replay-StagingGovernanceAuthoritySeed.ps1");
const recoveryPath = path.join(portable, "Recover-StagingDatabases.ps1");
const attributesPath = path.join(root, ".gitattributes");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const seed = fs.readFileSync(seedPath, "utf8");
const helper = fs.readFileSync(helperPath, "utf8");
const recovery = fs.readFileSync(recoveryPath, "utf8");
const attributes = fs.readFileSync(attributesPath, "utf8");

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

assert.equal(manifest.contract, "mad4b.staging.governance-authority-seed-manifest.v1");
assert.equal(manifest.status, "active_local_staging_only");
assert.equal(manifest.target_role, "governance");
assert.equal(manifest.execution_identity, "local_database_root");
assert.equal(manifest.replay_mode, "explicit_local_staging_only");
assert.equal(manifest.seed_file, "http-generic-api/config/staging-governance-authority-seed.sql");
assert.equal(manifest.seed_sha256, sha256(seed));
assert.equal(manifest.expected_statement_count, 5);
assert.equal(manifest.readback_required, true);
assert.equal(manifest.certification_posture.certification_status, "pending");
assert.equal(manifest.certification_posture.dispatch_allowed, false);
assert.equal(manifest.certification_posture.apply_allowed, false);
assert.equal(manifest.certification_posture.requires_independent_same_cycle_certification, true);
assert.deepEqual(manifest.safety, {
  local_staging_only: true,
  production_access_forbidden: true,
  provider_access_forbidden: true,
  hostinger_mutation: false,
  cloudflare_mutation: false,
  dns_mutation: false,
  custom_domain_mutation: false,
  grant_mutation: false,
  provider_credentials_included: false,
  secrets_included: false,
});

assert.match(attributes, /^http-generic-api\/config\/staging-governance-authority-seed\.sql text eol=lf$/mu);
assert.equal((seed.match(/^\s*INSERT\s+INTO\b/gimu) || []).length, 5);
for (const exact of [
  "staging_activation_gateway_apply_authority_v1",
  "staging_activation_gateway_apply_policy_v1",
  "5a2b04f8-bb99-4f65-a924-0f55d3080376",
  "mad4b-activation-gateway-staging",
  "c6468e051b8456d4d3ffc6478cdb98f7048b69c8ca6742f4dca27e1eb4023f32",
]) {
  assert.match(seed, new RegExp(exact.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
}
assert.match(seed, /certification_status='pending'/u);
assert.match(seed, /dispatch_allowed=0/u);
assert.match(seed, /apply_allowed=0/u);
assert.match(seed, /last_certified_at=NULL/u);
assert.match(seed, /expires_at=NULL/u);
assert.doesNotMatch(seed, /profile_bound_staging_apply_contract_certified/u);
assert.doesNotMatch(seed, /^\s*(?:GRANT|REVOKE|CREATE\s+USER|ALTER\s+USER|CREATE\s+DATABASE|DROP\s+DATABASE|LOAD\s+DATA)\b/gimu);
assert.doesNotMatch(seed, /\bINTO\s+(?:OUTFILE|DUMPFILE)\b/iu);

assert.match(helper, /STAGING_GOVERNANCE_AUTHORITY_SEED_FAIL_CLOSED/u);
assert.match(helper, /GOVERNANCE_DB_ROOT_PASSWORD/u);
assert.match(helper, /governance-db/u);
assert.match(helper, /Get-Sha256/u);
assert.match(helper, /seed_sha256/u);
assert.match(helper, /Required Governance seed table/u);
assert.match(helper, /certification_status='pending'/u);
assert.match(helper, /dispatch_allowed=0/u);
assert.match(helper, /apply_allowed=0/u);
assert.match(helper, /provider_mutation = \$false/u);
assert.match(helper, /grant_mutation = \$false/u);
assert.match(helper, /production_mutation = \$false/u);
assert.doesNotMatch(helper, /api\.cloudflare\.com/iu);
assert.doesNotMatch(helper, /wrangler\s+deploy/iu);
assert.doesNotMatch(helper, /GRANT\s+.+\s+ON/iu);

assert.match(recovery, /Replay-StagingGovernanceAuthoritySeed\.ps1/u);
assert.match(recovery, /governance_authority_seed/u);
assert.match(recovery, /Staging Governance authority seed replay failed/u);
const schemaApply = recovery.indexOf('Require ($LASTEXITCODE -eq 0) "Staging schema bundle apply failed"');
const seedApply = recovery.indexOf('-File $GovernanceAuthoritySeedReplay');
const grantApply = recovery.indexOf('$script:RecoveryState.status = "grant_reconciliation"');
assert.ok(schemaApply >= 0 && seedApply > schemaApply, "Governance authority seed must run after schema import");
assert.ok(grantApply > seedApply, "Governance authority seed must run before grant reconciliation");

console.log("staging governance authority seed recovery contract: ok");
