import { execFile as execFileCallback } from "node:child_process";
import { lstat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";
import { withManagedGitRepositoryCredential } from "./managedGitRepositoryCredentialBinding.js";

const execFile = promisify(execFileCallback);
const TRANSPORT_STATE = Symbol("managed_git_remote_transport_state");
const SAFE_WORKER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/;
const REPOSITORY_PART = /^[A-Za-z0-9_.-]{1,100}$/;
const SAFE_BRANCH = /^(?!-)(?!\/)(?!.*(?:\.\.|@\{|\/\/|[\u0000-\u0020\u007f~^:?*\[\\]))(?!.*(?:\/|\.|\.lock)$).{1,255}$/;
const SAFE_SHA = /^[a-f0-9]{40}$/;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_BUFFER_BYTES = 2 * 1024 * 1024;

export class ManagedGitRemoteTransportError extends Error {
  constructor(code, message, status = 500, details = {}) {
    super(message);
    this.name = "ManagedGitRemoteTransportError";
    this.code = code;
    this.status = status;
    this.details = {
      ...details,
      retryable: details?.retryable === true,
      credential_secret_exposed: false,
      persistent_credential_file_created: false,
      workspace_path_exposed: false,
      secrets_included: false,
    };
  }
}

function fail(code, message, status = 500, details = {}) {
  throw new ManagedGitRemoteTransportError(code, message, status, details);
}

function text(value, field, { max = 255, pattern = null } = {}) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > max || (pattern && !pattern.test(normalized))) {
    fail("MANAGED_GIT_REMOTE_INPUT_INVALID", `${field} is invalid.`, 400, { field });
  }
  return normalized;
}

function normalizeBranch(value) {
  const branch = text(value, "branch", { max: 255 });
  if (!SAFE_BRANCH.test(branch)) {
    fail("MANAGED_GIT_REMOTE_BRANCH_INVALID", "branch is invalid.", 400, { field: "branch" });
  }
  return branch;
}

function normalizeSha(value, field = "expected_head_sha") {
  const sha = String(value ?? "").trim().toLowerCase();
  if (!SAFE_SHA.test(sha)) {
    fail("MANAGED_GIT_REMOTE_SHA_INVALID", `${field} must be a 40-character commit SHA.`, 400, { field });
  }
  return sha;
}

function normalizeWorkspacePath(value) {
  const rawPath = text(value, "workspace_path", { max: 4096 });
  if (!isAbsolute(rawPath)) {
    fail("MANAGED_GIT_REMOTE_WORKSPACE_INVALID", "workspace_path must be absolute.", 500);
  }
  return resolve(rawPath);
}

function canonicalRemoteUrl(owner, repo) {
  return `https://github.com/${owner}/${repo}.git`;
}

function hiddenSession(safeFields, state) {
  const session = { ...safeFields };
  Object.defineProperty(session, TRANSPORT_STATE, {
    value: state,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return Object.freeze(session);
}

function stateOf(session) {
  const state = session?.[TRANSPORT_STATE];
  if (!state || typeof state !== "object" || typeof state.workspace_path !== "string") {
    fail("MANAGED_GIT_REMOTE_SESSION_INVALID", "The managed Git remote transport session is invalid.", 400);
  }
  return state;
}

function sanitizeGitEnvironment(base = process.env) {
  const env = { ...(base || {}) };
  for (const key of Object.keys(env)) {
    if (/^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+)$/.test(key)) delete env[key];
  }
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_ASKPASS = "";
  env.SSH_ASKPASS = "";
  return env;
}

function authenticatedGitEnvironment(secret, base = process.env) {
  const env = sanitizeGitEnvironment(base);
  const token = Buffer.isBuffer(secret) ? secret.toString("utf8") : String(secret ?? "");
  if (!token) fail("MANAGED_GIT_REMOTE_CREDENTIAL_INVALID", "The repository credential is invalid.", 503);
  const basic = Buffer.from(`x-access-token:${token}`, "utf8").toString("base64");
  env.GIT_CONFIG_COUNT = "2";
  env.GIT_CONFIG_KEY_0 = "credential.helper";
  env.GIT_CONFIG_VALUE_0 = "";
  env.GIT_CONFIG_KEY_1 = "http.https://github.com/.extraheader";
  env.GIT_CONFIG_VALUE_1 = `Authorization: Basic ${basic}`;
  return env;
}

async function executeGit(state, args, { authenticated = false, secret = null, env = null, timeout_ms = DEFAULT_TIMEOUT_MS } = {}) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
    fail("MANAGED_GIT_REMOTE_ARGUMENTS_INVALID", "Git arguments must be a string array.", 500);
  }
  if (args[0] === "push" && (args.includes("--force") || args.some((arg) => arg.startsWith("--force-with-lease")) || args.includes("-f"))) {
    fail("MANAGED_GIT_REMOTE_FORCE_PUSH_FORBIDDEN", "Force push is forbidden for managed Git transport.", 409);
  }
  const childEnv = env || (authenticated
    ? authenticatedGitEnvironment(secret)
    : sanitizeGitEnvironment());
  try {
    return await state.exec_file(state.git_binary, args, {
      cwd: state.workspace_path,
      timeout: timeout_ms,
      maxBuffer: MAX_BUFFER_BYTES,
      windowsHide: true,
      env: childEnv,
    });
  } catch (cause) {
    throw new ManagedGitRemoteTransportError(
      "MANAGED_GIT_REMOTE_COMMAND_FAILED",
      "The governed Git transport command failed.",
      503,
      {
        operation: args[0] || null,
        cause_code: String(cause?.code || "git_execution_failed"),
        exit_code: Number.isInteger(cause?.code) ? cause.code : null,
        retryable: true,
      },
    );
  } finally {
    if (authenticated) {
      childEnv.GIT_CONFIG_VALUE_1 = "";
      delete childEnv.GIT_CONFIG_VALUE_1;
    }
  }
}

function parseLsRemote(stdout) {
  const line = String(stdout || "").split(/\r?\n/).map((entry) => entry.trim()).find(Boolean) || "";
  const [sha] = line.split(/\s+/);
  return SAFE_SHA.test(String(sha || "").toLowerCase()) ? String(sha).toLowerCase() : null;
}

function transportScope(state) {
  return { worker_id: state.worker_id, owner: state.owner, repo: state.repo };
}

async function withCredential(state, callback, now = new Date()) {
  return withManagedGitRepositoryCredential(
    state.credential_binding,
    transportScope(state),
    async (secret, evidence) => callback(secret, evidence),
    { now },
  );
}

async function ensureWorkspace(state) {
  let info;
  try {
    info = await lstat(state.workspace_path);
  } catch (cause) {
    fail("MANAGED_GIT_REMOTE_WORKSPACE_UNAVAILABLE", "The managed Git workspace is unavailable.", 409, {
      cause_code: String(cause?.code || "workspace_unavailable"),
    });
  }
  if (!info.isDirectory()) {
    fail("MANAGED_GIT_REMOTE_WORKSPACE_UNAVAILABLE", "The managed Git workspace is not a directory.", 409);
  }
  const result = await executeGit(state, ["rev-parse", "--is-inside-work-tree"]);
  if (String(result?.stdout || "").trim() !== "true") {
    fail("MANAGED_GIT_REMOTE_WORKSPACE_NOT_GIT", "The managed workspace is not an initialized Git repository.", 409);
  }
}

export async function prepareManagedGitRemoteTransport({
  worker_id,
  owner,
  repo,
  branch,
  expected_head_sha,
  workspace_path,
  credential_binding,
  git_binary = process.env.MANAGED_GIT_BINARY || "git",
  exec_file = execFile,
  remote_url_builder = canonicalRemoteUrl,
  now = new Date(),
} = {}) {
  const workerId = text(worker_id, "worker_id", { max: 191, pattern: SAFE_WORKER_ID });
  const normalizedOwner = text(owner, "owner", { max: 100, pattern: REPOSITORY_PART });
  const normalizedRepo = text(repo, "repo", { max: 100, pattern: REPOSITORY_PART });
  const normalizedBranch = normalizeBranch(branch);
  const expectedHeadSha = normalizeSha(expected_head_sha);
  const workspacePath = normalizeWorkspacePath(workspace_path);
  if (!credential_binding) fail("MANAGED_GIT_REMOTE_CREDENTIAL_REQUIRED", "A repository credential binding is required.", 409);
  if (typeof exec_file !== "function") fail("MANAGED_GIT_REMOTE_EXECUTOR_REQUIRED", "exec_file must be a function.", 500);
  if (typeof remote_url_builder !== "function") fail("MANAGED_GIT_REMOTE_URL_BUILDER_REQUIRED", "remote_url_builder must be a function.", 500);
  const gitBinary = text(git_binary, "git_binary", { max: 4096 });
  const remoteUrl = String(remote_url_builder(normalizedOwner, normalizedRepo) ?? "").trim();
  if (!remoteUrl) fail("MANAGED_GIT_REMOTE_URL_INVALID", "The repository remote URL is invalid.", 500);

  const state = {
    worker_id: workerId,
    owner: normalizedOwner,
    repo: normalizedRepo,
    branch: normalizedBranch,
    expected_head_sha: expectedHeadSha,
    current_head_sha: expectedHeadSha,
    workspace_path: workspacePath,
    credential_binding,
    git_binary: gitBinary,
    exec_file,
    remote_url: remoteUrl,
    committed: false,
    pushed: false,
  };

  await ensureWorkspace(state);
  await withCredential(state, async (secret) => {
    const remotes = await executeGit(state, ["remote"], { authenticated: true, secret });
    const names = String(remotes?.stdout || "").split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
    if (names.includes("origin")) {
      await executeGit(state, ["remote", "set-url", "origin", remoteUrl], { authenticated: true, secret });
    } else {
      await executeGit(state, ["remote", "add", "origin", remoteUrl], { authenticated: true, secret });
    }
    await executeGit(state, [
      "fetch",
      "--no-tags",
      "--prune",
      "--depth=1",
      "origin",
      `+refs/heads/${normalizedBranch}:refs/remotes/origin/${normalizedBranch}`,
    ], { authenticated: true, secret });
  }, now);

  const fetched = await executeGit(state, ["rev-parse", `refs/remotes/origin/${normalizedBranch}`]);
  const fetchedHeadSha = normalizeSha(String(fetched?.stdout || "").trim(), "fetched_head_sha");
  if (fetchedHeadSha !== expectedHeadSha) {
    fail("MANAGED_GIT_REMOTE_HEAD_MISMATCH", "The fetched branch head does not match the governed expected head.", 409, {
      expected_head_sha: expectedHeadSha,
      actual_head_sha: fetchedHeadSha,
      retryable: false,
    });
  }

  await executeGit(state, ["checkout", "--force", "-B", normalizedBranch, `refs/remotes/origin/${normalizedBranch}`]);
  await executeGit(state, ["reset", "--hard", expectedHeadSha]);
  await executeGit(state, ["clean", "-ffdx"]);
  const checkedOut = await executeGit(state, ["rev-parse", "HEAD"]);
  const checkedOutHeadSha = normalizeSha(String(checkedOut?.stdout || "").trim(), "checkout_head_sha");
  if (checkedOutHeadSha !== expectedHeadSha) {
    fail("MANAGED_GIT_REMOTE_CHECKOUT_MISMATCH", "The local checkout does not match the governed expected head.", 409, {
      expected_head_sha: expectedHeadSha,
      actual_head_sha: checkedOutHeadSha,
      retryable: false,
    });
  }

  return hiddenSession({
    worker_id: workerId,
    owner: normalizedOwner,
    repo: normalizedRepo,
    branch: normalizedBranch,
    checkout_head_sha: checkedOutHeadSha,
    current_head_sha: checkedOutHeadSha,
    remote_fetch_performed: true,
    remote_checkout_performed: true,
    remote_commit_performed: false,
    remote_push_performed: false,
    credentials_read: true,
    credential_secret_exposed: false,
    persistent_credential_file_created: false,
    workspace_path_exposed: false,
    secrets_included: false,
  }, state);
}

export function readManagedGitRemoteTransport(session) {
  const state = stateOf(session);
  return {
    ...session,
    current_head_sha: state.current_head_sha,
    remote_commit_performed: state.committed,
    remote_push_performed: state.pushed,
    credential_secret_exposed: false,
    persistent_credential_file_created: false,
    workspace_path_exposed: false,
    secrets_included: false,
  };
}

export async function commitManagedGitRemoteChanges(session, {
  message,
  expected_parent_sha = null,
  author_name = "Mad4B Managed Git Worker",
  author_email = "managed-git-worker@mad4b.invalid",
  allow_empty = false,
} = {}) {
  const state = stateOf(session);
  const commitMessage = text(message, "message", { max: 500 });
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(commitMessage)) {
    fail("MANAGED_GIT_REMOTE_COMMIT_MESSAGE_INVALID", "The commit message contains unsupported control characters.", 400);
  }
  const parent = expected_parent_sha ? normalizeSha(expected_parent_sha, "expected_parent_sha") : state.current_head_sha;
  const current = await executeGit(state, ["rev-parse", "HEAD"]);
  const currentHead = normalizeSha(String(current?.stdout || "").trim(), "current_head_sha");
  if (currentHead !== parent) {
    fail("MANAGED_GIT_REMOTE_LOCAL_HEAD_MISMATCH", "The local branch head changed before commit.", 409, {
      expected_head_sha: parent,
      actual_head_sha: currentHead,
      retryable: false,
    });
  }

  await executeGit(state, ["add", "--all"]);
  const status = await executeGit(state, ["status", "--porcelain=v1", "-z"]);
  const hasChanges = Buffer.byteLength(String(status?.stdout || ""), "utf8") > 0;
  if (!hasChanges && allow_empty !== true) {
    return {
      committed: false,
      status: "no_changes",
      parent_head_sha: currentHead,
      commit_head_sha: currentHead,
      credential_secret_exposed: false,
      persistent_credential_file_created: false,
      workspace_path_exposed: false,
      secrets_included: false,
    };
  }

  const env = sanitizeGitEnvironment();
  env.GIT_AUTHOR_NAME = text(author_name, "author_name", { max: 191 });
  env.GIT_AUTHOR_EMAIL = text(author_email, "author_email", { max: 254 });
  env.GIT_COMMITTER_NAME = env.GIT_AUTHOR_NAME;
  env.GIT_COMMITTER_EMAIL = env.GIT_AUTHOR_EMAIL;
  const args = ["commit", "--no-gpg-sign", "-m", commitMessage];
  if (allow_empty === true) args.push("--allow-empty");
  await executeGit(state, args, { env });
  const committed = await executeGit(state, ["rev-parse", "HEAD"]);
  const commitHeadSha = normalizeSha(String(committed?.stdout || "").trim(), "commit_head_sha");
  if (commitHeadSha === currentHead) {
    fail("MANAGED_GIT_REMOTE_COMMIT_NOT_CREATED", "Git did not create a new commit.", 503, { retryable: false });
  }
  state.current_head_sha = commitHeadSha;
  state.committed = true;
  return {
    committed: true,
    status: "committed",
    parent_head_sha: currentHead,
    commit_head_sha: commitHeadSha,
    credential_secret_exposed: false,
    persistent_credential_file_created: false,
    workspace_path_exposed: false,
    secrets_included: false,
  };
}

export async function pushManagedGitRemoteChanges(session, {
  expected_remote_head_sha = null,
  now = new Date(),
} = {}) {
  const state = stateOf(session);
  const expectedRemoteHeadSha = normalizeSha(
    expected_remote_head_sha || state.expected_head_sha,
    "expected_remote_head_sha",
  );
  const local = await executeGit(state, ["rev-parse", "HEAD"]);
  const localHeadSha = normalizeSha(String(local?.stdout || "").trim(), "local_head_sha");

  await withCredential(state, async (secret) => {
    const remote = await executeGit(state, ["ls-remote", "--heads", "origin", `refs/heads/${state.branch}`], {
      authenticated: true,
      secret,
    });
    const actualRemoteHeadSha = parseLsRemote(remote?.stdout);
    if (!actualRemoteHeadSha || actualRemoteHeadSha !== expectedRemoteHeadSha) {
      fail("MANAGED_GIT_REMOTE_HEAD_MISMATCH", "The remote branch head changed before push.", 409, {
        expected_head_sha: expectedRemoteHeadSha,
        actual_head_sha: actualRemoteHeadSha,
        retryable: false,
      });
    }

    const mergeBase = await executeGit(state, ["merge-base", actualRemoteHeadSha, localHeadSha]);
    const mergeBaseSha = normalizeSha(String(mergeBase?.stdout || "").trim(), "merge_base_sha");
    if (mergeBaseSha !== actualRemoteHeadSha) {
      fail("MANAGED_GIT_REMOTE_NON_FAST_FORWARD", "The local commit is not a fast-forward of the governed remote head.", 409, {
        remote_head_sha: actualRemoteHeadSha,
        local_head_sha: localHeadSha,
        retryable: false,
      });
    }

    await executeGit(state, ["push", "--porcelain", "origin", `HEAD:refs/heads/${state.branch}`], {
      authenticated: true,
      secret,
    });
    const readback = await executeGit(state, ["ls-remote", "--heads", "origin", `refs/heads/${state.branch}`], {
      authenticated: true,
      secret,
    });
    const readbackHeadSha = parseLsRemote(readback?.stdout);
    if (readbackHeadSha !== localHeadSha) {
      fail("MANAGED_GIT_REMOTE_PUSH_READBACK_FAILED", "The pushed branch head could not be verified.", 503, {
        expected_head_sha: localHeadSha,
        actual_head_sha: readbackHeadSha,
        retryable: true,
      });
    }
  }, now);

  state.current_head_sha = localHeadSha;
  state.expected_head_sha = localHeadSha;
  state.pushed = true;
  return {
    pushed: true,
    status: "pushed",
    previous_remote_head_sha: expectedRemoteHeadSha,
    remote_head_sha: localHeadSha,
    force_push_performed: false,
    readback_verified: true,
    credential_secret_exposed: false,
    persistent_credential_file_created: false,
    workspace_path_exposed: false,
    secrets_included: false,
  };
}

export const _testingManagedGitRemoteTransport = Object.freeze({
  SAFE_BRANCH,
  SAFE_SHA,
  canonicalRemoteUrl,
  authenticatedGitEnvironment,
  parseLsRemote,
});
