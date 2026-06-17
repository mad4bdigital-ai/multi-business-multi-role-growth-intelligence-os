import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { getPool } from "./db.js";
import { resolveEffectiveCredential } from "./credentialResolver.js";
import { maybeCreateCredentialIntakeRequirement } from "./credentialIntakeEnforcement.js";
import { planRemoteRuntimeDispatchDryRun } from "./remoteRuntime.js";
import { writeExecutionEvidence } from "./executionEvidenceLogger.js";
import {
  capabilityEnvelopeError,
  extractCapabilityEnvelopeId,
  markCapabilityEnvelopeReferenced,
  resolveCapabilityExecutionEnvelope,
} from "./capabilityResolutionEnvelopeGuard.js";
import {
  normalizeHostingerSshProbeRunnerMode,
  validateHostingerSshProbeRunnerMode,
  describeHostingerSshProbeRunnerMode,
} from "./hostingerSshProbeRunnerModes.js";
import { createContinuationCheckpoint, planContinuationResume } from "./sharedReconciliationEngine.js";
import { getRuntimeParity } from "./runtimeVerificationService.js";

const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_PROBE_TIMEOUT_MS = 45000;
const MAX_PROBE_TIMEOUT_MS = 75000;
const MAX_TIMEOUT_MS = 300000;
const SSH_CONNECT_TIMEOUT_SECONDS = 10;
const SSH_SERVER_ALIVE_INTERVAL_SECONDS = 5;
const SSH_SERVER_ALIVE_COUNT_MAX = 1;
const SSH_PROCESS_KILL_GRACE_MS = 5000;
const EXECUTOR_FLAG = "REMOTE_RUNTIME_HOSTINGER_SSH_EXECUTOR_ENABLED";
const EXECUTOR_DB_FLAG_KEY = "remote_runtime_hostinger_ssh_executor_enabled";
const PROBE_FLAG = "REMOTE_RUNTIME_HOSTINGER_SSH_PROBE_ENABLED";
const PROBE_DB_FLAG_KEY = "remote_runtime_hostinger_ssh_probe_enabled";
const ALLOWED_BRANCHES = new Set(["main"]);
const DEFAULT_AUTH_APP_PATH = "/home/u338416126/domains/auth.mad4b.com/nodejs";
const SSH_COMMON_ROLES = ["ssh_host", "ssh_port", "ssh_user"];
const SSH_KEY_ROLE = "ssh_private_key";
const SSH_PASSWORD_ROLE = "ssh_password";
const SSH_AUTH_MODES = new Set(["private_key", "password"]);
export const HOSTINGER_SSH_TARGET_PROBE_JOB_TYPE = "hostinger_ssh_target_probe";

function compact(value = "", max = 255) {
  return String(value ?? "").trim().slice(0, max);
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function bool(value) {
  return value === true || ["true", "1", "yes"].includes(String(value ?? "").trim().toLowerCase());
}

function boundedInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function phaseTimeoutError(phase, timeoutMs, details = {}) {
  const err = new Error(`Hostinger SSH probe phase timed out: ${phase}.`);
  err.status = 504;
  err.code = "hostinger_probe_phase_timeout";
  err.details = { phase, timeout_ms: timeoutMs, ...details, secrets_included: false };
  return err;
}

async function withPhaseTimeout(promise, { phase, timeoutMs, details = {} } = {}) {
  const boundedTimeoutMs = boundedInt(timeoutMs, 15000, 1000, MAX_TIMEOUT_MS);
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(phaseTimeoutError(phase || "unknown", boundedTimeoutMs, details)), boundedTimeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function assertSafeRemotePath(pathValue) {
  const value = compact(pathValue, 1024);
  if (!value || !value.startsWith("/home/") || value.includes("\0") || /[\r\n]/.test(value)) {
    const err = new Error("app_path must be an absolute /home/... path without control characters.");
    err.status = 400;
    err.code = "remote_runtime_invalid_app_path";
    throw err;
  }
  if (value.includes("..") || /[;&|`$<>]/.test(value)) {
    const err = new Error("app_path contains unsupported traversal or shell metacharacters.");
    err.status = 400;
    err.code = "remote_runtime_app_path_not_safe";
    throw err;
  }
  return value.replace(/\/+$/, "");
}

function wildcardPathToRegex(pattern) {
  const escaped = String(pattern || "")
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]+")
    .replace(/\/+$/, "");
  return new RegExp(`^${escaped}(?:/.*)?$`);
}

function pathAllowedByTarget(appPath, target) {
  const allowlist = Array.isArray(target?.path_allowlist) ? target.path_allowlist : [];
  return allowlist.some((pattern) => wildcardPathToRegex(pattern).test(appPath));
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function sanitizeSshOutput(text = "") {
  return String(text || "")
    .replace(/-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g, "[redacted-private-key]")
    .replace(/(password|passphrase|token|secret|private_key)=\S+/gi, "$1=[redacted]")
    .slice(0, 12000);
}

async function safeQuery(pool, sql, params = []) {
  try {
    const [rows] = await pool.query(sql, params);
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(err?.code)) return [];
    throw err;
  }
}

export async function loadHostingerSshGate(pool, { targetId, env = process.env, envFlag, dbKey }) {
  if (env[envFlag] === "true") return { enabled: true, source: "env", key: envFlag };
  const rows = await safeQuery(
    pool,
    "SELECT config_json, status FROM platform_runtime_config WHERE config_key = ? LIMIT 1",
    [dbKey]
  );
  const row = rows[0];
  const config = parseJson(row?.config_json, {});
  const expiresAt = compact(config.expires_at || config.expiresAt || "", 64);
  const targetAllowed = !config.target_id || String(config.target_id) === String(targetId);
  const notExpired = !expiresAt || Number.isNaN(Date.parse(expiresAt)) || Date.parse(expiresAt) > Date.now();
  return {
    enabled: row?.status === "active" && config.enabled === true && targetAllowed && notExpired,
    source: "platform_runtime_config",
    key: dbKey,
    target_allowed: targetAllowed,
    expires_at: expiresAt || null,
    expired: expiresAt ? !notExpired : false,
    reason: !row ? "db_gate_missing" : row.status !== "active" ? "db_gate_disabled" : config.enabled !== true ? "db_gate_not_enabled" : !targetAllowed ? "db_gate_target_mismatch" : !notExpired ? "db_gate_expired" : "enabled",
  };
}

async function loadHostingerSshProbeGate(pool, targetId, env = process.env) {
  return await loadHostingerSshGate(pool, { targetId, env, envFlag: PROBE_FLAG, dbKey: PROBE_DB_FLAG_KEY });
}

async function loadHostingerSshExecutorGate(pool, targetId, env = process.env) {
  return await loadHostingerSshGate(pool, { targetId, env, envFlag: EXECUTOR_FLAG, dbKey: EXECUTOR_DB_FLAG_KEY });
}

async function loadTarget(pool, targetId) {
  const rows = await safeQuery(
    pool,
    "SELECT * FROM remote_runtime_targets WHERE target_id = ? AND plugin_key = 'remote_ssh_runtime' LIMIT 1",
    [targetId]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    target_id: row.target_id,
    tenant_id: row.tenant_id,
    user_id: row.user_id || null,
    target_kind: row.target_kind,
    provider_family: row.provider_family || null,
    connector_family: row.connector_family || null,
    system_id: row.system_id || null,
    host_label: row.host_label || "",
    root_path: row.root_path || null,
    path_allowlist: parseJson(row.path_allowlist_json, []),
    command_allowlist: parseJson(row.command_allowlist_json, []),
    metadata: parseJson(row.metadata_json, {}),
    status: row.status,
    validation_status: row.validation_status,
  };
}

function isPlatformManagedTarget(target = {}) {
  const systemKey = String(target.metadata?.system_key || "");
  return !target.user_id && (
    target.metadata?.service_mode === "managed" ||
    systemKey.endsWith("_platform") ||
    systemKey.includes("prod_platform") ||
    String(target.host_label || "").toLowerCase().includes("platform")
  );
}

function sshAuthTypeForRole(role) {
  return role === SSH_PASSWORD_ROLE ? "ssh_password" : "ssh_key_pair";
}

function sshCredentialLabel(role) {
  if (role === "ssh_port") return "SSH port";
  if (role === "ssh_host") return "SSH host";
  if (role === "ssh_user") return "SSH username";
  if (role === SSH_PASSWORD_ROLE) return "SSH password";
  if (role === SSH_KEY_ROLE) return "SSH private key";
  return role;
}

function preferredSshAuthMode(input = {}, target = {}) {
  const requested = compact(input.ssh_auth_mode || input.sshAuthMode || input.auth_mode || input.authMode || "", 32).toLowerCase();
  if (SSH_AUTH_MODES.has(requested)) return requested;
  if (target.provider_family === "hostinger") return "password";
  return "private_key";
}

export function normalizeHostingerSshTargetProbeJobPayload(input = {}) {
  return {
    target_id: compact(input.target_id || input.targetId, 64),
    app_key: compact(input.app_key || input.appKey || "auth.mad4b.com", 191),
    app_path: assertSafeRemotePath(input.app_path || input.appPath || DEFAULT_AUTH_APP_PATH),
    expected_commit_sha: compact(input.expected_commit_sha || input.expectedCommitSha || input.commit_sha || input.commitSha || "", 64).toLowerCase(),
    ssh_auth_mode: compact(input.ssh_auth_mode || input.sshAuthMode || "password", 32).toLowerCase(),
    activate_on_success: bool(input.activate_on_success || input.activateOnSuccess),
    approval_reason: compact(input.approval_reason || input.approvalReason || input.break_glass_reason || input.breakGlassReason, 1000),
    timeout_ms: boundedInt(input.timeout_ms || input.timeoutMs, DEFAULT_PROBE_TIMEOUT_MS, 1000, MAX_PROBE_TIMEOUT_MS),
    runner_mode: normalizeHostingerSshProbeRunnerMode(input.runner_mode || input.runnerMode || input.execution_mode || input.executionMode || "queue_worker"),
    dry_run: false,
    secrets_included: false,
  };
}

export function validateHostingerSshTargetProbeJobPayload(input = {}) {
  const errors = [];
  let payload;
  try { payload = normalizeHostingerSshTargetProbeJobPayload(input); }
  catch (err) { return [err?.message || "Hostinger SSH probe job payload is invalid."]; }
  if (!payload.target_id) errors.push("target_id is required.");
  if (payload.app_key !== "auth.mad4b.com") errors.push("app_key must be auth.mad4b.com.");
  if (payload.expected_commit_sha && !/^[0-9a-f]{40}$/.test(payload.expected_commit_sha)) errors.push("expected_commit_sha must be a 40-character git SHA when supplied.");
  if (!SSH_AUTH_MODES.has(payload.ssh_auth_mode)) errors.push("ssh_auth_mode must be password or private_key.");
  errors.push(...validateHostingerSshProbeRunnerMode(payload.runner_mode));
  if (payload.approval_reason.length < 20) errors.push("approval_reason with at least 20 characters is required for queued SSH probe execution.");
  return errors;
}

export async function runHostingerSshTargetProbeJob(input = {}, deps = {}) {
  const payload = normalizeHostingerSshTargetProbeJobPayload(input);
  return await executeHostingerSshTargetProbe({ ...payload, dry_run: false }, deps);
}

async function resolveSshCredential(pool, target, role, input = {}, options = {}) {
  const result = await resolveEffectiveCredential({
    tenantId: target.tenant_id,
    userId: target.user_id || input.user_id || input.userId || undefined,
    systemId: target.system_id || undefined,
    credentialRole: role,
    includeSecret: true,
    allowPlatformFallback: true,
  }, { pool });
  if (result?.status !== "resolved" || !compact(result.secret, 20000)) {
    if (options.createHandoff === false) return null;
    const authType = sshAuthTypeForRole(role);
    const credentialIntake = await maybeCreateCredentialIntakeRequirement({
      tenantId: target.tenant_id,
      userId: input.user_id || input.userId || target.user_id || undefined,
      platformAdminUserId: input.platform_admin_user_id || input.platformAdminUserId,
      systemId: target.system_id || undefined,
      appKey: "remote_ssh_runtime",
      authType,
      credentialRole: role,
      credentialField: role,
      credentialLabel: sshCredentialLabel(role),
      displayLabel: `${target.host_label || "Hostinger SSH"} ${sshCredentialLabel(role)}`,
      intakeScope: result?.owner_type === "platform" || String(result?.credential_ref || "").startsWith("platform_secret:") || isPlatformManagedTarget(target) ? "platform" : "tenant",
      providerFamily: target.provider_family,
      connectorFamily: target.connector_family,
      ownerId: result?.owner_id || "growth_intelligence_platform",
      metadata: {
        target_id: target.target_id,
        target_kind: target.target_kind,
        source_route: "remote_runtime_hostinger_ssh_probe_or_deploy",
        auto_handoff_reason: "missing_required_ssh_credential",
        ssh_auth_mode: role === SSH_PASSWORD_ROLE ? "password" : "private_key",
        secrets_included: false,
      },
      autoIntake: true,
      requireCredentialIntakeOnMissing: true,
      expiresInMinutes: 24 * 60,
      createdBy: "remote_runtime_missing_ssh_credential_handoff",
    }, result || {}, { pool }).catch((handoffErr) => ({
      status: "credential_intake_handoff_failed",
      reason: handoffErr.message,
      secrets_included: false,
    }));
    const err = new Error(`Required SSH credential ${role} is not resolved.`);
    err.status = 409;
    err.code = "remote_runtime_ssh_credential_not_resolved";
    err.details = { role, status: result?.status || "missing", credential_intake: credentialIntake, secrets_included: false };
    throw err;
  }
  return String(result.secret);
}

async function resolveCapabilityEnvelopeForHostingerDeploy({ pool, input = {}, target, expectedCommitSha }) {
  const resolved = await resolveCapabilityExecutionEnvelope({
    pool,
    source: input,
    acceptedAppKeys: ["remote_ssh_runtime", "hostinger"],
    acceptedIntents: ["deploy", "restart", "write", "remote_runtime_deploy", "hostinger_ssh_deploy", "deploy_release"],
    expectedTenantId: target?.tenant_id,
    expectedUserId: target?.user_id || input.user_id || input.userId,
    expectedCommitSha,
  });
  if (!resolved.ok) {
    throw capabilityEnvelopeError(resolved, "Capability resolution envelope does not allow Hostinger SSH deploy execution.");
  }
  return resolved;
}

async function resolveSshConnectionCredentials(pool, target, input = {}) {
  const [host, port, user] = await Promise.all(SSH_COMMON_ROLES.map((role) => resolveSshCredential(pool, target, role, input)));
  const authMode = preferredSshAuthMode(input, target);
  if (authMode === "password") {
    const password = await resolveSshCredential(pool, target, SSH_PASSWORD_ROLE, input);
    return { host, port, user, auth_mode: "password", password };
  }
  const privateKey = await resolveSshCredential(pool, target, SSH_KEY_ROLE, input);
  return { host, port, user, auth_mode: "private_key", privateKey };
}

function hardenedSshOptions({ usePassword = false } = {}) {
  const options = [
    "-T",
    "-o", `ConnectTimeout=${SSH_CONNECT_TIMEOUT_SECONDS}`,
    "-o", "ConnectionAttempts=1",
    "-o", `ServerAliveInterval=${SSH_SERVER_ALIVE_INTERVAL_SECONDS}`,
    "-o", `ServerAliveCountMax=${SSH_SERVER_ALIVE_COUNT_MAX}`,
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "LogLevel=ERROR",
  ];
  if (usePassword) {
    options.push("-o", "PreferredAuthentications=password", "-o", "PubkeyAuthentication=no", "-o", "NumberOfPasswordPrompts=1");
  } else {
    options.push("-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes");
  }
  return options;
}

function withCoreutilsTimeout(command, args = [], timeoutMs = DEFAULT_TIMEOUT_MS) {
  const seconds = Math.max(1, Math.ceil(Number(timeoutMs || DEFAULT_TIMEOUT_MS) / 1000));
  return {
    command: "timeout",
    args: ["-k", `${Math.ceil(SSH_PROCESS_KILL_GRACE_MS / 1000)}s`, `${seconds}s`, command, ...args],
  };
}

function killProcessTree(child, signal = "SIGTERM") {
  if (!child?.pid) return;
  try { process.kill(-child.pid, signal); return; } catch { /* fall back */ }
  try { child.kill(signal); } catch { /* noop */ }
}

export function buildRemoteDeployScript({ appPath, branch, expectedCommitSha, forceClean, restart }) {
  const safeAppPath = shellQuote(appPath);
  const safeBranch = shellQuote(branch);
  const safeSha = shellQuote(expectedCommitSha);
  const cleanBlock = forceClean
    ? "git reset --hard HEAD >/dev/null && git clean -fd >/dev/null"
    : "if [ -n \"$(git status --short)\" ]; then echo \"deploy_blocked_dirty_worktree\"; git status --short; exit 23; fi";
  const restartBlock = restart
    ? "mkdir -p tmp && (nohup sh -c 'sleep 5; touch tmp/restart.txt' >/dev/null 2>&1 </dev/null &) && echo \"restart_signal=scheduled:tmp/restart.txt\""
    : "echo \"restart_signal=not_requested\"";
  return [
    "set -euo pipefail",
    `cd ${safeAppPath}`,
    "before=$(git rev-parse HEAD)",
    "echo \"before_sha=$before\"",
    cleanBlock,
    `git fetch --prune origin ${safeBranch}`,
    `git cat-file -e ${safeSha}^{commit}`,
    `git checkout --detach ${safeSha}`,
    "after=$(git rev-parse HEAD)",
    "echo \"after_sha=$after\"",
    `test \"$after\" = ${safeSha}`,
    "echo \"worktree_status=$(git status --short | wc -l | tr -d ' ')\"",
    restartBlock,
    "echo \"deploy_result=ok\"",
  ].join(" && ");
}

function runSshCommand({ host, port, user, auth_mode: authMode = "private_key", privateKey, password, remoteScript, timeoutMs }) {
  return new Promise(async (resolve) => {
    const usePassword = authMode === "password";
    const tempDir = usePassword ? null : await mkdtemp(join(tmpdir(), "mad4b-hostinger-ssh-"));
    const keyFile = tempDir ? join(tempDir, "id_ed25519") : null;
    let settled = false;
    let child = null;
    const cleanup = async () => {
      if (!tempDir) return;
      try { await rm(tempDir, { recursive: true, force: true }); } catch { /* noop */ }
    };
    try {
      let command = "ssh";
      let args;
      let stdio = ["ignore", "pipe", "pipe"];
      if (usePassword) {
        command = "sshpass";
        args = [
          "-d", "3",
          "ssh",
          ...hardenedSshOptions({ usePassword: true }),
          "-p", String(port || 22),
          `${user}@${host}`,
          "bash",
          "-lc",
          remoteScript,
        ];
        stdio = ["ignore", "pipe", "pipe", "pipe"];
      } else {
        await writeFile(keyFile, privateKey, { mode: 0o600 });
        args = [
          "-i", keyFile,
          ...hardenedSshOptions({ usePassword: false }),
          "-p", String(port || 22),
          `${user}@${host}`,
          "bash",
          "-lc",
          remoteScript,
        ];
      }
      if (!usePassword) {
        const wrapped = withCoreutilsTimeout(command, args, timeoutMs);
        command = wrapped.command;
        args = wrapped.args;
      }
      child = spawn(command, args, { stdio, shell: false, detached: true });
      if (usePassword && child.stdio?.[3]) {
        child.stdio[3].end(`${password}\n`);
      }
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        killProcessTree(child, "SIGTERM");
        setTimeout(() => killProcessTree(child, "SIGKILL"), SSH_PROCESS_KILL_GRACE_MS).unref?.();
        cleanup().finally(() => resolve({ ok: false, exit_code: 124, timed_out: true, auth_mode: authMode, stdout: sanitizeSshOutput(stdout), stderr: sanitizeSshOutput(stderr) }));
      }, Number(timeoutMs || DEFAULT_TIMEOUT_MS) + SSH_PROCESS_KILL_GRACE_MS + 1000);
      child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
      child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const exitCode = Number(code);
        cleanup().finally(() => resolve({
          ok: exitCode === 0,
          exit_code: exitCode,
          timed_out: exitCode === 124,
          auth_mode: authMode,
          stdout: sanitizeSshOutput(stdout),
          stderr: sanitizeSshOutput(stderr),
        }));
      });
      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup().finally(() => resolve({ ok: false, exit_code: 127, timed_out: false, auth_mode: authMode, stdout: "", stderr: sanitizeSshOutput(err.message) }));
      });
    } catch (err) {
      if (!settled) {
        settled = true;
        await cleanup();
        resolve({ ok: false, exit_code: 1, timed_out: false, auth_mode: authMode, stdout: "", stderr: sanitizeSshOutput(err.message) });
      }
    }
  });
}

function buildRemoteProbeScript({ appPath, expectedCommitSha }) {
  const safeAppPath = shellQuote(appPath);
  const expectedCheck = expectedCommitSha
    ? `echo \"expected_sha=${shellQuote(expectedCommitSha).slice(1, -1)}\" && test \"$(git rev-parse HEAD)\" = ${shellQuote(expectedCommitSha)}`
    : "echo \"expected_sha=not_required\"";
  return [
    "set -euo pipefail",
    `cd ${safeAppPath}`,
    "echo \"probe_pwd=$(pwd)\"",
    "echo \"probe_host=$(hostname | tr -d '\\r\\n')\"",
    "echo \"git_head=$(git rev-parse HEAD)\"",
    "echo \"git_branch=$(git rev-parse --abbrev-ref HEAD)\"",
    "echo \"worktree_status_count=$(git status --short | wc -l | tr -d ' ')\"",
    "test -f package.json",
    "test -d routes",
    expectedCheck,
    "echo \"probe_result=ok\"",
  ].join(" && ");
}

function parseProbeOutput(stdout = "") {
  const out = {};
  for (const line of String(stdout || "").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (match) out[match[1]] = match[2];
  }
  return out;
}

export function buildHostingerDeployReloadVerification({ restart = true, parsed = {}, sshOk = false } = {}) {
  const restartSignal = String(parsed.restart_signal || "").trim();
  const deployResult = String(parsed.deploy_result || "").trim();
  const restartRequested = restart === true;
  const restartSignalScheduled = restartSignal === "scheduled:tmp/restart.txt";
  const restartSignalOk = !restartRequested || restartSignalScheduled || restartSignal === "tmp/restart.txt";
  const deployResultOk = deployResult === "ok";
  return {
    restart_requested: restartRequested,
    restart_signal: restartSignal || null,
    restart_signal_scheduled: restartSignalScheduled,
    restart_signal_ok: restartSignalOk,
    deploy_result: deployResult || null,
    deploy_result_ok: deployResultOk,
    files_updated: sshOk && deployResultOk,
    reload_signal_emitted: sshOk && restartRequested && restartSignalOk,
    runtime_health_readback_required: sshOk && restartRequested,
    status: !sshOk
      ? "ssh_deploy_failed"
      : !deployResultOk
        ? "deploy_result_missing_or_failed"
        : restartRequested && !restartSignalOk
          ? "deploy_reload_signal_missing"
          : restartSignalScheduled
            ? "restart_scheduled_pending_health_readback"
            : restartRequested
              ? "reload_signal_emitted_pending_health_readback"
              : "reload_not_requested",
    secrets_included: false,
  };
}

function buildHostingerDeployContinuationEvidence({
  targetId,
  appKey,
  appPath,
  branch,
  expectedCommitSha,
  restart,
  parsed = {},
  reloadVerification = {},
} = {}) {
  const checkpoint = createContinuationCheckpoint({
    operation_key: `hostinger_deploy_reload:${targetId || "unknown"}:${expectedCommitSha || "unknown"}`,
    resource_type: "hostinger_deploy_reload",
    actor_context: { actor_type: "admin" },
    resource_scope: {
      scope_type: "deployment",
      provider: "hostinger",
      target_id: targetId || null,
      app_key: appKey || null,
    },
    resource_state: {
      target_id: targetId || null,
      app_path: appPath || null,
      branch: branch || "main",
      expected_commit_sha: expectedCommitSha || null,
      parsed_deploy: parsed,
      reload_verification: reloadVerification,
    },
    interruption_signal: "deploy_reload_pending",
    stage: reloadVerification?.runtime_health_readback_required === true ? "verify" : "dry_run_repair",
    metadata: {
      adapter: "hostinger_deploy_reload",
      restart_requested: restart === true,
      requires_live_health_readback: reloadVerification?.runtime_health_readback_required === true,
      runbook: "http-generic-api/docs/hostinger-runtime-sync-runbook.md",
      secrets_included: false,
    },
  });
  const currentResourceState = {
    target_id: targetId || null,
    app_path: appPath || null,
    branch: branch || "main",
    expected_commit_sha: expectedCommitSha || null,
    parsed_deploy: parsed,
    reload_verification: reloadVerification,
    ...(reloadVerification?.runtime_health_readback_required === true ? { live_health_readback_pending: true } : {}),
  };
  const resume_plan = planContinuationResume({
    checkpoint,
    actor_context: { actor_type: "admin" },
    resource_scope: checkpoint.resource_scope,
    current_resource_state: currentResourceState,
    dry_run_result: { ok: reloadVerification?.files_updated === true, reload_verification: reloadVerification },
    verify_result: { ok: reloadVerification?.runtime_health_readback_required !== true, reload_verification: reloadVerification },
    apply_requested: false,
  });
  return { checkpoint, resume_plan, secrets_included: false };
}

export async function executeHostingerSshTargetProbe(input = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const env = deps.env || process.env;
  const targetId = compact(input.target_id || input.targetId, 64);
  const appKey = compact(input.app_key || input.appKey || "auth.mad4b.com", 191);
  const appPath = assertSafeRemotePath(input.app_path || input.appPath || (appKey === "auth.mad4b.com" ? DEFAULT_AUTH_APP_PATH : ""));
  const expectedCommitSha = compact(input.expected_commit_sha || input.expectedCommitSha || input.commit_sha || input.commitSha || "", 64).toLowerCase();
  const dryRun = input.dry_run === undefined ? true : bool(input.dry_run);
  const activateOnSuccess = bool(input.activate_on_success || input.activateOnSuccess);
  const approvalReason = compact(input.approval_reason || input.approvalReason || input.break_glass_reason || input.breakGlassReason, 1000);
  const timeoutMs = boundedInt(input.timeout_ms || input.timeoutMs, DEFAULT_PROBE_TIMEOUT_MS, 1000, MAX_PROBE_TIMEOUT_MS);
  const traceId = `hostinger_ssh_probe_${randomUUID()}`;

  if (!targetId) {
    const err = new Error("target_id is required.");
    err.status = 400;
    err.code = "remote_runtime_hosting_probe_target_required";
    throw err;
  }
  if (expectedCommitSha && !/^[0-9a-f]{40}$/.test(expectedCommitSha)) {
    const err = new Error("expected_commit_sha must be a 40-character git SHA when supplied.");
    err.status = 400;
    err.code = "remote_runtime_hosting_probe_sha_invalid";
    throw err;
  }
  if (!dryRun && approvalReason.length < 20) {
    const err = new Error("approval_reason/break_glass_reason with at least 20 characters is required for SSH probe execution.");
    err.status = 403;
    err.code = "remote_runtime_hosting_probe_approval_required";
    throw err;
  }

  const target = await loadTarget(pool, targetId);
  if (!target) {
    const err = new Error("Remote Runtime target was not found.");
    err.status = 404;
    err.code = "remote_runtime_target_not_found";
    throw err;
  }
  if (target.target_kind !== "hosting_account" || target.provider_family !== "hostinger") {
    const err = new Error("This probe only supports Hostinger hosting_account targets.");
    err.status = 409;
    err.code = "remote_runtime_hosting_probe_target_not_supported";
    throw err;
  }
  if (!Array.isArray(target.command_allowlist) || !target.command_allowlist.includes("ssh_probe")) {
    const err = new Error("Target does not allow ssh_probe.");
    err.status = 409;
    err.code = "remote_runtime_target_ssh_probe_not_allowed";
    throw err;
  }
  if (!pathAllowedByTarget(appPath, target)) {
    const err = new Error("app_path is outside target path allowlist.");
    err.status = 409;
    err.code = "remote_runtime_app_path_not_allowed";
    err.details = { app_path: appPath, path_allowlist: target.path_allowlist };
    throw err;
  }
  const sshAuthMode = preferredSshAuthMode(input, target);

  const plan = await planRemoteRuntimeDispatchDryRun({
    pool,
    targetId,
    commandKey: "ssh_probe",
    inputs: { app_key: appKey, app_path: appPath, expected_commit_sha: expectedCommitSha || null, activate_on_success: activateOnSuccess, ssh_auth_mode: sshAuthMode },
    approvalReason,
  });

  const baseResponse = {
    ok: true,
    plugin_key: "remote_ssh_runtime",
    execution_mode: "hostinger_ssh_target_probe",
    target_id: targetId,
    app_key: appKey,
    app_path: appPath,
    expected_commit_sha: expectedCommitSha || null,
    activate_on_success: activateOnSuccess,
    ssh_auth_mode: sshAuthMode,
    deployment_run_id: traceId,
    deployment_status: dryRun ? "planned" : "executing",
    dry_run: dryRun,
    will_execute: !dryRun,
    dispatch_plan: {
      dispatch_ready: plan.dispatch_ready,
      reason: plan.reason,
      checks: plan.checks,
    },
    secrets_included: false,
  };

  if (dryRun) {
    await writeExecutionEvidence({
      pool,
      traceId,
      entryType: "hostinger_ssh_target_probe_dry_run",
      executionClass: "remote_runtime_target_probe_plan",
      sourceLayer: "hostingerSshDeployExecutor",
      userInput: "hostinger ssh target probe dry-run",
      routeKeys: "remote_runtime_hosting_ssh_probe",
      selectedWorkflows: "hostinger_ssh_target_probe_dry_run",
      executionMode: "dry_run_only",
      decisionTrigger: "admin_tool",
      executionStatus: "success",
      outputSummary: { ...baseResponse, secrets_included: false },
      routeStatus: "dry_run_only",
      routeSource: "sql_primary",
      intakeValidationStatus: "validated",
      executionReadyStatus: plan.dispatch_ready ? "ready" : "degraded",
      logSource: "sql_primary",
    }).catch(() => null);
    return { ...baseResponse, execution: { will_execute: false, executed: false, reason: "dry_run_only" } };
  }

  const probeGate = await loadHostingerSshProbeGate(pool, targetId, env);
  if (!probeGate.enabled) {
    const err = new Error(`Hostinger SSH probe executor is disabled. Set ${PROBE_FLAG}=true or enable ${PROBE_DB_FLAG_KEY} only after approval and route readiness.`);
    err.status = 403;
    err.code = "remote_runtime_hostinger_ssh_probe_disabled";
    err.details = { flag: PROBE_FLAG, db_gate: probeGate, secrets_included: false };
    throw err;
  }

  const credentialTimeoutMs = Math.min(15000, Math.max(5000, timeoutMs - 5000));
  const sshConnection = await withPhaseTimeout(
    resolveSshConnectionCredentials(pool, target, input),
    { phase: "ssh_credential_resolution", timeoutMs: credentialTimeoutMs, details: { target_id: targetId, ssh_auth_mode: sshAuthMode } }
  );
  const remoteScript = buildRemoteProbeScript({ appPath, expectedCommitSha });
  const sshResult = await withPhaseTimeout(
    runSshCommand({ ...sshConnection, remoteScript, timeoutMs }),
    { phase: "ssh_command_execution", timeoutMs: timeoutMs + SSH_PROCESS_KILL_GRACE_MS + 2000, details: { target_id: targetId, ssh_auth_mode: sshAuthMode } }
  );
  const parsed = parseProbeOutput(sshResult.stdout);
  const probeOk = sshResult.ok && parsed.probe_result === "ok";

  if (probeOk && activateOnSuccess) {
    await pool.query(
      `UPDATE remote_runtime_targets
          SET status = 'active', validation_status = 'validated', updated_by = 'hostinger_ssh_target_probe', updated_at = CURRENT_TIMESTAMP
        WHERE target_id = ? AND plugin_key = 'remote_ssh_runtime'`,
      [targetId]
    );
  }

  await writeExecutionEvidence({
    pool,
    traceId,
    entryType: "hostinger_ssh_target_probe",
    executionClass: "remote_runtime_target_probe_execution",
    sourceLayer: "hostingerSshDeployExecutor",
    userInput: "hostinger ssh target probe",
    routeKeys: "remote_runtime_hosting_ssh_probe",
    selectedWorkflows: "hostinger_ssh_target_probe",
    executionMode: "approval_gated_readonly_ssh_probe",
    decisionTrigger: "admin_tool",
    executionStatus: probeOk ? "success" : "failed",
    outputSummary: {
      ...baseResponse,
      dry_run: false,
      executed: true,
      probe_ok: probeOk,
      activated_target: probeOk && activateOnSuccess,
      exit_code: sshResult.exit_code,
      timed_out: sshResult.timed_out,
      parsed_probe: parsed,
      stdout_preview: sshResult.stdout.slice(0, 2000),
      stderr_preview: sshResult.stderr.slice(0, 2000),
      secrets_included: false,
    },
    routeStatus: probeOk ? "executed" : "failed",
    routeSource: "sql_primary",
    intakeValidationStatus: "validated",
    executionReadyStatus: probeOk ? "complete" : "failed",
    failureReason: probeOk ? null : "ssh_probe_failed",
    logSource: "sql_primary",
  }).catch(() => null);

  return {
    ...baseResponse,
    ok: probeOk,
    dry_run: false,
    execution: {
      will_execute: true,
      executed: true,
      ssh_used: true,
      shell_freeform: false,
      readonly_probe_only: true,
      target_activated: probeOk && activateOnSuccess,
      exit_code: sshResult.exit_code,
      timed_out: sshResult.timed_out,
    },
    probe: {
      ok: probeOk,
      parsed,
      stdout: sshResult.stdout,
      stderr: sshResult.stderr,
      bounded: true,
    },
    secrets_included: false,
  };
}

export async function readHostingerSshDeployRunStatus(input = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const parityReader = deps.getRuntimeParity || getRuntimeParity;
  const deploymentRunId = compact(input.deployment_run_id || input.deploymentRunId, 255);
  if (!/^hostinger_ssh_deploy_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deploymentRunId)) {
    const err = new Error("deployment_run_id is invalid.");
    err.status = 400;
    err.code = "hostinger_deployment_run_id_invalid";
    throw err;
  }
  const rows = await safeQuery(
    pool,
    `SELECT execution_status, execution_ready_status, failure_reason, output_summary,
            request_id, created_at
       FROM execution_log
      WHERE execution_trace_id_writeback = ?
        AND entry_type = 'hostinger_ssh_deploy_release'
      ORDER BY id DESC
      LIMIT 1`,
    [deploymentRunId]
  );
  const row = rows[0];
  if (!row) {
    const err = new Error("Deployment run was not found.");
    err.status = 404;
    err.code = "hostinger_deployment_run_not_found";
    throw err;
  }
  const summary = parseJson(row.output_summary, {});
  const reloadVerification = summary.reload_verification || summary.deploy?.reload_verification || {};
  const expectedCommitSha = compact(summary.expected_commit_sha || summary.expectedCommitSha, 64).toLowerCase();
  let parity = { production_parity: "unknown", blocking_gap_count: null, secrets_included: false };
  try {
    parity = await parityReader("production");
  } catch (err) {
    parity = {
      production_parity: "unknown",
      blocking_gap_count: null,
      readback_error: compact(err?.message || "runtime parity unavailable", 240),
      secrets_included: false,
    };
  }
  const parityVerified = Boolean(
    expectedCommitSha
    && parity.production_parity === "verified"
    && Number(parity.blocking_gap_count || 0) === 0
    && String(parity.expected_commit_sha || "").toLowerCase() === expectedCommitSha
    && String(parity.deployed_commit_sha || "").toLowerCase() === expectedCommitSha
  );
  const failed = String(row.execution_status || "").toLowerCase() === "failed" || summary.executed === false;
  const healthReadbackRequired = reloadVerification.runtime_health_readback_required === true;
  const deploymentStatus = failed
    ? "failed"
    : parityVerified || !healthReadbackRequired
      ? "completed"
      : "accepted";
  return {
    ok: !failed,
    deployment_run_id: deploymentRunId,
    deployment_status: deploymentStatus,
    execution_status: row.execution_status || null,
    execution_ready_status: parityVerified ? "complete" : row.execution_ready_status || null,
    failure_reason: row.failure_reason || null,
    expected_commit_sha: expectedCommitSha || null,
    deployed_commit_sha: parity.deployed_commit_sha || null,
    restart_requested: reloadVerification.restart_requested === true,
    restart_signal: reloadVerification.restart_signal || null,
    restart_signal_scheduled: reloadVerification.restart_signal_scheduled === true,
    runtime_health_readback_required: healthReadbackRequired,
    runtime_parity: {
      production_parity: parity.production_parity || "unknown",
      blocking_gap_count: parity.blocking_gap_count ?? null,
      latest_run_id: parity.latest_run_id || null,
      verified_at: parity.verified_at || null,
      matches_expected_commit: parityVerified,
      secrets_included: false,
    },
    request_id: row.request_id || null,
    created_at: row.created_at || null,
    secrets_included: false,
  };
}

export async function executeHostingerSshDeployRelease(input = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const env = deps.env || process.env;
  const targetId = compact(input.target_id || input.targetId, 64);
  const branch = compact(input.branch || "main", 64);
  const expectedCommitSha = compact(input.expected_commit_sha || input.expectedCommitSha || input.commit_sha || input.commitSha, 64).toLowerCase();
  const appKey = compact(input.app_key || input.appKey || "auth.mad4b.com", 191);
  const appPath = assertSafeRemotePath(input.app_path || input.appPath || (appKey === "auth.mad4b.com" ? DEFAULT_AUTH_APP_PATH : ""));
  const dryRun = input.dry_run === undefined ? true : bool(input.dry_run);
  const forceClean = bool(input.force_clean || input.forceClean);
  const restart = input.restart === undefined ? true : bool(input.restart);
  const approvalReason = compact(input.approval_reason || input.approvalReason || input.break_glass_reason || input.breakGlassReason, 1000);
  const timeoutMs = boundedInt(input.timeout_ms || input.timeoutMs, DEFAULT_TIMEOUT_MS, 1000, MAX_TIMEOUT_MS);
  const traceId = `hostinger_ssh_deploy_${randomUUID()}`;

  if (!targetId) {
    const err = new Error("target_id is required.");
    err.status = 400;
    err.code = "remote_runtime_hosting_deploy_target_required";
    throw err;
  }
  if (!ALLOWED_BRANCHES.has(branch)) {
    const err = new Error("Only main branch deployment is supported by this executor.");
    err.status = 400;
    err.code = "remote_runtime_hosting_deploy_branch_not_allowed";
    throw err;
  }
  if (!/^[0-9a-f]{40}$/.test(expectedCommitSha)) {
    const err = new Error("expected_commit_sha must be a 40-character git SHA.");
    err.status = 400;
    err.code = "remote_runtime_hosting_deploy_sha_required";
    throw err;
  }
  if (!dryRun && approvalReason.length < 20) {
    const err = new Error("approval_reason/break_glass_reason with at least 20 characters is required for deployment.");
    err.status = 403;
    err.code = "remote_runtime_hosting_deploy_approval_required";
    throw err;
  }

  const target = await loadTarget(pool, targetId);
  if (!target) {
    const err = new Error("Remote Runtime target was not found.");
    err.status = 404;
    err.code = "remote_runtime_target_not_found";
    throw err;
  }
  if (target.target_kind !== "hosting_account" || target.provider_family !== "hostinger") {
    const err = new Error("This executor only supports Hostinger hosting_account targets.");
    err.status = 409;
    err.code = "remote_runtime_hosting_target_not_supported";
    throw err;
  }
  if (!Array.isArray(target.command_allowlist) || !target.command_allowlist.includes("deploy_release")) {
    const err = new Error("Target does not allow deploy_release.");
    err.status = 409;
    err.code = "remote_runtime_target_deploy_release_not_allowed";
    throw err;
  }
  if (!pathAllowedByTarget(appPath, target)) {
    const err = new Error("app_path is outside target path allowlist.");
    err.status = 409;
    err.code = "remote_runtime_app_path_not_allowed";
    err.details = { app_path: appPath, path_allowlist: target.path_allowlist };
    throw err;
  }
  const sshAuthMode = preferredSshAuthMode(input, target);

  const plan = await planRemoteRuntimeDispatchDryRun({
    pool,
    targetId,
    commandKey: "deploy_release",
    inputs: { app_key: appKey, app_path: appPath, branch, expected_commit_sha: expectedCommitSha, force_clean: forceClean, restart, ssh_auth_mode: sshAuthMode },
    approvalReason,
  });

  const baseResponse = {
    ok: true,
    plugin_key: "remote_ssh_runtime",
    execution_mode: "hostinger_ssh_deploy_release",
    target_id: targetId,
    app_key: appKey,
    app_path: appPath,
    branch,
    expected_commit_sha: expectedCommitSha,
    force_clean: forceClean,
    restart,
    ssh_auth_mode: sshAuthMode,
    dry_run: dryRun,
    will_execute: !dryRun,
    dispatch_plan: {
      dispatch_ready: plan.dispatch_ready,
      reason: plan.reason,
      checks: plan.checks,
    },
    secrets_included: false,
  };

  if (dryRun) {
    await writeExecutionEvidence({
      pool,
      traceId,
      entryType: "hostinger_ssh_deploy_release_dry_run",
      executionClass: "remote_runtime_deploy_plan",
      sourceLayer: "hostingerSshDeployExecutor",
      userInput: "hostinger ssh deploy release dry-run",
      routeKeys: "remote_runtime_hosting_deploy_release",
      selectedWorkflows: "hostinger_ssh_deploy_release_dry_run",
      executionMode: "dry_run_only",
      decisionTrigger: "admin_tool",
      executionStatus: "success",
      outputSummary: { ...baseResponse, dispatch_plan: baseResponse.dispatch_plan, secrets_included: false },
      routeStatus: "dry_run_only",
      routeSource: "sql_primary",
      intakeValidationStatus: "validated",
      executionReadyStatus: plan.dispatch_ready ? "ready" : "degraded",
      logSource: "sql_primary",
    }).catch(() => null);
    return {
      ...baseResponse,
      execution: { will_execute: false, executed: false, reason: "dry_run_only" },
    };
  }

  const executorGate = await loadHostingerSshExecutorGate(pool, targetId, env);
  if (!executorGate.enabled) {
    const err = new Error(`Hostinger SSH executor is disabled. Set ${EXECUTOR_FLAG}=true or enable ${EXECUTOR_DB_FLAG_KEY} only after approval and deployment readiness.`);
    err.status = 403;
    err.code = "remote_runtime_hostinger_ssh_executor_disabled";
    err.details = { flag: EXECUTOR_FLAG, db_gate: executorGate, secrets_included: false };
    throw err;
  }
  if (!plan.dispatch_ready) {
    const err = new Error("Remote Runtime dispatch dry-run is not ready for deploy_release.");
    err.status = 409;
    err.code = "remote_runtime_hosting_deploy_plan_not_ready";
    err.details = { reason: plan.reason, checks: plan.checks, secrets_included: false };
    throw err;
  }
  const envelope = await resolveCapabilityEnvelopeForHostingerDeploy({ pool, input, target, expectedCommitSha });
  await markCapabilityEnvelopeReferenced({ pool, envelopeId: envelope.envelope_id, executionRef: "hostinger_ssh_deploy_release" });

  const sshConnection = await resolveSshConnectionCredentials(pool, target, input);
  const remoteScript = buildRemoteDeployScript({ appPath, branch, expectedCommitSha, forceClean, restart });
  const sshResult = await runSshCommand({ ...sshConnection, remoteScript, timeoutMs });
  const parsedDeploy = parseProbeOutput(sshResult.stdout);
  const reloadVerification = buildHostingerDeployReloadVerification({ restart, parsed: parsedDeploy, sshOk: sshResult.ok });
  const continuation = buildHostingerDeployContinuationEvidence({
    targetId,
    appKey,
    appPath,
    branch,
    expectedCommitSha,
    restart,
    parsed: parsedDeploy,
    reloadVerification,
  });
  const deployOk = sshResult.ok && reloadVerification.deploy_result_ok && reloadVerification.restart_signal_ok;
  const status = deployOk ? "success" : "failed";

  await writeExecutionEvidence({
    pool,
    traceId,
    entryType: "hostinger_ssh_deploy_release",
    executionClass: "remote_runtime_deploy_execution",
    sourceLayer: "hostingerSshDeployExecutor",
    userInput: "hostinger ssh deploy release",
    routeKeys: "remote_runtime_hosting_deploy_release",
    selectedWorkflows: "hostinger_ssh_deploy_release",
    executionMode: "approval_gated_execute",
    decisionTrigger: "admin_tool",
    executionStatus: status,
    outputSummary: {
      ...baseResponse,
      dry_run: false,
      executed: deployOk,
      exit_code: sshResult.exit_code,
      timed_out: sshResult.timed_out,
      parsed_deploy: parsedDeploy,
      reload_verification: reloadVerification,
      continuation,
      stdout_preview: sshResult.stdout.slice(0, 2000),
      stderr_preview: sshResult.stderr.slice(0, 2000),
      secrets_included: false,
    },
    routeStatus: deployOk ? "executed" : "failed",
    routeSource: "sql_primary",
    intakeValidationStatus: "validated",
    executionReadyStatus: deployOk ? (reloadVerification.runtime_health_readback_required ? "pending_health_readback" : "complete") : "failed",
    failureReason: deployOk ? null : reloadVerification.status || "ssh_deploy_failed",
    logSource: "sql_primary",
  }).catch(() => null);

  const deploymentStatus = deployOk ? (restart ? "accepted" : "completed") : "failed";
  const httpStatus = deployOk ? (restart ? 202 : 200) : 502;
  return {
    ...baseResponse,
    ok: deployOk,
    deployment_run_id: traceId,
    deployment_status: deploymentStatus,
    http_status: httpStatus,
    dry_run: false,
    execution: {
      will_execute: true,
      executed: deployOk,
      ssh_used: true,
      shell_freeform: false,
      allowlisted_deploy_only: true,
      exit_code: sshResult.exit_code,
      timed_out: sshResult.timed_out,
    },
    deploy: {
      ok: deployOk,
      parsed: parsedDeploy,
      reload_verification: reloadVerification,
      continuation,
      live_ready: deployOk && reloadVerification.runtime_health_readback_required !== true,
    },
    readback: {
      required: restart,
      method: "GET",
      path: `/platform/remote-runtime/hosting/deploy-runs/${traceId}`,
      deployment_run_id: traceId,
      secrets_included: false,
    },
    output: {
      stdout: sshResult.stdout,
      stderr: sshResult.stderr,
      bounded: true,
    },
    secrets_included: false,
  };
}
