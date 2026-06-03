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
    if (key === "secrets_included" && child === false) continue;
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

const HOSTING_SSH_CREDENTIAL_ROLES = ["ssh_host", "ssh_port", "ssh_user", "ssh_private_key"];

async function loadHostingSshCredentialReadiness(pool, target = {}, system = null, connection = null) {
  if (!target?.tenant_id) {
    return {
      roles: HOSTING_SSH_CREDENTIAL_ROLES,
      present_roles: [],
      missing_roles: HOSTING_SSH_CREDENTIAL_ROLES,
      value_present_roles: [],
      value_missing_roles: HOSTING_SSH_CREDENTIAL_ROLES,
      all_bindings_present: false,
      all_values_present: false,
      bindings: [],
      source: "credential_bindings",
    };
  }
  const filters = [
    "cb.tenant_id = ?",
    "cb.credential_role IN ('ssh_host','ssh_port','ssh_user','ssh_private_key')",
    "cb.status = 'active'",
  ];
  const params = [target.tenant_id];
  if (target.system_id || system?.system_id) {
    filters.push("cb.system_id = ?");
    params.push(target.system_id || system.system_id);
  } else if (target.connection_id || connection?.connection_id) {
    filters.push("cb.connection_id = ?");
    params.push(target.connection_id || connection.connection_id);
  } else {
    filters.push("cb.provider_family = ? AND cb.connector_family = ?");
    params.push(target.provider_family || system?.provider_family || connection?.app_key || "hostinger");
    params.push(target.connector_family || system?.connector_family || "hostinger_ssh");
  }

  const rows = await safeQuery(
    pool,
    `SELECT cb.credential_role, cb.credential_ref, cb.owner_type, cb.owner_id, cb.system_id,
            ps.secret_key, ps.storage_backend, ps.status AS secret_status,
            CASE WHEN COALESCE(ps.value_ciphertext, '') <> '' THEN 1 ELSE 0 END AS has_secret_value
       FROM credential_bindings cb
       LEFT JOIN platform_secrets ps
         ON cb.credential_ref COLLATE utf8mb4_unicode_ci = CONCAT('platform_secret:', ps.secret_key) COLLATE utf8mb4_unicode_ci
      WHERE ${filters.join(" AND ")}
      ORDER BY cb.resolution_priority ASC, cb.updated_at DESC`,
    params
  );
  const byRole = new Map();
  for (const row of rows) {
    if (!byRole.has(row.credential_role)) byRole.set(row.credential_role, row);
  }
  const presentRoles = HOSTING_SSH_CREDENTIAL_ROLES.filter((role) => byRole.has(role));
  const missingRoles = HOSTING_SSH_CREDENTIAL_ROLES.filter((role) => !byRole.has(role));
  const valuePresentRoles = HOSTING_SSH_CREDENTIAL_ROLES.filter((role) => {
    const row = byRole.get(role);
    return Boolean(row && row.secret_status === "active" && Number(row.has_secret_value) === 1);
  });
  const valueMissingRoles = HOSTING_SSH_CREDENTIAL_ROLES.filter((role) => !valuePresentRoles.includes(role));
  return {
    roles: HOSTING_SSH_CREDENTIAL_ROLES,
    present_roles: presentRoles,
    missing_roles: missingRoles,
    value_present_roles: valuePresentRoles,
    value_missing_roles: valueMissingRoles,
    all_bindings_present: missingRoles.length === 0,
    all_values_present: valueMissingRoles.length === 0,
    bindings: presentRoles.map((role) => {
      const row = byRole.get(role);
      return {
        credential_role: role,
        credential_ref: row?.credential_ref || "",
        owner_type: row?.owner_type || "",
        owner_id: row?.owner_id || "",
        storage_backend: row?.storage_backend || "",
        secret_status: row?.secret_status || "missing",
        secret_value_present: Number(row?.has_secret_value || 0) === 1,
      };
    }),
    source: "credential_bindings",
  };
}

async function loadConnection(pool, connectionId) {
  if (!connectionId) return null;
  const rows = await safeQuery(
    pool,
    `SELECT connection_id, tenant_id, user_id, app_key, display_label, auth_type, account_label,
            account_metadata, api_base_url, status, validation_status, last_validated_at
       FROM user_app_connections
      WHERE connection_id COLLATE utf8mb4_unicode_ci = ? COLLATE utf8mb4_unicode_ci
      LIMIT 1`,
    [connectionId]
  );
  return rows[0] || null;
}

async function loadConnectedSystem(pool, systemId) {
  if (!systemId) return null;
  const rows = await safeQuery(
    pool,
    `SELECT system_id, tenant_id, system_key, display_name, provider_family, connector_family,
            auth_type, service_mode, status, config_json
       FROM connected_systems
      WHERE system_id = ?
      LIMIT 1`,
    [systemId]
  );
  return rows[0] || null;
}

async function loadLocalPath(pool, localPathId) {
  if (!localPathId) return null;
  const rows = await safeQuery(
    pool,
    `SELECT path_id, tenant_id, user_id, device_id, project_key, project_label, owner_scope,
            allowed_subject_scope, current_path, repo_remote, repo_branch, allowed_operations_json,
            path_status, validation_status
       FROM local_project_path_registry
      WHERE path_id = ?
      LIMIT 1`,
    [localPathId]
  );
  return rows[0] || null;
}

function scopeMismatch(row, tenantId, userId) {
  if (!row) return false;
  if (tenantId && row.tenant_id && String(row.tenant_id) !== String(tenantId)) return true;
  if (userId && row.user_id && String(row.user_id) !== String(userId)) return true;
  return false;
}

export async function upsertRemoteRuntimeTarget({
  pool = getPool(),
  targetId = null,
  tenantId,
  userId = null,
  targetKind,
  providerFamily = null,
  connectorFamily = null,
  systemId = null,
  connectionId = null,
  localPathId = null,
  hostLabel = null,
  rootPath = null,
  pathAllowlist = null,
  commandAllowlist = null,
  metadata = {},
  status = null,
  validationStatus = null,
  updatedBy = null,
} = {}) {
  const normalizedTenantId = compactString(tenantId, 64);
  const normalizedUserId = compactString(userId, 64) || null;
  const normalizedKind = normalizeKey(targetKind, 32);
  const normalizedTargetId = compactString(targetId, 36) || randomUUID();
  const normalizedSystemId = compactString(systemId, 36) || null;
  const normalizedConnectionId = compactString(connectionId, 36) || null;
  const normalizedLocalPathId = compactString(localPathId, 36) || null;
  const normalizedProvider = normalizeKey(providerFamily, 64) || null;
  const normalizedConnector = normalizeKey(connectorFamily, 64) || null;

  if (!normalizedTenantId) {
    const err = new Error("tenant_id is required.");
    err.status = 400;
    err.code = "missing_remote_runtime_tenant_id";
    throw err;
  }
  if (!["hosting_account", "local_path"].includes(normalizedKind)) {
    const err = new Error("target_kind must be hosting_account or local_path.");
    err.status = 400;
    err.code = "invalid_remote_runtime_target_kind";
    throw err;
  }
  rejectSecretLikePayload(metadata, "metadata");

  let connection = null;
  let system = null;
  let localPath = null;
  let finalProvider = normalizedProvider;
  let finalConnector = normalizedConnector;
  let finalHostLabel = compactString(hostLabel, 191);
  let finalRootPath = compactString(rootPath, 1024) || null;
  let finalPathAllowlist = asArray(pathAllowlist, []);
  let finalCommandAllowlist = asArray(commandAllowlist, []);
  let finalStatus = normalizeKey(status, 32) || "planned";
  let finalValidation = normalizeKey(validationStatus, 32) || "unknown";

  if (normalizedKind === "hosting_account") {
    if (!normalizedSystemId && !normalizedConnectionId) {
      const err = new Error("hosting_account targets require system_id or connection_id.");
      err.status = 400;
      err.code = "remote_runtime_hosting_target_requires_binding";
      throw err;
    }
    if (normalizedConnectionId) {
      connection = await loadConnection(pool, normalizedConnectionId);
      if (!connection) {
        const err = new Error("connection_id was not found.");
        err.status = 404;
        err.code = "remote_runtime_connection_not_found";
        throw err;
      }
      if (scopeMismatch(connection, normalizedTenantId, normalizedUserId)) {
        const err = new Error("connection_id is outside requested tenant/user scope.");
        err.status = 403;
        err.code = "remote_runtime_connection_scope_mismatch";
        throw err;
      }
      finalHostLabel ||= compactString(connection.display_label || connection.account_label || connection.app_key || "Remote hosting account", 191);
      finalProvider ||= normalizeKey(connection.app_key, 64) || "hosting";
      finalConnector ||= "ssh";
      finalValidation = connection.validation_status === "validated" ? "partial" : "pending_configuration";
      finalStatus = connection.status === "active" ? "planned" : "planned";
    }
    if (normalizedSystemId) {
      system = await loadConnectedSystem(pool, normalizedSystemId);
      if (!system) {
        const err = new Error("system_id was not found.");
        err.status = 404;
        err.code = "remote_runtime_system_not_found";
        throw err;
      }
      if (scopeMismatch(system, normalizedTenantId, null)) {
        const err = new Error("system_id is outside requested tenant scope.");
        err.status = 403;
        err.code = "remote_runtime_system_scope_mismatch";
        throw err;
      }
      const config = parseStoredJson(system.config_json, {});
      finalHostLabel ||= compactString(system.display_name || system.system_key || "Remote connected system", 191);
      finalProvider ||= normalizeKey(system.provider_family, 64) || "hosting";
      finalConnector ||= normalizeKey(system.connector_family, 64) || "ssh";
      if (finalPathAllowlist.length === 0) finalPathAllowlist = asArray(config.path_allowlist, []);
      if (finalCommandAllowlist.length === 0) finalCommandAllowlist = asArray(config.command_allowlist, []);
      finalValidation = system.status === "active" ? "valid" : "pending_configuration";
      finalStatus = system.status === "active" ? "active" : "planned";
    }
    if (finalPathAllowlist.length === 0) {
      const err = new Error("hosting_account targets require a non-empty path_allowlist.");
      err.status = 400;
      err.code = "remote_runtime_path_allowlist_required";
      throw err;
    }
  }

  if (normalizedKind === "local_path") {
    if (!normalizedLocalPathId) {
      const err = new Error("local_path targets require local_path_id.");
      err.status = 400;
      err.code = "remote_runtime_local_path_id_required";
      throw err;
    }
    localPath = await loadLocalPath(pool, normalizedLocalPathId);
    if (!localPath) {
      const err = new Error("local_path_id was not found.");
      err.status = 404;
      err.code = "remote_runtime_local_path_not_found";
      throw err;
    }
    if (scopeMismatch(localPath, normalizedTenantId, normalizedUserId)) {
      const err = new Error("local_path_id is outside requested tenant/user scope.");
      err.status = 403;
      err.code = "remote_runtime_local_path_scope_mismatch";
      throw err;
    }
    finalProvider ||= "local";
    finalConnector ||= "local_connector";
    finalHostLabel ||= compactString(localPath.project_label || localPath.project_key || "Local project path", 191);
    finalRootPath ||= compactString(localPath.current_path, 1024) || null;
    finalPathAllowlist = finalPathAllowlist.length ? finalPathAllowlist : [compactString(localPath.current_path, 1024)].filter(Boolean);
    finalCommandAllowlist = finalCommandAllowlist.length ? finalCommandAllowlist : asArray(localPath.allowed_operations_json, []);
    finalStatus = localPath.path_status === "active" ? "active" : "planned";
    finalValidation = localPath.validation_status === "valid" ? "valid" : (localPath.validation_status === "inaccessible" ? "inaccessible" : "unknown");
  }

  if (!["planned", "active", "disabled", "archived"].includes(finalStatus)) finalStatus = "planned";
  if (!["unknown", "pending_configuration", "valid", "invalid", "inaccessible", "partial"].includes(finalValidation)) finalValidation = "unknown";

  const finalMetadata = {
    ...metadata,
    source: metadata?.source || "remote_runtime_target_upsert",
    system_key: system?.system_key || undefined,
    connection_app_key: connection?.app_key || undefined,
    local_device_id: localPath?.device_id || undefined,
    local_project_key: localPath?.project_key || undefined,
    secrets_included: false,
  };
  rejectSecretLikePayload(finalMetadata, "metadata");

  await pool.query(
    `INSERT INTO remote_runtime_targets (
      target_id, tenant_id, user_id, plugin_key, target_kind, provider_family, connector_family,
      system_id, connection_id, local_path_id, host_label, root_path, path_allowlist_json,
      command_allowlist_json, metadata_json, status, validation_status, created_by, updated_by
    ) VALUES (?, ?, ?, 'remote_ssh_runtime', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      tenant_id = VALUES(tenant_id),
      user_id = VALUES(user_id),
      plugin_key = VALUES(plugin_key),
      target_kind = VALUES(target_kind),
      provider_family = VALUES(provider_family),
      connector_family = VALUES(connector_family),
      host_label = VALUES(host_label),
      root_path = VALUES(root_path),
      path_allowlist_json = VALUES(path_allowlist_json),
      command_allowlist_json = VALUES(command_allowlist_json),
      metadata_json = VALUES(metadata_json),
      status = VALUES(status),
      validation_status = VALUES(validation_status),
      updated_by = VALUES(updated_by),
      updated_at = CURRENT_TIMESTAMP`,
    [
      normalizedTargetId,
      normalizedTenantId,
      normalizedUserId,
      normalizedKind,
      finalProvider,
      finalConnector,
      normalizedSystemId,
      normalizedConnectionId,
      normalizedLocalPathId,
      finalHostLabel,
      finalRootPath,
      jsonParam(finalPathAllowlist, []),
      jsonParam(finalCommandAllowlist, []),
      jsonParam(finalMetadata, {}),
      finalStatus,
      finalValidation,
      compactString(updatedBy, 191) || "remote_runtime_target_upsert",
      compactString(updatedBy, 191) || "remote_runtime_target_upsert",
    ]
  );

  const result = await listRemoteRuntimeTargets({
    pool,
    tenantId: normalizedTenantId,
    userId: normalizedUserId,
    targetKind: normalizedKind,
    includeCommands: true,
    limit: 250,
  });
  const target = result.targets.find((item) => item.target_id === normalizedTargetId)
    || result.targets.find((item) => normalizedSystemId && item.system_id === normalizedSystemId)
    || result.targets.find((item) => normalizedConnectionId && item.connection_id === normalizedConnectionId)
    || result.targets.find((item) => normalizedLocalPathId && item.local_path_id === normalizedLocalPathId)
    || null;

  return {
    ok: true,
    created_or_updated: true,
    plugin_key: "remote_ssh_runtime",
    target,
    validation: {
      status: target?.validation_status || finalValidation,
      reason: normalizedKind === "hosting_account" ? "metadata_registered_no_ssh_execution" : "local_path_registry_checked",
    },
    execution: { will_execute: false, dispatch_ready: false },
    secrets_included: false,
  };
}

export async function validateRemoteRuntimeTarget({
  pool = getPool(),
  targetId,
  tenantId = null,
  userId = null,
  updatedBy = null,
} = {}) {
  const normalizedTargetId = compactString(targetId, 36);
  if (!normalizedTargetId) {
    const err = new Error("target_id is required.");
    err.status = 400;
    err.code = "missing_remote_runtime_target_id";
    throw err;
  }

  const catalog = await listRemoteRuntimeTargets({ pool, tenantId, userId, includeCommands: true, limit: 250 });
  const target = catalog.targets.find((item) => item.target_id === normalizedTargetId);
  if (!target) {
    const err = new Error("target_id was not found or is outside scope.");
    err.status = 404;
    err.code = "remote_runtime_target_not_found";
    throw err;
  }

  let nextStatus = target.status;
  let nextValidation = target.validation_status;
  let reason = "metadata_checked";
  const checks = [];

  if (target.target_kind === "local_path") {
    const localPath = await loadLocalPath(pool, target.local_path_id);
    checks.push({ check: "local_path_exists", ok: Boolean(localPath) });
    checks.push({ check: "local_path_valid", ok: localPath?.validation_status === "valid" });
    if (localPath?.validation_status === "valid" && localPath?.path_status === "active") {
      nextStatus = "active";
      nextValidation = "valid";
      reason = "local_path_validated";
    } else if (localPath?.validation_status === "inaccessible") {
      nextValidation = "inaccessible";
      reason = "local_path_inaccessible";
    } else {
      nextValidation = "unknown";
      reason = "local_path_not_validated";
    }
  }

  if (target.target_kind === "hosting_account") {
    let system = null;
    let connection = null;
    if (target.system_id) system = await loadConnectedSystem(pool, target.system_id);
    if (target.connection_id) connection = await loadConnection(pool, target.connection_id);
    checks.push({ check: "has_system_or_connection", ok: Boolean(system || connection) });
    checks.push({ check: "path_allowlist_non_empty", ok: Array.isArray(target.path_allowlist) && target.path_allowlist.length > 0 });
    checks.push({ check: "command_allowlist_non_empty", ok: Array.isArray(target.command_allowlist) && target.command_allowlist.length > 0 });
    const credentialReadiness = await loadHostingSshCredentialReadiness(pool, target, system, connection);
    checks.push({
      check: "ssh_credential_bindings_present",
      ok: credentialReadiness.all_bindings_present,
      present_roles: credentialReadiness.present_roles,
      missing_roles: credentialReadiness.missing_roles,
    });
    checks.push({
      check: "ssh_secret_values_present",
      ok: credentialReadiness.all_values_present,
      present_roles: credentialReadiness.value_present_roles,
      missing_roles: credentialReadiness.value_missing_roles,
    });
    const externallyValid = system?.status === "active" || connection?.validation_status === "validated";
    if (system?.status === "active") {
      nextStatus = "active";
      nextValidation = "valid";
      reason = "managed_connected_system_active";
    } else if (externallyValid || credentialReadiness.all_values_present) {
      nextStatus = "planned";
      nextValidation = "partial";
      reason = credentialReadiness.all_values_present
        ? "db_credential_values_present_ssh_not_probed"
        : "credential_metadata_validated_ssh_not_probed";
    } else if (credentialReadiness.all_bindings_present) {
      nextStatus = "planned";
      nextValidation = "pending_configuration";
      reason = "db_credential_bindings_present_pending_secret_values";
    } else {
      nextStatus = "planned";
      nextValidation = "pending_configuration";
      reason = "hosting_account_pending_ssh_configuration";
    }
  }

  await pool.query(
    `UPDATE remote_runtime_targets
        SET status = ?, validation_status = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE target_id = ?`,
    [nextStatus, nextValidation, compactString(updatedBy, 191) || "remote_runtime_target_validate", normalizedTargetId]
  );

  const probe = await probeRemoteRuntimeTarget({ pool, targetId: normalizedTargetId, tenantId, userId, commandKey: "status", dryRun: true });
  return {
    ok: true,
    plugin_key: "remote_ssh_runtime",
    target_id: normalizedTargetId,
    status: nextStatus,
    validation_status: nextValidation,
    reason,
    checks,
    probe,
    execution: { will_execute: false, dispatch_ready: false },
    secrets_included: false,
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

export async function planRemoteRuntimeDispatchDryRun({
  pool = getPool(),
  targetId,
  tenantId = null,
  userId = null,
  commandKey = "status",
  inputs = {},
  approvalId = null,
  approvalReason = null,
} = {}) {
  const normalizedTargetId = compactString(targetId, 64);
  const normalizedTenantId = compactString(tenantId, 64);
  const normalizedUserId = compactString(userId, 64);
  const normalizedCommandKey = normalizeKey(commandKey || "status", 128) || "status";
  const normalizedApprovalId = compactString(approvalId, 191) || null;
  const normalizedApprovalReason = compactString(approvalReason, 500) || null;
  if (!normalizedTargetId) {
    const err = new Error("target_id is required.");
    err.status = 400;
    err.code = "missing_remote_runtime_target_id";
    throw err;
  }
  rejectSecretLikePayload(inputs, "inputs");

  const probe = await probeRemoteRuntimeTarget({
    pool,
    targetId: normalizedTargetId,
    tenantId: normalizedTenantId,
    userId: normalizedUserId,
    commandKey: normalizedCommandKey,
    dryRun: true,
  });
  if (!probe.found) {
    return {
      ok: true,
      plugin_key: "remote_ssh_runtime",
      found: false,
      target_id: normalizedTargetId,
      command_key: normalizedCommandKey,
      dispatch_ready: false,
      reason: probe.reason || "target_not_found",
      execution: { will_execute: false, dry_run: true, dispatch_ready: false },
      secrets_included: false,
    };
  }

  const target = probe.target;
  const selectedCommand = probe.commands.find((command) => command.command_key === normalizedCommandKey) || null;
  const commandExists = Boolean(selectedCommand);
  const commandActive = selectedCommand?.status === "active";
  const commandTargetCompatible = Boolean(selectedCommand && (selectedCommand.target_kind === "both" || selectedCommand.target_kind === target.target_kind));
  const targetCommandAllowlist = Array.isArray(target.command_allowlist) ? target.command_allowlist : [];
  const targetAllowsCommand = normalizedCommandKey === "status" || targetCommandAllowlist.includes(normalizedCommandKey);
  const approvalRequired = Boolean(selectedCommand?.requires_approval || selectedCommand?.is_consequential);
  const approvalSatisfied = !approvalRequired || Boolean(normalizedApprovalId || (normalizedApprovalReason && normalizedApprovalReason.length >= 12));

  let reason = "dispatch_dry_run_ready";
  if (!commandExists) reason = "command_not_registered";
  else if (!commandActive) reason = "command_not_active";
  else if (!commandTargetCompatible) reason = "command_not_compatible_with_target_kind";
  else if (!targetAllowsCommand) reason = "command_not_allowed_by_target_allowlist";
  else if (!probe.ready) reason = probe.reason || "target_not_ready";
  else if (!approvalSatisfied) reason = "approval_required_before_execution";

  const dispatchReady = reason === "dispatch_dry_run_ready";
  const traceId = `remote_runtime_dispatch_dry_run_${randomUUID()}`;
  let log = null;
  try {
    const evidence = await writeExecutionEvidence({
      pool,
      traceId,
      entryType: "remote_runtime_dispatch_dry_run",
      executionClass: "remote_runtime_dispatch_plan",
      sourceLayer: "remoteRuntime",
      userInput: `remote runtime dispatch dry-run ${normalizedTargetId} ${normalizedCommandKey}`,
      routeKeys: "remote_runtime_dispatch_dry_run",
      selectedWorkflows: "remote_runtime_allowlisted_dispatch_planning",
      executionMode: "dry_run_only",
      decisionTrigger: "admin_tool",
      executionStatus: "success",
      outputSummary: {
        plugin_key: "remote_ssh_runtime",
        target_id: normalizedTargetId,
        target_kind: target.target_kind,
        command_key: normalizedCommandKey,
        command_active: commandActive,
        target_allows_command: targetAllowsCommand,
        approval_required: approvalRequired,
        approval_satisfied: approvalSatisfied,
        dispatch_ready: dispatchReady,
        will_execute: false,
        secrets_included: false,
      },
      recoveryStatus: "not_required",
      routeStatus: "resolved",
      routeSource: "sql_primary",
      intakeValidationStatus: "validated",
      executionReadyStatus: dispatchReady ? "ready" : "degraded",
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
    requested_command_key: normalizedCommandKey,
    inputs_summary: {
      keys: inputs && typeof inputs === "object" ? Object.keys(inputs).sort() : [],
      secrets_included: false,
    },
    checks: {
      command_exists: commandExists,
      command_active: commandActive,
      command_target_compatible: commandTargetCompatible,
      target_allows_command: targetAllowsCommand,
      target_ready: Boolean(probe.ready),
      approval_required: approvalRequired,
      approval_satisfied: approvalSatisfied,
    },
    dispatch_ready: dispatchReady,
    reason,
    next_step: dispatchReady ? "request_execution_route_with_approval_if_required" : "resolve_failed_dry_run_check",
    execution: {
      will_execute: false,
      dry_run: true,
      dispatch_ready: dispatchReady,
      note: "Dispatch dry-run never opens SSH, local shell, or file access. It only evaluates allowlists, target readiness, and approval requirements.",
    },
    execution_log: log ? { ok: true, id: log.id, execution_status: log.execution_status, trace_id: log.execution_trace_id_writeback } : { ok: false, trace_id: traceId },
    secrets_included: false,
  };
}
