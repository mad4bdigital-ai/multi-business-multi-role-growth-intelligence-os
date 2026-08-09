import { createAuthorizedScopeRepository } from "./contextKernel/infrastructure/sql/authorizedScopeRepository.js";
import { createWorkspaceOwnershipRepository } from "./contextKernel/infrastructure/sql/workspaceOwnershipRepository.js";

function authorityError(status, code, message, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details) error.details = details;
  return error;
}

function required(value, field) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw authorityError(400, `tenant_managed_repair_${field}_required`, `${field} is required.`);
  }
  return normalized;
}

function assertUserJwtContext(authContext = {}) {
  if (String(authContext.mode || "").trim() !== "user_jwt" || authContext.is_admin === true) {
    throw authorityError(
      403,
      "tenant_managed_repair_user_jwt_required",
      "Tenant managed repair requires an authenticated User-JWT principal.",
    );
  }
  return Object.freeze({
    tenant_id: required(authContext.tenant_id, "tenant_id"),
    user_id: required(authContext.user_id, "user_id"),
    tenant_role: String(authContext.tenant_role || "").trim() || null,
  });
}

function findWorkspace(scope, workspaceRef) {
  const workspaces = Array.isArray(scope?.workspaces) ? scope.workspaces : [];
  const matches = workspaces.filter((workspace) => String(workspace?.workspaceRef || "").trim() === workspaceRef);
  if (matches.length > 1) {
    throw authorityError(
      409,
      "tenant_managed_repair_workspace_scope_ambiguous",
      "Requested workspace resolved to multiple authorized scope rows.",
      { workspace_ref: workspaceRef, candidate_count: matches.length },
    );
  }
  return matches[0] || null;
}

export async function resolveTenantPlatformPluginManagedRepairAuthority({
  authContext = {},
  workspaceRef,
  pool = null,
  authorizedScopeRepository = null,
  workspaceOwnershipRepository = null,
} = {}) {
  const principal = assertUserJwtContext(authContext);
  const requestedWorkspaceRef = required(workspaceRef, "workspace_id");
  const scopeRepository = authorizedScopeRepository || createAuthorizedScopeRepository({ pool });
  const ownershipRepository = workspaceOwnershipRepository || createWorkspaceOwnershipRepository({ pool });

  const scope = await scopeRepository.findAuthorizedScope({
    tenantRef: principal.tenant_id,
    userRef: principal.user_id,
  });
  if (!scope || scope.membership?.status !== "active") {
    throw authorityError(
      403,
      "tenant_managed_repair_active_membership_required",
      "Active tenant membership is required for managed repair.",
      { tenant_ref: principal.tenant_id },
    );
  }

  const workspace = findWorkspace(scope, requestedWorkspaceRef);
  if (!workspace) {
    throw authorityError(
      403,
      "tenant_managed_repair_workspace_membership_required",
      "The authenticated user is not authorized for the requested workspace.",
      { tenant_ref: principal.tenant_id, workspace_ref: requestedWorkspaceRef },
    );
  }

  const ownership = await ownershipRepository.findWorkspaceOwnership({
    tenantRef: principal.tenant_id,
    workspaceRef: requestedWorkspaceRef,
  });
  if (!ownership) {
    throw authorityError(
      404,
      "tenant_managed_repair_workspace_not_found",
      "No authoritative workspace ownership record was found.",
      { tenant_ref: principal.tenant_id, workspace_ref: requestedWorkspaceRef },
    );
  }
  if (ownership.tenantRef !== principal.tenant_id || ownership.workspaceRef !== requestedWorkspaceRef) {
    throw authorityError(
      409,
      "tenant_managed_repair_workspace_context_mismatch",
      "Workspace ownership does not match the authenticated tenant context.",
    );
  }

  const ownershipType = String(ownership.workspaceOwnershipType || "").trim().toLowerCase();
  if (!new Set(["personal", "company"]).has(ownershipType)) {
    throw authorityError(
      409,
      "tenant_managed_repair_workspace_ownership_unclassified",
      "Workspace ownership must be classified as personal or company.",
      { workspace_ownership_type: ownershipType || null },
    );
  }
  if (ownershipType === "personal" && String(ownership.ownerUserRef || "").trim() !== principal.user_id) {
    throw authorityError(
      403,
      "tenant_managed_repair_personal_owner_mismatch",
      "Personal workspace owner does not match the authenticated user.",
      { workspace_ref: requestedWorkspaceRef },
    );
  }

  return Object.freeze({
    mode: "user_jwt",
    is_admin: false,
    tenant_id: principal.tenant_id,
    user_id: principal.user_id,
    tenant_role: scope.membership?.role || principal.tenant_role,
    workspace_id: requestedWorkspaceRef,
    workspace_ownership_type: ownershipType,
    workspace_ownership_revision: Number(ownership.ownershipRevision || 0),
    source: "context_kernel_authorized_scope_and_workspace_ownership",
    secrets_included: false,
  });
}

export const _testingTenantPlatformPluginManagedRepairAuthority = {
  assertUserJwtContext,
  findWorkspace,
};
