import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import { upsertTenantIntegrationPolicies } from "./hybridIntegrationPolicy.js";

const OPTIONAL_SCHEMA_ERRORS = new Set(["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"]);

function bootstrapFailure(status, code, message, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details) error.details = details;
  return error;
}

function workspaceDisplayName(value, user) {
  const cleaned = String(value || "").trim().slice(0, 120);
  if (cleaned) return cleaned;
  return `${user?.display_name || user?.email || "User"}'s workspace`;
}

function activeWorkspaceOptions(memberships = []) {
  return memberships
    .filter((membership) => membership.membership_status === "active" && membership.tenant_status === "active")
    .map((membership) => ({
      workspace_key: membership.tenant_id,
      display_name: membership.tenant_display_name || null,
      role: membership.role || null,
    }));
}

function verifyReadback({ membership, connection, tenantId }) {
  if (
    !membership
    || membership.tenant_id !== tenantId
    || membership.membership_status !== "active"
    || membership.tenant_status !== "active"
    || !connection
    || connection.tenant_id !== tenantId
    || connection.status !== "active"
    || connection.connection_mode !== "managed"
  ) {
    throw bootstrapFailure(
      503,
      "activation_validation_failed",
      "Managed activation could not be verified by transactional readback."
    );
  }
}

export async function executeTenantConnectBootstrapTransaction({
  userId,
  jwtTenantId = null,
  displayName = null,
  source = "connect_bootstrap",
} = {}, {
  pool = null,
  idFactory = randomUUID,
  upsertIntegrationPolicies = upsertTenantIntegrationPolicies,
} = {}) {
  if (!userId) throw bootstrapFailure(401, "user_jwt_required", "Sign in required.");

  const activePool = pool || getPool();
  if (typeof activePool?.getConnection !== "function") {
    throw bootstrapFailure(
      503,
      "connect_bootstrap_transaction_unavailable",
      "Managed bootstrap requires a transaction-capable database connection."
    );
  }

  const transaction = await activePool.getConnection();
  let transactionStarted = false;
  try {
    await transaction.beginTransaction();
    transactionStarted = true;

    // Locking the user serializes concurrent tenantless bootstrap attempts for
    // one principal, preventing two workspaces from being created in parallel.
    const [userRows] = await transaction.query(
      "SELECT user_id, email, display_name FROM `users` WHERE user_id = ? AND status = 'active' LIMIT 1 FOR UPDATE",
      [userId]
    );
    const user = userRows[0] || null;
    if (!user) throw bootstrapFailure(404, "user_not_found", "User not found or inactive.");

    const [membershipRows] = await transaction.query(
      `SELECT m.tenant_id,
              m.role,
              m.status AS membership_status,
              t.status AS tenant_status,
              t.display_name AS tenant_display_name
         FROM memberships m
         LEFT JOIN tenants t ON t.tenant_id = m.tenant_id
        WHERE m.user_id = ?
        ORDER BY m.granted_at ASC
        FOR UPDATE`,
      [userId]
    );
    const memberships = membershipRows || [];
    const activeOptions = activeWorkspaceOptions(memberships);

    let selectedMembership = null;
    if (jwtTenantId) {
      selectedMembership = memberships.find((membership) => (
        membership.tenant_id === jwtTenantId && membership.membership_status === "active"
      )) || null;
      if (!selectedMembership) {
        throw bootstrapFailure(
          403,
          "tenant_membership_required",
          "The signed-in user does not have access to the selected workspace."
        );
      }
      if (selectedMembership.tenant_status !== "active") {
        throw bootstrapFailure(403, "tenant_suspended", "The selected workspace is not active.");
      }
    } else if (activeOptions.length > 1) {
      throw bootstrapFailure(409, "tenant_selection_required", "Choose a workspace before activation.", {
        workspaces: activeOptions,
      });
    } else {
      selectedMembership = memberships.find((membership) => (
        membership.membership_status === "active" && membership.tenant_status === "active"
      )) || null;
    }

    if (!selectedMembership && memberships.some((membership) => membership.membership_status !== "active")) {
      throw bootstrapFailure(403, "membership_revoked", "The existing workspace membership is not active.");
    }
    if (!selectedMembership && memberships.some((membership) => membership.tenant_status !== "active")) {
      throw bootstrapFailure(403, "tenant_suspended", "The existing workspace is not active.");
    }

    let tenantId = jwtTenantId || selectedMembership?.tenant_id || null;
    let workspaceCreated = false;
    if (!tenantId) {
      tenantId = idFactory();
      const tenantName = workspaceDisplayName(displayName, user);
      await transaction.query(
        `INSERT INTO \`tenants\` (tenant_id, tenant_type, display_name, status, metadata_json)
         VALUES (?, 'managed_client_account', ?, 'active', ?)`,
        [tenantId, tenantName, JSON.stringify({ source, user_id: userId })]
      );
      await transaction.query(
        `INSERT INTO \`memberships\` (user_id, tenant_id, role, status)
         VALUES (?, ?, 'owner', 'active')`,
        [userId, tenantId]
      );
      try {
        await transaction.query(
          `UPDATE \`onboarding_escalations\`
              SET tenant_id = COALESCE(tenant_id, ?), status = IF(status = 'open', 'in_review', status)
            WHERE user_id = ? AND tenant_id IS NULL`,
          [tenantId, userId]
        );
      } catch (error) {
        if (!OPTIONAL_SCHEMA_ERRORS.has(error?.code)) throw error;
      }
      workspaceCreated = true;
    }

    const [existingConnectionRows] = await transaction.query(
      "SELECT * FROM `tenant_backend_connections` WHERE tenant_id = ? LIMIT 1 FOR UPDATE",
      [tenantId]
    );
    const existingConnection = existingConnectionRows[0] || null;
    const alreadyActive = existingConnection?.status === "active"
      && existingConnection?.connection_mode === "managed";

    if (!alreadyActive) {
      await transaction.query(
        `INSERT INTO \`tenant_backend_connections\`
           (connection_id, tenant_id, connection_mode, cloudflare_mode, google_auth_mode, n8n_activation_mode, status, activated_at)
         VALUES (?, ?, 'managed', 'managed', 'managed', 'managed_main_server', 'active', NOW())
         ON DUPLICATE KEY UPDATE
           connection_mode = 'managed',
           cloudflare_mode = 'managed',
           google_auth_mode = 'managed',
           n8n_activation_mode = 'managed_main_server',
           status = 'active',
           activated_at = COALESCE(activated_at, NOW()),
           updated_at = NOW()`,
        [idFactory(), tenantId]
      );
    }

    await upsertIntegrationPolicies({
      tenantId,
      userId,
      integrationModes: {},
      source,
      db: transaction,
    });

    const [readbackMembershipRows] = await transaction.query(
      `SELECT m.tenant_id,
              m.role,
              m.status AS membership_status,
              t.status AS tenant_status,
              t.display_name AS tenant_display_name
         FROM memberships m
         JOIN tenants t ON t.tenant_id = m.tenant_id
        WHERE m.user_id = ? AND m.tenant_id = ?
        LIMIT 1`,
      [userId, tenantId]
    );
    const [readbackConnectionRows] = await transaction.query(
      "SELECT * FROM `tenant_backend_connections` WHERE tenant_id = ? LIMIT 1",
      [tenantId]
    );
    const membership = readbackMembershipRows[0] || null;
    const connection = readbackConnectionRows[0] || null;
    verifyReadback({ membership, connection, tenantId });

    const result = {
      user,
      tenant_id: tenantId,
      membership,
      connection,
      workspace_created: workspaceCreated,
      activated: !alreadyActive,
      readback: { verified: true, before_commit: true },
    };
    await transaction.commit();
    transactionStarted = false;
    return result;
  } catch (error) {
    if (transactionStarted) {
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        const failure = bootstrapFailure(
          500,
          "connect_bootstrap_transaction_rollback_failed",
          "Managed bootstrap rollback could not be verified.",
          {
            original_code: error?.code || null,
            rollback_code: rollbackError?.code || null,
            state: "indeterminate",
          }
        );
        failure.cause = error;
        throw failure;
      }
    }
    throw error;
  } finally {
    transaction.release();
  }
}
