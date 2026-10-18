// Bounded repo-scoped developer sessions; independent of the Control Plane.
// Not an arbitrary remote shell. An admin must opt in, bind a reviewed repo,
// and opt into executing repository code separately from read-only Git probes.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";

const MAX_OUTPUT = 96 * 1024;
const PAGE_BYTES = 8192;
const MAX_SESSIONS = 20;
const MAX_RUNNING = 2;
const SESSION_TTL_MS = 30 * 60 * 1000;
const TASKS = Object.freeze({
  git_status: { cmd: "git", args: ["status", "--short"], executes_repo_code: false },
  git_diff_stat: { cmd: "git", args: ["diff", "--stat"], executes_repo_code: false },
  git_log: { cmd: "git", args: ["log", "-5", "--oneline"], executes_repo_code: false },
  node_check: { cmd: "node", args: ["--check"], executes_repo_code: true },
  node_test: { cmd: "node", args: ["--test"], executes_repo_code: true },
  npm_test: { cmd: "npm", args: ["test"], executes_repo_code: true },
});
function fail(code, status = 403) { return { ok: false, http_status: status, code, secrets_included: false }; }
function inside(root, file) {
  const rel = path.relative(root, file);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}
function cleanRelativeFile(root, value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_./-]{1,180}$/.test(value) ||
      value.includes("..") || value.startsWith("/") || value.includes("//")) return null;
  const candidate = path.resolve(root, value);
  if (!inside(root, candidate)) return null;
  try {
    const actual = fs.realpathSync(candidate);
    if (!inside(root, actual) || !fs.statSync(actual).isFile() ||
        !/\.(mjs|cjs|js)$/i.test(actual)) return null;
    return actual;
  } catch { return null; }
}
function redact(text) {
  return String(text).replace(
    /((?:password|passwd|secret|api[_-]?key|access[_-]?token|authorization)\s*[:=]\s*)([^\s"']+)/gi,
    "$1[REDACTED]",
  ).replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
}
export function developerSessionCapabilities(env = process.env) {
  const enabled = env.CONNECTOR_DEVELOPER_SESSIONS_ENABLED === "true";
  const repo = String(env.CONNECTOR_DEVELOPER_REPO_ROOT || "").trim();
  let root = null;
  try {
    if (path.isAbsolute(repo)) {
      const actual = fs.realpathSync(repo);
      if (fs.statSync(actual).isDirectory()) root = actual;
    }
  } catch { /* deliberately unavailable */ }
  // The authorized repo must also be a file-allowlisted root.
  let allowedRoots = [];
  try {
    const configured = JSON.parse(env.CONNECTOR_FILE_PATHS || "[]");
    if (Array.isArray(configured)) allowedRoots = configured.map((p) => {
      try { return fs.realpathSync(String(p)); } catch { return ""; }
    });
  } catch {
    allowedRoots = String(env.CONNECTOR_FILE_PATHS || "").split(",").map((p) => {
      try { return fs.realpathSync(p.trim()); } catch { return ""; }
    });
  }
  const bound = Boolean(root && allowedRoots.includes(root));
  return {
    enabled: enabled && bound, requested: enabled, repo_bound: bound,
    repo_root: bound ? root : null,
    execute_tests_enabled: env.CONNECTOR_DEVELOPER_TESTS_ENABLED === "true",
    tasks: Object.keys(TASKS).map((name) => ({
      name, available: enabled && bound &&
        (!TASKS[name].executes_repo_code || env.CONNECTOR_DEVELOPER_TESTS_ENABLED === "true"),
      runs_repo_code: TASKS[name].executes_repo_code,
    })),
    max_running: MAX_RUNNING, output_page_bytes: PAGE_BYTES,
    arbitrary_shell_allowed: false, destructive_git_allowed: false,
    session_state: "process_local_bounded", secrets_included: false,
  };
}
export function createDeveloperSessionManager({
  env = process.env, spawnImpl = spawn, spawnSyncImpl = spawnSync, clock = Date.now,
} = {}) {
  const capabilities = developerSessionCapabilities(env);
  const sessions = new Map();
  function prune() {
    for (const [id, s] of sessions) {
      if (clock() - s.createdAt > SESSION_TTL_MS) {
        if (s.status === "running") { s.child?.kill("SIGTERM"); s.status = "expired"; }
        sessions.delete(id);
      }
    }
    while (sessions.size > MAX_SESSIONS) {
      const earliest = sessions.keys().next().value;
      const s = sessions.get(earliest);
      if (s?.status === "running") return;
      sessions.delete(earliest);
    }
  }
  function response(s, cursor = 0) {
    const index = Number(cursor);
    if (!Number.isSafeInteger(index) || index < 0 || index > s.output.length) return fail("invalid_cursor", 400);
    const page = s.output.slice(index, index + PAGE_BYTES);
    return {
      ok: true, http_status: 200, session_id: s.id, task: s.task,
      status: s.status, exit_code: s.exitCode, created_at: new Date(s.createdAt).toISOString(),
      output: page, next_cursor: index + page.length,
      output_truncated: s.outputTruncated, repo_root: capabilities.repo_root,
      output_may_contain_sensitive_test_data: true, arbitrary_shell_allowed: false,
    };
  }
  function append(s, chunk) {
    const remaining = MAX_OUTPUT - s.output.length;
    if (remaining <= 0) { s.outputTruncated = true; return; }
    const safe = redact(chunk);
    if (safe.length > remaining) s.outputTruncated = true;
    s.output += safe.slice(0, remaining);
  }
  function start(request) {
    if (!capabilities.enabled) return fail("developer_session_not_configured");
    const task = TASKS[request.task];
    if (!task) return fail("developer_task_not_allowlisted", 400);
    if (task.executes_repo_code && !capabilities.execute_tests_enabled) return fail("repo_code_execution_not_approved");
    if ([...sessions.values()].filter((s) => s.status === "running").length >= MAX_RUNNING) {
      return fail("developer_sessions_at_capacity", 429);
    }
    if (sessions.size >= MAX_SESSIONS) return fail("developer_session_capacity", 429);
    let args = [...task.args];
    if (["node_check", "node_test"].includes(request.task)) {
      const file = cleanRelativeFile(capabilities.repo_root, request.test_file);
      if (!file) return fail("test_file_not_allowed", 400);
      args.push(file);
    }
    if (task.executes_repo_code) {
      const expected = String(request.expected_head_sha || "").toLowerCase();
      if (!/^[a-f0-9]{40}$/.test(expected)) return fail("exact_head_sha_required", 400);
      const rev = spawnSyncImpl("git", ["rev-parse", "HEAD"], {
        cwd: capabilities.repo_root, timeout: 5000, encoding: "utf8", windowsHide: true,
      });
      if (rev.status !== 0 || String(rev.stdout || "").trim().toLowerCase() !== expected)
        return fail("repo_head_changed_or_unavailable", 409);
    }
    const id = randomUUID();
    const s = { id, task: request.task, createdAt: clock(), status: "running",
      exitCode: null, output: "", outputTruncated: false, child: null };
    sessions.set(id, s);
    const runCommand = process.platform === "win32" && task.cmd === "npm" ? "cmd.exe" : task.cmd;
    const runArgs = runCommand === "cmd.exe" ? ["/d", "/c", "npm.cmd", "test"] : args;
    try {
      const child = spawnImpl(runCommand, runArgs, {
        cwd: capabilities.repo_root, windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
      s.child = child;
      const timer = setTimeout(() => {
        if (s.status === "running") { s.status = "timed_out"; child.kill("SIGTERM"); }
      }, 180000);
      timer.unref?.();
      child.stdout?.on("data", (v) => append(s, v.toString()));
      child.stderr?.on("data", (v) => append(s, v.toString()));
      child.on("error", () => {
        clearTimeout(timer); if (s.status === "running") s.status = "failed";
        s.exitCode = -1;
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (s.status === "running") s.status = code === 0 ? "completed" : "failed";
        s.exitCode = Number.isInteger(code) ? code : -1;
      });
      return response(s);
    } catch {
      s.status = "failed"; s.exitCode = -1;
      return fail("developer_process_start_failed", 500);
    }
  }
  function dispatch(request = {}) {
    if (!request || typeof request !== "object" || Array.isArray(request)) return fail("invalid_request", 400);
    prune();
    if (request.action === "capabilities") return { ok: true, ...capabilities };
    if (request.action === "start") return start(request);
    if (request.action !== "status" && request.action !== "cancel") return fail("unknown_developer_action", 400);
    const s = sessions.get(String(request.session_id || ""));
    if (!s) return fail("developer_session_unknown_or_expired", 404);
    if (request.action === "cancel" && s.status === "running") {
      s.status = "cancelled"; s.child?.kill("SIGTERM");
    }
    return response(s, request.cursor ?? 0);
  }
  return { dispatch, capabilities };
}
