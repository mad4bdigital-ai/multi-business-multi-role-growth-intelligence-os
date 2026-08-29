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

const grantPlan = read("http-generic-api/scripts/staging-role-grant-plan.mjs");
const governanceReadiness = read("http-generic-api/governanceDbPrivilegeReadinessService.js");
const compose = read("http-generic-api/docker-compose.staging.yml");
const repair = read("autopilot-portable-staging/Repair-StagingDatabaseReadiness.ps1");

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

assert.equal(STAGING_ROLE_GRANT_POLICIES.runtime.required_tables.includes("admin_platform_endpoint_tools"), true);
assert.equal(STAGING_ROLE_GRANT_POLICIES.runtime.required_tables.includes("tenant_platform_endpoint_tools"), true);
assert.deepEqual(STAGING_ROLE_GRANT_POLICIES.runtime.required_operations_by_table.admin_platform_endpoint_tools, ["SELECT"]);
assert.deepEqual(STAGING_ROLE_GRANT_POLICIES.runtime.required_operations_by_table.tenant_platform_endpoint_tools, ["SELECT"]);
assert.deepEqual(STAGING_ROLE_GRANT_POLICIES.governance, BOOTSTRAP_ROLE_GRANT_POLICIES.governance);
assert.deepEqual(STAGING_ROLE_GRANT_POLICIES.runtime_persistence, BOOTSTRAP_ROLE_GRANT_POLICIES.runtime_persistence);

assert.match(grantPlan, /STAGING_ROLE_GRANT_POLICIES/);
assert.doesNotMatch(grantPlan, /const spec = BOOTSTRAP_ROLE_GRANT_POLICIES\[role\]/);
assert.match(grantPlan, /broad_schema_grants_allowed: false/);
assert.match(grantPlan, /grant_option_allowed: false/);

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

assert.match(repair, /REPAIR_LOCAL_STAGING_DATABASE_READINESS:\$\{ExpectedCommit\}:staging_local_windows_docker/);
assert.match(repair, /origin\/main moved away from ExpectedCommit/);
assert.match(repair, /Tracked working tree changes are forbidden/);
assert.match(repair, /DOCKER_HOST is forbidden/);
assert.match(repair, /DOCKER_CONTEXT is forbidden/);
assert.match(repair, /ALTER DATABASE \$databaseIdentifier CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci/);
assert.match(repair, /REVOKE ALL PRIVILEGES, GRANT OPTION/);
assert.match(repair, /TABLE_PRIVILEGES/);
assert.match(repair, /SCHEMA_PRIVILEGES/);
assert.match(repair, /COLUMN_PRIVILEGES/);
assert.match(repair, /APPLICABLE_ROLES/);
assert.match(repair, /-BuildMode Smart -SkipSelfUpdate/);
assert.match(repair, /certification_status -eq "ready"/);
assert.match(repair, /destructive_reset = \$false/);
assert.match(repair, /schema_replay = \$false/);
assert.match(repair, /data_directory_moved = \$false/);
assert.doesNotMatch(repair, /Recover-StagingDatabases\.ps1/);
assert.doesNotMatch(repair, /Move-Item[^\r\n]*(?:runtime-db|governance-db|persistence-db|_recovery_backups)/i);
assert.doesNotMatch(repair, /DROP\s+(?:DATABASE|TABLE)/i);
assert.doesNotMatch(repair, /Clone-StagingDatabases\.ps1/);

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.staging-database-readiness-repair.v1",
  production_bootstrap_grants_unchanged: true,
  staging_mcp_catalog_select_only: true,
  staging_governance_authority_repository_only: true,
  staging_mariadb_collation_pinned: true,
  non_destructive_resume_repair: true,
  production_accessed: false,
  provider_accessed: false,
  secrets_included: false,
}, null, 2));
