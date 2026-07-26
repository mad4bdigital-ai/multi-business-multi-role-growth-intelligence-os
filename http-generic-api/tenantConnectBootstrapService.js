function bootstrapFailure(status, code, message, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details) error.details = details;
  return error;
}

export async function orchestrateTenantConnectBootstrap({
  user_id,
  jwt_tenant_id = null,
  workspace_name = null,
  mode = "managed",
} = {}, {
  resolveState,
  applyManagedBootstrap,
  now = () => new Date(),
} = {}) {
  if (!user_id) throw bootstrapFailure(401, "user_jwt_required", "Sign in required.");
  if (mode !== "managed") {
    throw bootstrapFailure(400, "bootstrap_managed_only", "connect_bootstrap currently supports Managed mode only.");
  }
  if (typeof applyManagedBootstrap !== "function") {
    throw new TypeError("applyManagedBootstrap is required.");
  }

  const bootstrapResult = await applyManagedBootstrap({
    userId: user_id,
    jwtTenantId: jwt_tenant_id || null,
    displayName: workspace_name,
    source: "connect_bootstrap",
  });
  const tenantId = bootstrapResult?.tenant_id || null;
  if (!tenantId || bootstrapResult?.readback?.verified !== true) {
    throw bootstrapFailure(503, "activation_validation_failed", "Managed activation could not be verified by transactional readback.");
  }

  // Rich onboarding readiness may involve optional tables and providers. It is
  // intentionally post-commit enrichment: the core success signal comes only
  // from the verified in-transaction membership and connection readback.
  let finalState = null;
  if (typeof resolveState === "function") {
    try {
      finalState = await resolveState(user_id, tenantId);
    } catch {
      finalState = null;
    }
  }
  const connection = bootstrapResult.connection;
  const finalMembership = bootstrapResult.membership || null;

  return {
    ok: true,
    bootstrap: {
      account: "existing",
      tenant: bootstrapResult.workspace_created ? "created" : "existing",
      workspace: bootstrapResult.workspace_created ? "created" : "existing",
      connection: bootstrapResult.activated ? "activated" : "existing",
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
