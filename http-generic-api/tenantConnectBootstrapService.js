function bootstrapFailure(status, code, message, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details) error.details = details;
  return error;
}

function safeMemberships(state = {}) {
  return Array.isArray(state.memberships) ? state.memberships : [];
}

function activeWorkspaceOptions(memberships = []) {
  return memberships
    .filter((membership) => membership.tenant_status === undefined || membership.tenant_status === "active")
    .map((membership) => ({
      workspace_key: membership.tenant_id,
      display_name: membership.tenant_display_name || membership.display_name || null,
      role: membership.role || null,
    }));
}

export async function orchestrateTenantConnectBootstrap({
  user_id,
  jwt_tenant_id = null,
  workspace_name = null,
  mode = "managed",
} = {}, {
  resolveState,
  createWorkspace,
  activateManaged,
  now = () => new Date(),
} = {}) {
  if (!user_id) throw bootstrapFailure(401, "user_jwt_required", "Sign in required.");
  if (mode !== "managed") {
    throw bootstrapFailure(400, "bootstrap_managed_only", "connect_bootstrap currently supports Managed mode only.");
  }
  if (typeof resolveState !== "function" || typeof createWorkspace !== "function" || typeof activateManaged !== "function") {
    throw new TypeError("resolveState, createWorkspace, and activateManaged are required.");
  }

  const initial = await resolveState(user_id, jwt_tenant_id || null);
  if (!initial?.user) throw bootstrapFailure(404, "user_not_found", "User not found.");

  const memberships = safeMemberships(initial);
  const activeOptions = activeWorkspaceOptions(memberships);

  if (jwt_tenant_id) {
    const selected = memberships.find((membership) => membership.tenant_id === jwt_tenant_id);
    if (!selected) {
      throw bootstrapFailure(403, "tenant_membership_required", "The signed-in user does not have access to the selected workspace.");
    }
    if (selected.tenant_status !== undefined && selected.tenant_status !== "active") {
      throw bootstrapFailure(403, "tenant_suspended", "The selected workspace is not active.");
    }
  } else if (activeOptions.length > 1) {
    throw bootstrapFailure(409, "tenant_selection_required", "Choose a workspace before activation.", {
      workspaces: activeOptions,
    });
  }

  if (!activeOptions.length && memberships.some((membership) => membership.tenant_status && membership.tenant_status !== "active")) {
    throw bootstrapFailure(403, "tenant_suspended", "The existing workspace is not active.");
  }

  let tenantId = jwt_tenant_id || initial.resolvedTenantId || activeOptions[0]?.workspace_key || null;
  let workspaceCreated = false;

  if (!tenantId) {
    const workspace = await createWorkspace({
      userId: user_id,
      displayName: workspace_name,
      source: "connect_bootstrap",
    });
    tenantId = workspace?.tenant_id || null;
    workspaceCreated = Boolean(workspace?.created);
  }

  if (!tenantId) {
    throw bootstrapFailure(500, "tenant_provisioning_failed", "Workspace provisioning did not return a workspace identifier.");
  }

  const activationResult = await activateManaged({ userId: user_id, tenantId });
  const finalState = await resolveState(user_id, tenantId);
  const connection = finalState?.connection || activationResult?.connection || null;

  if (!connection || connection.status !== "active" || connection.connection_mode !== "managed") {
    throw bootstrapFailure(503, "activation_validation_failed", "Managed activation could not be verified by final readback.");
  }

  const finalMemberships = safeMemberships(finalState);
  const finalMembership = finalMemberships.find((membership) => membership.tenant_id === tenantId)
    || finalState?.membership
    || null;

  return {
    ok: true,
    bootstrap: {
      account: "existing",
      tenant: workspaceCreated ? "created" : "existing",
      workspace: workspaceCreated ? "created" : "existing",
      connection: activationResult?.activated ? "activated" : "existing",
    },
    principal: {
      workspace_key: tenantId,
      role: finalMembership?.role || "owner",
    },
    activation: {
      mode: "managed",
      status: connection.status,
      validation_status: "verified",
    },
    onboarding: finalState?.onboarding || null,
    next_actions: finalState?.onboarding?.allowed_actions || [],
    readback: {
      verified: true,
      checked_at: now().toISOString(),
    },
    secrets_included: false,
  };
}
