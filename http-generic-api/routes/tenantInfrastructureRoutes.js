import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as dns } from "node:dns";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { Router } from "express";
import jwt from "jsonwebtoken";
import mysql from "mysql2/promise";
import { getPool } from "../db.js";
import { decryptCredentials } from "../tokenEncryption.js";

function verifyUserJwt(authorization) {
  if (!authorization || !authorization.startsWith("Bearer ")) return null;
  try {
    return jwt.verify(authorization.slice(7), process.env.JWT_SECRET || "dev-secret");
  } catch {
    return null;
  }
}

function requireUserJwt(req, res, next) {
  if (req.auth?.mode === "user_jwt") return next();
  const payload = verifyUserJwt(req.headers.authorization);
  if (!payload || !payload.user_id) {
    return res.status(401).json({ ok: false, error: { code: "user_jwt_required", message: "Sign in required." }, secrets_included: false });
  }
  req.auth = { mode: "user_jwt", user_id: payload.user_id, tenant_id: payload.tenant_id, is_admin: false };
  return next();
}

function normalizeAuthKind(kind) {
  const value = String(kind || "").trim().toLowerCase();
  if (["database", "db", "remote_database", "mysql"].includes(value)) return "remote_database";
  if (["ssh", "ssh_key_pair", "remote_ssh_runtime"].includes(value)) return "ssh_key_pair";
  return value;
}

function expectedAppKey(authType) {
  if (authType === "remote_database") return "remote_mysql_database";
  if (authType === "ssh_key_pair") return "remote_ssh_runtime";
  return null;
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

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function safeIdentifierLike(value, maxLength = 128) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (!/^[A-Za-z0-9_$%*.-]+$/.test(text) || text.length > maxLength) {
    const err = new Error("Filter contains unsupported characters.");
    err.status = 400;
    err.code = "invalid_schema_filter";
    throw err;
  }
  return text.replace(/\*/g, "%");
}

function requiredCredential(credentials, key) {
  const value = credentials?.[key];
  if (value === null || value === undefined || String(value).trim() === "") {
    const err = new Error(`${key} is missing from the encrypted credential payload.`);
    err.status = 422;
    err.code = "missing_database_credential_field";
    throw err;
  }
  return String(value).trim();
}

function databaseConfigFromConnection(row) {
  const credentials = decryptCredentials(row.encrypted_credentials);
  return {
    host: requiredCredential(credentials, "db_host"),
    port: clampInt(requiredCredential(credentials, "db_port"), 3306, 1, 65535),
    database: requiredCredential(credentials, "db_name"),
    user: requiredCredential(credentials, "db_user"),
    password: requiredCredential(credentials, "db_password"),
  };
}

function optionalCredential(credentials, key) {
  const value = credentials?.[key];
  if (value === null || value === undefined || String(value).trim() === "") return "";
  return String(value);
}

function looksLikePrivateKey(value = "") {
  return /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(String(value || ""));
}

function sshConfigFromConnection(row) {
  const credentials = decryptCredentials(row.encrypted_credentials);
  const privateKey = optionalCredential(credentials, "ssh_private_key");
  const explicitPassword = optionalCredential(credentials, "ssh_password");
  const passwordFallback = privateKey && !looksLikePrivateKey(privateKey) ? privateKey : "";
  const passwordPresent = Boolean(explicitPassword || passwordFallback);
  const privateKeyPresent = looksLikePrivateKey(privateKey);
  return {
    host: requiredCredential(credentials, "ssh_host"),
    port: clampInt(requiredCredential(credentials, "ssh_port"), 22, 1, 65535),
    user_present: Boolean(requiredCredential(credentials, "ssh_user")),
    private_key_present: privateKeyPresent,
    password_present: passwordPresent,
    authentication_secret_present: privateKeyPresent || passwordPresent,
    auth_method: privateKeyPresent ? "private_key" : passwordPresent ? "password" : "missing",
  };
}

function sshExecutionConfigFromConnection(row) {
  const credentials = decryptCredentials(row.encrypted_credentials);
  return {
    host: requiredCredential(credentials, "ssh_host"),
    port: clampInt(requiredCredential(credentials, "ssh_port"), 22, 1, 65535),
    user: requiredCredential(credentials, "ssh_user"),
    private_key: requiredCredential(credentials, "ssh_private_key"),
  };
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

function assertApprovedSshCliExecution(row, approvalRow, commandKey) {
  const plan = buildSshCliDryRunPlan({ command_key: commandKey });
  if (approvalRow.connection_id !== row.connection_id) {
    const err = new Error("Approval request does not match this SSH connection.");
    err.status = 409;
    err.code = "approval_connection_mismatch";
    throw err;
  }
  if (approvalRow.status !== "approved" || approvalRow.hold_status !== "approved") {
    const err = new Error("SSH CLI execution requires an approved approval request.");
    err.status = 409;
    err.code = "approval_not_approved";
    throw err;
  }
  if (approvalRow.command_key !== plan.command_key) {
    const err = new Error("Approval request command_key does not match requested command_key.");
    err.status = 409;
    err.code = "approval_command_mismatch";
    throw err;
  }
  const approvedArgv = JSON.stringify(JSON.parse(approvalRow.command_argv_json || "[]"));
  if (approvedArgv !== JSON.stringify(plan.argv)) {
    const err = new Error("Approval request argv no longer matches the allowlisted command plan.");
    err.status = 409;
    err.code = "approval_argv_mismatch";
    throw err;
  }
  if (approvalRow.expires_at && new Date(approvalRow.expires_at).getTime() <= Date.now()) {
    const err = new Error("Approval request has expired.");
    err.status = 409;
    err.code = "approval_request_expired";
    throw err;
  }
  return plan;
}

async function loadSshCliExecuteRuntimeConfig(pool) {
  const [rows] = await pool.query(
    `SELECT config_json, status FROM platform_runtime_config WHERE config_key = 'tenant_ssh_cli_execute_runtime' LIMIT 1`
  );
  const row = rows?.[0];
  if (!row || row.status !== "active") return { enabled: false, driver: "disabled" };
  try {
    return JSON.parse(row.config_json || "{}");
  } catch {
    return { enabled: false, driver: "invalid_config" };
  }
}

async function assertSshCliExecuteRuntimeEnabled(pool) {
  const config = await loadSshCliExecuteRuntimeConfig(pool);
  const enabled = config?.enabled === true;
  const driver = String(config?.driver || "").toLowerCase();
  if (enabled && driver === "host_ssh_spawn") {
    const err = new Error("Tenant SSH CLI host_ssh_spawn is blocked on the web runtime after live 502 validation.");
    err.status = 503;
    err.code = "ssh_cli_execute_driver_blocked_on_web_host";
    err.details = {
      config_key: "tenant_ssh_cli_execute_runtime",
      current_driver: driver,
      blocked_reason: "host_ssh_spawn_caused_cloudflare_502_on_web_host",
      required_driver: "dedicated_worker_or_connector_runtime",
      secrets_included: false,
    };
    throw err;
  }
  if (!enabled || driver !== "dedicated_worker_or_connector_runtime") {
    const err = new Error("Tenant SSH CLI execution runtime is not enabled on a dedicated worker or connector runtime.");
    err.status = 503;
    err.code = "ssh_cli_execute_runtime_not_enabled";
    err.details = {
      required_config_key: "tenant_ssh_cli_execute_runtime",
      required_config_json: { enabled: true, driver: "dedicated_worker_or_connector_runtime" },
      current_driver: driver || "disabled",
      recommended_runtime: "dedicated_worker_or_connector_runtime",
    };
    throw err;
  }
  const err = new Error("Tenant SSH CLI dedicated execution driver is not implemented in the web runtime.");
  err.status = 503;
  err.code = "ssh_cli_execute_dedicated_driver_not_implemented";
  err.details = { required_driver: "dedicated_worker_or_connector_runtime", secrets_included: false };
  throw err;
}

async function executeApprovedSshCli(pool, row, approvalRow, commandKey, options = {}) {
  await assertSshCliExecuteRuntimeEnabled(pool);
  const cfg = sshExecutionConfigFromConnection(row);
  const plan = assertApprovedSshCliExecution(row, approvalRow, commandKey);
  const address = await resolvePublicProbeAddress(cfg.host);
  const timeout_ms = clampInt(options.timeout_ms, 5000, 1000, 10000);
  const started_at = new Date().toISOString();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "tenant-ssh-"));
  const keyPath = path.join(tempDir, "id_key");
  await writeFile(keyPath, cfg.private_key, { mode: 0o600 });
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
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
    const child = spawn("ssh", sshArgs, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 500).unref?.();
    }, timeout_ms);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => {
      clearTimeout(timer);
      rm(tempDir, { recursive: true, force: true }).catch(() => {});
      resolve({
        ok: false,
        error_code: error?.code === "ENOENT" ? "ssh_cli_runtime_unavailable" : "ssh_cli_spawn_failed",
        message: error?.code === "ENOENT" ? "ssh binary is not available on this runtime." : "SSH process could not be started.",
        command_key: plan.command_key,
        command_argv: plan.argv,
        authenticated_ssh: false,
        command_executed: false,
        timed_out: false,
        timeout_ms,
        started_at,
        finished_at: new Date().toISOString(),
        host_key_verified: false,
        secrets_included: false,
      });
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      rm(tempDir, { recursive: true, force: true }).catch(() => {});
      const redactedStdout = capOutput(redactExecutionOutput(stdout, [cfg.private_key, cfg.user]));
      const redactedStderr = capOutput(redactExecutionOutput(stderr, [cfg.private_key, cfg.user]));
      resolve({
        ok: exitCode === 0 && !timedOut,
        command_key: plan.command_key,
        command_argv: plan.argv,
        exit_code: exitCode,
        signal,
        timed_out: timedOut,
        timeout_ms,
        started_at,
        finished_at: new Date().toISOString(),
        authenticated_ssh: exitCode !== null,
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

function isBlockedProbeIp(ip = "") {
  const value = String(ip || "").toLowerCase();
  if (!value) return true;
  if (value === "::1" || value === "0:0:0:0:0:0:0:1" || value === "0.0.0.0") return true;
  if (value.startsWith("127.") || value.startsWith("10.") || value.startsWith("169.254.")) return true;
  if (value.startsWith("192.168.")) return true;
  const parts = value.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length === 4 && parts.every(Number.isFinite) && parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80:")) return true;
  return false;
}

async function resolvePublicProbeAddress(host) {
  const value = String(host || "").trim();
  if (!value) {
    const err = new Error("ssh_host is required.");
    err.status = 422;
    err.code = "missing_ssh_credential_field";
    throw err;
  }
  const addresses = net.isIP(value) ? [{ address: value }] : await dns.lookup(value, { all: true, verbatim: false });
  if (!addresses.length || addresses.some((entry) => isBlockedProbeIp(entry.address))) {
    const err = new Error("SSH probe target resolves to a blocked or private address.");
    err.status = 400;
    err.code = "ssh_probe_target_blocked";
    throw err;
  }
  return addresses[0].address;
}

const SSH_CLI_DRY_RUN_ALLOWLIST = Object.freeze({
  pwd: { argv: ["pwd"], description: "Print current working directory", risk: "low", permission: "file_read" },
  whoami: { argv: ["whoami"], description: "Print remote username", risk: "low", permission: "shell_read" },
  uname_s: { argv: ["uname", "-s"], description: "Print kernel/system name", risk: "low", permission: "shell_read" },
  uptime: { argv: ["uptime"], description: "Print system uptime", risk: "low", permission: "shell_read" },
});

const SHELL_ARG_METACHARACTER = /[;&|`$<>()[\]{}\\\r\n]/;

function assertAllowlistedArgvIsTypedAndLiteral(commandKey, argv = []) {
  if (!Array.isArray(argv) || argv.length === 0) {
    const err = new Error("Allowlisted SSH command argv must be a non-empty typed argument array.");
    err.status = 500;
    err.code = "ssh_cli_allowlist_argv_invalid";
    throw err;
  }
  for (const arg of argv) {
    const value = String(arg || "");
    if (!value || SHELL_ARG_METACHARACTER.test(value)) {
      const err = new Error("Allowlisted SSH command argv contains unsupported shell metacharacters.");
      err.status = 500;
      err.code = "ssh_cli_allowlist_argv_metacharacter";
      err.details = { command_key: commandKey, secrets_included: false };
      throw err;
    }
  }
}

function buildSshCliDryRunPlan(options = {}) {
  const commandKey = String(options.command_key || "").trim();
  if (!commandKey) {
    const err = new Error("command_key is required.");
    err.status = 400;
    err.code = "ssh_cli_command_key_required";
    throw err;
  }
  const command = SSH_CLI_DRY_RUN_ALLOWLIST[commandKey];
  if (!command) {
    const err = new Error("command_key is not allowlisted for tenant SSH CLI dry-run.");
    err.status = 400;
    err.code = "ssh_cli_command_not_allowlisted";
    err.details = { allowed_command_keys: Object.keys(SSH_CLI_DRY_RUN_ALLOWLIST) };
    throw err;
  }
  assertAllowlistedArgvIsTypedAndLiteral(commandKey, command.argv);
  return {
    command_key: commandKey,
    description: command.description,
    risk: command.risk,
    permission: command.permission,
    argv: command.argv,
    will_decrypt_credentials: false,
    will_authenticate_ssh: false,
    will_open_network_connection: false,
    will_execute_command: false,
    execution_enabled: false,
    next_required_tool: "tenant_ssh_cli_allowlisted_execute_not_enabled_yet",
    secrets_included: false,
  };
}

function sanitizeApprovalRequest(row) {
  return {
    request_id: row.request_id,
    hold_id: row.hold_id,
    tenant_id: row.tenant_id,
    user_id: row.user_id,
    connection_id: row.connection_id,
    command_key: row.command_key,
    command_argv: JSON.parse(row.command_argv_json || "[]"),
    status: row.status,
    hold_status: row.hold_status,
    required_role: row.required_role,
    requested_by: row.requested_by,
    decision_by: row.decision_by,
    decision_note: row.decision_note,
    expires_at: row.expires_at,
    decided_at: row.decided_at,
    created_at: row.created_at,
    execution_enabled: false,
    secrets_included: false,
  };
}

async function loadSshCliApprovalRequest(pool, req, requestId) {
  const [rows] = await pool.query(
    `SELECT r.request_id, r.hold_id, r.tenant_id, r.user_id, r.connection_id,
            r.command_key, r.command_argv_json, r.status, r.decision_by,
            r.decision_note, r.expires_at, r.decided_at, r.created_at,
            h.status AS hold_status, h.required_role, h.requested_by
       FROM tenant_ssh_cli_approval_requests r
       LEFT JOIN approval_holds h
         ON h.hold_id COLLATE utf8mb4_unicode_ci = r.hold_id
        AND h.tenant_id COLLATE utf8mb4_unicode_ci = r.tenant_id
      WHERE r.request_id = ? AND r.tenant_id = ?
      LIMIT 1`,
    [requestId, req.auth.tenant_id]
  );
  const row = rows?.[0];
  if (!row) {
    const err = new Error("Approval request was not found for this tenant.");
    err.status = 404;
    err.code = "approval_request_not_found";
    throw err;
  }
  return row;
}

async function assertWorkspaceApprovalRole(pool, req) {
  const [rows] = await pool.query(
    `SELECT role, status FROM memberships WHERE tenant_id = ? AND user_id = ? AND status = 'active' LIMIT 1`,
    [req.auth.tenant_id, req.auth.user_id]
  );
  const role = String(rows?.[0]?.role || "").toLowerCase();
  if (!["owner", "workspace_owner", "admin"].includes(role)) {
    const err = new Error("Workspace owner approval is required for SSH CLI approval decisions.");
    err.status = 403;
    err.code = "workspace_owner_approval_required";
    throw err;
  }
  return role;
}

function normalizeApprovalDecision(value) {
  const decision = String(value || "").trim().toLowerCase();
  if (!["approved", "rejected"].includes(decision)) {
    const err = new Error("decision must be approved or rejected.");
    err.status = 400;
    err.code = "invalid_approval_decision";
    throw err;
  }
  return decision;
}

function normalizeDecisionNote(value) {
  return String(value || "").trim().slice(0, 512);
}

async function withInfrastructureTransaction(pool, work) {
  const connection = pool && typeof pool.getConnection === "function" ? await pool.getConnection() : pool;
  const transactional = connection && typeof connection.beginTransaction === "function";
  try {
    if (transactional) await connection.beginTransaction();
    const result = await work(connection);
    if (transactional) await connection.commit();
    return result;
  } catch (cause) {
    if (transactional && typeof connection.rollback === "function") await connection.rollback();
    throw cause;
  } finally {
    if (connection !== pool && typeof connection?.release === "function") connection.release();
  }
}

async function decideSshCliApprovalRequest(pool, req, requestId, body = {}) {
  return withInfrastructureTransaction(pool, async (connection) => { // MUTATION_TRANSACTION: tenant_ssh_cli_approval_request_decide
    const row = await loadSshCliApprovalRequest(connection, req, requestId);
    await assertWorkspaceApprovalRole(connection, req);
    if (row.status !== "open" || row.hold_status !== "open") {
      const err = new Error("Approval request is not open.");
      err.status = 409;
      err.code = "approval_request_not_open";
      throw err;
    }
    const decision = normalizeApprovalDecision(body.decision);
    const note = normalizeDecisionNote(body.decision_note);
    const [requestResult] = await connection.query(
      `UPDATE tenant_ssh_cli_approval_requests
          SET status = ?, decision_by = ?, decision_note = ?, decided_at = CURRENT_TIMESTAMP
        WHERE request_id = ? AND tenant_id = ? AND status = 'open'`,
      [decision, req.auth.user_id, note || null, requestId, req.auth.tenant_id]
    );
    if (requestResult.affectedRows !== 1) throw Object.assign(new Error("Approval request decision changed concurrently."), { status: 409, code: "approval_request_state_changed" });
    const [holdResult] = await connection.query(
      `UPDATE approval_holds
          SET status = ?, decision_by = ?, decision_note = ?, decided_at = CURRENT_TIMESTAMP
        WHERE hold_id COLLATE utf8mb4_unicode_ci = ? AND tenant_id COLLATE utf8mb4_unicode_ci = ? AND status = 'open'`,
      [decision, req.auth.user_id, note || null, row.hold_id, req.auth.tenant_id]
    );
    if (holdResult.affectedRows !== 1) throw Object.assign(new Error("Approval hold decision changed concurrently."), { status: 409, code: "approval_hold_state_changed" });
    const readback = sanitizeApprovalRequest(await loadSshCliApprovalRequest(connection, req, requestId)); // MUTATION_READBACK: tenant_ssh_cli_approval_request_decide
    if (readback.status !== decision || readback.hold_status !== decision || readback.decision_by !== req.auth.user_id) throw Object.assign(new Error("Approval decision readback did not match the requested state."), { status: 409, code: "approval_request_decision_readback_mismatch" });
    return readback;
  });
}

async function createSshCliApprovalRequest(pool, req, row, plan) {
  return withInfrastructureTransaction(pool, async (connection) => { // MUTATION_TRANSACTION: tenant_ssh_cli_approval_request_create
    const requestId = randomUUID();
    const holdId = randomUUID();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const executionContextJson = JSON.stringify({
      source: "tenant_infrastructure_routes",
      parent_table: "tenant_ssh_cli_approval_requests",
      request_id: requestId,
      hold_id: holdId,
      connection_id: row.connection_id,
      command_key: plan.command_key,
      relationship_status: "resolved_parent_reference",
      secrets_included: false,
    });
    await connection.query(
      `INSERT INTO tenant_ssh_cli_approval_requests
         (request_id, hold_id, tenant_id, user_id, connection_id, command_key, command_argv_json, status, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
      [requestId, holdId, req.auth.tenant_id, req.auth.user_id, row.connection_id, plan.command_key, JSON.stringify(plan.argv), expiresAt]
    );
    await connection.query(
      `INSERT INTO approval_holds
         (hold_id, run_id, tenant_id, user_id, actor_id, actor_type,
          request_id, correlation_id, execution_context_json,
          hold_type, requested_by, required_role, status, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'supervisor_approval', ?, 'workspace_owner', 'open', ?)`,
      [holdId, requestId, req.auth.tenant_id, req.auth.user_id, req.auth.user_id, req.auth.user_id ? "user" : "system", requestId, requestId, executionContextJson, req.auth.user_id, expiresAt]
    );
    const readback = sanitizeApprovalRequest(await loadSshCliApprovalRequest(connection, req, requestId)); // MUTATION_READBACK: tenant_ssh_cli_approval_request_create
    if (readback.request_id !== requestId || readback.hold_id !== holdId || readback.status !== "open" || readback.hold_status !== "open") throw Object.assign(new Error("Approval request creation readback did not resolve the persisted request and hold."), { status: 409, code: "approval_request_create_readback_mismatch" });
    return {
      ...readback,
      command_argv: plan.argv,
      execution_enabled: false,
      next_step: "approval_decision_required_before_execute",
      secrets_included: false,
    };
  });
}

async function probeSshTcpBanner(row, options = {}) {
  const cfg = sshConfigFromConnection(row);
  const timeout_ms = clampInt(options.timeout_ms, 5000, 1000, 10000);
  const address = await resolvePublicProbeAddress(cfg.host);
  return new Promise((resolve) => {
    let settled = false;
    let banner = "";
    const started_at = new Date().toISOString();
    const socket = net.createConnection({ host: address, port: cfg.port });
    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({
        tcp_connected: false,
        ssh_banner_detected: false,
        authenticated: false,
        command_executed: false,
        private_key_used_for_auth: false,
        timeout_ms,
        started_at,
        finished_at: new Date().toISOString(),
        user_present: cfg.user_present,
        private_key_present: cfg.private_key_present,
        secrets_included: false,
        ...result,
      });
    };
    socket.setTimeout(timeout_ms);
    socket.on("connect", () => {
      setTimeout(() => finish({
        tcp_connected: true,
        ssh_banner_detected: /^SSH-/.test(banner),
        protocol_hint: /^SSH-/.test(banner) ? "ssh" : "unknown",
      }), Math.min(750, timeout_ms));
    });
    socket.on("data", (chunk) => {
      banner += chunk.toString("utf8").slice(0, 256);
      finish({
        tcp_connected: true,
        ssh_banner_detected: /^SSH-/.test(banner),
        protocol_hint: /^SSH-/.test(banner) ? "ssh" : "unknown",
      });
    });
    socket.on("timeout", () => finish({ tcp_connected: true, timed_out_waiting_for_banner: true, protocol_hint: "unknown" }));
    socket.on("error", (error) => finish({ tcp_connected: false, failure_code: error?.code || "ssh_probe_connect_failed" }));
  });
}

function validateReadonlySql(sql) {
  const text = String(sql || "").trim();
  if (!text) {
    const err = new Error("sql is required.");
    err.status = 400;
    err.code = "sql_required";
    throw err;
  }
  if (text.length > 6000) {
    const err = new Error("sql is too long for the read-only query tool.");
    err.status = 400;
    err.code = "sql_too_long";
    throw err;
  }
  if (!/^select\b/i.test(text)) {
    const err = new Error("Only SELECT statements are allowed.");
    err.status = 400;
    err.code = "readonly_sql_select_only";
    throw err;
  }
  const forbiddenPatterns = [
    /;/,
    /--/,
    /\/\*/,
    /\*\//,
    /#/,
    /\?/,
    /\b(insert|update|delete|drop|alter|create|truncate|replace|merge|grant|revoke|call|execute|prepare|load|handler|lock|unlock|set|show|describe|explain|analyze|optimize|repair|use|start|commit|rollback)\b/i,
    /\b(sleep|benchmark|load_file)\s*\(/i,
    /\binto\s+(out|dump)file\b/i,
  ];
  if (forbiddenPatterns.some((pattern) => pattern.test(text))) {
    const err = new Error("SQL contains a blocked token for the read-only query tool.");
    err.status = 400;
    err.code = "readonly_sql_blocked_token";
    throw err;
  }
  if (/\bselect\s+\*/i.test(text) || /,\s*\*/.test(text)) {
    const err = new Error("SELECT * is not allowed. Choose explicit non-sensitive columns.");
    err.status = 400;
    err.code = "readonly_sql_explicit_columns_required";
    throw err;
  }
  const secretLikeSql = /\b(password|passwd|secret|token|credential|credentials|encrypted_credentials|private_key|client_secret|api_key|access_token|refresh_token|authorization)\b/i;
  if (secretLikeSql.test(text)) {
    const err = new Error("SQL references a secret-like field or token.");
    err.status = 400;
    err.code = "readonly_sql_secret_like_reference_blocked";
    throw err;
  }
  return text;
}

function assertSafeReadonlyFields(fields = []) {
  const secretLikeField = /(^|_)(password|passwd|secret|token|credential|credentials|private_key|client_secret|api_key|access_token|refresh_token|authorization)($|_)/i;
  const blocked = fields.map((field) => field?.name || "").filter((name) => secretLikeField.test(name));
  if (blocked.length) {
    const err = new Error("Read-only query selected secret-like columns.");
    err.status = 400;
    err.code = "readonly_query_secret_like_column_blocked";
    err.details = blocked;
    throw err;
  }
}

function sanitizeReadonlyValue(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Buffer.isBuffer(value)) return `[binary:${value.length}]`;
  return value;
}

function sanitizeReadonlyRow(row) {
  return Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [key, sanitizeReadonlyValue(value)]));
}

async function executeReadonlyDatabaseQuery(row, options = {}) {
  const cfg = databaseConfigFromConnection(row);
  const sql = validateReadonlySql(options.sql);
  const limit = clampInt(options.limit, 25, 1, 100);
  let connection;
  try {
    connection = await mysql.createConnection({
      host: cfg.host,
      port: cfg.port,
      database: cfg.database,
      user: cfg.user,
      password: cfg.password,
      connectTimeout: 8000,
      multipleStatements: false,
      namedPlaceholders: false,
    });
    await connection.query("SET SESSION TRANSACTION READ ONLY").catch(() => {});
    await connection.query("SET SESSION MAX_EXECUTION_TIME=5000").catch(() => {});
    const wrappedSql = `SELECT tenant_readonly_query.* FROM (${sql}) AS tenant_readonly_query LIMIT ?`;
    const [rows, fields] = await connection.execute(wrappedSql, [limit]);
    assertSafeReadonlyFields(fields || []);
    return {
      database: cfg.database,
      read_only: true,
      limit,
      row_count: rows.length,
      columns: (fields || []).map((field) => ({ name: field.name, column_type: field.columnType })),
      rows: rows.map(sanitizeReadonlyRow),
      secrets_included: false,
    };
  } finally {
    if (connection) await connection.end().catch(() => {});
  }
}

function sanitizeColumn(row) {
  return {
    table_schema: row.TABLE_SCHEMA,
    table_name: row.TABLE_NAME,
    column_name: row.COLUMN_NAME,
    ordinal_position: row.ORDINAL_POSITION,
    data_type: row.DATA_TYPE,
    column_type: row.COLUMN_TYPE,
    is_nullable: row.IS_NULLABLE,
    column_key: row.COLUMN_KEY || "",
    extra: row.EXTRA || "",
  };
}

async function readRemoteDatabaseSchema(row, options = {}) {
  const cfg = databaseConfigFromConnection(row);
  const tableFilter = safeIdentifierLike(options.table || options.table_like || "");
  const limit = clampInt(options.limit, 100, 1, 500);
  let connection;
  try {
    connection = await mysql.createConnection({
      host: cfg.host,
      port: cfg.port,
      database: cfg.database,
      user: cfg.user,
      password: cfg.password,
      connectTimeout: 8000,
      multipleStatements: false,
      namedPlaceholders: false,
    });
    await connection.query("SET SESSION TRANSACTION READ ONLY").catch(() => {});
    const params = [cfg.database];
    let filterSql = "";
    if (tableFilter) {
      filterSql = " AND c.TABLE_NAME LIKE ?";
      params.push(tableFilter);
    }
    params.push(limit);
    const [columns] = await connection.execute(
      `SELECT c.TABLE_SCHEMA, c.TABLE_NAME, c.COLUMN_NAME, c.ORDINAL_POSITION,
              c.DATA_TYPE, c.COLUMN_TYPE, c.IS_NULLABLE, c.COLUMN_KEY, c.EXTRA
         FROM information_schema.COLUMNS c
        WHERE c.TABLE_SCHEMA = ?${filterSql}
        ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION
        LIMIT ?`,
      params
    );
    const tableNames = [...new Set(columns.map((item) => item.TABLE_NAME))];
    return {
      database: cfg.database,
      table_count_returned: tableNames.length,
      column_count_returned: columns.length,
      limit,
      tables: tableNames.map((tableName) => ({
        table_name: tableName,
        columns: columns.filter((item) => item.TABLE_NAME === tableName).map(sanitizeColumn),
      })),
      secrets_included: false,
    };
  } finally {
    if (connection) await connection.end().catch(() => {});
  }
}

function readinessFor(row, expectedAuthType) {
  const checks = {
    tenant_scoped: Boolean(row?.tenant_id && row?.user_id),
    connection_active: row?.status === "active",
    auth_type_matches: row?.auth_type === expectedAuthType,
    app_key_matches: row?.app_key === expectedAppKey(expectedAuthType),
    credentials_present: Boolean(row?.encrypted_credentials),
    not_revoked: row?.status !== "revoked",
  };
  const ready = Object.values(checks).every(Boolean);
  const blocked = Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key);
  return {
    ready,
    checks,
    blocked_reasons: blocked,
    execution_enabled: false,
    execution_next_step: expectedAuthType === "ssh_key_pair"
      ? "tenant_ssh_cli_approval_required_before_allowlisted_execute"
      : "tenant_database_runtime_tools_enabled_read_only",
    secrets_included: false,
  };
}

async function loadTenantConnection(pool, req, connectionId, expectedAuthType) {
  if (!req.auth?.tenant_id) {
    const err = new Error("A tenant-scoped user JWT is required.");
    err.status = 401;
    err.code = "tenant_auth_required";
    throw err;
  }
  const [rows] = await pool.query(
    `SELECT connection_id, user_id, tenant_id, app_key, auth_type, display_label,
            account_label, encrypted_credentials, status, validation_status,
            connected_at, last_validated_at, last_used_at
       FROM user_app_connections
      WHERE connection_id = ?
        AND tenant_id = ?
        AND user_id = ?
      LIMIT 1`,
    [connectionId, req.auth.tenant_id, req.auth.user_id]
  );
  const row = rows?.[0];
  if (!row) {
    const err = new Error("Connection was not found for this caller.");
    err.status = 404;
    err.code = "connection_not_found";
    throw err;
  }
  if (row.auth_type !== expectedAuthType) {
    const err = new Error(`Connection auth_type ${row.auth_type} is not ${expectedAuthType}.`);
    err.status = 409;
    err.code = "connection_auth_type_mismatch";
    throw err;
  }
  return row;
}

export function buildTenantInfrastructureRoutes(deps = {}) {
  const router = Router();
  const pool = deps.pool || getPool();
  const executionFacade = deps.executionFacade || null;

  async function sendStatus(req, res, authType) {
    try {
      const connectionId = String(req.params.connection_id || "").trim();
      if (!connectionId) return res.status(400).json({ ok: false, error: { code: "connection_id_required", message: "connection_id is required." }, secrets_included: false });
      const row = await loadTenantConnection(pool, req, connectionId, authType);
      return res.json({
        ok: true,
        kind: authType === "ssh_key_pair" ? "ssh" : "database",
        connection: safeConnection(row),
        readiness: readinessFor(row, authType),
        secrets_included: false,
      });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "tenant_infrastructure_status_failed", message: err.message }, secrets_included: false });
    }
  }

  async function sendPreflight(req, res, authType) {
    try {
      const connectionId = String(req.params.connection_id || "").trim();
      if (!connectionId) return res.status(400).json({ ok: false, error: { code: "connection_id_required", message: "connection_id is required." }, secrets_included: false });
      const row = await loadTenantConnection(pool, req, connectionId, authType);
      const readiness = readinessFor(row, authType);
      return res.json({
        ok: true,
        dry_run: true,
        will_decrypt_credentials: false,
        will_open_network_connection: false,
        will_execute_command: false,
        will_query_database: false,
        kind: authType === "ssh_key_pair" ? "ssh" : "database",
        connection: safeConnection(row),
        readiness,
        allowed_next_tools: authType === "ssh_key_pair"
          ? ["tenant_ssh_connection_status", "tenant_ssh_preflight"]
          : ["tenant_database_connection_status", "tenant_database_preflight"],
        blocked_runtime_tools: authType === "ssh_key_pair"
          ? ["tenant_ssh_cli_allowlisted_execute"]
          : ["tenant_database_schema_read", "tenant_database_query_readonly"],
        secrets_included: false,
      });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "tenant_infrastructure_preflight_failed", message: err.message }, secrets_included: false });
    }
  }

  router.get("/me/infrastructure/database/connections/:connection_id/status", requireUserJwt, (req, res) => sendStatus(req, res, "remote_database"));
  router.post("/me/infrastructure/database/connections/:connection_id/preflight", requireUserJwt, (req, res) => sendPreflight(req, res, "remote_database"));
  router.post("/me/infrastructure/database/connections/:connection_id/query-readonly", requireUserJwt, async (req, res) => {
    try {
      const connectionId = String(req.params.connection_id || "").trim();
      if (!connectionId) return res.status(400).json({ ok: false, error: { code: "connection_id_required", message: "connection_id is required." }, secrets_included: false });
      const row = await loadTenantConnection(pool, req, connectionId, "remote_database");
      const readiness = readinessFor(row, "remote_database");
      if (!readiness.ready) {
        return res.status(409).json({ ok: false, error: { code: "database_connection_not_ready", message: "Database connection is not ready for read-only query execution.", details: readiness.blocked_reasons }, readiness, secrets_included: false });
      }
      const result = await executeReadonlyDatabaseQuery(row, req.body || {});
      return res.json({
        ok: true,
        kind: "database",
        read_only: true,
        source: "tenant_database_query_readonly",
        connection: safeConnection(row),
        result,
        secrets_included: false,
      });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "tenant_database_query_readonly_failed", message: err.message, details: err.details }, secrets_included: false });
    }
  });
  router.get("/me/infrastructure/database/connections/:connection_id/schema", requireUserJwt, async (req, res) => {
    try {
      const connectionId = String(req.params.connection_id || "").trim();
      if (!connectionId) return res.status(400).json({ ok: false, error: { code: "connection_id_required", message: "connection_id is required." }, secrets_included: false });
      const row = await loadTenantConnection(pool, req, connectionId, "remote_database");
      const readiness = readinessFor(row, "remote_database");
      if (!readiness.ready) {
        return res.status(409).json({ ok: false, error: { code: "database_connection_not_ready", message: "Database connection is not ready for schema read.", details: readiness.blocked_reasons }, readiness, secrets_included: false });
      }
      const schema = await readRemoteDatabaseSchema(row, req.query || {});
      return res.json({
        ok: true,
        kind: "database",
        read_only: true,
        source: "information_schema",
        connection: safeConnection(row),
        schema,
        secrets_included: false,
      });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "tenant_database_schema_read_failed", message: err.message }, secrets_included: false });
    }
  });
  router.get("/me/infrastructure/ssh/connections/:connection_id/status", requireUserJwt, (req, res) => sendStatus(req, res, "ssh_key_pair"));
  router.post("/me/infrastructure/ssh/connections/:connection_id/preflight", requireUserJwt, (req, res) => sendPreflight(req, res, "ssh_key_pair"));
  router.get("/me/infrastructure/ssh/cli/approval-requests/:request_id", requireUserJwt, async (req, res) => {
    try {
      const requestId = String(req.params.request_id || "").trim();
      if (!requestId) return res.status(400).json({ ok: false, error: { code: "request_id_required", message: "request_id is required." }, secrets_included: false });
      const approval_request = sanitizeApprovalRequest(await loadSshCliApprovalRequest(pool, req, requestId));
      return res.json({ ok: true, kind: "ssh", approval_request, execution_enabled: false, secrets_included: false });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "tenant_ssh_cli_approval_status_failed", message: err.message }, secrets_included: false });
    }
  });

  router.post("/me/infrastructure/ssh/cli/approval-requests/:request_id/decision", requireUserJwt, async (req, res) => {
    try {
      const requestId = String(req.params.request_id || "").trim();
      if (!requestId) return res.status(400).json({ ok: false, error: { code: "request_id_required", message: "request_id is required." }, secrets_included: false });
      const approval_request = await decideSshCliApprovalRequest(pool, req, requestId, req.body || {});
      return res.json({ ok: true, kind: "ssh", approval_request, execution_enabled: false, execute_tool_enabled: false, secrets_included: false });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "tenant_ssh_cli_approval_decision_failed", message: err.message }, secrets_included: false });
    }
  });

  router.post("/me/infrastructure/ssh/connections/:connection_id/cli/execute", requireUserJwt, async (req, res) => {
    try {
      const connectionId = String(req.params.connection_id || "").trim();
      const approvalRequestId = String(req.body?.approval_request_id || req.body?.request_id || "").trim();
      const commandKey = String(req.body?.command_key || "").trim();
      if (!connectionId) return res.status(400).json({ ok: false, error: { code: "connection_id_required", message: "connection_id is required." }, secrets_included: false });
      if (!approvalRequestId) return res.status(400).json({ ok: false, error: { code: "approval_request_id_required", message: "approval_request_id is required." }, secrets_included: false });
      const row = await loadTenantConnection(pool, req, connectionId, "ssh_key_pair");
      const readiness = readinessFor(row, "ssh_key_pair");
      if (!readiness.ready) {
        return res.status(409).json({ ok: false, error: { code: "ssh_connection_not_ready", message: "SSH connection is not ready for CLI execution.", details: readiness.blocked_reasons }, readiness, secrets_included: false });
      }
      const approvalRow = await loadSshCliApprovalRequest(pool, req, approvalRequestId);
      const effectiveCommandKey = commandKey || approvalRow.command_key;
      assertApprovedSshCliExecution(row, approvalRow, effectiveCommandKey);
      const runtimeConfig = await loadSshCliExecuteRuntimeConfig(pool);
      const runtimeDriver = String(runtimeConfig?.driver || "").toLowerCase();
      if (runtimeConfig?.enabled === true && runtimeDriver === "dedicated_worker_or_connector_runtime") {
        if (!executionFacade || typeof executionFacade.submitJob !== "function") {
          return res.status(503).json({ ok: false, error: { code: "tenant_ssh_execute_job_submission_unavailable", message: "Execution job submission is unavailable." }, secrets_included: false });
        }
        const { status, body } = await executionFacade.submitJob({
          job_type: "tenant_ssh_cli_allowlisted_execute",
          request_payload: {
            connection_id: connectionId,
            approval_request_id: approvalRequestId,
            command_key: effectiveCommandKey,
            tenant_id: req.auth.tenant_id,
            user_id: req.auth.user_id,
            timeout_ms: req.body?.timeout_ms,
            secrets_included: false,
          },
          max_attempts: 1,
          idempotency_key: `tenant_ssh_cli_execute:${approvalRequestId}:${effectiveCommandKey}`,
        }, req.auth.user_id, `tenant_ssh_cli_execute:${approvalRequestId}:${effectiveCommandKey}`);
        return res.status(status).json({
          ...body,
          ok: status >= 200 && status < 300,
          kind: "ssh",
          source: "tenant_ssh_cli_allowlisted_execute",
          queued_for_dedicated_worker: true,
          connection: safeConnection(row),
          approval_request: sanitizeApprovalRequest(approvalRow),
          result_url: body?.job_id ? `/me/infrastructure/ssh/connections/${connectionId}/cli/execute-jobs/${body.job_id}/result` : undefined,
          secrets_included: false,
        });
      }
      const execution = await executeApprovedSshCli(pool, row, approvalRow, effectiveCommandKey, req.body || {});
      return res.status(execution.ok ? 200 : 502).json({
        ok: execution.ok,
        kind: "ssh",
        source: "tenant_ssh_cli_allowlisted_execute",
        connection: safeConnection(row),
        approval_request: sanitizeApprovalRequest(approvalRow),
        execution,
        secrets_included: false,
      });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "tenant_ssh_cli_execute_failed", message: err.message, details: err.details }, secrets_included: false });
    }
  });

  router.get("/me/infrastructure/ssh/connections/:connection_id/cli/execute-jobs/:job_id/result", requireUserJwt, async (req, res) => {
    try {
      if (!executionFacade || typeof executionFacade.getJob !== "function" || typeof executionFacade.pollJobResult !== "function") {
        return res.status(503).json({ ok: false, error: { code: "tenant_ssh_execute_job_status_unavailable", message: "Execution job status is unavailable." }, secrets_included: false });
      }
      const connectionId = String(req.params.connection_id || "").trim();
      const jobId = String(req.params.job_id || "").trim();
      if (!connectionId) return res.status(400).json({ ok: false, error: { code: "connection_id_required", message: "connection_id is required." }, secrets_included: false });
      if (!jobId) return res.status(400).json({ ok: false, error: { code: "job_id_required", message: "job_id is required." }, secrets_included: false });
      const jobRead = await executionFacade.getJob(jobId);
      if (jobRead.status >= 400) return res.status(jobRead.status).json({ ...jobRead.body, secrets_included: false });
      if (jobRead.body?.target_key !== connectionId || jobRead.body?.requested_by !== req.auth.user_id || jobRead.body?.job_type !== "tenant_ssh_cli_allowlisted_execute") {
        return res.status(404).json({ ok: false, error: { code: "tenant_ssh_execute_job_not_found", message: "Execution job was not found for this tenant connection." }, secrets_included: false });
      }
      const polled = await executionFacade.pollJobResult(jobId);
      return res.status(polled.status).json({ ...polled.body, kind: "ssh", source: "tenant_ssh_cli_allowlisted_execute", secrets_included: false });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "tenant_ssh_execute_job_result_failed", message: err.message }, secrets_included: false });
    }
  });

  router.post("/me/infrastructure/ssh/connections/:connection_id/cli/approval-request", requireUserJwt, async (req, res) => {
    try {
      const connectionId = String(req.params.connection_id || "").trim();
      if (!connectionId) return res.status(400).json({ ok: false, error: { code: "connection_id_required", message: "connection_id is required." }, secrets_included: false });
      const row = await loadTenantConnection(pool, req, connectionId, "ssh_key_pair");
      const readiness = readinessFor(row, "ssh_key_pair");
      if (!readiness.ready) {
        return res.status(409).json({ ok: false, error: { code: "ssh_connection_not_ready", message: "SSH connection is not ready for CLI approval request.", details: readiness.blocked_reasons }, readiness, secrets_included: false });
      }
      const plan = buildSshCliDryRunPlan(req.body || {});
      const approval_request = await createSshCliApprovalRequest(pool, req, row, plan);
      return res.status(201).json({
        ok: true,
        kind: "ssh",
        approval_required: true,
        execution_enabled: false,
        connection: safeConnection(row),
        plan,
        approval_request,
        secrets_included: false,
      });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "tenant_ssh_cli_approval_request_failed", message: err.message, details: err.details }, secrets_included: false });
    }
  });
  router.post("/me/infrastructure/ssh/connections/:connection_id/cli/dry-run", requireUserJwt, async (req, res) => {
    try {
      const connectionId = String(req.params.connection_id || "").trim();
      if (!connectionId) return res.status(400).json({ ok: false, error: { code: "connection_id_required", message: "connection_id is required." }, secrets_included: false });
      const row = await loadTenantConnection(pool, req, connectionId, "ssh_key_pair");
      const readiness = readinessFor(row, "ssh_key_pair");
      if (!readiness.ready) {
        return res.status(409).json({ ok: false, error: { code: "ssh_connection_not_ready", message: "SSH connection is not ready for CLI dry-run.", details: readiness.blocked_reasons }, readiness, secrets_included: false });
      }
      const plan = buildSshCliDryRunPlan(req.body || {});
      return res.json({
        ok: true,
        kind: "ssh",
        dry_run: true,
        connection: safeConnection(row),
        plan,
        secrets_included: false,
      });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "tenant_ssh_cli_dry_run_failed", message: err.message, details: err.details }, secrets_included: false });
    }
  });
  router.post("/me/infrastructure/ssh/connections/:connection_id/probe", requireUserJwt, async (req, res) => {
    try {
      const connectionId = String(req.params.connection_id || "").trim();
      if (!connectionId) return res.status(400).json({ ok: false, error: { code: "connection_id_required", message: "connection_id is required." }, secrets_included: false });
      const row = await loadTenantConnection(pool, req, connectionId, "ssh_key_pair");
      const readiness = readinessFor(row, "ssh_key_pair");
      if (!readiness.ready) {
        return res.status(409).json({ ok: false, error: { code: "ssh_connection_not_ready", message: "SSH connection is not ready for probe.", details: readiness.blocked_reasons }, readiness, secrets_included: false });
      }
      const probe = await probeSshTcpBanner(row, req.body || {});
      return res.json({
        ok: true,
        kind: "ssh",
        probe_type: "tcp_banner",
        authenticated: false,
        command_executed: false,
        connection: safeConnection(row),
        probe,
        secrets_included: false,
      });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "tenant_ssh_probe_failed", message: err.message }, secrets_included: false });
    }
  });

  router.get("/me/infrastructure/connections/:connection_id/status", requireUserJwt, async (req, res) => {
    try {
      const connectionId = String(req.params.connection_id || "").trim();
      const authType = normalizeAuthKind(req.query.auth_type || req.query.kind);
      if (!connectionId) return res.status(400).json({ ok: false, error: { code: "connection_id_required", message: "connection_id is required." }, secrets_included: false });
      if (!["remote_database", "ssh_key_pair"].includes(authType)) {
        return res.status(400).json({ ok: false, error: { code: "auth_type_required", message: "auth_type must be remote_database or ssh_key_pair." }, secrets_included: false });
      }
      const row = await loadTenantConnection(pool, req, connectionId, authType);
      return res.json({
        ok: true,
        kind: authType === "ssh_key_pair" ? "ssh" : "database",
        connection: safeConnection(row),
        readiness: readinessFor(row, authType),
        secrets_included: false,
      });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "tenant_infrastructure_status_failed", message: err.message }, secrets_included: false });
    }
  });

  router.post("/me/infrastructure/connections/:connection_id/preflight", requireUserJwt, async (req, res) => {
    try {
      const connectionId = String(req.params.connection_id || "").trim();
      const authType = normalizeAuthKind(req.body?.auth_type || req.body?.kind);
      if (!connectionId) return res.status(400).json({ ok: false, error: { code: "connection_id_required", message: "connection_id is required." }, secrets_included: false });
      if (!["remote_database", "ssh_key_pair"].includes(authType)) {
        return res.status(400).json({ ok: false, error: { code: "auth_type_required", message: "auth_type must be remote_database or ssh_key_pair." }, secrets_included: false });
      }
      const row = await loadTenantConnection(pool, req, connectionId, authType);
      const readiness = readinessFor(row, authType);
      return res.json({
        ok: true,
        dry_run: true,
        will_decrypt_credentials: false,
        will_open_network_connection: false,
        will_execute_command: false,
        will_query_database: false,
        kind: authType === "ssh_key_pair" ? "ssh" : "database",
        connection: safeConnection(row),
        readiness,
        allowed_next_tools: authType === "ssh_key_pair"
          ? ["tenant_ssh_connection_status", "tenant_ssh_preflight"]
          : ["tenant_database_connection_status", "tenant_database_preflight"],
        blocked_runtime_tools: authType === "ssh_key_pair"
          ? ["tenant_ssh_cli_allowlisted_execute"]
          : ["tenant_database_schema_read", "tenant_database_query_readonly"],
        secrets_included: false,
      });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "tenant_infrastructure_preflight_failed", message: err.message }, secrets_included: false });
    }
  });

  return router;
}
