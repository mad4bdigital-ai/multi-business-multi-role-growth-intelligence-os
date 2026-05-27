import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import { writeExecutionEvidence } from "./executionEvidenceLogger.js";

function compactString(value = "", max = 255) {
  return String(value || "").trim().slice(0, max);
}

function normalizeKey(value = "", max = 255) {
  return compactString(value, max).toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_:.]/g, "_");
}

function parseStoredJson(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function asArray(value, fallback = []) {
  if (Array.isArray(value)) return value.map((item) => compactString(item, 1024)).filter(Boolean);
  const parsed = parseStoredJson(value, null);
  if (Array.isArray(parsed)) return parsed.map((item) => compactString(item, 1024)).filter(Boolean);
  return fallback;
}

function rejectSecretLikePayload(value, path = "payload") {
  if (value === null || value === undefined) return;
  if (typeof value !== "object") return;
  const blocked = /(secret|password|passphrase|private[_-]?key|token|authorization|cookie|credential)/i;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (blocked.test(key)) {
      const err = new Error(`Secret-like field is not allowed in Remote Runtime metadata: ${childPath}`);
      err.status = 400;
      err.code = "remote_runtime_secret_like_metadata_rejected";
      throw err;
    }
    rejectSecretLikePayload(child, childPath);
  }
}

function jsonParam(value, fallback) {
  return JSON.stringify(value === undefined ? fallback : value);
}

async function safeQuery(pool, sql, params = []) {
  try {
    const [rows] = await pool.query(sql, params);
    return rows || [];
  } catch (err) {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(err?.code)) return [];
    throw err;
  }
}

function publicTarget(row) {
  if (!row) return null;
  return {
    target_id: row.target_id,
    tenant_id: row.tenant_id,
    user_id: row.user_id || null,
    plugin_key: row.plugin_key,
    target_kind: row.target_kind,
    provider_family: row.provider_family || null,
    connector_family: row.connector_family || null,
    system_id: row.system_id || null,
    connection_id: row.connection_id || null,
    local_path_id: row.local_path_id || null,
    host_label: row.host_label,
    root_path: row.root_path || null,
    path_allowlist: parseStoredJson(row.path_allowlist_json, []),
    command_allowlist: parseStoredJson(row.command_allowlist_json, []),
    metadata: parseStoredJson(row.metadata_json, {}),
    status: row.status,
    validation_status: row.validation_status,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

function publicCommand(row) {
  if (!row) return null;
  return {
    command_key: row.command_key,
    display_name: row.display_name,
    target_kind: row.target_kind,
    command_template: row.command_template,
    input_schema: parseStoredJson(row.input_schema_json, {}),
    risk_class: row.risk_class,
    requires_approval: Boolean(row.requires_approval),
    is_consequential: Boolean(row.is_consequential),
    output_policy: row.output_policy,
    status: row.status,
    notes: row.notes || null,
  };
}

function readinessForTarget(target, activeCommands = []) {
  if (!target) return { ready: false, reason: "target_not_found", next_step: "select_valid_target" };
  if (target.status !== "active") {
    return {
      ready: false,
      reason: target.status === "planned" ? "target_planned_not_active" : "target_not_active",
      next_step: target.target_kind === "hosting_account" ? "configure_and_validate_ssh_credentials" : "activate_target",
    };
  }
  if (target.validation_status !== "valid") {
    return {
      ready: false,
      reason: target.validation_status === "pending_configuration" ? "target_pending_configuration" : "target_not_validated",
      next_step: target.target_kind === "hosting_account" ? "validate_hosting_account_ssh_connection" : "validate_local_project_path",
    };
  }
  if (!Array.isArray(activeCommands) || activeCommands.length === 0) {
    return { ready: false, reason: "no_active_commands", next_step: "enable_command_allowlist" };
  }
  return {
    ready: true,
    reason: "target_ready_for_allowlisted_dry_run",
    next_step: "request_allowlisted_command_dispatch_dry_run",
  };
}

export async function listRemoteRuntimeTargets({
  pool = getPool(),
  tenantId = null,
  userId = null,
  targetKind = null,
  providerFamily = null,
  status = null,
  includeCommands = true,
  limit = 100,
} = {}) {
  const filters = ["plugin_key = 'remote_ssh_runtime'"];
  const params = [];
  const normalizedTenantId = compactString(tenantId, 64);
  const normalizedUserId = compactString(userId, 64);
  const normalizedKind = targetKind ? normalizeKey(targetKind, 32) : "";
  const normalizedProvider = providerFamily ? normalizeKey(providerFamily, 64) : "";
  const normalizedStatus = status ? normalizeKey(status, 32) : "";

  if (normalizedTenantId) { filters.push("tenant_id = ?"); params.push(normalizedTenantId); }
  if (normalizedUserId) { filters.push("(user_id IS NULL OR user_id = ?)"); params.push(normalizedUserId); }
  if (normalizedKind) { filters.push("target_kind = ?"); params.push(normalizedKind); }
  if (normalizedProvider) { filters.push("provider_family = ?"); params.push(normalizedProvider); }
  if (normalizedStatus) { filters.push("status = ?"); params.push(normalizedStatus); }

  const boundedLimit = Math.max(1, Math.min(Number(limit) || 100, 250));
  const rows = await safeQuery(
    pool,
    `SELECT * FROM remote_runtime_targets
      WHERE ${filters.join(" AND ")}
      ORDER BY target_kind, provider_family, host_label
      LIMIT ${boundedLimit}`,
    params
  );
  const targets = rows.map(publicTarget);

  let commands = [];
  if (includeCommands) {
    const commandRows = await safeQuery(
      pool,
      `SELECT * FROM remote_runtime_command_allowlists
        WHERE plugin_key = 'remote_ssh_runtime'
          AND status IN ('active','planned')
        ORDER BY status, target_kind, risk_class, command_key`,
      []
    );
    commands = commandRows.map(publicCommand);
  }

  return {
    ok: true,
    plugin_key: "remote_ssh_runtime",
    filters: {
      tenant_id: normalizedTenantId || null,
      user_id: normalizedUserId || null,
      target_kind: normalizedKind || null,
      provider_family: normalizedProvider || null,
      status: normalizedStatus || null,
    },
    counts: {
      targets: targets.length,
      commands: commands.length,
      active_targets: targets.filter((target) => target.status === "active").length,
      valid_targets: targets.filter((target) => target.validation_status === "valid").length,
    },
    targets,
    commands,
    secrets_included: false,
  };
}

export async function probeRemoteRuntimeTarget({
  pool = getPool(),
  targetId,
  tenantId = null,
  userId = null,
  commandKey = "status",
  dryRun = true,
} = {}) {
  const normalizedTargetId = compactString(targetId, 64);
  const normalizedTenantId = compactString(tenantId, 64);
  const normalizedUserId = compactString(userId, 64);
  const normalizedCommandKey = normalizeKey(commandKey || "status", 128) || "status";
  if (!normalizedTargetId) {
    const err = new Error("target_id is required.");
    err.status = 400;
    err.code = "missing_remote_runtime_target_id";
    throw err;
  }

  const filters = ["target_id = ?", "plugin_key = 'remote_ssh_runtime'"];
  const params = [normalizedTargetId];
  if (normalizedTenantId) { filters.push("tenant_id = ?"); params.push(normalizedTenantId); }
  if (normalizedUserId) { filters.push("(user_id IS NULL OR user_id = ?)"); params.push(normalizedUserId); }

  const targetRows = await safeQuery(pool, `SELECT * FROM remote_runtime_targets WHERE ${filters.join(" AND ")} LIMIT 1`, params);
  const target = publicTarget(targetRows[0] || null);
  if (!target) {
    return {
      ok: true,
      target_id: normalizedTargetId,
      found: false,
      ready: false,
      reason: "target_not_found_or_scope_mismatch",
      execution: { will_execute: false, dry_run: Boolean(dryRun), dispatch_ready: false },
      secrets_included: false,
    };
  }

  const commandRows = await safeQuery(
    pool,
    `SELECT * FROM remote_runtime_command_allowlists
      WHERE plugin_key = 'remote_ssh_runtime'
        AND status IN ('active','planned')
        AND (target_kind = 'both' OR target_kind = ?)
      ORDER BY status, target_kind, risk_class, command_key`,
    [target.target_kind]
  );
  const commands = commandRows.map(publicCommand);
  const selectedCommand = commands.find((command) => command.command_key === normalizedCommandKey) || commands.find((command) => command.command_key === "status") || null;
  const activeCommands = commands.filter((command) => command.status === "active");
  const readiness = readinessForTarget(target, activeCommands);
  const commandReady = Boolean(selectedCommand && selectedCommand.status === "active");
  const willExecute = false;
  const traceId = `remote_runtime_probe_${randomUUID()}`;

  let log = null;
  try {
    const evidence = await writeExecutionEvidence({
      pool,
      traceId,
      entryType: "remote_runtime_probe",
      executionClass: "remote_runtime_diagnostic",
      sourceLayer: "remoteRuntime",
      userInput: `remote runtime probe ${target.target_id}`,
      routeKeys: "remote_runtime_probe",
      selectedWorkflows: "remote_runtime_readiness_probe",
      executionMode: "dry_run_probe",
      decisionTrigger: "admin_tool",
      executionStatus: "success",
      outputSummary: {
        plugin_key: "remote_ssh_runtime",
        target_id: target.target_id,
        target_kind: target.target_kind,
        status: target.status,
        validation_status: target.validation_status,
        ready: readiness.ready,
        command_key: selectedCommand?.command_key || normalizedCommandKey,
        command_ready: commandReady,
        will_execute: willExecute,
        secrets_included: false,
      },
      recoveryStatus: "not_required",
      routeStatus: "resolved",
      routeSource: "sql_primary",
      intakeValidationStatus: "validated",
      executionReadyStatus: readiness.ready && commandReady ? "ready" : "degraded",
      logSource: "sql_primary",
    });
    log = evidence.row || null;
  } catch {
    log = null;
  }

  return {
    ok: true,
    plugin_key: "remote_ssh_runtime",
    found: true,
    target,
    selected_command: selectedCommand,
    commands,
    readiness,
    ready: Boolean(readiness.ready && commandReady),
    reason: !commandReady ? "selected_command_not_active" : readiness.reason,
    execution: {
      will_execute: willExecute,
      dry_run: Boolean(dryRun),
      dispatch_ready: false,
      note: "Probe never opens SSH, local shell, or file access. Execution dispatch will be added behind separate allowlisted/approval-gated routes.",
    },
    execution_log: log ? { ok: true, id: log.id, execution_status: log.execution_status, trace_id: log.execution_trace_id_writeback } : { ok: false, trace_id: traceId },
    secrets_included: false,
  };
}
