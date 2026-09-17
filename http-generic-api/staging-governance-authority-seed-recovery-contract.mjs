import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const apiRoot = path.join(root, "http-generic-api");
const portable = path.join(root, "autopilot-portable-staging");
const manifestPath = path.join(apiRoot, "config", "staging-gateway-authority-seed-manifest.json");
const runtimeSeedPath = path.join(apiRoot, "config", "staging-gateway-runtime-authority-seed.sql");
const governanceSeedPath = path.join(apiRoot, "config", "staging-gateway-governance-authority-seed.sql");
const roleManifestPath = path.join(apiRoot, "config", "staging-database-role-migration-manifest.json");
const helperPath = path.join(portable, "Replay-StagingGatewayAuthoritySeeds.ps1");
const compatibilityHelperPath = path.join(portable, "Replay-StagingGovernanceAuthoritySeed.ps1");
const recoveryPath = path.join(portable, "Recover-StagingDatabases.ps1");
const rolloutWrapperPath = path.join(apiRoot, "activationGatewayRolloutTool.js");
const attributesPath = path.join(root, ".gitattributes");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const roleManifest = JSON.parse(fs.readFileSync(roleManifestPath, "utf8"));
const runtimeSeed = fs.readFileSync(runtimeSeedPath, "utf8");
const governanceSeed = fs.readFileSync(governanceSeedPath, "utf8");
const helper = fs.readFileSync(helperPath, "utf8");
const compatibilityHelper = fs.readFileSync(compatibilityHelperPath, "utf8");
const recovery = fs.readFileSync(recoveryPath, "utf8");
const rolloutWrapper = fs.readFileSync(rolloutWrapperPath, "utf8");
const attributes = fs.readFileSync(attributesPath, "utf8");

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const forbiddenSeedSql = /^\s*(?:GRANT|REVOKE|CREATE\s+USER|ALTER\s+USER|CREATE\s+DATABASE|DROP\s+DATABASE|LOAD\s+DATA)\b/gimu;

assert.equal(manifest.contract, "mad4b.staging.gateway-authority-seed-manifest.v1");
assert.equal(manifest.status, "active_local_staging_only");
assert.equal(manifest.execution_identity, "local_database_root");
assert.equal(manifest.replay_mode, "explicit_local_staging_only");
assert.equal(manifest.readback_required, true);
assert.equal(manifest.roles.runtime.container_service, "runtime-db");
assert.equal(manifest.roles.runtime.database_env, "DB_NAME");
assert.equal(manifest.roles.runtime.root_password_env, "RUNTIME_DB_ROOT_PASSWORD");
assert.equal(manifest.roles.runtime.seed_file, "http-generic-api/config/staging-gateway-runtime-authority-seed.sql");
assert.equal(manifest.roles.runtime.seed_sha256, sha256(runtimeSeed));
assert.equal(manifest.roles.runtime.expected_statement_count, 2);
assert.equal(manifest.roles.governance.container_service, "governance-db");
assert.equal(manifest.roles.governance.database_env, "GOVERNANCE_DB_NAME");
assert.equal(manifest.roles.governance.root_password_env, "GOVERNANCE_DB_ROOT_PASSWORD");
assert.equal(manifest.roles.governance.seed_file, "http-generic-api/config/staging-gateway-governance-authority-seed.sql");
assert.equal(manifest.roles.governance.seed_sha256, sha256(governanceSeed));
assert.equal(manifest.roles.governance.expected_statement_count, 3);
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

assert.match(attributes, /^http-generic-api\/config\/staging-gateway-runtime-authority-seed\.sql text eol=lf$/mu);
assert.match(attributes, /^http-generic-api\/config\/staging-gateway-governance-authority-seed\.sql text eol=lf$/mu);
assert.equal((runtimeSeed.match(/^\s*INSERT\s+INTO\b/gimu) || []).length, 2);
assert.equal((governanceSeed.match(/^\s*INSERT\s+INTO\b/gimu) || []).length, 3);
assert.doesNotMatch(runtimeSeed, forbiddenSeedSql);
assert.doesNotMatch(governanceSeed, forbiddenSeedSql);
assert.doesNotMatch(runtimeSeed, /\bINTO\s+(?:OUTFILE|DUMPFILE)\b/iu);
assert.doesNotMatch(governanceSeed, /\bINTO\s+(?:OUTFILE|DUMPFILE)\b/iu);

assert.match(runtimeSeed, /INSERT INTO platform_resource_authority_requirements/u);
assert.match(runtimeSeed, /INSERT INTO resource_authority_route_family_registry/u);
assert.doesNotMatch(runtimeSeed, /INSERT INTO platform_resource_authority_bindings/u);
assert.doesNotMatch(runtimeSeed, /INSERT INTO capability_apply_authorization_policy_registry/u);
assert.doesNotMatch(runtimeSeed, /INSERT INTO runtime_dispatch_certification_registry/u);

assert.match(governanceSeed, /INSERT INTO capability_apply_authorization_policy_registry/u);
assert.match(governanceSeed, /INSERT INTO platform_resource_authority_bindings/u);
assert.match(governanceSeed, /INSERT INTO runtime_dispatch_certification_registry/u);
assert.doesNotMatch(governanceSeed, /INSERT INTO platform_resource_authority_requirements/u);
assert.doesNotMatch(governanceSeed, /INSERT INTO resource_authority_route_family_registry/u);
for (const exact of [
  "staging_activation_gateway_apply_policy_v1",
  "5a2b04f8-bb99-4f65-a924-0f55d3080376",
  "mad4b-activation-gateway-staging",
  "dd5f152c4a226d07c75cf33dae3ab3a0cbf6e9913b623724429a96b2d4f96a96",
]) {
  assert.match(governanceSeed, new RegExp(exact.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
}
assert.match(governanceSeed, /certification_status='pending'/u);
assert.match(governanceSeed, /dispatch_allowed=0/u);
assert.match(governanceSeed, /apply_allowed=0/u);
assert.match(governanceSeed, /last_certified_at=NULL/u);
assert.match(governanceSeed, /expires_at=NULL/u);
assert.doesNotMatch(governanceSeed, /profile_bound_staging_apply_contract_certified/u);

const governanceOwned = [
  "capability_apply_authorization_policy_registry",
  "platform_resource_authority_bindings",
  "runtime_dispatch_certification_registry",
];
for (const table of governanceOwned) {
  assert.ok(roleManifest.roles.governance.required_tables.includes(table), `${table} must remain Governance-owned`);
  assert.ok(roleManifest.roles.runtime.excluded_tables.includes(table), `${table} must remain Runtime-excluded`);
}
assert.ok(!roleManifest.roles.governance.required_tables.includes("platform_resource_authority_requirements"));
assert.ok(!roleManifest.roles.governance.required_tables.includes("resource_authority_route_family_registry"));
assert.ok(roleManifest.roles.runtime.required_tables.includes("platform_resource_authority_requirements") || !roleManifest.roles.runtime.excluded_tables.includes("platform_resource_authority_requirements"));
assert.ok(roleManifest.roles.runtime.required_tables.includes("resource_authority_route_family_registry") || !roleManifest.roles.runtime.excluded_tables.includes("resource_authority_route_family_registry"));

assert.match(rolloutWrapper, /assertPlatformResourceAuthorityStoreSource/u);
assert.match(rolloutWrapper, /const governancePool = deps\.governancePool \|\| deps\.authorityStorePool \|\| null/u);
assert.match(rolloutWrapper, /platform_resource_authority_bindings/u);
assert.match(rolloutWrapper, /return governancePool\.query\(sql, params\)/u);

assert.match(helper, /STAGING_GATEWAY_AUTHORITY_SEED_FAIL_CLOSED/u);
assert.match(helper, /RUNTIME_DB_ROOT_PASSWORD/u);
assert.match(helper, /GOVERNANCE_DB_ROOT_PASSWORD/u);
assert.match(helper, /runtime-db/u);
assert.match(helper, /governance-db/u);
assert.match(helper, /seed_sha256/u);
assert.match(helper, /Runtime Gateway authority seed replay failed/u);
assert.match(helper, /Governance Gateway authority seed replay failed/u);
assert.match(helper, /certification_status='pending'/u);
assert.match(helper, /dispatch_allowed=0/u);
assert.match(helper, /apply_allowed=0/u);
assert.match(helper, /provider_mutation = \$false/u);
assert.match(helper, /grant_mutation = \$false/u);
assert.match(helper, /production_mutation = \$false/u);
assert.doesNotMatch(helper, /api\.cloudflare\.com/iu);
assert.doesNotMatch(helper, /wrangler\s+deploy/iu);
assert.doesNotMatch(helper, /GRANT\s+.+\s+ON/iu);

assert.match(compatibilityHelper, /Replay-StagingGatewayAuthoritySeeds\.ps1/u);
assert.match(recovery, /Replay-StagingGovernanceAuthoritySeed\.ps1/u);
assert.match(recovery, /governance_authority_seed/u);
assert.match(recovery, /Staging Governance authority seed replay failed/u);
const schemaApply = recovery.indexOf('Require ($LASTEXITCODE -eq 0) "Staging schema bundle apply failed"');
const seedApply = recovery.indexOf('-File $GovernanceAuthoritySeedReplay');
const grantApply = recovery.indexOf('$script:RecoveryState.status = "grant_reconciliation"');
assert.ok(schemaApply >= 0 && seedApply > schemaApply, "Gateway authority seeds must run after schema import");
assert.ok(grantApply > seedApply, "Gateway authority seeds must run before grant reconciliation");

console.log("staging role-aware Gateway authority seed recovery contract: ok");
