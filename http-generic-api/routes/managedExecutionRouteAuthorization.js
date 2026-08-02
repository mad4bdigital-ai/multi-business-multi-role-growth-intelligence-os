import { Router } from "express";
import { getPool } from "../db.js";

function routeError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function routeFailure(res, error) {
  return res.status(error.status || 500).json({
    ok: false,
    error: {
      code: error.code || "managed_execution_authorization_failed",
      message: error.message,
    },
    secrets_included: false,
  });
}

function principalScope(req) {
  return {
    is_admin: req.auth?.is_admin === true,
    tenant_id: String(req.auth?.tenant_id || "").trim() || null,
    user_id: String(req.auth?.user_id || "").trim() || null,
  };
}

function requireTenantPrincipal(scope) {
  if (scope.is_admin) return;
  if (!scope.tenant_id || !scope.user_id) {
    throw routeError(
      403,
      "managed_execution_principal_required",
      "Managed execution requires an authenticated tenant user or platform admin.",
    );
  }
}

function bindCreationScope(req) {
  const scope = principalScope(req);
  requireTenantPrincipal(scope);
  if (scope.is_admin) return;
  const body = req.body || {};
  const requestedTenant = String(body.tenant_id || "").trim();
  const requestedUser = String(body.user_id || body.requester_id || "").trim();
  if (
    (requestedTenant && requestedTenant !== scope.tenant_id) ||
    (requestedUser && requestedUser !== scope.user_id)
  ) {
    throw routeError(
      403,
      "managed_execution_principal_scope_mismatch",
      "Managed execution tenant and requester must match the authenticated principal.",
    );
  }
  req.body = {
    ...body,
    tenant_id: scope.tenant_id,
    user_id: scope.user_id,
  };
}

function assertRunScope(scope, run) {
  requireTenantPrincipal(scope);
  if (scope.is_admin) return;
  if (
    String(run?.tenant_id || "") !== scope.tenant_id ||
    String(run?.user_id || "") !== scope.user_id
  ) {
    throw routeError(
      403,
      "managed_execution_principal_scope_mismatch",
      "Managed execution run is outside the authenticated tenant or requester scope.",
    );
  }
}

async function readRun(runId) {
  const [rows] = await getPool().query(
    "SELECT run_id, tenant_id, user_id, execution_context_json FROM workflow_runs WHERE run_id = ? LIMIT 2",
    [runId],
  );
  if (rows.length !== 1) return null;
  let context = {};
  try { context = JSON.parse(rows[0].execution_context_json || "{}"); } catch {}
  return { ...rows[0], managed: context.contract === "tenant-managed-execution-v1" };
}

function runIdFromPath(pathname) {
  return pathname.match(/^\/(?:managed-execution-runs|workflow-runs)\/([^/]+)(?:\/|$)/u)?.[1] || null;
}

export function buildManagedExecutionRouteAuthorization(deps) {
  const router = Router();
  router.use(deps.requireBackendApiKey);
  router.use(async (req, res, next) => {
    try {
      const pathname = String(req.path || req.url || "").split("?", 1)[0];
      const method = String(req.method || "GET").toUpperCase();
      if (method === "POST" && pathname === "/managed-execution-runs") {
        bindCreationScope(req);
        return next();
      }

      const tenantList = pathname.match(/^\/tenants\/([^/]+)\/workflow-runs$/u);
      if (method === "GET" && tenantList) {
        const scope = principalScope(req);
        requireTenantPrincipal(scope);
        if (!scope.is_admin && tenantList[1] !== scope.tenant_id) {
          throw routeError(
            403,
            "managed_execution_principal_scope_mismatch",
            "Workflow run listing is outside the authenticated tenant scope.",
          );
        }
        return next();
      }

      const runId = runIdFromPath(pathname);
      if (!runId) return next();
      const run = await readRun(runId);
      if (!run || !run.managed) return next();
      assertRunScope(principalScope(req), run);
      return next();
    } catch (error) {
      return routeFailure(res, error);
    }
  });
  return router;
}

export function _testingManagedExecutionRouteAuthorization() {
  return {
    principalScope,
    bindCreationScope,
    assertRunScope,
    runIdFromPath,
  };
}
