function operationError(status, code, message, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

function principalClass(auth = {}) {
  if (auth.is_admin === true || ["backend_api", "admin", "service", "service_account"].includes(String(auth.mode || auth.caller_type || "").toLowerCase())) {
    return "admin";
  }
  if (auth.mode === "user_jwt" && auth.user_id && auth.tenant_id) return "tenant";
  return null;
}

function compact(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

export function extractOperationRunId(result = {}) {
  return compact(
    result.run_id
      || result.operation_id
      || result.run?.run_id
      || result.run?.operation_id
      || result.result?.run_id
      || result.body?.run_id,
    64,
  ) || null;
}

export async function recordOperationRunOwnership({
  pool,
  auth = {},
  input = {},
  result = {},
  operationKey = null,
} = {}) {
  if (!pool) throw operationError(500, "OPERATION_OWNERSHIP_POOL_REQUIRED", "Operation ownership persistence requires a database pool.");

  const scope = principalClass(auth);
  if (scope !== "tenant") {
    return { recorded: false, principal_scope: scope || "unknown", reason: "tenant_ownership_not_required" };
  }

  const runId = extractOperationRunId(result);
  if (!runId) {
    return { recorded: false, principal_scope: "tenant", reason: "run_id_missing" };
  }

  const tenantId = compact(auth.tenant_id, 36);
  const userId = compact(auth.user_id, 36);
  const workspaceId = compact(input.workspace_id || input.workspaceId, 36) || null;
  const resourceUri = compact(
    input.resource_uri
      || input.resourceUri
      || (input.owner && input.repo ? `github://${input.owner}/${input.repo}` : ""),
    500,
  ) || null;
  const resolvedOperationKey = compact(operationKey || input.operation_key || input.operation || input.intent, 128) || null;

  await pool.query(
    `INSERT INTO operation_run_ownership
      (run_id, tenant_id, workspace_id, user_id, resource_uri, operation_key)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       updated_at = CURRENT_TIMESTAMP`,
    [runId, tenantId, workspaceId, userId, resourceUri, resolvedOperationKey],
  );

  const [rows] = await pool.query(
    `SELECT run_id, tenant_id, workspace_id, user_id, resource_uri, operation_key
       FROM operation_run_ownership
      WHERE run_id = ?
      LIMIT 1`,
    [runId],
  );
  const row = rows[0];
  if (!row || row.tenant_id !== tenantId || row.user_id !== userId) {
    throw operationError(409, "OPERATION_RUN_OWNERSHIP_CONFLICT", "The operation run is already bound to a different tenant principal.", {
      run_id: runId,
    });
  }

  return {
    recorded: true,
    principal_scope: "tenant",
    run_id: runId,
    tenant_id: tenantId,
    user_id: userId,
    workspace_id: row.workspace_id || null,
    resource_uri: row.resource_uri || null,
  };
}

export async function assertOperationRunAccess({
  pool,
  auth = {},
  runId,
} = {}) {
  if (!pool) throw operationError(500, "OPERATION_OWNERSHIP_POOL_REQUIRED", "Operation ownership verification requires a database pool.");

  const scope = principalClass(auth);
  if (scope === "admin") {
    return { allowed: true, principal_scope: "admin", source: "authenticated_admin_principal" };
  }
  if (scope !== "tenant") {
    throw operationError(403, "OPERATION_PRINCIPAL_NOT_ALLOWED", "An authenticated Admin or Tenant principal is required.");
  }

  const normalizedRunId = compact(runId, 64);
  if (!normalizedRunId) {
    throw operationError(400, "OPERATION_RUN_ID_REQUIRED", "run_id is required.");
  }

  const [rows] = await pool.query(
    `SELECT run_id, tenant_id, workspace_id, user_id, resource_uri, operation_key
       FROM operation_run_ownership
      WHERE run_id = ?
        AND tenant_id = ?
        AND user_id = ?
      LIMIT 1`,
    [normalizedRunId, compact(auth.tenant_id, 36), compact(auth.user_id, 36)],
  );

  if (!rows[0]) {
    throw operationError(403, "OPERATION_RUN_ACCESS_DENIED", "The operation run is not owned by the authenticated tenant principal.", {
      run_id: normalizedRunId,
    });
  }

  return {
    allowed: true,
    principal_scope: "tenant",
    source: "operation_run_ownership",
    ownership: {
      run_id: rows[0].run_id,
      tenant_id: rows[0].tenant_id,
      workspace_id: rows[0].workspace_id || null,
      user_id: rows[0].user_id,
      resource_uri: rows[0].resource_uri || null,
      operation_key: rows[0].operation_key || null,
    },
  };
}

export const _testingOperationRunOwnershipService = {
  principalClass,
  compact,
};
