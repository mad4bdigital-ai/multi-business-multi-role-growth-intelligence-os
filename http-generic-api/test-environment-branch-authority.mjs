import assert from "node:assert/strict";

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

console.log("Environment branch authority tests passed");
