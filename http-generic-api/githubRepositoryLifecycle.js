import {
  applyGithubExistingBlobChangeSet as applyGithubExistingBlobChangeSetCore,
  applyGithubRepositoryChangeSet as applyGithubRepositoryChangeSetCore,
} from "./githubRepositoryLifecycleCore.js";
import {
  capabilityEnvelopeError,
  resolveCapabilityExecutionEnvelope,
} from "./capabilityResolutionEnvelopeGuard.js";

export {
  DEFAULT_DISPOSABLE_BRANCH_PREFIXES,
  closeGithubPullRequest,
  deleteGithubBranchRef,
  finalizeGithubPullRequest,
  getGithubPullRequestCiGate,
  githubBranchDeleteConfirmation,
  githubLifecycleRequest,
  githubPullRequestFinalizeConfirmation,
  resolveGithubLifecycleTarget,
} from "./githubRepositoryLifecycleCore.js";

export const REPOSITORY_PATCH_MUTATION_INTENTS = Object.freeze([
  "repo_patch_apply",
  "repo_mutation",
  "github_repo_patch",
  "write",
  "create",
  "delete",
]);

const PROVIDER_MUTATION_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

function envelopeId(options = {}) {
  return String(options.capability_envelope_id || options.capabilityEnvelopeId || "").trim();
}

function githubTargetFromUrl(value = "") {
  try {
    const url = new URL(String(value));
    const match = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\//);
    return match
      ? { owner: decodeURIComponent(match[1]), repo: decodeURIComponent(match[2]) }
      : { owner: "", repo: "" };
  } catch {
    return { owner: "", repo: "" };
  }
}

function githubPathname(value = "") {
  try {
    return new URL(String(value)).pathname;
  } catch {
    return "";
  }
}

function resolvedCommitParentFromPathname(pathname = "") {
  const match = String(pathname).match(/\/git\/commits\/([0-9a-f]{40})$/i);
  return match ? match[1].toLowerCase() : "";
}

async function revalidateRepositoryWriteAuthority(options = {}, requestUrl = "", phase = "provider_write", resolvedCommitParentSha = "") {
  const target = githubTargetFromUrl(requestUrl);
  const actualCommitParentSha = String(resolvedCommitParentSha || "").trim().toLowerCase();
  const result = await resolveCapabilityExecutionEnvelope({
    pool: options.pool || null,
    envelopeId: envelopeId(options),
    source: {
      owner: target.owner || options.owner || "",
      repo: target.repo || options.repo || "",
      branch: options.branch || "",
      expected_branch_sha: actualCommitParentSha ? "" : (options.expected_branch_sha || options.expectedBranchSha || ""),
      expected_head_sha: actualCommitParentSha ? "" : (options.expected_head_sha || options.expectedHeadSha || ""),
      expected_commit_sha: actualCommitParentSha || options.expected_commit_sha || options.expectedCommitSha || "",
      expected_base_sha: actualCommitParentSha ? "" : (options.expected_base_sha || options.expectedBaseSha || ""),
    },
    acceptedAppKeys: ["github"],
    acceptedCapabilityKeys: ["repo_patch_apply"],
    acceptedIntents: REPOSITORY_PATCH_MUTATION_INTENTS,
    allowReferenced: true,
  });
  if (!result?.ok) {
    throw capabilityEnvelopeError(
      { ...result, write_boundary_phase: phase, resolved_commit_parent_sha: actualCommitParentSha || null },
      `Repository mutation authority is no longer valid at the ${phase} boundary.`,
    );
  }
  return result;
}

export function createRepositoryAuthorityCheckedFetch(options = {}) {
  const upstreamFetch = typeof options.fetchImpl === "function" ? options.fetchImpl : globalThis.fetch;
  if (typeof upstreamFetch !== "function") {
    throw new TypeError("A fetch implementation is required for repository lifecycle requests.");
  }
  let firstProviderWriteChecked = false;
  let resolvedCommitParentSha = "";
  return async (url, init = {}) => {
    const method = String(init?.method || "GET").toUpperCase();
    const pathname = githubPathname(url);
    if (!firstProviderWriteChecked && method === "GET") {
      const commitParentSha = resolvedCommitParentFromPathname(pathname);
      if (commitParentSha) resolvedCommitParentSha = commitParentSha;
    }
    if (PROVIDER_MUTATION_METHODS.has(method)) {
      const refMutation = /\/git\/refs(?:\/|$)/.test(pathname);
      if (!firstProviderWriteChecked || refMutation) {
        await revalidateRepositoryWriteAuthority(
          options,
          url,
          refMutation ? "pre_ref_update" : "pre_first_provider_write",
          resolvedCommitParentSha,
        );
        firstProviderWriteChecked = true;
      }
    }
    return upstreamFetch(url, init);
  };
}

function withRepositoryAuthorityWriteBoundary(options = {}) {
  return {
    ...options,
    fetchImpl: createRepositoryAuthorityCheckedFetch(options),
  };
}

export async function applyGithubRepositoryChangeSet(options = {}) {
  return applyGithubRepositoryChangeSetCore(withRepositoryAuthorityWriteBoundary(options));
}

export async function applyGithubExistingBlobChangeSet(options = {}) {
  return applyGithubExistingBlobChangeSetCore(withRepositoryAuthorityWriteBoundary(options));
}
