import { GITHUB_API_BASE_URL, GITHUB_TOKEN, GITHUB_BLOB_CHUNK_MAX_LENGTH } from "./config.js";

// ── File policy ────────────────────────────────────────────────────────────
const DEFAULT_FILE_DENYLIST = [
  ".env",
  ".env.local",
  ".env.production",
  ".env.staging",
  ".env.test",
  ".github/workflows/",
  "node_modules/",
  "secrets/",
  ".git/"
];

function isDeniedPath(filePath, extraDenylist = []) {
  const norm = String(filePath || "").replace(/\\/g, "/");
  const patterns = [...DEFAULT_FILE_DENYLIST, ...extraDenylist];
  return patterns.some(pattern => {
    if (pattern.endsWith("/")) {
      return norm.startsWith(pattern) || norm.includes("/" + pattern);
    }
    const base = norm.split("/").pop();
    return base === pattern || norm === pattern;
  });
}

function newRequestId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function deriveCheckRunsSummary(checkRuns) {
  if (!checkRuns.length) return "no_checks";
  const failing = checkRuns.filter(
    c =>
      c.status === "completed" &&
      !["success", "neutral", "skipped"].includes(c.conclusion)
  );
  const pending = checkRuns.filter(c => c.status !== "completed");
  if (failing.length > 0) return "failing";
  if (pending.length > 0) return "pending";
  return "passing";
}

function requireGithubToken() {
  if (!GITHUB_TOKEN) {
    const err = new Error("Missing required environment variable: GITHUB_TOKEN");
    err.code = "missing_github_token";
    err.status = 500;
    throw err;
  }
  return GITHUB_TOKEN;
}

function assertGithubParam(value, fieldName) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    const err = new Error(`${fieldName} is required.`);
    err.code = "invalid_request";
    err.status = 400;
    throw err;
  }
  return normalized;
}

function parseGithubChunkInteger(value, fieldName, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    const err = new Error(
      `${fieldName} must be an integer between ${min} and ${max}.`
    );
    err.code = "invalid_request";
    err.status = 400;
    throw err;
  }
  return parsed;
}

function decodeGithubBase64ToBuffer(value) {
  return Buffer.from(String(value || "").replace(/\s+/g, ""), "base64");
}

function encodeStringToBase64(value) {
  return Buffer.from(String(value ?? ""), "utf8").toString("base64");
}

function encodeGitHubContentPath(value) {
  return String(value || "")
    .split("/")
    .filter(Boolean)
    .map(segment => encodeURIComponent(segment))
    .join("/");
}

async function proxyGitHubJson({
  method = "GET",
  pathname,
  searchParams,
  body,
  accept = "application/vnd.github+json"
}) {
  const token = requireGithubToken();
  const url = new URL(`${GITHUB_API_BASE_URL}${pathname}`);

  for (const [key, value] of Object.entries(searchParams || {})) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    method,
    headers: {
      Accept: accept,
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const raw = await response.text();
  let payload = null;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = { message: raw };
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    payload
  };
}

function githubErrorResponse(res, upstream, codeBase, fallbackMessage) {
  return res.status(upstream.status || 502).json({
    ok: false,
    error: {
      code:
        upstream.status === 404
          ? `${codeBase}_not_found`
          : `${codeBase}_failed`,
      message:
        upstream.payload?.message ||
        fallbackMessage ||
        `GitHub request failed with status ${upstream.status}.`
    }
  });
}

export async function fetchGitHubBlobPayload({ owner, repo, fileSha }) {
  const upstream = await proxyGitHubJson({
    method: "GET",
    pathname:
      `/repos/${encodeURIComponent(owner)}` +
      `/${encodeURIComponent(repo)}/git/blobs/${encodeURIComponent(fileSha)}`
  });

  if (!upstream.ok) {
    const err = new Error(
      upstream.payload?.message ||
      `GitHub blob fetch failed with status ${upstream.status}.`
    );
    err.code =
      upstream.status === 404 ? "github_blob_not_found" : "github_blob_fetch_failed";
    err.status = upstream.status === 404 ? 404 : 502;
    throw err;
  }

  if (String(upstream.payload?.encoding || "").trim().toLowerCase() !== "base64") {
    const err = new Error("GitHub blob response encoding is not base64.");
    err.code = "github_blob_encoding_unsupported";
    err.status = 502;
    throw err;
  }

  return upstream.payload;
}

export async function fetchGitHubContentFile({ owner, repo, path, branch }) {
  const normalizedOwner = assertGithubParam(owner, "owner");
  const normalizedRepo = assertGithubParam(repo, "repo");
  const normalizedPath = assertGithubParam(path, "path");

  const upstream = await proxyGitHubJson({
    method: "GET",
    pathname:
      `/repos/${encodeURIComponent(normalizedOwner)}` +
      `/${encodeURIComponent(normalizedRepo)}` +
      `/contents/${encodeGitHubContentPath(normalizedPath)}`,
    searchParams: {
      ref: branch
    }
  });

  if (!upstream.ok) {
    if (upstream.status === 404) return null;
    const err = new Error(
      upstream.payload?.message ||
      `GitHub content fetch failed with status ${upstream.status}.`
    );
    err.code = "github_content_fetch_failed";
    err.status = upstream.status || 502;
    throw err;
  }

  if (Array.isArray(upstream.payload) || upstream.payload?.type !== "file") {
    const err = new Error(`GitHub content path is not a file: ${normalizedPath}`);
    err.code = "github_content_not_file";
    err.status = 409;
    throw err;
  }

  return upstream.payload;
}

export async function githubPutContents({ input = {} }) {
  const owner = assertGithubParam(input.owner, "owner");
  const repo = assertGithubParam(input.repo, "repo");
  const path = assertGithubParam(input.path, "path");
  const message = assertGithubParam(input.message, "message");
  const branch = String(input.branch || "").trim() || undefined;
  const existingSha = String(input.sha || "").trim();
  const content =
    input.content_base64 !== undefined
      ? String(input.content_base64 || "").replace(/\s+/g, "")
      : encodeStringToBase64(input.content);

  if (!content) {
    const err = new Error("content or content_base64 is required.");
    err.code = "invalid_request";
    err.status = 400;
    throw err;
  }

  const upstream = await proxyGitHubJson({
    method: "PUT",
    pathname:
      `/repos/${encodeURIComponent(owner)}` +
      `/${encodeURIComponent(repo)}` +
      `/contents/${encodeGitHubContentPath(path)}`,
    body: {
      message,
      content,
      ...(branch ? { branch } : {}),
      ...(existingSha ? { sha: existingSha } : {}),
      ...(input.committer ? { committer: input.committer } : {}),
      ...(input.author ? { author: input.author } : {})
    }
  });

  if (!upstream.ok) {
    const err = new Error(
      upstream.payload?.message ||
      `GitHub content write failed with status ${upstream.status}.`
    );
    err.code = "github_put_contents_failed";
    err.status = upstream.status || 502;
    err.details = upstream.payload || null;
    throw err;
  }

  return {
    ok: true,
    statusCode: upstream.status,
    owner,
    repo,
    branch: branch || "",
    path,
    content_sha: upstream.payload?.content?.sha || "",
    commit_sha: upstream.payload?.commit?.sha || "",
    commit_html_url: upstream.payload?.commit?.html_url || "",
    content_html_url: upstream.payload?.content?.html_url || ""
  };
}

export async function githubApplyFileUpdates({ input = {} }) {
  const owner = assertGithubParam(input.owner, "owner");
  const repo = assertGithubParam(input.repo, "repo");
  const branch = assertGithubParam(input.branch || "main", "branch");
  const message = assertGithubParam(input.message, "message");
  const files = Array.isArray(input.files) ? input.files : [];

  if (!files.length) {
    const err = new Error("files must be a non-empty array.");
    err.code = "invalid_request";
    err.status = 400;
    throw err;
  }

  const refUpstream = await proxyGitHubJson({
    method: "GET",
    pathname:
      `/repos/${encodeURIComponent(owner)}` +
      `/${encodeURIComponent(repo)}` +
      `/git/ref/heads/${encodeURIComponent(branch)}`
  });

  if (!refUpstream.ok) {
    const err = new Error(
      refUpstream.payload?.message ||
      `GitHub branch ref fetch failed with status ${refUpstream.status}.`
    );
    err.code = "github_ref_fetch_failed";
    err.status = refUpstream.status || 502;
    err.details = refUpstream.payload || null;
    throw err;
  }

  const baseCommitSha = String(refUpstream.payload?.object?.sha || "").trim();
  if (!baseCommitSha) {
    const err = new Error(`GitHub branch ref did not include a commit SHA: ${branch}`);
    err.code = "github_ref_missing_commit_sha";
    err.status = 502;
    throw err;
  }

  const commitUpstream = await proxyGitHubJson({
    method: "GET",
    pathname:
      `/repos/${encodeURIComponent(owner)}` +
      `/${encodeURIComponent(repo)}` +
      `/git/commits/${encodeURIComponent(baseCommitSha)}`
  });

  if (!commitUpstream.ok) {
    const err = new Error(
      commitUpstream.payload?.message ||
      `GitHub base commit fetch failed with status ${commitUpstream.status}.`
    );
    err.code = "github_base_commit_fetch_failed";
    err.status = commitUpstream.status || 502;
    err.details = commitUpstream.payload || null;
    throw err;
  }

  const baseTreeSha = String(commitUpstream.payload?.tree?.sha || "").trim();
  if (!baseTreeSha) {
    const err = new Error(`GitHub base commit did not include a tree SHA: ${baseCommitSha}`);
    err.code = "github_base_tree_missing";
    err.status = 502;
    throw err;
  }

  const tree = files.map(file => {
    const path = assertGithubParam(file.path, "files[].path");
    const content =
      file.content_base64 !== undefined
        ? decodeGithubBase64ToBuffer(file.content_base64).toString("utf8")
        : String(file.content ?? "");

    return {
      path,
      mode: "100644",
      type: "blob",
      content
    };
  });

  const treeUpstream = await proxyGitHubJson({
    method: "POST",
    pathname:
      `/repos/${encodeURIComponent(owner)}` +
      `/${encodeURIComponent(repo)}` +
      `/git/trees`,
    body: {
      base_tree: baseTreeSha,
      tree
    }
  });

  if (!treeUpstream.ok) {
    const err = new Error(
      treeUpstream.payload?.message ||
      `GitHub tree creation failed with status ${treeUpstream.status}.`
    );
    err.code = "github_tree_create_failed";
    err.status = treeUpstream.status || 502;
    err.details = treeUpstream.payload || null;
    throw err;
  }

  const newTreeSha = String(treeUpstream.payload?.sha || "").trim();
  if (!newTreeSha) {
    const err = new Error("GitHub tree creation did not return a tree SHA.");
    err.code = "github_tree_sha_missing";
    err.status = 502;
    throw err;
  }

  const commitBody = {
    message,
    tree: newTreeSha,
    parents: [baseCommitSha],
    ...(input.author ? { author: input.author } : {}),
    ...(input.committer ? { committer: input.committer } : {})
  };

  const newCommitUpstream = await proxyGitHubJson({
    method: "POST",
    pathname:
      `/repos/${encodeURIComponent(owner)}` +
      `/${encodeURIComponent(repo)}` +
      `/git/commits`,
    body: commitBody
  });

  if (!newCommitUpstream.ok) {
    const err = new Error(
      newCommitUpstream.payload?.message ||
      `GitHub commit creation failed with status ${newCommitUpstream.status}.`
    );
    err.code = "github_commit_create_failed";
    err.status = newCommitUpstream.status || 502;
    err.details = newCommitUpstream.payload || null;
    throw err;
  }

  const newCommitSha = String(newCommitUpstream.payload?.sha || "").trim();
  if (!newCommitSha) {
    const err = new Error("GitHub commit creation did not return a commit SHA.");
    err.code = "github_commit_sha_missing";
    err.status = 502;
    throw err;
  }

  const updateRefUpstream = await proxyGitHubJson({
    method: "PATCH",
    pathname:
      `/repos/${encodeURIComponent(owner)}` +
      `/${encodeURIComponent(repo)}` +
      `/git/refs/heads/${encodeURIComponent(branch)}`,
    body: {
      sha: newCommitSha,
      force: input.force === true
    }
  });

  if (!updateRefUpstream.ok) {
    const err = new Error(
      updateRefUpstream.payload?.message ||
      `GitHub branch ref update failed with status ${updateRefUpstream.status}.`
    );
    err.code = "github_ref_update_failed";
    err.status = updateRefUpstream.status || 502;
    err.details = updateRefUpstream.payload || null;
    throw err;
  }

  return {
    ok: true,
    owner,
    repo,
    branch,
    files_changed: tree.length,
    commit_mode: "single_commit_tree",
    base_commit_sha: baseCommitSha,
    base_tree_sha: baseTreeSha,
    tree_sha: newTreeSha,
    final_commit_sha: newCommitSha,
    commit_html_url: newCommitUpstream.payload?.html_url || "",
    ref: updateRefUpstream.payload?.ref || `refs/heads/${branch}`,
    results: tree.map(item => ({
      path: item.path,
      operation: "upsert"
    }))
  };
}

export async function fetchGitHubBranchRef({ owner, repo, branch }) {
  const normalizedOwner = assertGithubParam(owner, "owner");
  const normalizedRepo = assertGithubParam(repo, "repo");
  const normalizedBranch = assertGithubParam(branch, "branch");

  const upstream = await proxyGitHubJson({
    method: "GET",
    pathname:
      `/repos/${encodeURIComponent(normalizedOwner)}` +
      `/${encodeURIComponent(normalizedRepo)}` +
      `/git/ref/heads/${encodeURIComponent(normalizedBranch)}`
  });

  if (!upstream.ok) {
    if (upstream.status === 404) return null;
    const err = new Error(
      upstream.payload?.message ||
      `GitHub branch ref fetch failed with status ${upstream.status}.`
    );
    err.code = "github_ref_fetch_failed";
    err.status = upstream.status || 502;
    err.details = upstream.payload || null;
    throw err;
  }

  return upstream.payload;
}

export async function githubCreateBranchReference({ input = {} }) {
  const owner = assertGithubParam(input.owner, "owner");
  const repo = assertGithubParam(input.repo, "repo");
  const branch = assertGithubParam(input.branch, "branch");
  const baseBranch = assertGithubParam(input.base_branch || input.baseBranch || "main", "base_branch");

  const existing = await fetchGitHubBranchRef({ owner, repo, branch });
  if (existing) {
    return {
      ok: true,
      created: false,
      owner,
      repo,
      branch,
      ref: existing.ref || `refs/heads/${branch}`,
      sha: existing.object?.sha || ""
    };
  }

  const baseRef = await fetchGitHubBranchRef({ owner, repo, branch: baseBranch });
  const baseSha = String(baseRef?.object?.sha || "").trim();
  if (!baseSha) {
    const err = new Error(`Base branch did not resolve to a commit SHA: ${baseBranch}`);
    err.code = "github_base_branch_missing_sha";
    err.status = 502;
    throw err;
  }

  const upstream = await proxyGitHubJson({
    method: "POST",
    pathname:
      `/repos/${encodeURIComponent(owner)}` +
      `/${encodeURIComponent(repo)}` +
      `/git/refs`,
    body: {
      ref: `refs/heads/${branch}`,
      sha: baseSha
    }
  });

  if (!upstream.ok) {
    const err = new Error(
      upstream.payload?.message ||
      `GitHub branch creation failed with status ${upstream.status}.`
    );
    err.code = "github_branch_create_failed";
    err.status = upstream.status || 502;
    err.details = upstream.payload || null;
    throw err;
  }

  return {
    ok: true,
    created: true,
    owner,
    repo,
    branch,
    base_branch: baseBranch,
    ref: upstream.payload?.ref || `refs/heads/${branch}`,
    sha: upstream.payload?.object?.sha || baseSha
  };
}

export async function githubCreatePullRequest({ input = {} }) {
  const owner = assertGithubParam(input.owner, "owner");
  const repo = assertGithubParam(input.repo, "repo");
  const head = assertGithubParam(input.head, "head");
  const base = assertGithubParam(input.base || input.base_branch || "main", "base");
  const title = assertGithubParam(input.title, "title");

  const upstream = await proxyGitHubJson({
    method: "POST",
    pathname:
      `/repos/${encodeURIComponent(owner)}` +
      `/${encodeURIComponent(repo)}` +
      `/pulls`,
    body: {
      title,
      head,
      base,
      body: String(input.body || ""),
      draft: input.draft !== false
    }
  });

  if (!upstream.ok) {
    const err = new Error(
      upstream.payload?.message ||
      `GitHub pull request creation failed with status ${upstream.status}.`
    );
    err.code = "github_pull_request_create_failed";
    err.status = upstream.status || 502;
    err.details = upstream.payload || null;
    throw err;
  }

  return {
    ok: true,
    number: upstream.payload?.number || null,
    html_url: upstream.payload?.html_url || "",
    head: upstream.payload?.head?.ref || head,
    base: upstream.payload?.base?.ref || base,
    draft: upstream.payload?.draft === true
  };
}

export async function githubValidatedApplyFileUpdates({ input = {} }) {
  const owner = assertGithubParam(input.owner, "owner");
  const repo = assertGithubParam(input.repo, "repo");
  const baseBranch = assertGithubParam(input.base_branch || input.baseBranch || "main", "base_branch");
  const branch = assertGithubParam(input.branch, "branch");

  if (branch === baseBranch && input.allow_direct_base !== true) {
    const err = new Error("validated apply requires a branch different from base_branch.");
    err.code = "direct_base_branch_blocked";
    err.status = 400;
    throw err;
  }

  const branchResult = await githubCreateBranchReference({
    input: {
      owner,
      repo,
      branch,
      base_branch: baseBranch
    }
  });

  const applyResult = await githubApplyFileUpdates({
    input: {
      ...input,
      owner,
      repo,
      branch
    }
  });

  const pullRequest =
    input.create_pr === false
      ? null
      : await githubCreatePullRequest({
          input: {
            owner,
            repo,
            head: input.head || branch,
            base: baseBranch,
            title: input.title || input.message,
            body:
              input.body ||
              `Automated governed file update.\n\nCommit: ${applyResult.final_commit_sha}`,
            draft: input.draft !== false
          }
        });

  return {
    ok: true,
    mode: "validated_branch_pr",
    owner,
    repo,
    base_branch: baseBranch,
    branch,
    branch_result: branchResult,
    apply_result: applyResult,
    pull_request: pullRequest,
    validation_gate: "github_actions_on_pull_request"
  };
}

export function generateAgentBranchName({ prefix = "agent", task_slug = "" } = {}) {
  const date = new Date().toISOString().slice(0, 10);
  const id = Math.random().toString(36).slice(2, 8);
  const slug = String(task_slug || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return [prefix, date, slug, id].filter(Boolean).join("/");
}

export async function githubGetPRStatus({ input = {} }) {
  const owner = assertGithubParam(input.owner, "owner");
  const repo = assertGithubParam(input.repo, "repo");
  const pullNumber = String(input.pull_number || "").trim();
  if (!pullNumber || isNaN(Number(pullNumber))) {
    const err = new Error("pull_number is required and must be a number.");
    err.code = "invalid_request";
    err.status = 400;
    throw err;
  }

  const prUpstream = await proxyGitHubJson({
    method: "GET",
    pathname:
      `/repos/${encodeURIComponent(owner)}` +
      `/${encodeURIComponent(repo)}` +
      `/pulls/${encodeURIComponent(pullNumber)}`
  });

  if (!prUpstream.ok) {
    const err = new Error(
      prUpstream.payload?.message ||
      `GitHub PR fetch failed with status ${prUpstream.status}.`
    );
    err.code = prUpstream.status === 404 ? "pr_not_found" : "github_pr_fetch_failed";
    err.status = prUpstream.status || 502;
    throw err;
  }

  const pr = prUpstream.payload;
  const headSha = String(pr?.head?.sha || "").trim();

  const checksUpstream = headSha
    ? await proxyGitHubJson({
        method: "GET",
        pathname:
          `/repos/${encodeURIComponent(owner)}` +
          `/${encodeURIComponent(repo)}` +
          `/commits/${encodeURIComponent(headSha)}/check-runs`
      })
    : { ok: false, payload: null };

  const checkRuns = checksUpstream.ok
    ? checksUpstream.payload?.check_runs || []
    : [];

  return {
    ok: true,
    number: pr.number,
    state: pr.state,
    draft: pr.draft === true,
    merged: pr.merged === true,
    mergeable: pr.mergeable,
    mergeable_state: pr.mergeable_state,
    head_sha: headSha,
    html_url: pr.html_url || "",
    title: pr.title || "",
    ci_status: deriveCheckRunsSummary(checkRuns),
    checks: checkRuns.map(c => ({
      name: c.name,
      status: c.status,
      conclusion: c.conclusion,
      html_url: c.html_url || ""
    }))
  };
}

export async function githubMergePR({ input = {} }) {
  const owner = assertGithubParam(input.owner, "owner");
  const repo = assertGithubParam(input.repo, "repo");
  const pullNumber = String(input.pull_number || "").trim();
  if (!pullNumber || isNaN(Number(pullNumber))) {
    const err = new Error("pull_number is required and must be a number.");
    err.code = "invalid_request";
    err.status = 400;
    throw err;
  }

  const requireCiPass = input.require_ci_pass !== false;
  const status = await githubGetPRStatus({ input: { owner, repo, pull_number: pullNumber } });

  if (status.merged) {
    return { ok: true, merged: true, already_merged: true, pull_number: Number(pullNumber), ci_status: status.ci_status };
  }
  if (status.state !== "open") {
    const err = new Error(`PR is not open (state: ${status.state}).`);
    err.code = "pr_not_open";
    err.status = 409;
    throw err;
  }
  if (status.draft) {
    const err = new Error("PR is in draft state. Convert to ready before merging.");
    err.code = "pr_is_draft";
    err.status = 409;
    throw err;
  }
  if (requireCiPass && status.ci_status !== "passing" && status.ci_status !== "no_checks") {
    const err = new Error(`CI is not passing (ci_status: ${status.ci_status}). Merge blocked.`);
    err.code = "ci_not_passing";
    err.status = 409;
    err.ci_status = status.ci_status;
    throw err;
  }

  const mergeMethod = ["merge", "squash", "rebase"].includes(input.merge_method)
    ? input.merge_method
    : "squash";

  const mergeUpstream = await proxyGitHubJson({
    method: "PUT",
    pathname:
      `/repos/${encodeURIComponent(owner)}` +
      `/${encodeURIComponent(repo)}` +
      `/pulls/${encodeURIComponent(pullNumber)}/merge`,
    body: {
      merge_method: mergeMethod,
      ...(input.commit_title ? { commit_title: input.commit_title } : {}),
      ...(input.commit_message ? { commit_message: input.commit_message } : {})
    }
  });

  if (!mergeUpstream.ok) {
    const err = new Error(
      mergeUpstream.payload?.message ||
      `GitHub merge failed with status ${mergeUpstream.status}.`
    );
    err.code = "github_merge_failed";
    err.status = mergeUpstream.status || 502;
    err.details = mergeUpstream.payload || null;
    throw err;
  }

  return {
    ok: true,
    merged: true,
    already_merged: false,
    pull_number: Number(pullNumber),
    merge_method: mergeMethod,
    sha: mergeUpstream.payload?.sha || "",
    message: mergeUpstream.payload?.message || "",
    ci_status: status.ci_status
  };
}

export async function githubPreviewFileUpdates({ input = {} }) {
  const owner = assertGithubParam(input.owner, "owner");
  const repo = assertGithubParam(input.repo, "repo");
  const branch = String(input.branch || "main").trim();
  const files = Array.isArray(input.files) ? input.files : [];
  const extraDenylist = Array.isArray(input.denylist) ? input.denylist : [];

  if (!files.length) {
    const err = new Error("files must be a non-empty array.");
    err.code = "invalid_request";
    err.status = 400;
    throw err;
  }

  const denied = [];
  const previews = [];

  for (const file of files) {
    const path = String(file.path || "").trim();
    if (!path) continue;

    if (isDeniedPath(path, extraDenylist)) {
      denied.push({ path, reason: "path_policy_violation" });
      continue;
    }

    const newContent =
      file.content_base64 !== undefined
        ? decodeGithubBase64ToBuffer(file.content_base64).toString("utf8")
        : String(file.content ?? "");
    const newSizeBytes = Buffer.byteLength(newContent, "utf8");

    let action = "create";
    let currentSizeBytes = null;
    let currentSha = null;
    try {
      const current = await fetchGitHubContentFile({ owner, repo, path, branch });
      if (current) {
        action = "update";
        currentSizeBytes = current.size || null;
        currentSha = current.sha || null;
      }
    } catch {
      // file does not exist — will be created
    }

    previews.push({
      path,
      action,
      current_size_bytes: currentSizeBytes,
      new_size_bytes: newSizeBytes,
      size_delta_bytes: currentSizeBytes !== null ? newSizeBytes - currentSizeBytes : null,
      current_sha: currentSha
    });
  }

  return {
    ok: true,
    dry_run: true,
    owner,
    repo,
    branch,
    would_commit: denied.length === 0,
    files_preview: previews,
    files_denied: denied,
    summary: {
      total: files.length,
      would_create: previews.filter(p => p.action === "create").length,
      would_update: previews.filter(p => p.action === "update").length,
      denied: denied.length
    }
  };
}

export async function githubCommentOnPR({ input = {} }) {
  const owner = assertGithubParam(input.owner, "owner");
  const repo = assertGithubParam(input.repo, "repo");
  const pullNumber = String(input.pull_number || "").trim();
  if (!pullNumber || isNaN(Number(pullNumber))) {
    const err = new Error("pull_number is required and must be a number.");
    err.code = "invalid_request";
    err.status = 400;
    throw err;
  }
  const body = assertGithubParam(input.body, "body");

  const upstream = await proxyGitHubJson({
    method: "POST",
    pathname:
      `/repos/${encodeURIComponent(owner)}` +
      `/${encodeURIComponent(repo)}` +
      `/issues/${encodeURIComponent(pullNumber)}/comments`,
    body: { body }
  });

  if (!upstream.ok) {
    const err = new Error(
      upstream.payload?.message ||
      `GitHub comment creation failed with status ${upstream.status}.`
    );
    err.code = "github_comment_create_failed";
    err.status = upstream.status || 502;
    err.details = upstream.payload || null;
    throw err;
  }

  return {
    ok: true,
    comment_id: upstream.payload?.id || null,
    html_url: upstream.payload?.html_url || "",
    pull_number: Number(pullNumber)
  };
}

export async function githubGitBlobChunkRead({ input = {} }) {
  const owner = assertGithubParam(input.owner, "owner");
  const repo = assertGithubParam(input.repo, "repo");
  const fileSha = assertGithubParam(
    input.file_sha || input.fileSha,
    "file_sha"
  );

  const start = parseGithubChunkInteger(
    input.byte_offset ?? input.start,
    "byte_offset",
    0,
    Number.MAX_SAFE_INTEGER
  );
  const length = parseGithubChunkInteger(
    input.length,
    "length",
    1,
    GITHUB_BLOB_CHUNK_MAX_LENGTH
  );

  const blob = await fetchGitHubBlobPayload({ owner, repo, fileSha });
  const blobBuffer = decodeGithubBase64ToBuffer(blob.content);
  const totalSize = blobBuffer.length;

  if (start > totalSize) {
    return {
      ok: false,
      statusCode: 416,
      error: {
        code: "range_not_satisfiable",
        message: "start exceeds blob size."
      }
    };
  }

  const endExclusive = Math.min(start + length, totalSize);
  const chunkBuffer = blobBuffer.subarray(start, endExclusive);

  return {
    ok: true,
    statusCode: 200,
    owner,
    repo,
    file_sha: fileSha,
    byte_offset: start,
    start,
    length: chunkBuffer.length,
    end: endExclusive,
    total_size: totalSize,
    encoding: "base64",
    content: chunkBuffer.toString("base64"),
    has_more: endExclusive < totalSize
  };
}
