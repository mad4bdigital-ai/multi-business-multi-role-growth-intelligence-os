import { spawn } from "node:child_process";
import { promises as dns } from "node:dns";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { decryptCredentials } from "./tokenEncryption.js";
import { getPool } from "./db.js";

export const TENANT_SSH_CLI_EXECUTE_JOB_TYPE = "tenant_ssh_cli_allowlisted_execute";

const SSH_CLI_COMMAND_ALLOWLIST = Object.freeze({
  pwd: { command_key: "pwd", argv: ["pwd"] },
  whoami: { command_key: "whoami", argv: ["whoami"] },
  uname_s: { command_key: "uname_s", argv: ["uname", "-s"] },
  uptime: { command_key: "uptime", argv: ["uptime"] },
});

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function requiredCredential(credentials, key) {
  const value = credentials?.[key];
  if (value === undefined || value === null || String(value).trim() === "") {
    const err = new Error(`Missing required SSH credential field: ${key}`);
    err.status = 422;
    err.code = "missing_ssh_credential_field";
    err.details = { field: key };
    throw err;
  }
  return String(value);
}

function normalizePrivateKey(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  const withNewlines = text
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  return withNewlines.endsWith("\n") ? withNewlines : `${withNewlines}\n`;
}

function optionalCredential(credentials, key) {
  const value = credentials?.[key];
  if (value === null || value === undefined || String(value).trim() === "") return "";
  return String(value);
}

function looksLikePrivateKey(value = "") {
  return /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(String(value || ""));
}

function sshExecutionConfigFromConnection(row) {
  const credentials = decryptCredentials(row.encrypted_credentials);
  const rawPrivateKey = optionalCredential(credentials, "ssh_private_key");
  const rawPassword = optionalCredential(credentials, "ssh_password");
  const privateKey = normalizePrivateKey(rawPrivateKey);
  const password = rawPassword || (!looksLikePrivateKey(privateKey) ? rawPrivateKey : "");
  const authMethod = looksLikePrivateKey(privateKey) ? "private_key" : password ? "password" : "missing";
  if (authMethod === "missing") {
    const err = new Error("SSH authentication requires ssh_private_key or ssh_password.");
    err.status = 422;
    err.code = "missing_ssh_authentication_secret";
    throw err;
  }
  return {
    host: requiredCredential(credentials, "ssh_host"),
    port: clampInt(requiredCredential(credentials, "ssh_port"), 22, 1, 65535),
    user: requiredCredential(credentials, "ssh_user"),
    auth_method: authMethod,
    private_key: authMethod === "private_key" ? privateKey : "",
    password: authMethod === "password" ? password : "",
  };
}

function isBlockedProbeIp(ip = "") {
  const value = String(ip || "").trim().toLowerCase();
  if (!value) return true;
  if (value === "::1" || value === "0:0:0:0:0:0:0:1") return true;
  if (value.startsWith("127.")) return true;
  if (value.startsWith("10.")) return true;
  if (value.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(value)) return true;
  if (value.startsWith("169.254.")) return true;
  if (value === "localhost") return true;
  if (value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80:")) return true;
  return false;
}

async function resolvePublicSshAddress(host) {
  const cleanHost = String(host || "").trim();
  if (!cleanHost) {
    const err = new Error("ssh_host is required.");
    err.status = 422;
    err.code = "ssh_host_required";
    throw err;
  }
  if (net.isIP(cleanHost)) {
    if (isBlockedProbeIp(cleanHost)) {
      const err = new Error("SSH execution target resolves to a blocked private/local address.");
      err.status = 409;
      err.code = "ssh_target_blocked_private_address";
      throw err;
    }
    return cleanHost;
  }
  const records = await dns.lookup(cleanHost, { all: true, verbatim: false });
  const firstPublic = records.find((record) => record?.address && !isBlockedProbeIp(record.address));
  if (!firstPublic) {
    const err = new Error("SSH execution target did not resolve to a public address.");
    err.status = 409;
    err.code = "ssh_target_no_public_address";
    throw err;
  }
  return firstPublic.address;
}

function loadPlan(commandKey) {
  const plan = SSH_CLI_COMMAND_ALLOWLIST[String(commandKey || "").trim()];
  if (!plan) {
    const err = new Error("command_key is not allowlisted.");
    err.status = 400;
    err.code = "ssh_cli_command_not_allowlisted";
    throw err;
  }
  return plan;
}

function redactExecutionOutput(text, secrets = []) {
  let value = String(text || "");
  for (const secret of secrets) {
    const token = String(secret || "");
    if (token && token.length >= 6) value = value.split(token).join("[redacted]");
  }
  return value;
}

function capOutput(text, maxChars = 4096) {
  const value = String(text || "");
  return { text: value.slice(0, maxChars), truncated: value.length > maxChars };
}

async function loadTenantSshConnection(pool, payload) {
  const [rows] = await pool.query(
    `SELECT connection_id, tenant_id, user_id, app_key, auth_type, display_label, account_label,
            status, validation_status, encrypted_credentials, connected_at, last_validated_at, last_used_at
       FROM user_app_connections
      WHERE connection_id = ? AND tenant_id = ? AND user_id = ? AND auth_type = 'ssh_key_pair'
      LIMIT 1`,
    [payload.connection_id, payload.tenant_id, payload.user_id]
  );
  const row = rows?.[0];
  if (!row) {
    const err = new Error("SSH connection was not found for this tenant/user.");
    err.status = 404;
    err.code = "ssh_connection_not_found";
    throw err;
  }
  if (row.status !== "active") {
    const err = new Error("SSH connection is not active.");
    err.status = 409;
    err.code = "ssh_connection_not_active";
    throw err;
  }
  return row;
}

async function loadApprovalRequest(pool, payload) {
  const [rows] = await pool.query(
    `SELECT r.request_id, r.hold_id, r.tenant_id, r.user_id, r.connection_id,
            r.command_key, r.command_argv_json, r.status, r.expires_at,
            h.status AS hold_status
       FROM tenant_ssh_cli_approval_requests r
       LEFT JOIN approval_holds h
         ON h.hold_id COLLATE utf8mb4_unicode_ci = r.hold_id
        AND h.tenant_id COLLATE utf8mb4_unicode_ci = r.tenant_id
      WHERE r.request_id = ? AND r.tenant_id = ? AND r.user_id = ?
      LIMIT 1`,
    [payload.approval_request_id, payload.tenant_id, payload.user_id]
  );
  const row = rows?.[0];
  if (!row) {
    const err = new Error("Approval request was not found for this tenant/user.");
    err.status = 404;
    err.code = "approval_request_not_found";
    throw err;
  }
  return row;
}

function assertApprovalMatches(row, approval, commandKey) {
  const plan = loadPlan(commandKey);
  if (approval.connection_id !== row.connection_id) {
    const err = new Error("Approval request does not match this SSH connection.");
    err.status = 409;
    err.code = "approval_connection_mismatch";
    throw err;
  }
  if (approval.status !== "approved" || approval.hold_status !== "approved") {
    const err = new Error("SSH CLI execution requires an approved approval request.");
    err.status = 409;
    err.code = "approval_not_approved";
    throw err;
  }
  if (approval.command_key !== plan.command_key) {
    const err = new Error("Approval request command_key does not match requested command_key.");
    err.status = 409;
    err.code = "approval_command_mismatch";
    throw err;
  }
  if (JSON.stringify(JSON.parse(approval.command_argv_json || "[]")) !== JSON.stringify(plan.argv)) {
    const err = new Error("Approval request argv no longer matches the allowlisted command plan.");
    err.status = 409;
    err.code = "approval_argv_mismatch";
    throw err;
  }
  if (approval.expires_at && new Date(approval.expires_at).getTime() <= Date.now()) {
    const err = new Error("Approval request has expired.");
    err.status = 409;
    err.code = "approval_request_expired";
    throw err;
  }
  return plan;
}

function safeConnection(row) {
  return {
    connection_id: row.connection_id,
    tenant_id: row.tenant_id,
    user_id: row.user_id,
    app_key: row.app_key,
    auth_type: row.auth_type,
    display_label: row.display_label,
    account_label: row.account_label,
    status: row.status,
    validation_status: row.validation_status,
    connected_at: row.connected_at,
    last_validated_at: row.last_validated_at,
    last_used_at: row.last_used_at,
  };
}

async function spawnSshCommand(cfg, plan, timeoutMs) {
  const address = await resolvePublicSshAddress(cfg.host);
  const started_at = new Date().toISOString();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "tenant-ssh-worker-"));
  const keyPath = path.join(tempDir, "id_key");
  await writeFile(keyPath, cfg.private_key, { mode: 0o600 });
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const sshArgs = [
      "-i", keyPath,
      "-p", String(cfg.port),
      "-o", "BatchMode=yes",
      "-o", "ConnectTimeout=8",
      "-o", "StrictHostKeyChecking=no",
      "-o", "UserKnownHostsFile=/dev/null",
      "-o", "LogLevel=ERROR",
      `${cfg.user}@${address}`,
      "--",
      ...plan.argv,
    ];
    const cleanup = () => rm(tempDir, { recursive: true, force: true }).catch(() => {});
    const child = spawn("ssh", sshArgs, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 500).unref?.();
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      resolve({
        ok: false,
        error_code: error?.code === "ENOENT" ? "ssh_cli_runtime_unavailable" : "ssh_cli_spawn_failed",
        message: error?.code === "ENOENT" ? "ssh binary is not available on this worker runtime." : "SSH process could not be started.",
        command_key: plan.command_key,
        command_argv: plan.argv,
        command_executed: false,
        timed_out: false,
        timeout_ms: timeoutMs,
        started_at,
        finished_at: new Date().toISOString(),
        host_key_verified: false,
        secrets_included: false,
      });
    });
    child.on("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      const redactedStdout = capOutput(redactExecutionOutput(stdout, [cfg.private_key, cfg.user]));
      const redactedStderr = capOutput(redactExecutionOutput(stderr, [cfg.private_key, cfg.user]));
      resolve({
        ok: exitCode === 0 && !timedOut,
        command_key: plan.command_key,
        command_argv: plan.argv,
        exit_code: exitCode,
        signal,
        timed_out: timedOut,
        timeout_ms: timeoutMs,
        started_at,
        finished_at: new Date().toISOString(),
        command_executed: exitCode !== null && !timedOut,
        host_key_verified: false,
        stdout: redactedStdout.text,
        stderr: redactedStderr.text,
        stdout_truncated: redactedStdout.truncated,
        stderr_truncated: redactedStderr.truncated,
        secrets_included: false,
      });
    });
  });
}

export async function runTenantSshCliExecuteJob(jobPayload = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const payload = jobPayload && typeof jobPayload === "object" ? jobPayload : {};
  try {
    const row = await loadTenantSshConnection(pool, payload);
    const approval = await loadApprovalRequest(pool, payload);
    const plan = assertApprovalMatches(row, approval, payload.command_key);
    const cfg = sshExecutionConfigFromConnection(row);
    const timeoutMs = clampInt(payload.timeout_ms, 5000, 1000, 10000);
    const execution = await spawnSshCommand(cfg, plan, timeoutMs);
    await pool.query(
      `UPDATE user_app_connections SET last_used_at = CURRENT_TIMESTAMP WHERE connection_id = ? AND tenant_id = ? AND user_id = ?`,
      [row.connection_id, row.tenant_id, row.user_id]
    ).catch(() => {});
    return {
      ok: execution.ok,
      kind: "ssh",
      source: TENANT_SSH_CLI_EXECUTE_JOB_TYPE,
      worker_job_id: payload.worker_job_id || null,
      execution_id: randomUUID(),
      connection: safeConnection(row),
      approval_request: {
        request_id: approval.request_id,
        status: approval.status,
        hold_status: approval.hold_status,
        command_key: approval.command_key,
        execution_enabled: true,
        secrets_included: false,
      },
      execution,
      secrets_included: false,
    };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: err.code || "tenant_ssh_cli_execute_worker_failed",
        message: err.message || String(err),
        details: err.details || null,
      },
      secrets_included: false,
    };
  }
}
