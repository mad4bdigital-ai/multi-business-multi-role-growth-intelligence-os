// Device-scoped terminal sessions. No public network listener and no delegated auth.
// Local Connector owns authentication, exact device binding and approval-header injection.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const requireNative = createRequire(import.meta.url);
function detectConpty(platform, env) {
  if (platform !== "win32" || env.CONNECTOR_DEVICE_MCP_ENVIRONMENT !== "staging") return null;
  // This check is repeated on EVERY native-enabled process start, not only
  // during install-service.ps1. A manual restart must not bypass provenance.
  const addon = String(env.CONNECTOR_DEVICE_CONPTY_NATIVE_ADDON_PATH || "").trim();
  const sha = String(env.CONNECTOR_DEVICE_CONPTY_NATIVE_SHA256 || "").trim();
  const thumbprint = String(env.CONNECTOR_DEVICE_CONPTY_SIGNER_THUMBPRINT || "").trim();
  if (!addon || !/^[a-f0-9]{64}$/i.test(sha) || !/^[a-f0-9]{40}$/i.test(thumbprint))
    return null;
  const localRoot = path.dirname(fileURLToPath(import.meta.url));
  const result = spawnSync("powershell.exe", [
    "-NoProfile", "-NonInteractive",
    "-File", path.join(localRoot, "Test-ConptyNativePackage.ps1"),
    "-ConnectorRoot", localRoot, "-NativeAddonPath", addon,
    "-ExpectedSha256", sha, "-AllowedSignerThumbprint", thumbprint,
  ], { windowsHide: true, timeout: 12000, stdio: "ignore" });
  if (result.error || result.status !== 0) return null;
  try { const pty = requireNative("node-pty"); return typeof pty?.spawn === "function" ? pty : null; }
  catch { return null; } // never emulate unsigned ConPTY over ordinary pipes
}

const PAGE = 8192;
const MAX_OUTPUT = 256 * 1024;
const MAX_INPUT = 2048;
const MAX_SESSIONS = 16;
const MAX_RUNNING = 2;
const MAX_RUNTIME_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 60 * 60 * 1000;
const PROFILES = Object.freeze({
  git_status: { command: "git", args: ["-c", "core.fsmonitor=false", "-c", `core.hooksPath=${os.devNull}`, "status", "--short"], interactive: false },
  git_log: { command: "git", args: ["-c", "core.fsmonitor=false", "-c", `core.hooksPath=${os.devNull}`, "log", "-5", "--oneline"], interactive: false },
  node_repl: { command: "node", args: ["-i"], interactive: true },
  python_repl: { command: "python", args: ["-i"], interactive: true },
  powershell: { command: "powershell.exe", args: ["-NoProfile", "-NoLogo", "-NoExit", "-Command", "-"], interactive: true, windows_only: true },
  cmd: { command: "cmd.exe", args: ["/D", "/Q", "/K"], interactive: true, windows_only: true },
});
const errors = { disabled: 403, invalid_request: 400, invalid_cursor: 400,
  approval_required: 403, shell_not_authorized: 403, profile_unavailable: 403,
  session_not_found: 404, session_closed: 409, input_too_large: 413,
  capacity: 429, output_unavailable: 500, process_start_failed: 500, pty_unavailable: 409 };
function denied(code) { return { ok: false, code, http_status: errors[code] || 400, secrets_included: false }; }
function equalSecret(a, b) {
  if (!a || !b) return false;
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}
function realDir(value) {
  if (typeof value !== "string" || !path.isAbsolute(value) || value === path.parse(value).root) return null;
  try { const actual = fs.realpathSync(value); return fs.statSync(actual).isDirectory() ? actual : null; }
  catch { return null; }
}
function configuredRoot(env) {
  const root = realDir(env.CONNECTOR_DEVELOPER_REPO_ROOT || env.CONNECTOR_DEVICE_FILE_ROOT);
  if (!root) return null;
  let roots;
  try { roots = JSON.parse(env.CONNECTOR_FILE_PATHS || "[]"); }
  catch { roots = String(env.CONNECTOR_FILE_PATHS || "").split(","); }
  return Array.isArray(roots) && roots.some(value => realDir(String(value).trim()) === root) ? root : null;
}
function stateDirectory(env, root) {
  const state = realDir(env.CONNECTOR_DEVICE_TERMINAL_STATE_DIR);
  if (!state || !root || state === root || state.startsWith(root + path.sep)) return null;
  return state;
}
function safeEnv() {
  const env = { CI: "true", GIT_TERMINAL_PROMPT: "0", GIT_PAGER: "cat", NO_COLOR: "1",
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: os.devNull, GIT_OPTIONAL_LOCKS: "0" };
  for (const k of ["Path", "PATH", "PATHEXT", "SystemRoot", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE"]) {
    if (typeof process.env[k] === "string") env[k] = process.env[k];
  }
  return env;
}
function redact(s) {
  return String(s).replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/((?:secret|password|passwd|authorization|access[_-]?token|api[_-]?key)\s*[:=]\s*)([^\s]+)/gi, "$1[REDACTED]");
}
function auditCopy(s) {
  return { session_id: s.id, profile: s.profile, interactive: s.interactive,
    device_id: s.deviceId, owner_principal: s.ownerPrincipal, status: s.status, started_at: s.startedAt,
    finished_at: s.finishedAt, exit_code: s.exitCode,
    bytes_recorded: s.bytes, truncated: s.truncated, pid: ["running", "termination_pending"].includes(s.status) ? s.child?.pid ?? null : null,
    termination_requested: s.terminationRequested || null,
    shell_approval_used: s.interactive, conpty: s.conpty === true, secrets_included: false };
}

export function createDeviceTerminalManager({ env = process.env, spawnImpl = spawn, ptyImpl = undefined, platform = process.platform, now = Date.now } = {}) {
  const root = configuredRoot(env);
  const state = stateDirectory(env, root);
  const deviceId = String(env.CONNECTOR_DEVICE_ID || "").trim();
  const enabled = env.CONNECTOR_DEVICE_TERMINAL_ENABLED === "true" && Boolean(root && state && deviceId);
  const interactiveEnabled = enabled && env.CONNECTOR_DEVICE_TERMINAL_INTERACTIVE_ENABLED === "true" &&
    Boolean(env.CONNECTOR_DEVICE_TERMINAL_APPROVAL_TOKEN);
  const conptyRequested = env.CONNECTOR_DEVICE_TERMINAL_CONPTY_ENABLED === "true";
  // Disabled and non-Staging instances never load a native PTY addon.
  const ptyBackend = ptyImpl === undefined
    ? (conptyRequested && platform === "win32" &&
       env.CONNECTOR_DEVICE_MCP_ENVIRONMENT === "staging" ? detectConpty(platform, env) : null)
    : ptyImpl;
  const conptyEnabled = conptyRequested && platform === "win32" &&
    env.CONNECTOR_DEVICE_MCP_ENVIRONMENT === "staging" && interactiveEnabled &&
    typeof ptyBackend?.spawn === "function";
  const sessions = new Map();
  const capabilities = {
    enabled, root_bound: Boolean(root), device_bound: Boolean(deviceId), persistent_transcripts: enabled,
    interactive_enabled: interactiveEnabled && (!conptyRequested || conptyEnabled),
    pty: conptyEnabled, pty_requested: conptyRequested,
    pty_backend: conptyEnabled ? "windows_conpty" : "disabled",
    process_reattach_after_restart: false,
    recovery_mode: "transcript_only_after_process_restart",
    max_running: MAX_RUNNING, max_input_bytes: MAX_INPUT, max_output_bytes: MAX_OUTPUT, page_bytes: PAGE,
    profiles: Object.entries(PROFILES).map(([name, p]) => ({ name, interactive: p.interactive,
      available: enabled && (!p.interactive || (interactiveEnabled && (!conptyRequested || conptyEnabled))) && (!p.windows_only || platform === "win32") })),
    scope: "single_device_local_connector", arbitrary_pid_kill: false, secrets_included: false,
  };
  function save(s) {
    if (!enabled) return;
    const metadata = { ...auditCopy(s), expires_at: s.createdAt + SESSION_TTL_MS };
    const target = path.join(state, s.id + ".json");
    const tmp = path.join(state, "." + s.id + ".tmp");
    fs.writeFileSync(tmp, JSON.stringify(metadata), { mode: 0o600 });
    fs.renameSync(tmp, target);
  }
  function load() {
    if (!enabled) return;
    for (const name of fs.readdirSync(state).filter(n => /^[0-9a-f-]{36}\.json$/.test(n)).slice(0, MAX_SESSIONS * 5)) {
      try {
        const filename = path.join(state, name);
        if (fs.lstatSync(filename).isSymbolicLink()) continue;
        const item = JSON.parse(fs.readFileSync(filename, "utf8"));
        if (item.device_id !== deviceId || item.expires_at < now() ||
            typeof item.owner_principal !== "string" || !item.owner_principal ||
            item.owner_principal.length > 512 || !Object.hasOwn(PROFILES, item.profile)) continue;
        const id = name.slice(0, -5);
        const outputPath = path.join(state, id + ".log");
        if (!fs.existsSync(outputPath) || fs.lstatSync(outputPath).isSymbolicLink()) continue;
        const bytes = Math.min(MAX_OUTPUT, fs.statSync(outputPath).size);
        const s = { id, profile: item.profile, interactive: Boolean(item.interactive),
          deviceId, ownerPrincipal: item.owner_principal,
          status: ["running", "termination_pending"].includes(item.status) ? "interrupted" : item.status,
          createdAt: Date.parse(item.started_at), startedAt: item.started_at,
          finishedAt: ["running", "termination_pending"].includes(item.status) ? new Date(now()).toISOString() : item.finished_at,
          exitCode: item.exit_code ?? null, bytes, truncated: Boolean(item.truncated), child: null,
          outputPath, timer: null, terminationRequested: null, conpty: Boolean(item.conpty) };
        if (Number.isFinite(s.createdAt)) { sessions.set(id, s); if (["running", "termination_pending"].includes(item.status)) save(s); }
      } catch { /* invalid, stale or unrelated persistent record is ignored */ }
    }
  }
  load();
  function append(s, chunk) {
    if (s.bytes >= MAX_OUTPUT) { s.truncated = true; return; }
    const encoded = Buffer.from(redact(chunk));
    const accepted = encoded.subarray(0, MAX_OUTPUT - s.bytes);
    if (encoded.length > accepted.length) s.truncated = true;
    if (accepted.length) {
      fs.appendFileSync(s.outputPath, accepted, { mode: 0o600 });
      s.bytes += accepted.length;
    }
  }
  function finish(s, status, code = null) {
    if (s.timer) clearTimeout(s.timer);
    if (s.status !== "running" && s.status !== "termination_pending") return;
    s.status = status; s.exitCode = code; s.finishedAt = new Date(now()).toISOString();
    save(s);
  }
  function eraseSessionArtifacts(s) {
    // IDs are exclusively locally generated UUIDs; never accept a path from callers.
    if (!/^[0-9a-f-]{36}$/.test(s.id)) return;
    for (const name of [s.id + ".json", s.id + ".log"]) {
      const target = path.join(state, name);
      try {
        if (fs.existsSync(target) && !fs.lstatSync(target).isSymbolicLink())
          fs.rmSync(target, { force: true });
      } catch { /* cleanup error cannot confer extra authority */ }
    }
  }
  function terminateOwnedProcess(s) {
    const child = s.child;
    if (!child) return;
    const fallback = () => { try { child.kill("SIGTERM"); } catch { /* already exited */ } };
    // Windows child.kill terminates only the direct PID. taskkill /T is
    // permitted solely for the PID returned from this owned spawn.
    if (platform !== "win32" || !Number.isSafeInteger(child.pid) || child.pid <= 0) {
      fallback();
      return;
    }
    try {
      const killer = spawnImpl("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        cwd: root, env: safeEnv(), shell: false, windowsHide: true, stdio: "ignore",
      });
      killer.once("error", fallback);
      killer.once("close", (code) => { if (code !== 0) fallback(); });
    } catch { fallback(); }
  }
  function requestTermination(s, requestedStatus) {
    if (s.status !== "running") return;
    s.terminationRequested = requestedStatus;
    // Do not report cancellation as completed before the process closes.
    s.status = "termination_pending";
    save(s);
    terminateOwnedProcess(s);
  }
  function removeOld() {
    for (const [id, s] of sessions) {
      if (now() - s.createdAt <= SESSION_TTL_MS) continue;
      if (s.status === "running") requestTermination(s, "expired");
      // A still-live owned process cannot be forgotten just to free capacity.
      if (s.status === "termination_pending") continue;
      sessions.delete(id);
      eraseSessionArtifacts(s);
    }
    if (sessions.size > MAX_SESSIONS) {
      for (const [id, s] of sessions) {
        if (sessions.size <= MAX_SESSIONS) break;
        if (s.status !== "running" && s.status !== "termination_pending") {
          sessions.delete(id);
          eraseSessionArtifacts(s);
        }
      }
    }
  }
  function inspect(s, cursor = 0) {
    const index = Number(cursor);
    if (!Number.isSafeInteger(index) || index < 0 || index > s.bytes) return denied("invalid_cursor");
    let buffer = Buffer.alloc(0);
    try {
      const fd = fs.openSync(s.outputPath, "r");
      try {
        buffer = Buffer.alloc(Math.min(PAGE, s.bytes - index));
        const bytes = fs.readSync(fd, buffer, 0, buffer.length, index);
        buffer = buffer.subarray(0, bytes);
      } finally { fs.closeSync(fd); }
    } catch { return denied("output_unavailable"); }
    return { ok: true, http_status: 200, ...auditCopy(s),
      output: buffer.toString("utf8"), next_cursor: index + buffer.length,
      output_may_contain_sensitive_data: true };
  }
  function start(req, principal) {
    if (!enabled) return denied("disabled");
    const profile = PROFILES[req.profile];
    if (!profile) return denied("profile_unavailable");
    if (profile.windows_only && platform !== "win32") return denied("profile_unavailable");
    if (profile.interactive && conptyRequested && !conptyEnabled) return denied("pty_unavailable");
    if (profile.interactive && (!interactiveEnabled ||
        !equalSecret(req.approval_token, env.CONNECTOR_DEVICE_TERMINAL_APPROVAL_TOKEN)))
      return denied("approval_required");
    if ([...sessions.values()].filter(s => s.status === "running").length >= MAX_RUNNING ||
        sessions.size >= MAX_SESSIONS) return denied("capacity");
    const id = randomUUID();
    const s = { id, profile: req.profile, interactive: profile.interactive,
      deviceId, ownerPrincipal: principal, createdAt: now(), startedAt: new Date(now()).toISOString(), finishedAt: null,
      status: "running", exitCode: null, bytes: 0, truncated: false,
      child: null, timer: null, conpty: Boolean(profile.interactive && conptyEnabled), outputPath: path.join(state, id + ".log") };
    try {
      fs.writeFileSync(s.outputPath, "", { flag: "wx", mode: 0o600 });
      save(s);
      if (s.conpty) {
        const child = ptyBackend.spawn(profile.command, profile.args, {
          name: "xterm-256color", cols: 80, rows: 24, cwd: root,
          env: safeEnv(), useConpty: true,
        });
        if (!child || !Number.isSafeInteger(child.pid) || child.pid <= 0 ||
            typeof child.write !== "function" || typeof child.onData !== "function" ||
            typeof child.onExit !== "function" || typeof child.kill !== "function" ||
            typeof child.resize !== "function")
          throw new Error("ConPTY session contract unavailable");
        s.child = child;
        sessions.set(id, s);
        child.onData(data => append(s, data));
        child.onExit(({ exitCode }) => finish(s, s.terminationRequested ||
          (exitCode === 0 ? "completed" : "failed"), Number.isInteger(exitCode) ? exitCode : -1));
      } else {
        const child = spawnImpl(profile.command, profile.args, {
          cwd: root, env: safeEnv(), stdio: ["pipe", "pipe", "pipe"],
          shell: false, windowsHide: true,
        });
        s.child = child;
        sessions.set(id, s);
        child.stdout?.on("data", data => append(s, data));
        child.stderr?.on("data", data => append(s, data));
        child.on("error", () => finish(s, "failed", -1));
        child.on("close", code => finish(s, s.terminationRequested ||
          (code === 0 ? "completed" : "failed"), Number.isInteger(code) ? code : -1));
      }
      s.timer = setTimeout(() => {
        if (s.status === "running") requestTermination(s, "timed_out");
      }, MAX_RUNTIME_MS);
      s.timer.unref?.();
      return inspect(s);
    } catch {
      finish(s, "failed", -1);
      sessions.delete(s.id);
      eraseSessionArtifacts(s);
      return denied("process_start_failed");
    }
  }
  function input(req, s) {
    if (s.status !== "running" || !s.child || !s.interactive) return denied("session_closed");
    if (!equalSecret(req.approval_token, env.CONNECTOR_DEVICE_TERMINAL_APPROVAL_TOKEN))
      return denied("approval_required");
    if (typeof req.input !== "string" || !req.input ||
        Buffer.byteLength(req.input) > MAX_INPUT) return denied("input_too_large");
    if (s.conpty) s.child.write(req.input);
    else {
      if (s.child.stdin?.destroyed || s.child.stdin?.writableEnded) return denied("session_closed");
      s.child.stdin.write(req.input);
    }
    return inspect(s, req.cursor ?? s.bytes);
  }
  function dispatch(req = {}) {
    if (!req || typeof req !== "object" || Array.isArray(req)) return denied("invalid_request");
    if (req.action === "capabilities") return { ok: true, http_status: 200, ...capabilities };
    if (!enabled) return denied("disabled");
    const principal = req.owner_principal;
    if (typeof principal !== "string" || !principal.trim() || principal.length > 512)
      return denied("approval_required");
    removeOld();
    if (req.action === "start") return start(req, principal);
    if (req.action === "list" || req.action === "process_list") return {
      ok: true, http_status: 200, sessions: [...sessions.values()].filter(s => s.ownerPrincipal === principal).map(auditCopy),
      next_cursor: null, secrets_included: false };
    const s = sessions.get(String(req.session_id || ""));
    if (!s || s.deviceId !== deviceId || s.ownerPrincipal !== principal)
      return denied("session_not_found");
    if (req.action === "status" || req.action === "output" || req.action === "resume" || req.action === "process_status")
      return inspect(s, req.cursor || 0);
    if (req.action === "input") return input(req, s);
    if (req.action === "resize") {
      if (!s.conpty || s.status !== "running" || !s.child ||
          !Number.isSafeInteger(req.cols) || req.cols < 20 || req.cols > 240 ||
          !Number.isSafeInteger(req.rows) || req.rows < 10 || req.rows > 80)
        return denied("invalid_request");
      if (!equalSecret(req.approval_token, env.CONNECTOR_DEVICE_TERMINAL_APPROVAL_TOKEN))
        return denied("approval_required");
      try { s.child.resize(req.cols, req.rows); } catch { return denied("session_closed"); }
      return inspect(s, req.cursor ?? s.bytes);
    }
    if (req.action === "cancel" || req.action === "process_terminate") {
      if (s.status === "running") requestTermination(s, "cancelled");
      return inspect(s, req.cursor || 0);
    }
    if (req.action === "close") {
      if (s.status === "running" || s.status === "termination_pending") return denied("session_closed");
      sessions.delete(s.id);
      eraseSessionArtifacts(s);
      return { ok: true, http_status: 200, closed: true, session_id: s.id, secrets_included: false };
    }
    return denied("invalid_request");
  }
  return { dispatch, capabilities };
}
