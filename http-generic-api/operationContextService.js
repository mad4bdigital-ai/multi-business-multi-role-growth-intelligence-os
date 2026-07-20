import { getPool } from "./db.js";
import { getOperationContract, validateOperationInput } from "./operationContractRegistry.js";

const ADMIN_MODES = new Set(["backend_api", "admin", "service", "service_account"]);
const WRITE_PERMISSIONS = new Set(["write", "admin", "owner"]);
const RESPONSE_MODES = new Set(["summary", "relevant", "full"]);

function operationError(status, code, message, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

function compact(value, max = 255) {
  return String(value ?? "").trim().slice(0, max);
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function principalClass(auth = {}) {
  if (auth.is_admin === true || ADMIN_MODES.has(String(auth.mode || auth.caller_type || "").toLowerCase())) return "admin";
  if (auth.mode === "user_jwt" && auth.user_id && auth.tenant_id) return "tenant";
  return null;
}

function repositoryUri(input = {}) {
  const owner = compact(input.owner, 191);
  const repo = compact(input.repo, 191);
  return owner && repo ? `github://${owner}/${repo}` : null;
}

async function verifyTenantMembership(pool, auth) {
  const [rows] = await pool.query(
    `SELECT m.tenant_id, m.role, m.status, t.status AS tenant_status
       FROM memberships m
       JOIN tenants t ON t.tenant_id = m.tenant_id
      WHERE m.user_id = ? AND m.tenant_id = ?
        AND m.status = 'active' AND t.status = 'active'
      LIMIT 1`,
    [auth.user_id, auth.tenant_id]
  );
  if (!rows[0]) {
    throw operationError(403, "ACTIVE_TENANT_MEMBERSHIP_REQUIRED", "An active tenant membership is required.");
  }
  return rows[0];
}

async function resolveTenantResourceAuthority({ pool, auth, contract, input, resourceUri }) {
  if (!contract.resource_type) {
    return { allowed: true, source: "tenant_membership", permission_level: "read", binding_id: null };
  }
  if (!resourceUri) {
    throw operationError(400, "RESOURCE_URI_REQUIRED", "The target resource could not be resolved.");
  }
  const workspaceId = compact(input.workspace_id || input.workspaceId, 64) || null;
  const recipeKey = compact(input.recipe_key || input.recipeKey || input.automation_key, 64) || null;
  const [rows] = await pool.query(
    `SELECT binding_id, tenant_id, workspace_id, user_id, resource_type, resource_uri,
            recipe_key, permission_level, allowed_modes_json, authority_source, expires_at
       FROM platform_resource_authority_bindings
      WHERE tenant_id = ?
        AND (workspace_id IS NULL OR workspace_id = ?)
        AND (user_id IS NULL OR user_id = ?)
        AND resource_type = ?
        AND resource_uri = ?
        AND status = 'active'
        AND (expires_at IS NULL OR expires_at > NOW())
        AND (recipe_key IS NULL OR recipe_key = ?)
      ORDER BY user_id IS NOT NULL DESC, workspace_id IS NOT NULL DESC, updated_at DESC
      LIMIT 10`,
    [auth.tenant_id, workspaceId, auth.user_id, contract.resource_type, resourceUri, recipeKey]
  );
  const requestedMode = contract.execution_class === "mutation" ? "write" : "read";
  const binding = rows.find((row) => {
    const modes = parseJson(row.allowed_modes_json, []);
    const allowedModes = Array.isArray(modes) ? modes.map((item) => String(item).toLowerCase()) : [];
    const permission = String(row.permission_level || "").toLowerCase();
    return (requestedMode === "read" || WRITE_PERMISSIONS.has(permission))
      && (!allowedModes.length || allowedModes.includes(requestedMode) || allowedModes.includes("apply") || allowedModes.includes("read_write"));
  });
  if (!binding) {
    throw operationError(403, "RESOURCE_AUTHORITY_REQUIRED", "No active resource authority binding permits this operation.", {
      resource_uri: resourceUri,
      operation_key: contract.operation_key,
      requested_mode: requestedMode,
    });
  }
  return {
    allowed: true,
    source: binding.authority_source,
    binding_id: binding.binding_id,
    permission_level: binding.permission_level,
    recipe_key: binding.recipe_key,
    expires_at: binding.expires_at,
  };
}

function responseMode(input = {}) {
  const mode = compact(input.response_mode || input.responseMode || "summary", 20).toLowerCase();
  return RESPONSE_MODES.has(mode) ? mode : "summary";
}

function projectContext(context, mode) {
  if (mode === "full") return context;
  const base = {
    ok: true,
    operation: context.operation,
    principal: context.principal,
    authority: context.authority,
    resource: context.resource,
    budget: context.budget,
    blockers: context.blockers,
    completeness: "complete",
    secrets_included: false,
  };
  if (mode === "relevant") {
    base.repository = context.repository;
    base.dependencies = context.dependencies;
  }
  return base;
}

export async function buildOperationContext({ auth = {}, input = {}, pool = null } = {}) {
  const contract = getOperationContract(input.operation_key || input.operation || input.intent);
  validateOperationInput(contract, input);
  const resolvedPool = pool || getPool();
  const scope = principalClass(auth);
  if (!scope || !contract.principal_scopes.includes(scope)) {
    throw operationError(403, "OPERATION_PRINCIPAL_NOT_ALLOWED", "The authenticated principal cannot execute this operation.", {
      operation_key: contract.operation_key,
      principal_scope: scope,
    });
  }

  let membership = null;
  let authority;
  const resourceUri = contract.resource_type === "repository" ? repositoryUri(input) : compact(input.resource_uri || input.resourceUri, 500) || null;
  if (scope === "tenant") {
    membership = await verifyTenantMembership(resolvedPool, auth);
    authority = await resolveTenantResourceAuthority({ pool: resolvedPool, auth, contract, input, resourceUri });
  } else {
    authority = {
      allowed: true,
      source: "authenticated_admin_principal",
      binding_id: null,
      permission_level: "admin",
      recipe_key: compact(input.recipe_key || input.recipeKey || input.automation_key, 64) || null,
      expires_at: null,
    };
  }

  const context = {
    ok: true,
    operation: {
      operation_key: contract.operation_key,
      execution_class: contract.execution_class,
      principal_scopes: contract.principal_scopes,
    },
    principal: {
      principal_class: scope,
      user_id: auth.user_id || auth.admin_id || null,
      tenant_id: scope === "tenant" ? auth.tenant_id : input.tenant_id || auth.tenant_id || null,
      tenant_role: membership?.role || auth.tenant_role || null,
      workspace_id: compact(input.workspace_id || input.workspaceId, 64) || null,
    },
    authority,
    resource: {
      resource_type: contract.resource_type,
      resource_uri: resourceUri,
    },
    repository: contract.resource_type === "repository" ? {
      owner: compact(input.owner, 191),
      repo: compact(input.repo, 191),
      branch: compact(input.branch || input.head_ref, 255) || null,
      default_branch: compact(input.default_branch || "main", 191),
      pull_number: Number(input.pull_number || 0) || null,
    } : null,
    dependencies: {
      local_connector_required: false,
      sql_discovery_required: false,
      managed_github_transport_preferred: contract.resource_type === "repository",
    },
    budget: { ...contract.budget },
    blockers: [],
    generated_at: new Date().toISOString(),
    secrets_included: false,
  };
  return projectContext(context, responseMode(input));
}

export const _testingOperationContextService = {
  principalClass,
  repositoryUri,
  responseMode,
  projectContext,
};
