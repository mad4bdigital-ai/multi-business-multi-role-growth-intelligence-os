import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ENVIRONMENT_BRANCH_AUTHORITY_CONFIG_KEY,
  assertExactProductionCommitSha,
  assertProductionDeploymentBranch,
  loadEnvironmentBranchAuthority,
  resolveProductionDeploymentAuthority,
  validateEnvironmentBranchAuthority,
} from "./environmentBranchAuthority.js";

const validSqlConfig = {
  schema_version: "mad4b.environment-branch-authority.v1",
  staging_branch: "main",
  production_branch: "Production",
  promotion_source_branch: "main",
  promotion_target_branch: "Production",
  production_host: "auth.mad4b.com",
  production_provider: "hostinger",
};

function poolWith(rows) {
  return {
    async query(sql, params) {
      assert.match(sql, /platform_runtime_config/);
      assert.deepEqual(params, [ENVIRONMENT_BRANCH_AUTHORITY_CONFIG_KEY]);
      return [rows];
    },
  };
}

{
  const authority = await loadEnvironmentBranchAuthority({
    pool: poolWith([{ config_json: JSON.stringify(validSqlConfig), status: "active", updated_at: "2026-08-10T00:00:00.000Z" }]),
    readFile: async () => { throw new Error("fallback must not be read when SQL authority exists"); },
  });
  assert.equal(authority.source, "platform_runtime_config");
  assert.equal(authority.staging_branch, "main");
  assert.equal(authority.production_branch, "Production");
  assert.equal(authority.promotion_source_branch, "main");
  assert.equal(authority.promotion_target_branch, "Production");
}

{
  const filePolicy = {
    schema_version: "mad4b.deployment-branch-policy.v1",
    source_of_change: { branch: "main" },
    production: { hostname: "auth.mad4b.com", source_branch: "Production", required_environment_branch: "Production", deployment_provider: "hostinger" },
    promotion: { source_branch: "main", target_branch: "Production" },
  };
  const authority = await loadEnvironmentBranchAuthority({
    pool: poolWith([]),
    readFile: async () => JSON.stringify(filePolicy),
  });
  assert.equal(authority.source, "deployment-branch-policy.json");
  assert.equal(authority.production_branch, "Production");
}

{
  assert.throws(
    () => validateEnvironmentBranchAuthority({ staging_branch: "main", production_branch: "main", promotion_source_branch: "main", promotion_target_branch: "main" }, { source: "test" }),
    (err) => err?.code === "environment_branch_authority_invalid"
  );
}

{
  await assert.rejects(
    () => loadEnvironmentBranchAuthority({
      pool: poolWith([{ config_json: "{broken", status: "active", updated_at: null }]),
      readFile: async () => JSON.stringify(validSqlConfig),
    }),
    (err) => err?.code === "environment_branch_authority_invalid_json"
  );
}

{
  assert.equal(assertProductionDeploymentBranch(null, { production_branch: "Production" }), "Production");
  assert.equal(assertProductionDeploymentBranch("Production", { production_branch: "Production" }), "Production");
  assert.throws(
    () => assertProductionDeploymentBranch("main", { production_branch: "Production" }),
    (err) => err?.code === "production_deployment_branch_authority_mismatch" && err?.details?.requested_branch === "main"
  );
}

{
  const sha = "a".repeat(40);
  assert.equal(assertExactProductionCommitSha(sha.toUpperCase()), sha);
  assert.throws(
    () => assertExactProductionCommitSha("abc"),
    (err) => err?.code === "production_deployment_expected_sha_required"
  );

  const resolved = await resolveProductionDeploymentAuthority(
    { branch: "Production", expectedCommitSha: sha },
    { pool: poolWith([{ config_json: validSqlConfig, status: "active", updated_at: null }]) }
  );
  assert.equal(resolved.production_branch, "Production");
  assert.equal(resolved.expected_commit_sha, sha);
  assert.equal(resolved.secrets_included, false);
}

{
  const migration = readFileSync("migrations/20260810_environment_branch_authority_v1.sql", "utf8");
  assert(migration.includes("'staging_branch', 'main'"), "migration must preserve main as staging/source-of-change");
  assert(migration.includes("'production_branch', 'Production'"), "migration must register Production as production authority");
  assert(migration.includes("'allowed_branches',JSON_ARRAY('Production')"), "execution policy must allow Production only");
  assert(migration.includes("JSON_ARRAY('Production'),'default','Production'"), "command schema must expose Production only");
  assert(migration.includes('"enum":["Production"],"default":"Production"'), "admin tool schema must expose Production only");
  assert(migration.includes("'$.deployment_allowed', FALSE"), "routine SSH deployment must remain disabled on the production target");
  assert(migration.includes("'$.ssh_normal_updates_allowed', FALSE"), "normal SSH updates must remain disabled on the production target");
  assert(migration.includes("'$.ssh_break_glass_only', TRUE"), "SSH must remain break-glass-only on the production target");
  assert(!migration.includes("'allowed_branches',JSON_ARRAY('main','Production')"), "new authority migration must not retain main as production deploy authority");
}

console.log("Environment branch authority tests passed");
