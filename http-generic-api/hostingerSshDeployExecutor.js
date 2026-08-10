import {
  executeHostingerSshDeployRelease as executeLegacyHostingerSshDeployRelease,
} from "./hostingerSshDeployExecutorLegacy.js";
import { resolveProductionDeploymentAuthority } from "./environmentBranchAuthority.js";

export * from "./hostingerSshDeployExecutorLegacy.js";

function requestedBranch(input = {}) {
  return String(input.branch ?? input.production_branch ?? input.productionBranch ?? "").trim() || null;
}

function requestedCommitSha(input = {}) {
  return String(
    input.expected_commit_sha ??
    input.expectedCommitSha ??
    input.commit_sha ??
    input.commitSha ??
    ""
  ).trim() || null;
}

function publicAuthority(authority = {}) {
  return {
    source: authority.source || null,
    config_key: authority.config_key || null,
    schema_version: authority.schema_version || null,
    staging_branch: authority.staging_branch || null,
    production_branch: authority.production_branch || null,
    promotion_source_branch: authority.promotion_source_branch || null,
    promotion_target_branch: authority.promotion_target_branch || null,
    production_host: authority.production_host || null,
    production_provider: authority.production_provider || null,
    updated_at: authority.updated_at || null,
    secrets_included: false,
  };
}

export async function executeHostingerSshDeployRelease(input = {}, deps = {}) {
  const authority = await resolveProductionDeploymentAuthority(
    {
      branch: requestedBranch(input),
      expectedCommitSha: requestedCommitSha(input),
    },
    { pool: deps.pool }
  );

  const result = await executeLegacyHostingerSshDeployRelease(
    {
      ...input,
      branch: authority.production_branch,
      expected_commit_sha: authority.expected_commit_sha,
    },
    deps
  );

  return {
    ...result,
    branch: authority.production_branch,
    expected_commit_sha: authority.expected_commit_sha,
    environment_authority: publicAuthority(authority),
    secrets_included: false,
  };
}
