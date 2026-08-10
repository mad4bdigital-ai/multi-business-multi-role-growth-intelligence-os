import assert from "node:assert/strict";

import {
  readProductionBranchHead,
  resolveVerifiedProductionDeploymentAuthority,
} from "./productionDeploymentAuthority.js";

const PRODUCTION_SHA = "a".repeat(40);
const STALE_SHA = "b".repeat(40);
const POLICY = {
  schema_version: "mad4b.environment-branch-authority.v1",
  staging_branch: "main",
  production_branch: "Production",
  promotion_source_branch: "main",
  promotion_target_branch: "Production",
  production_host: "auth.mad4b.com",
  production_provider: "hostinger",
};

function poolWithoutSqlAuthority() {
  return {
    async query() {
      return [[]];
    },
  };
}

function githubRefResponse(sha = PRODUCTION_SHA, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return status >= 200 && status < 300
        ? { object: { sha } }
        : { message: "not found" };
    },
  };
}

function deps({ headSha = PRODUCTION_SHA, onFetch = null } = {}) {
  return {
    pool: poolWithoutSqlAuthority(),
    readFile: async () => JSON.stringify(POLICY),
    repositoryIdentity: { owner: "mad4bdigital-ai", repo: "multi-business-multi-role-growth-intelligence-os" },
    token: "test-token-never-returned",
    fetchImpl: async (url, options) => {
      onFetch?.(url, options);
      return githubRefResponse(headSha);
    },
  };
}

{
  let request = null;
  const result = await resolveVerifiedProductionDeploymentAuthority(
    { expectedCommitSha: PRODUCTION_SHA },
    deps({ onFetch: (url, options) => { request = { url, options }; } })
  );
  assert.equal(result.production_branch, "Production");
  assert.equal(result.expected_commit_sha, PRODUCTION_SHA);
  assert.equal(result.production_branch_head_sha, PRODUCTION_SHA);
  assert.equal(result.same_cycle_branch_readback, true);
  assert.equal(result.expected_sha_matches_production_head, true);
  assert.match(request.url, /\/git\/ref\/heads\/Production$/);
  assert.equal(request.options.method, "GET");
  assert.equal(result.secrets_included, false);
  assert.equal(JSON.stringify(result).includes("test-token-never-returned"), false);
}

{
  let fetchCount = 0;
  await assert.rejects(
    resolveVerifiedProductionDeploymentAuthority(
      { branch: "main", expectedCommitSha: PRODUCTION_SHA },
      deps({ onFetch: () => { fetchCount += 1; } })
    ),
    (err) => err?.code === "production_deployment_branch_authority_mismatch"
  );
  assert.equal(fetchCount, 0, "unauthorized caller-selected branch must fail before GitHub readback");
}

{
  await assert.rejects(
    resolveVerifiedProductionDeploymentAuthority(
      { branch: "feature/not-production", expectedCommitSha: PRODUCTION_SHA },
      deps()
    ),
    (err) => err?.code === "production_deployment_branch_authority_mismatch"
  );
}

{
  await assert.rejects(
    resolveVerifiedProductionDeploymentAuthority(
      { expectedCommitSha: STALE_SHA },
      deps({ headSha: PRODUCTION_SHA })
    ),
    (err) => err?.code === "production_deployment_sha_stale"
      && err?.details?.expected_commit_sha === STALE_SHA
      && err?.details?.production_branch_head_sha === PRODUCTION_SHA
  );
}

{
  await assert.rejects(
    resolveVerifiedProductionDeploymentAuthority(
      { expectedCommitSha: "not-a-sha" },
      deps()
    ),
    (err) => err?.code === "production_deployment_expected_sha_required"
  );
}

{
  const result = await readProductionBranchHead(
    { branch: "Production" },
    deps({ headSha: PRODUCTION_SHA })
  );
  assert.equal(result.production_branch_head_sha, PRODUCTION_SHA);
  assert.equal(result.readback_performed, true);
  assert.equal(result.provider, "github");
  assert.equal(result.secrets_included, false);
}

console.log("Production deployment authority tests passed");
