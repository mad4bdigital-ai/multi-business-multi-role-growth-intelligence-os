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

const DEFAULT_TIMEOUT_MS = 120000;
const MAX_TIMEOUT_MS = 300000;
const EXECUTOR_FLAG = "REMOTE_RUNTIME_HOSTINGER_SSH_EXECUTOR_ENABLED";
const PROBE_FLAG = "REMOTE_RUNTIME_HOSTINGER_SSH_PROBE_ENABLED";
const ALLOWED_BRANCHES = new Set(["main"]);
const DEFAULT_AUTH_APP_PATH = "/home/u338416126/domains/auth.mad4b.com/nodejs";
const SSH_ROLES = ["ssh_host", "ssh_port", "ssh_user", "ssh_private_key"];

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

async function resolveSshCredential(pool, target, role) {
  const result = await resolveEffectiveCredential({
    tenantId: target.tenant_id,
    userId: target.user_id || undefined,
    systemId: target.system_id || undefined,
    credentialRole: role,
    includeSecret: true,
    allowPlatformFallback: true,
  }, { pool });
  if (result?.status !== "resolved" || !compact(result.secret, 20000)) {
    const err = new Error(`Required SSH credential ${role} is not resolved.`);
    err.status = 409;
    err.code = "remote_runtime_ssh_credential_not_resolved";
    err.details = { role, status: result?.status || "missing" };
    throw err;
  }
  return String(result.secret);
}

function buildRemoteDeployScript({ appPath, branch, expectedCommitSha, forceClean, restart }) {
  const safeAppPath = shellQuote(appPath);
  const safeBranch = shellQuote(branch);
  const safeSha = shellQuote(expectedCommitSha);
  const cleanBlock = forceClean
    ? "git reset --hard HEAD >/dev/null && git clean -fd >/dev/null"
    : "if [ -n \"$(git status --short)\" ]; then echo \"deploy_blocked_dirty_worktree\"; git status --short; exit 23; fi";
  const restartBlock = restart
    ? "mkdir -p tmp && touch tmp/restart.txt && echo \"restart_signal=tmp/restart.txt\""
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

function runSshDeploy({ host, port, user, privateKey, remoteScript, timeoutMs }) {
  return new Promise(async (resolve) => {
    const tempDir = await mkdtemp(join(tmpdir(), "mad4b-hostinger-ssh-"));
    const keyFile = join(tempDir, "id_ed25519");
    let settled = false;
    let child = null;
    const cleanup = async () => {
      try { await rm(tempDir, { recursive: true, force: true }); } catch { /* noop */ }
    };
    try {
      await writeFile(keyFile, privateKey, { mode: 0o600 });
      const args = [
        "-i", keyFile,
        "-p", String(port || 22),
        "-o", "BatchMode=yes",
        "-o", "IdentitiesOnly=yes",
        "-o", "StrictHostKeyChecking=accept-new",
        `${user}@${host}`,
        "bash",
        "-lc",
        remoteScript,
      ];
      child = spawn("ssh", args, { stdio: ["ignore", "pipe", "pipe"], shell: false });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { child.kill("SIGTERM"); } catch { /* noop */ }
        cleanup().finally(() => resolve({ ok: false, exit_code: 124, timed_out: true, stdout: sanitizeSshOutput(stdout), stderr: sanitizeSshOutput(stderr) }));
      }, timeoutMs);
      child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
      child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup().finally(() => resolve({
          ok: Number(code) === 0,
          exit_code: Number(code),
          timed_out: false,
          stdout: sanitizeSshOutput(stdout),
          stderr: sanitizeSshOutput(stderr),
        }));
      });
      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup().finally(() => resolve({ ok: false, exit_code: 127, timed_out: false, stdout: "", stderr: sanitizeSshOutput(err.message) }));
      });
    } catch (err) {
      if (!settled) {
        settled = true;
        await cleanup();
        resolve({ ok: false, exit_code: 1, timed_out: false, stdout: "", stderr: sanitizeSshOutput(err.message) });
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
  const timeoutMs = boundedInt(input.timeout_ms || input.timeoutMs, 60000, 1000, MAX_TIMEOUT_MS);
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

  const plan = await planRemoteRuntimeDispatchDryRun({
    pool,
    targetId,
    commandKey: "ssh_probe",
    inputs: { app_key: appKey, app_path: appPath, expected_commit_sha: expectedCommitSha || null, activate_on_success: activateOnSuccess },
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

  if (env[PROBE_FLAG] !== "true") {
    const err = new Error(`Hostinger SSH probe executor is disabled. Set ${PROBE_FLAG}=true only after approval and route readiness.`);
    err.status = 403;
    err.code = "remote_runtime_hostinger_ssh_probe_disabled";
    err.details = { flag: PROBE_FLAG, secrets_included: false };
    throw err;
  }

  const [host, port, user, privateKey] = await Promise.all(SSH_ROLES.map((role) => resolveSshCredential(pool, target, role)));
  const remoteScript = buildRemoteProbeScript({ appPath, expectedCommitSha });
  const sshResult = await runSshDeploy({ host, port, user, privateKey, remoteScript, timeoutMs });
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

  const plan = await planRemoteRuntimeDispatchDryRun({
    pool,
    targetId,
    commandKey: "deploy_release",
    inputs: { app_key: appKey, app_path: appPath, branch, expected_commit_sha: expectedCommitSha, force_clean: forceClean, restart },
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

  if (env[EXECUTOR_FLAG] !== "true") {
    const err = new Error(`Hostinger SSH executor is disabled. Set ${EXECUTOR_FLAG}=true only after approval and deployment readiness.`);
    err.status = 403;
    err.code = "remote_runtime_hostinger_ssh_executor_disabled";
    err.details = { flag: EXECUTOR_FLAG, secrets_included: false };
    throw err;
  }
  if (!plan.dispatch_ready) {
    const err = new Error("Remote Runtime dispatch dry-run is not ready for deploy_release.");
    err.status = 409;
    err.code = "remote_runtime_hosting_deploy_plan_not_ready";
    err.details = { reason: plan.reason, checks: plan.checks, secrets_included: false };
    throw err;
  }

  const [host, port, user, privateKey] = await Promise.all(SSH_ROLES.map((role) => resolveSshCredential(pool, target, role)));
  const remoteScript = buildRemoteDeployScript({ appPath, branch, expectedCommitSha, forceClean, restart });
  const sshResult = await runSshDeploy({ host, port, user, privateKey, remoteScript, timeoutMs });
  const status = sshResult.ok ? "success" : "failed";

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
      executed: sshResult.ok,
      exit_code: sshResult.exit_code,
      timed_out: sshResult.timed_out,
      stdout_preview: sshResult.stdout.slice(0, 2000),
      stderr_preview: sshResult.stderr.slice(0, 2000),
      secrets_included: false,
    },
    routeStatus: sshResult.ok ? "executed" : "failed",
    routeSource: "sql_primary",
    intakeValidationStatus: "validated",
    executionReadyStatus: sshResult.ok ? "complete" : "failed",
    failureReason: sshResult.ok ? null : "ssh_deploy_failed",
    logSource: "sql_primary",
  }).catch(() => null);

  return {
    ...baseResponse,
    ok: sshResult.ok,
    dry_run: false,
    execution: {
      will_execute: true,
      executed: sshResult.ok,
      ssh_used: true,
      shell_freeform: false,
      allowlisted_deploy_only: true,
      exit_code: sshResult.exit_code,
      timed_out: sshResult.timed_out,
    },
    output: {
      stdout: sshResult.stdout,
      stderr: sshResult.stderr,
      bounded: true,
    },
    secrets_included: false,
  };
}
