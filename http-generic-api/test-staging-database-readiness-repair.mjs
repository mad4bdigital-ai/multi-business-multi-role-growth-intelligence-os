import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BOOTSTRAP_ROLE_GRANT_POLICIES,
  STAGING_ROLE_GRANT_POLICIES,
} from "./databasePrivilegeContracts.js";
import { loadEnvironmentBranchAuthority } from "./environmentBranchAuthority.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");
const readJson = (relative) => JSON.parse(read(relative));

const grantPlan = read("http-generic-api/scripts/staging-role-grant-plan.mjs");
const governanceReadiness = read("http-generic-api/governanceDbPrivilegeReadinessService.js");
const compose = read("http-generic-api/docker-compose.staging.yml");
const repair = read("autopilot-portable-staging/Repair-StagingDatabaseReadiness.ps1");
const runtimePersistenceReadiness = read("http-generic-api/scripts/runtime-persistence-operational-readiness.mjs");
const importer = read("autopilot-portable-staging/Clone-StagingDatabases.Legacy.ps1");
const sqlCacheMigration = read("http-generic-api/migrations/1023_sprint69_sql_cache_runtime_policy.sql");
const roleManifest = readJson("http-generic-api/config/staging-database-role-migration-manifest.json");
const autoDeployPolicy = readJson("autopilot-portable-staging/auto-deploy-policy.json");
const oneClickPolicy = readJson("autopilot-portable-staging/autopilot-one-click-policy.json");

const sqlCacheAuthoritySeed = {
  file: "1023_sprint69_sql_cache_runtime_policy.sql",
  sha256: "50424aac877e6c3924191599b295a460007b98d01fbe009d615e06457e24fdc7",
  statement_count: 2,
};

const sqlCacheInsertIndex = sqlCacheMigration.indexOf('INSERT INTO `sql_cache_runtime_policies`');
assert.ok(sqlCacheInsertIndex >= 0);
const extractedSqlCacheSeed = sqlCacheMigration.slice(sqlCacheInsertIndex).trim();
assert.ok(extractedSqlCacheSeed.startsWith('INSERT INTO `sql_cache_runtime_policies`'));
assert.match(repair, /\$seedSql\.StartsWith\(\$insertMarker, \[StringComparison\]::Ordinal\)/);

assert.deepEqual(BOOTSTRAP_ROLE_GRANT_POLICIES.runtime.required_tables, [
  "customer_sessions",
  "gpt_session_turns",
  "actions",
  "dynamic_audit_scheduler_runs",
  "execution_log",
  "json_assets",
]);
assert.equal(BOOTSTRAP_ROLE_GRANT_POLICIES.runtime.required_tables.includes("admin_platform_endpoint_tools"), false);
assert.equal(BOOTSTRAP_ROLE_GRANT_POLICIES.runtime.required_tables.includes("tenant_platform_endpoint_tools"), false);
assert.equal(BOOTSTRAP_ROLE_GRANT_POLICIES.runtime.required_tables.includes("sql_cache_runtime_policies"), false);

assert.equal(STAGING_ROLE_GRANT_POLICIES.runtime.required_tables.includes("admin_platform_endpoint_tools"), true);
assert.equal(STAGING_ROLE_GRANT_POLICIES.runtime.required_tables.includes("tenant_platform_endpoint_tools"), true);
assert.equal(STAGING_ROLE_GRANT_POLICIES.runtime.required_tables.includes("sql_cache_runtime_policies"), true);
assert.deepEqual(STAGING_ROLE_GRANT_POLICIES.runtime.required_operations_by_table.admin_platform_endpoint_tools, ["SELECT"]);
assert.deepEqual(STAGING_ROLE_GRANT_POLICIES.runtime.required_operations_by_table.tenant_platform_endpoint_tools, ["SELECT"]);
assert.deepEqual(STAGING_ROLE_GRANT_POLICIES.runtime.required_operations_by_table.sql_cache_runtime_policies, ["SELECT"]);
assert.equal(STAGING_ROLE_GRANT_POLICIES.runtime.required_tables.includes("platform_runtime_config"), true);
assert.deepEqual(STAGING_ROLE_GRANT_POLICIES.runtime.required_operations_by_table.platform_runtime_config, ["SELECT"]);
assert.equal(BOOTSTRAP_ROLE_GRANT_POLICIES.runtime.required_tables.includes("platform_runtime_config"), false);
for (const operationalReadSurface of [
  "v_activation_pending_tasks",
  "v_activation_agent_catalog",
  "v_activation_agent_skill_grants",
  "activation_freshness_ledger",
  "activation_signal_inbox",
  "readiness_checks",
  "telemetry_spans",
  "operational_alerts",
  "v_platform_evolution_activation_card",
]) {
  assert.equal(STAGING_ROLE_GRANT_POLICIES.runtime.required_tables.includes(operationalReadSurface), false);
  assert.equal(STAGING_ROLE_GRANT_POLICIES.runtime.optional_tables.includes(operationalReadSurface), true);
  assert.deepEqual(
    STAGING_ROLE_GRANT_POLICIES.runtime.required_operations_by_table[operationalReadSurface],
    ["SELECT"],
  );
  assert.equal(BOOTSTRAP_ROLE_GRANT_POLICIES.runtime.required_tables.includes(operationalReadSurface), false);
  assert.equal(BOOTSTRAP_ROLE_GRANT_POLICIES.runtime.optional_tables.includes(operationalReadSurface), false);
}
for (const identityTable of ["users", "memberships", "tenants"]) {
  assert.equal(STAGING_ROLE_GRANT_POLICIES.runtime.required_tables.includes(identityTable), true);
  assert.deepEqual(STAGING_ROLE_GRANT_POLICIES.runtime.required_operations_by_table[identityTable], ["SELECT"]);
  assert.equal(BOOTSTRAP_ROLE_GRANT_POLICIES.runtime.required_tables.includes(identityTable), false);
}
assert.deepEqual(STAGING_ROLE_GRANT_POLICIES.governance, BOOTSTRAP_ROLE_GRANT_POLICIES.governance);
assert.deepEqual(STAGING_ROLE_GRANT_POLICIES.runtime_persistence, BOOTSTRAP_ROLE_GRANT_POLICIES.runtime_persistence);

assert.match(grantPlan, /STAGING_ROLE_GRANT_POLICIES/);
assert.doesNotMatch(grantPlan, /const spec = BOOTSTRAP_ROLE_GRANT_POLICIES\[role\]/);
assert.match(grantPlan, /broad_schema_grants_allowed: false/);
assert.match(grantPlan, /grant_option_allowed: false/);
assert.match(grantPlan, /required: !optionalSet\.has\(table\)/);
assert.match(grantPlan, /missing_optional_surface_is_blocking: false/);
assert.match(grantPlan, /missing_required_surface_is_blocking: true/);

const composeCollationCount = (compose.match(/--collation-server=utf8mb4_unicode_ci/g) || []).length;
const composeCharsetCount = (compose.match(/--character-set-server=utf8mb4/g) || []).length;
assert.equal(composeCollationCount, 3);
assert.equal(composeCharsetCount, 3);

assert.match(governanceReadiness, /DEPLOYMENT_ENVIRONMENT/);
assert.match(governanceReadiness, /staging_local_windows_docker/);
assert.match(governanceReadiness, /repositoryAuthorityOnly: true/);

let sqlAuthorityQueried = false;
const authority = await loadEnvironmentBranchAuthority({
  pool: {
    async query() {
      sqlAuthorityQueried = true;
      throw new Error("repository-only Staging authority must not query SQL");
    },
  },
  repositoryAuthorityOnly: true,
  readFile: async () => JSON.stringify({
    staging_branch: "main",
    production_branch: "Production",
    promotion_source_branch: "main",
    promotion_target_branch: "Production",
  }),
});
assert.equal(sqlAuthorityQueried, false);
assert.equal(authority.staging_branch, "main");
assert.equal(authority.production_branch, "Production");
assert.equal(authority.source, "deployment-branch-policy.json");

assert.deepEqual(roleManifest.canonical_seed_lifecycle.seed_files, [
  "039_sprint43_data_integrity_and_missing_tables.sql",
  "1043_sprint69_dynamic_container_hvac_activity_seed.sql",
  "20260815_custom_gpt_mcp_catalog_levels.sql",
]);
assert.equal(roleManifest.authority_seed_lifecycle.contract, "mad4b.staging.authority-seed-manifest.v1");
assert.equal(roleManifest.authority_seed_lifecycle.target_role, "runtime");
assert.equal(roleManifest.authority_seed_lifecycle.execution_identity, "local_database_root");
assert.equal(roleManifest.authority_seed_lifecycle.runtime_write_authority_forbidden, true);
assert.equal(roleManifest.authority_seed_lifecycle.readback_required, true);
assert.deepEqual(roleManifest.authority_seed_lifecycle.seed_files, [sqlCacheAuthoritySeed]);
assert.deepEqual(roleManifest.authority_seed_lifecycle.readback, {
  table: "sql_cache_runtime_policies",
  policy_key: "sql_cache_policy_v2",
  exact_row_count: 1,
  minimum_revision: 1,
  required: false,
  required_blocked_tables: ["endpoints"],
});
assert.equal(roleManifest.validation.required_role_count, 3);
assert.equal(roleManifest.validation.missing_required_table_is_blocking, true);
assert.equal(roleManifest.validation.unexpected_governance_or_persistence_table_is_blocking, true);
assert.equal(roleManifest.validation.runtime_exclusion_violation_is_blocking, true);
assert.deepEqual(
  [
    ...roleManifest.validation.required_runtime_table_census,
    ...roleManifest.validation.required_runtime_support_tables,
  ].sort(),
  [...roleManifest.roles.runtime.required_tables].sort(),
);

assert.equal(autoDeployPolicy.authority_seed_lifecycle.contract, "mad4b.staging.authority-seed-manifest.v1");
assert.equal(autoDeployPolicy.authority_seed_lifecycle.execution_identity, "local_database_root");
assert.deepEqual(autoDeployPolicy.authority_seed_lifecycle.seed_files, [sqlCacheAuthoritySeed.file]);
assert.equal(autoDeployPolicy.authority_seed_lifecycle.runtime_write_authority_forbidden, true);
assert.ok(autoDeployPolicy.authority_seed_lifecycle.canonical_rows_required.includes("sql_cache_runtime_policies.sql_cache_policy_v2"));

assert.equal(oneClickPolicy.lifecycle.authority_seeds.contract, "mad4b.staging.authority-seed-manifest.v1");
assert.equal(oneClickPolicy.lifecycle.authority_seeds.execution_identity, "local_database_root");
assert.deepEqual(oneClickPolicy.lifecycle.authority_seeds.seed_files, [sqlCacheAuthoritySeed.file]);
assert.equal(oneClickPolicy.lifecycle.authority_seeds.runtime_write_authority_forbidden, true);
assert.ok(oneClickPolicy.lifecycle.authority_seeds.canonical_rows_required.includes("sql_cache_runtime_policies.sql_cache_policy_v2"));

assert.match(importer, /mad4b\.staging\.authority-seed-manifest\.v1/);
assert.match(importer, /execution_identity -eq "local_database_root"/);
assert.match(importer, /RUNTIME_DB_ROOT_PASSWORD/);
assert.match(importer, /authority_seed_status/);
assert.match(importer, /authority_seed_applied_files/);
assert.match(importer, /runtime_write_authority_expanded = \$false/);
assert.match(importer, /STAGING_AUTHORITY_SEEDS_COMPLETED/);
assert.match(importer, /sql_cache_runtime_policies WHERE policy_key = 'sql_cache_policy_v2'/);
assert.doesNotMatch(importer, /GRANT\s+(?:INSERT|UPDATE|DELETE)[^\r\n]*sql_cache_runtime_policies/i);

assert.match(repair, /REPAIR_LOCAL_STAGING_DATABASE_READINESS:\$\{ExpectedCommit\}:staging_local_windows_docker/);
assert.match(repair, /origin\/main moved away from ExpectedCommit/);
assert.match(repair, /Tracked working tree changes are forbidden/);
assert.match(repair, /DOCKER_HOST is forbidden/);
assert.match(repair, /DOCKER_CONTEXT is forbidden/);
assert.match(repair, /ALTER DATABASE \$databaseIdentifier CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci/);
assert.match(repair, /1023_sprint69_sql_cache_runtime_policy\.sql/);
assert.match(repair, /50424aac877e6c3924191599b295a460007b98d01fbe009d615e06457e24fdc7/);
assert.match(repair, /Reconcile-SqlCacheRuntimePolicy/);
assert.match(repair, /sql_cache_policy_v2 must exist exactly once after reconciliation/);
assert.match(repair, /Local Staging SQL cache policy must remain required=false/);
assert.match(repair, /immutable endpoints denylist/);
assert.match(repair, /root_identity_used_for_seed = \$inserted/);
assert.match(repair, /runtime_write_authority_required = \$false/);
assert.match(repair, /REVOKE ALL PRIVILEGES, GRANT OPTION/);
assert.match(repair, /required grant surface is missing before authority mutation/);
assert.match(repair, /missingOptionalSurfaces/);
assert.match(repair, /missing_optional_surface_is_blocking = \$false/);
assert.match(repair, /required_surface_preflight_completed = \$true/);
const requiredPreflightIndex = repair.indexOf("required grant surface is missing before authority mutation");
const revokeIndex = repair.indexOf("REVOKE ALL PRIVILEGES, GRANT OPTION");
assert.ok(requiredPreflightIndex >= 0);
assert.ok(revokeIndex > requiredPreflightIndex);
assert.match(repair, /TABLE_PRIVILEGES/);
assert.match(repair, /SCHEMA_PRIVILEGES/);
assert.match(repair, /COLUMN_PRIVILEGES/);
assert.match(repair, /APPLICABLE_ROLES/);
assert.match(repair, /staging-database-role-migration-manifest\.json/);
assert.match(repair, /function Assert-RoleSchemaCensus/);
assert.match(repair, /missing_required_table_is_blocking/);
assert.match(repair, /unexpected_governance_or_persistence_table_is_blocking/);
assert.match(repair, /runtime_exclusion_violation_is_blocking/);
assert.match(repair, /TABLE_TYPE = 'BASE TABLE'/);
assert.match(repair, /required schema census is incomplete/);
assert.match(repair, /schema census has unexpected base tables/);
assert.match(repair, /database_repair_status = "completed"/);
assert.match(repair, /runtime_restart_status = "pending"/);
assert.match(repair, /runtime_restart_status = "failed"/);
assert.match(repair, /status = "repaired_restart_pending"/);
assert.match(repair, /database repair remains completed and restart is resumable/);
assert.match(repair, /runtime schema census contains excluded role tables/);
assert.match(repair, /root_identity_used_for_census = \$true/);
assert.match(repair, /\$script:State\.schema_census = Assert-RoleSchemaCensus \$roleConfig/);
assert.match(repair, /Readiness-repaired Staging role\/schema census is not complete/);
const schemaCensusIndex = repair.indexOf('$script:State.status = "schema_census_validation"');
const restartAndCertifyIndex = repair.indexOf('$script:State.status = "restart_and_certify"');
assert.ok(schemaCensusIndex >= 0);
assert.ok(restartAndCertifyIndex > schemaCensusIndex);
assert.match(repair, /-BuildMode Smart -SkipSelfUpdate/);
assert.match(repair, /certification_status -eq "ready"/);
assert.match(repair, /destructive_reset = \$false/);
assert.match(repair, /schema_replay = \$false/);
assert.match(repair, /data_directory_moved = \$false/);
assert.doesNotMatch(repair, /Recover-StagingDatabases\.ps1/);
assert.doesNotMatch(repair, /Move-Item[^\r\n]*(?:runtime-db|governance-db|persistence-db|_recovery_backups)/i);
assert.doesNotMatch(repair, /DROP\s+(?:DATABASE|TABLE)/i);
assert.doesNotMatch(repair, /Clone-StagingDatabases\.ps1/);

assert.match(runtimePersistenceReadiness, /export async function runRuntimePersistenceOperationalReadinessCli/);
assert.match(runtimePersistenceReadiness, /await cliPool\.end\(\)/);
assert.match(runtimePersistenceReadiness, /runtime_persistence_cli_resource_cleanup_failed/);
assert.match(runtimePersistenceReadiness, /cli_resource_cleanup/);
assert.match(runtimePersistenceReadiness, /runRuntimePersistenceOperationalReadinessCli\(\)/);

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.staging-database-readiness-repair.v1",
  production_bootstrap_grants_unchanged: true,
  staging_mcp_catalog_select_only: true,
  staging_sql_cache_policy_select_only: true,
  staging_runtime_config_select_only: true,
  staging_operational_read_surfaces_select_only: true,
  staging_optional_surface_absence_non_blocking: true,
  required_surface_preflight_before_revoke: true,
  repaired_restart_state_resumable: true,
  staging_identity_lookup_select_only: true,
  staging_sql_cache_policy_seed_reconciled_by_root_only: true,
  staging_sql_cache_authority_seed_separated: true,
  staging_governance_authority_repository_only: true,
  staging_mariadb_collation_pinned: true,
  non_destructive_resume_repair: true,
  schema_census_required_before_restart_certification: true,
  runtime_persistence_cli_pool_cleanup_required: true,
  production_accessed: false,
  provider_accessed: false,
  secrets_included: false,
}, null, 2));
