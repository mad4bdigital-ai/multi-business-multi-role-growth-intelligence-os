import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildReplayPlanFromBundleTexts } from "./prepare-staging-role-schema-replay.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname, "..");
const recovery = fs.readFileSync(path.join(root, "autopilot-portable-staging/Recover-StagingDatabases.ps1"), "utf8");
const clone = fs.readFileSync(path.join(root, "autopilot-portable-staging/Clone-StagingDatabases.ps1"), "utf8");
const legacyClone = fs.readFileSync(path.join(root, "autopilot-portable-staging/Clone-StagingDatabases.Legacy.ps1"), "utf8");
const replayPlanner = fs.readFileSync(path.join(root, "http-generic-api/scripts/prepare-staging-role-schema-replay.mjs"), "utf8");
const roleManifest = JSON.parse(fs.readFileSync(path.join(root, "http-generic-api/config/staging-database-role-migration-manifest.json"), "utf8"));
const grantPlan = fs.readFileSync(path.join(root, "http-generic-api/scripts/staging-role-grant-plan.mjs"), "utf8");
const grantContracts = fs.readFileSync(path.join(root, "http-generic-api/databasePrivilegeContracts.js"), "utf8");

assert.match(recovery, /RESET_LOCAL_STAGING_DATABASES:\$\{ExpectedCommit\}:staging_local_windows_docker/);
assert.match(recovery, /APPLY_STAGING_ROLE_GRANTS:\$\{ExpectedCommit\}:staging_local_windows_docker/);
assert.doesNotMatch(recovery, /RESET_LOCAL_STAGING_DATABASES:\$ExpectedCommit:staging_local_windows_docker/);
assert.doesNotMatch(recovery, /APPLY_STAGING_ROLE_GRANTS:\$ExpectedCommit:staging_local_windows_docker/);
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

assert.match(recovery, /for \(\$attempt = 1; \$attempt -le 60; \$attempt\+\+\)/);
assert.match(recovery, /\$previousErrorActionPreference = \$ErrorActionPreference/);
assert.match(recovery, /\$ErrorActionPreference = "Continue"/);
assert.match(recovery, /\$probeExitCode = \$LASTEXITCODE/);
assert.match(recovery, /finally \{\s*\$ErrorActionPreference = \$previousErrorActionPreference\s*\}/);
assert.match(recovery, /if \(\$probeExitCode -eq 0 -and \$result -eq "1"\) \{ return \}/);
assert.doesNotMatch(recovery, /if \(\$LASTEXITCODE -eq 0 -and \$result -eq "1"\) \{ return \}/);
assert.match(recovery, /Start-Sleep -Seconds 2/);
assert.match(recovery, /Fresh local database did not accept the configured role identity/);
assert.match(recovery, /"--user=\$user"/);
assert.doesNotMatch(recovery, /--protocol=socket\s+-u\$user\b/);

assert.match(clone, /prepare-staging-role-schema-replay\.mjs/);
assert.match(clone, /Clone-StagingDatabases\.Legacy\.ps1/);
assert.match(clone, /--plan/);
assert.match(clone, /--output-directory/);
assert.match(clone, /Role schema replay plan changed between validation and preparation/);
assert.match(clone, /database_connection_used -eq \$false/);
assert.match(clone, /database_mutation -eq \$false/);
assert.match(clone, /grant_mutation -eq \$false/);
assert.match(clone, /ROLE_SCHEMA_REPLAY_PLAN_VALIDATED/);
assert.match(clone, /ROLE_SCHEMA_REPLAY_COMPLETED/);
assert.match(clone, /role-schema-replay-plan\.json/);
assert.match(clone, /schema-import-state\.json/);
assert.match(clone, /Copy-Item -LiteralPath \$preparedStatePath -Destination \$RecoveryStatePath -Force/);
assert.match(clone, /Remove-Item -LiteralPath \$tempRoot -Recurse -Force/);
assert.doesNotMatch(clone, /mariadb[^\r\n]*-uroot/i);
assert.doesNotMatch(clone.replace(/^\s*#.*$/gm, ""), /GRANT\s+SET\s+USER/i);

assert.equal((legacyClone.match(/"--user=\$user"/g) || []).length, 2);
assert.equal((legacyClone.match(/"--user=\$runtimeUser"/g) || []).length, 1);
assert.doesNotMatch(legacyClone, /(?:^|\s)-u\$(?:user|runtimeUser)\b/m);
assert.match(legacyClone, /sed -E 's\/DEFINER=\[\^ \]\+\/DEFINER=CURRENT_USER\/g'/);
assert.match(legacyClone, /mariadb --protocol=socket -u'\$user' '\$db'/);
assert.doesNotMatch(legacyClone.replace(/^\s*#.*$/gm, ""), /GRANT\s+SET\s+USER/i);
assert.doesNotMatch(legacyClone, /mariadb[^\r\n]*-uroot/i);
assert.match(legacyClone, /if \(\$LASTEXITCODE -ne 0\) \{ Fail "Schema import failed for role \$\(\$item\.Key\); state remains applying for explicit recovery\." \}/);

assert.equal(roleManifest.contract, "mad4b.staging.database-role-migration-manifest.v1");
assert.equal(roleManifest.validation.required_runtime_table_census.length, 18);
assert.equal(roleManifest.validation.required_runtime_support_tables.length, 11);
assert.match(legacyClone, /staging-database-role-migration-manifest\.json/);
assert.match(legacyClone, /Assert-SetEqual \$canonicalRuntimeCensus \$requiredRuntimeCensus "schema bundle runtime census projection"/);
assert.match(legacyClone, /\$requiredRuntimeSupportTables = @\(\$roleMigrationManifest\.validation\.required_runtime_support_tables\)/);
assert.match(legacyClone, /Assert-ContainsSet \$requiredRuntimeSupportTables @\(\$runtimeRole\.tables\) "runtime support"/);
assert.match(legacyClone, /Assert-ContainsSet \$requiredRuntimeSupportTables @\(\$runtimeTableNames\) "post-import runtime support"/);
assert.doesNotMatch(legacyClone, /\$bundleManifest\.validation\.required_runtime_support_tables/);

assert.match(replayPlanner, /DEFINER=CURRENT_USER/);
assert.match(replayPlanner, /staging_schema_build/);
assert.match(replayPlanner, /cross_role/);
assert.match(replayPlanner, /unqualifiedRelationPattern/);
assert.match(replayPlanner, /disposable_builder_qualifier_removed: true/);
assert.match(replayPlanner, /cross_role_grants_added: false/);
assert.match(replayPlanner, /root_replay_used: false/);
assert.match(replayPlanner, /database_connection_used: false/);
assert.match(replayPlanner, /grant_mutation: false/);
assert.doesNotMatch(replayPlanner, /child_process|spawnSync|execSync|mariadb\b|docker\b/);
assert.doesNotMatch(replayPlanner, /GRANT\s+SET\s+USER/i);

const fixtureRoleManifest = {
  contract: "mad4b.staging.database-role-migration-manifest.v1",
  roles: {
    runtime: { required_tables: ["runtime_t"] },
    governance: { required_tables: ["governance_t"] },
    runtime_persistence: { required_tables: ["persistence_t"] },
  },
};
const fixtureBundleManifest = {
  contract: "mad4b.staging.schema-bundle-output.v1",
  source_commit: "a".repeat(40),
  schema_only: true,
  production_accessed: false,
  provider_accessed: false,
  secrets_included: false,
  roles: {
    runtime: { tables: ["runtime_t", "v_runtime", "v_runtime_child", "v_governance", "v_cross", "v_activation_agent_skill_grants", "v_effective_agent_skill_grants"] },
    governance: { tables: ["governance_t"] },
    runtime_persistence: { tables: ["persistence_t"] },
  },
};
const view = (name, body) => `/*!50001 CREATE ALGORITHM=UNDEFINED */\n/*!50013 DEFINER=\`root\`@\`localhost\` SQL SECURITY DEFINER */\n/*!50001 VIEW \`${name}\` AS ${body} */`;
const fixtureRuntime = [
  "SET NAMES utf8mb4",
  "CREATE TABLE `runtime_t` (`id` INT)",
  "DROP TABLE IF EXISTS `v_runtime`",
  "/*!50001 CREATE TABLE `v_runtime` (`id` INT) */",
  "DROP TABLE IF EXISTS `v_runtime_child`",
  "/*!50001 CREATE TABLE `v_runtime_child` (`id` INT) */",
  "DROP TABLE IF EXISTS `v_governance`",
  "/*!50001 CREATE TABLE `v_governance` (`id` INT) */",
  "DROP TABLE IF EXISTS `v_cross`",
  "/*!50001 CREATE TABLE `v_cross` (`id` INT) */",
  "DROP TABLE IF EXISTS `v_activation_agent_skill_grants`",
  "/*!50001 CREATE TABLE `v_activation_agent_skill_grants` (`id` INT) */",
  "DROP TABLE IF EXISTS `v_effective_agent_skill_grants`",
  "/*!50001 CREATE TABLE `v_effective_agent_skill_grants` (`id` INT) */",
  view("v_runtime", "SELECT `staging_schema_build`.`runtime_t`.`id` AS `id` FROM `staging_schema_build`.`runtime_t`"),
  view("v_runtime_child", "SELECT `staging_schema_build`.`v_runtime`.`id` AS `id` FROM `staging_schema_build`.`v_runtime`"),
  view("v_governance", "SELECT `staging_schema_build`.`governance_t`.`id` AS `id` FROM `staging_schema_build`.`governance_t`"),
  view("v_cross", "SELECT r.`id` FROM `staging_schema_build`.`runtime_t` r JOIN `staging_schema_build`.`governance_t` g ON g.`id` = r.`id`"),
  view("v_effective_agent_skill_grants", "SELECT `runtime_t`.`id` AS `id` FROM `runtime_t`"),
  view("v_activation_agent_skill_grants", "SELECT `e`.`id` AS `id` FROM ((`v_effective_agent_skill_grants` `e` JOIN `runtime_t` `t` ON (`t`.`id` = `e`.`id`)))"),
].join(";\n") + ";\n";
const fixturePlan = buildReplayPlanFromBundleTexts({
  roleManifest: fixtureRoleManifest,
  bundleManifest: fixtureBundleManifest,
  bundleTexts: {
    runtime: fixtureRuntime,
    governance: "CREATE TABLE `governance_t` (`id` INT);\n",
    runtime_persistence: "CREATE TABLE `persistence_t` (`id` INT);\n",
  },
});
assert.deepEqual(fixturePlan.roles.runtime.views, ["v_effective_agent_skill_grants", "v_activation_agent_skill_grants", "v_runtime", "v_runtime_child"]);
assert.ok(fixturePlan.roles.runtime.views.indexOf("v_effective_agent_skill_grants") < fixturePlan.roles.runtime.views.indexOf("v_activation_agent_skill_grants"));
assert.deepEqual(fixturePlan.roles.governance.views, ["v_governance"]);
assert.deepEqual(fixturePlan.roles.runtime_persistence.views, []);
assert.deepEqual(fixturePlan.excluded_cross_role_views.map((item) => item.name), ["v_cross"]);
assert.deepEqual(fixturePlan.excluded_cross_role_views[0].dependency_roles, ["governance", "runtime"]);
assert.equal(fixturePlan.roles.runtime.sql.includes("staging_schema_build"), false);
assert.equal(fixturePlan.roles.governance.sql.includes("staging_schema_build"), false);
assert.equal(fixturePlan.roles.runtime.sql.includes("DEFINER=CURRENT_USER"), true);
assert.equal(fixturePlan.roles.governance.sql.includes("DEFINER=CURRENT_USER"), true);
assert.equal(fixturePlan.roles.runtime.sql.includes("DEFINER=`root`@`localhost`"), false);
assert.equal(fixturePlan.roles.runtime.sql.includes("v_governance"), false);
assert.equal(fixturePlan.roles.runtime.sql.includes("v_cross"), false);
assert.equal(fixturePlan.roles.governance.sql.includes("v_governance"), true);
assert.equal(fixturePlan.database_connection_used, false);
assert.equal(fixturePlan.database_mutation, false);
assert.equal(fixturePlan.grant_mutation, false);
assert.equal(fixturePlan.production_accessed, false);
assert.equal(fixturePlan.provider_accessed, false);
assert.equal(fixturePlan.secrets_included, false);

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
  canonical_runtime_support_contract_required: true,
  windows_powershell_transient_db_probe_safe: true,
  windows_powershell_native_user_argument_safe: true,
  schema_view_definer_rebound_to_authenticated_role: true,
  schema_view_builder_qualifier_removed: true,
  schema_view_role_dependency_closure: true,
  schema_view_unqualified_dependency_ordering: true,
  cross_role_views_excluded_from_isolated_replay: true,
  cross_role_grants_added: false,
  root_replay_used: false,
  repository_owned_grant_matrix: true,
  certification_ready_required: true,
  production_accessed: false,
  provider_accessed: false,
  secrets_included: false,
}));