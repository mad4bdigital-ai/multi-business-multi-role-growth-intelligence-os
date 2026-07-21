import { getPool } from "./db.js";
import {
  tenantBrandCoreOperationalIndexPreview,
  tenantConnectionCleanupPlan as baseTenantConnectionCleanupPlan,
  tenantConversationOrchestrationPreview,
  tenantConversationOrchestrationReadinessSmoke,
} from "./tenantConversationOrchestrator.js";

function text(value = "", max = 191) {
  return String(value ?? "").trim().slice(0, max);
}

function blocked(code, message) {
  return {
    ok: false,
    tool: "tenant_connection_cleanup_plan",
    status: "authorization_gated",
    error: { code, message },
    provider_calls_made: 0,
    mutations_executed: false,
    external_sends: 0,
    secrets_included: false,
  };
}

function principalScope(args = {}, auth = {}) {
  const admin = auth?.is_admin === true;
  return {
    tenant_id: admin && args.tenant_id ? text(args.tenant_id, 64) : text(auth?.tenant_id, 64),
    user_id: admin && args.user_id ? text(args.user_id, 64) : text(auth?.user_id, 64),
  };
}

export async function tenantConnectionCleanupPlan(args = {}, { auth = {}, pool = getPool() } = {}) {
  const scope = principalScope(args, auth);
  if (!scope.tenant_id || !scope.user_id) {
    return blocked("TENANT_CONTEXT_REQUIRED", "A signed Tenant principal is required.");
  }
  const [rows] = await pool.query(
    `SELECT tenant_id, user_id, role, status
       FROM memberships
      WHERE tenant_id = ?
        AND user_id = ?
        AND status = 'active'
      LIMIT 1`,
    [scope.tenant_id, scope.user_id]
  );
  if (!Array.isArray(rows) || rows.length !== 1) {
    return blocked("ACTIVE_TENANT_MEMBERSHIP_REQUIRED", "An active Tenant membership is required.");
  }
  return baseTenantConnectionCleanupPlan(args, { auth, pool });
}

export {
  tenantBrandCoreOperationalIndexPreview,
  tenantConversationOrchestrationPreview,
  tenantConversationOrchestrationReadinessSmoke,
};
