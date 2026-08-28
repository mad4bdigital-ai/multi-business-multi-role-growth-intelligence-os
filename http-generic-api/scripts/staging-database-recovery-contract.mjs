import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname, "..");
const recovery = fs.readFileSync(path.join(root, "autopilot-portable-staging/Recover-StagingDatabases.ps1"), "utf8");
const grantPlan = fs.readFileSync(path.join(root, "http-generic-api/scripts/staging-role-grant-plan.mjs"), "utf8");
const grantContracts = fs.readFileSync(path.join(root, "http-generic-api/databasePrivilegeContracts.js"), "utf8");

assert.match(recovery, /RESET_LOCAL_STAGING_DATABASES:\$ExpectedCommit:staging_local_windows_docker/);
assert.match(recovery, /APPLY_STAGING_ROLE_GRANTS:\$ExpectedCommit:staging_local_windows_docker/);
assert.match(recovery, /origin\/main moved away from ExpectedCommit/);
assert.match(recovery, /Tracked working tree changes are forbidden/);
assert.match(recovery, /DOCKER_HOST is forbidden/);
assert.match(recovery, /DOCKER_CONTEXT is forbidden/);
assert.match(recovery, /BUILD_STAGING_SCHEMA_BUNDLE/);
assert.match(recovery, /Clone-StagingDatabases\.ps1/);
assert.match(recovery, /-Mode schema_only -Apply/);
assert.match(recovery, /_recovery_backups/);
assert.match(recovery, /Move-Item -LiteralPath \$source -Destination \$destination/);
assert.match(recovery, /--profile", "tunnel", "down", "--remove-orphans/);
assert.doesNotMatch(recovery, /down[^\r\n]*-v/);
assert.doesNotMatch(recovery, /Remove-Item[^\r\n]*(?:runtime-db|governance-db|persistence-db|_recovery_backups)/i);
assert.match(recovery, /RUNTIME_DB_ROOT_PASSWORD/);
assert.match(recovery, /GOVERNANCE_DB_ROOT_PASSWORD/);
assert.match(recovery, /RUNTIME_PERSISTENCE_DB_ROOT_PASSWORD/);
assert.match(recovery, /REVOKE ALL PRIVILEGES, GRANT OPTION/);
assert.match(recovery, /Forbidden Staging grant privilege/);
assert.match(recovery, /USER_PRIVILEGES/);
assert.match(recovery, /SCHEMA_PRIVILEGES/);
assert.match(recovery, /TABLE_PRIVILEGES/);
assert.match(recovery, /COLUMN_PRIVILEGES/);
assert.match(recovery, /APPLICABLE_ROLES/);
assert.match(recovery, /IS_GRANTABLE = 'YES'/);
assert.match(recovery, /Start-AutoPilot\.ps1/);
assert.match(recovery, /-SkipBuild -SkipSelfUpdate/);
assert.match(recovery, /certification_status -eq "ready"/);
assert.match(recovery, /backups_deleted = \$false/);
assert.match(recovery, /production_accessed = \$false/);
assert.match(recovery, /provider_accessed = \$false/);
assert.match(recovery, /hostinger_mutation = \$false/);
assert.match(recovery, /cloudflare_mutation = \$false/);
assert.match(recovery, /secrets_included = \$false/);

assert.match(grantPlan, /BOOTSTRAP_ROLE_GRANT_POLICIES/);
assert.match(grantPlan, /runtime_persistence/);
assert.match(grantPlan, /broad_schema_grants_allowed: false/);
assert.match(grantPlan, /grant_option_allowed: false/);
assert.match(grantPlan, /production_accessed: false/);
assert.match(grantPlan, /provider_accessed: false/);
assert.match(grantPlan, /secrets_included: false/);
assert.match(grantContracts, /GOVERNANCE_DB_PRIVILEGE_MATRIX/);
assert.match(grantContracts, /runtime_persistence: buildGrantSpec/);

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.staging-database-recovery.v1",
  reversible_backups_required: true,
  exact_sha_required: true,
  explicit_reset_confirmation_required: true,
  explicit_grant_confirmation_required: true,
  repository_owned_grant_matrix: true,
  certification_ready_required: true,
  production_accessed: false,
  provider_accessed: false,
  secrets_included: false,
}));
