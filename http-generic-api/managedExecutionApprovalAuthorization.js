import { decideManagedExecutionApproval as decideManagedExecutionApprovalBase } from "./managedExecutionDecisionService.js";
import { managedError } from "./managedExecutionCore.js";
import { appendManagedEvent, withManagedTransaction } from "./managedExecutionPersistence.js";

const TENANT_APPROVAL_ADMIN_ROLES = new Set(["owner", "admin"]);
const APPROVAL_ROLE_GRANTS = Object.freeze({
  supervisor: new Set(["supervisor", "certified_reviewer", "managed_operator"]),
  certified_reviewer: new Set(["certified_reviewer"]),
  managed_operator: new Set(["managed_operator"]),
});
const PLATFORM_ADMIN_ACTORS = new Set(["backend_api_key"]);

function normalized(value) {
  return String(value || "").trim().toLowerCase();
}

export async function assertManagedExecutionApprovalAuthority({
  connection,
  hold,
  decisionBy,
}) {
  const tenantId = String(hold?.tenant_id || "").trim();
  const requiredRole = normalized(hold?.required_role);
  const actor = String(decisionBy || "").trim();
  if (!tenantId || !requiredRole) {
    throw managedError(
      409,
      "managed_execution_approval_contract_invalid",
      "Managed execution approval hold is missing tenant or required-role authority.",
    );
  }

  if (PLATFORM_ADMIN_ACTORS.has(normalized(actor))) {
    return {
      authorized: true,
      source: "platform_admin",
      user_id: null,
      membership_role: null,
      required_role: requiredRole,
      matched_role: "platform_admin",
      secrets_included: false,
    };
  }

  if (!actor) {
    throw managedError(
      403,
      "managed_execution_approval_principal_required",
      "An authenticated tenant principal is required to decide this approval.",
    );
  }

  const [membershipRows] = await connection.query(
    `SELECT user_id, role, status
       FROM memberships
      WHERE tenant_id = ? AND user_id = ?
      LIMIT 2 FOR UPDATE`,
    [tenantId, actor],
  );
  if (membershipRows.length > 1) {
    throw managedError(
      409,
      "managed_execution_approval_membership_ambiguous",
      "Approval principal membership resolved to multiple rows.",
    );
  }
  const membership = membershipRows[0] || null;
  if (!membership || normalized(membership.status) !== "active") {
    throw managedError(
      403,
      "managed_execution_approval_active_membership_required",
      "An active membership in the approval tenant is required.",
    );
  }

  const membershipRole = normalized(membership.role);
  const grantedRoles = APPROVAL_ROLE_GRANTS[membershipRole] || new Set([membershipRole]);
  const matchedRole = TENANT_APPROVAL_ADMIN_ROLES.has(membershipRole)
    ? membershipRole
    : grantedRoles.has(requiredRole)
      ? membershipRole
      : null;
  if (!matchedRole) {
    throw managedError(
      403,
      "managed_execution_approval_role_required",
      `The approval requires role '${requiredRole}' or tenant owner/admin authority.`,
      { required_role: requiredRole, membership_role: membershipRole || null },
    );
  }

  return {
    authorized: true,
    source: TENANT_APPROVAL_ADMIN_ROLES.has(matchedRole)
      ? "tenant_owner_admin"
      : "tenant_required_role",
    user_id: actor,
    membership_role: membership.role || null,
    required_role: requiredRole,
    matched_role: matchedRole,
    secrets_included: false,
  };
}

export async function decideManagedExecutionApproval({
  pool,
  connection: suppliedConnection = null,
  holdId,
  decision,
  decisionBy,
  decisionNote = null,
}) {
  const operation = async (connection) => {
    const [holdRows] = await connection.query(
      "SELECT * FROM approval_holds WHERE hold_id = ? LIMIT 2 FOR UPDATE",
      [holdId],
    );
    if (holdRows.length !== 1) {
      throw managedError(
        404,
        "managed_execution_hold_not_found",
        "Managed execution approval hold was not found.",
      );
    }
    const hold = holdRows[0];
    const decisionAuthority = await assertManagedExecutionApprovalAuthority({
      connection,
      hold,
      decisionBy,
    });
    const [bindingRows] = await connection.query(
      "SELECT binding_id, tenant_id, lifecycle_state FROM managed_execution_bindings WHERE run_id = ? LIMIT 2 FOR UPDATE",
      [hold.run_id],
    );
    if (bindingRows.length !== 1) {
      throw managedError(
        409,
        "managed_execution_binding_missing",
        "Managed execution binding is missing or ambiguous.",
      );
    }
    const binding = bindingRows[0];
    await appendManagedEvent(connection, {
      bindingId: binding.binding_id,
      runId: hold.run_id,
      tenantId: binding.tenant_id,
      eventType: "approval_authority_verified",
      fromState: binding.lifecycle_state,
      toState: binding.lifecycle_state,
      actorId: decisionBy,
      evidence: {
        hold_id: holdId,
        decision_authority: decisionAuthority,
      },
    });
    const result = await decideManagedExecutionApprovalBase({
      pool,
      connection,
      holdId,
      decision,
      decisionBy,
      decisionNote,
    });
    return {
      ...result,
      decision_authority: decisionAuthority,
      secrets_included: false,
    };
  };
  return suppliedConnection
    ? operation(suppliedConnection)
    : withManagedTransaction(pool, operation);
}
