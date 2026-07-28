import { execFile as execFileCallback } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const WORKSPACE_PATH = Symbol("managed_git_ephemeral_workspace_path");
const WORKSPACE_ROOT = Symbol("managed_git_ephemeral_workspace_root");
const SAFE_WORKER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DEFAULT_ROOT_NAME = "operation-managed-git-workers";

export class ManagedGitEphemeralCheckoutError extends Error {
  constructor(code, message, status = 500, details = {}) {
    super(message);
    this.name = "ManagedGitEphemeralCheckoutError";
    this.code = code;
    this.status = status;
    this.details = {
      ...details,
      retryable: details?.retryable === true,
      workspace_path_exposed: false,
      secrets_included: false,
    };
  }
}

function fail(code, message, status = 500, details = {}) {
  throw new ManagedGitEphemeralCheckoutError(code, message, status, details);
}

function normalizeWorkerId(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized || !SAFE_WORKER_ID.test(normalized)) {
    fail("managed_git_ephemeral_worker_id_invalid", "worker_id is invalid.", 400, { field: "worker_id" });
  }
  return normalized;
}

function normalizeRoot(value) {
  const configured = String(value ?? "").trim();
  const root = resolve(configured || join(tmpdir(), DEFAULT_ROOT_NAME));
  if (!isAbsolute(root)) {
    fail("managed_git_ephemeral_root_invalid", "workspace root must be absolute.", 500);
  }
  return root;
}

function assertInsideRoot(root, target) {
  const delta = relative(root, target);
  if (!delta || delta === "." || delta === ".." || delta.startsWith(`..${sep}`) || isAbsolute(delta)) {
    fail("managed_git_ephemeral_path_escape", "workspace path must be a child of the configured root.", 500);
  }
}

function hiddenWorkspaceHandle(safeFields, root, workspacePath) {
  const handle = { ...safeFields };
  Object.defineProperties(handle, {
    [WORKSPACE_ROOT]: { value: root, enumerable: false, writable: false },
    [WORKSPACE_PATH]: { value: workspacePath, enumerable: false, writable: false },
  });
  return Object.freeze(handle);
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function executeGit(execFileImpl, gitBinary, args, cwd) {
  try {
    return await execFileImpl(gitBinary, args, {
      cwd,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_ASKPASS: "",
        SSH_ASKPASS: "",
      },
    });
  } catch (error) {
    throw new ManagedGitEphemeralCheckoutError(
      "managed_git_ephemeral_git_init_failed",
      "The isolated local Git workspace could not be initialized.",
      503,
      {
        cause_code: String(error?.code || "git_execution_failed"),
        retryable: true,
      },
    );
  }
}

export function getManagedGitEphemeralCheckoutPath(handle) {
  const workspacePath = handle?.[WORKSPACE_PATH];
  const root = handle?.[WORKSPACE_ROOT];
  if (typeof workspacePath !== "string" || typeof root !== "string") {
    fail("managed_git_ephemeral_handle_invalid", "The workspace handle is invalid.", 400);
  }
  assertInsideRoot(root, workspacePath);
  return workspacePath;
}

export async function createManagedGitEphemeralCheckout({
  worker_id,
  root_dir = process.env.MANAGED_GIT_WORKSPACE_ROOT,
  git_binary = process.env.MANAGED_GIT_BINARY || "git",
  exec_file = execFile,
} = {}) {
  const workerId = normalizeWorkerId(worker_id);
  const root = normalizeRoot(root_dir);
  const gitBinary = String(git_binary || "git").trim();
  if (!gitBinary) fail("managed_git_ephemeral_git_binary_invalid", "git_binary is invalid.", 500);
  if (typeof exec_file !== "function") fail("managed_git_ephemeral_exec_invalid", "exec_file must be a function.", 500);

  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);

  let workspacePath = null;
  try {
    workspacePath = await mkdtemp(join(root, `${workerId}-`));
    assertInsideRoot(root, workspacePath);
    await chmod(workspacePath, 0o700);
    await executeGit(exec_file, gitBinary, ["init", "--quiet"], workspacePath);
    const verification = await executeGit(exec_file, gitBinary, ["rev-parse", "--is-inside-work-tree"], workspacePath);
    if (String(verification?.stdout || "").trim() !== "true") {
      fail("managed_git_ephemeral_verification_failed", "The local Git workspace verification failed.", 503, { retryable: true });
    }

    return hiddenWorkspaceHandle({
      worker_id: workerId,
      checkout_strategy: "ephemeral_checkout",
      workspace_created: true,
      git_repository_initialized: true,
      remote_fetch_performed: false,
      remote_checkout_performed: false,
      credentials_read: false,
      workspace_path_exposed: false,
      secrets_included: false,
    }, root, workspacePath);
  } catch (error) {
    if (workspacePath) {
      await rm(workspacePath, { recursive: true, force: true }).catch(() => {});
    }
    if (error instanceof ManagedGitEphemeralCheckoutError) throw error;
    throw new ManagedGitEphemeralCheckoutError(
      "managed_git_ephemeral_create_failed",
      "The isolated workspace could not be created.",
      503,
      { cause_code: String(error?.code || "workspace_create_failed"), retryable: true },
    );
  }
}

export async function releaseManagedGitEphemeralCheckout(handle) {
  const workspacePath = getManagedGitEphemeralCheckoutPath(handle);
  await rm(workspacePath, { recursive: true, force: true });
  const cleanupVerified = !(await pathExists(workspacePath));
  if (!cleanupVerified) {
    fail("managed_git_ephemeral_cleanup_failed", "The isolated workspace cleanup could not be verified.", 503, {
      worker_id: handle.worker_id,
      retryable: true,
    });
  }
  return {
    worker_id: handle.worker_id,
    checkout_strategy: "ephemeral_checkout",
    workspace_released: true,
    cleanup_verified: true,
    workspace_path_exposed: false,
    secrets_included: false,
  };
}

export async function releaseManagedGitEphemeralCheckoutsForWorker({
  worker_id,
  root_dir = process.env.MANAGED_GIT_WORKSPACE_ROOT,
} = {}) {
  const workerId = normalizeWorkerId(worker_id);
  const root = normalizeRoot(root_dir);
  let entries;
  try {
    entries = await readdir(root);
  } catch (error) {
    if (error?.code === "ENOENT") entries = [];
    else throw error;
  }
  const prefix = `${workerId}-`;
  const targets = entries.filter((entry) => entry.startsWith(prefix)).sort();
  for (const entry of targets) {
    const target = resolve(root, entry);
    assertInsideRoot(root, target);
    await rm(target, { recursive: true, force: true });
    if (await pathExists(target)) {
      fail("managed_git_ephemeral_cleanup_failed", "Expired workspace cleanup could not be verified.", 503, {
        worker_id: workerId,
        retryable: true,
      });
    }
  }
  return {
    worker_id: workerId,
    checkout_strategy: "ephemeral_checkout",
    workspace_released: true,
    cleanup_verified: true,
    cleanup_count: targets.length,
    workspace_path_exposed: false,
    secrets_included: false,
  };
}

export async function listManagedGitEphemeralRootEntries(root_dir = process.env.MANAGED_GIT_WORKSPACE_ROOT) {
  const root = normalizeRoot(root_dir);
  try {
    return (await readdir(root)).sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}
