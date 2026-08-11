import { resolveActivationBootstrapConfig } from "./activationBootstrapConfig.js";
import { getGitHubAppInstallationToken } from "./githubAppAuth.js";
import { resolveProductionDeploymentAuthority } from "./environmentBranchAuthority.js";

const SAFE_SHA = /^[0-9a-f]{40}$/;

function text(value = "", max = 255) {
  return String(value ?? "").trim().slice(0, max);
}

function fail(code, message, status = 409, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.details = { ...details, secrets_included: false };
  throw err;
}

function encodeRef(ref = "") {
  return String(ref || "").split("/").map(encodeURIComponent).join("/");
}

async function resolveRepositoryIdentity(deps = {}) {
  if (deps.repositoryIdentity?.owner && deps.repositoryIdentity?.repo) {
    return {
      owner: text(deps.repositoryIdentity.owner, 100),
      repo: text(deps.repositoryIdentity.repo, 100),
    };
  }
  const resolver = deps.resolveActivationBootstrapConfig || resolveActivationBootstrapConfig;
  const resolved = await resolver({});
  const owner = text(resolved?.config?.github_owner, 100);
  const repo = text(resolved?.config?.github_repo, 100);
  if (!owner || !repo) {
    fail(
      "production_deployment_repository_authority_missing",
      "Production deployment repository authority is unavailable.",
      503
    );
  }
  return { owner, repo };
}

async function fetchProductionBranchRef({ owner, repo, branch, token, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeRef(branch)}`,
    {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "mad4b-production-deployment-authority",
      },
    }
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    fail(
      response.status === 404
        ? "production_deployment_branch_not_found"
        : "production_deployment_branch_readback_failed",
      response.status === 404
        ? "The governed production branch could not be resolved."
        : "The governed production branch could not be read back from GitHub.",
      response.status >= 400 && response.status < 500 ? response.status : 502,
      { github_status: response.status, production_branch: branch }
    );
  }
  const headSha = text(payload?.object?.sha, 64).toLowerCase();
  if (!SAFE_SHA.test(headSha)) {
    fail(
      "production_deployment_branch_head_invalid",
      "The governed production branch returned an invalid head SHA.",
      502,
      { production_branch: branch }
    );
  }
  return headSha;
}

export async function readProductionBranchHead({ branch } = {}, deps = {}) {
  const productionBranch = text(branch, 255);
  if (!productionBranch) {
    fail(
      "production_deployment_branch_authority_missing",
      "Production deployment branch authority is unavailable.",
      503
    );
  }
  const { owner, repo } = await resolveRepositoryIdentity(deps);
  const tokenResolver = deps.getGitHubAppInstallationToken || getGitHubAppInstallationToken;
  const token = deps.token || await tokenResolver({});
  if (!text(token, 20000)) {
    fail(
      "production_deployment_repository_credential_unavailable",
      "A governed GitHub credential is required for same-cycle Production branch readback.",
      503
    );
  }
  const headSha = await fetchProductionBranchRef({
    owner,
    repo,
    branch: productionBranch,
    token,
    fetchImpl: deps.fetchImpl || fetch,
  });
  return {
    repository_owner: owner,
    repository_name: repo,
    production_branch: productionBranch,
    production_branch_head_sha: headSha,
    provider: "github",
    readback_performed: true,
    secrets_included: false,
  };
}

export async function resolveVerifiedProductionDeploymentAuthority(input = {}, deps = {}) {
  const authority = await resolveProductionDeploymentAuthority(input, deps);
  const branchReadback = await readProductionBranchHead({ branch: authority.production_branch }, deps);
  if (branchReadback.production_branch_head_sha !== authority.expected_commit_sha) {
    fail(
      "production_deployment_sha_stale",
      "expected_commit_sha does not match the current governed Production branch head.",
      409,
      {
        production_branch: authority.production_branch,
        expected_commit_sha: authority.expected_commit_sha,
        production_branch_head_sha: branchReadback.production_branch_head_sha,
      }
    );
  }
  return {
    ...authority,
    repository_owner: branchReadback.repository_owner,
    repository_name: branchReadback.repository_name,
    production_branch_head_sha: branchReadback.production_branch_head_sha,
    same_cycle_branch_readback: true,
    expected_sha_matches_production_head: true,
    secrets_included: false,
  };
}
