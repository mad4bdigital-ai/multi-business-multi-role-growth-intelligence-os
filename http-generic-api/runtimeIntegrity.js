import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const GIT_TIMEOUT_MS = 5000;
const GIT_MAX_BUFFER = 64 * 1024;

function normalizeSha(value) {
  const sha = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{40}$/.test(sha) ? sha : "";
}

function nonEmptyLines(value = "") {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function runGit(execFileImpl, args, options) {
  return new Promise((resolve) => {
    try {
      execFileImpl("git", args, options, (error, stdout = "") => {
        resolve({ ok: !error, stdout: String(stdout || "") });
      });
    } catch {
      resolve({ ok: false, stdout: "" });
    }
  });
}

export function classifyRuntimeIntegrity({
  expectedCommitSha,
  checkoutCommitSha,
  checkoutDetected = true,
  statusReadbackAvailable = true,
  dirtyTrackedFileCount = 0,
} = {}) {
  const expected = normalizeSha(expectedCommitSha);
  const checkout = normalizeSha(checkoutCommitSha);
  const dirtyCount = Number.isFinite(Number(dirtyTrackedFileCount))
    ? Math.max(0, Math.floor(Number(dirtyTrackedFileCount)))
    : 0;
  const reasons = [];

  if (!statusReadbackAvailable) reasons.push("runtime_checkout_integrity_unavailable");
  if (!checkoutDetected) reasons.push("runtime_checkout_not_detected");
  if (!expected) reasons.push("runtime_expected_commit_unavailable");
  if (!checkout) reasons.push("runtime_checkout_commit_unavailable");
  if (expected && checkout && expected !== checkout) reasons.push("runtime_commit_mismatch");
  if (dirtyCount > 0) reasons.push("unapproved_dirty_runtime");

  const verified = reasons.length === 0;
  return {
    contract: "mad4b.runtime-integrity.v1",
    state: verified ? "verified" : "degraded",
    verified,
    tracked_checkout_clean: statusReadbackAvailable && dirtyCount === 0,
    local_application_code_mutation_detected: dirtyCount > 0,
    dirty_tracked_file_count: dirtyCount,
    expected_commit_sha_available: Boolean(expected),
    checkout_commit_sha_available: Boolean(checkout),
    commit_matches: expected && checkout ? expected === checkout : null,
    checkout_detected: Boolean(checkoutDetected),
    readback_available: Boolean(statusReadbackAvailable),
    read_only_check: true,
    untracked_files_ignored: true,
    reason_codes: reasons,
    secrets_included: false,
  };
}

export async function inspectRuntimeIntegrity({
  repoRoot = REPO_ROOT,
  expectedCommitSha,
  checkoutCommitSha,
  execFileImpl = execFile,
  env = process.env,
} = {}) {
  const safeOptions = {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    env: { ...env, GIT_OPTIONAL_LOCKS: "0" },
  };

  let checkoutSha = normalizeSha(checkoutCommitSha);
  let checkoutDetected = Boolean(checkoutSha);
  if (!checkoutSha) {
    const head = await runGit(execFileImpl, ["rev-parse", "--verify", "HEAD"], safeOptions);
    checkoutSha = head.ok ? normalizeSha(head.stdout) : "";
    checkoutDetected = Boolean(checkoutSha);
  }

  const status = await runGit(
    execFileImpl,
    ["status", "--porcelain=v1", "--untracked-files=no", "--no-renames"],
    safeOptions,
  );
  const statusReadbackAvailable = status.ok;
  const dirtyTrackedFileCount = statusReadbackAvailable ? nonEmptyLines(status.stdout).length : 0;

  return classifyRuntimeIntegrity({
    expectedCommitSha,
    checkoutCommitSha: checkoutSha,
    checkoutDetected,
    statusReadbackAvailable,
    dirtyTrackedFileCount,
  });
}
