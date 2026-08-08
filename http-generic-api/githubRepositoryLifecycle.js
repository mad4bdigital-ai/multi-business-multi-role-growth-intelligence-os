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

async function revalidateRepositoryWriteAuthority(options = {}, requestUrl = "", phase = "provider_write") {
  const target = githubTargetFromUrl(requestUrl);
  const result = await resolveCapabilityExecutionEnvelope({
    pool: options.pool || null,
    envelopeId: envelopeId(options),
    source: {
      owner: target.owner || options.owner || "",
      repo: target.repo || options.repo || "",
      branch: options.branch || "",
      expected_branch_sha: options.expected_branch_sha || options.expectedBranchSha || "",
      expected_head_sha: options.expected_head_sha || options.expectedHeadSha || "",
      expected_commit_sha: options.expected_commit_sha || options.expectedCommitSha || "",
      expected_base_sha: options.expected_base_sha || options.expectedBaseSha || "",
    },
    acceptedAppKeys: ["github"],
    acceptedCapabilityKeys: ["repo_patch_apply"],
    acceptedIntents: REPOSITORY_PATCH_MUTATION_INTENTS,
    allowReferenced: true,
  });
  if (!result?.ok) {
    throw capabilityEnvelopeError(
      { ...result, write_boundary_phase: phase },
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
  return async (url, init = {}) => {
    const method = String(init?.method || "GET").toUpperCase();
    if (PROVIDER_MUTATION_METHODS.has(method)) {
      const pathname = (() => {
        try { return new URL(String(url)).pathname; } catch { return ""; }
      })();
      const refMutation = /\/git\/refs(?:\/|$)/.test(pathname);
      if (!firstProviderWriteChecked || refMutation) {
        await revalidateRepositoryWriteAuthority(
          options,
          url,
          refMutation ? "pre_ref_update" : "pre_first_provider_write",
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
