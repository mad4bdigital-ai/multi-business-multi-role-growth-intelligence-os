function text(value = "") {
  return String(value ?? "").trim();
}

function bounded(value, maxLength) {
  const normalized = text(value);
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function authObject(input = {}) {
  return input?.auth && typeof input.auth === "object" ? input.auth : input;
}

function claim(auth = {}, ...keys) {
  for (const key of keys) {
    const direct = auth?.[key];
    if (direct !== undefined && direct !== null && direct !== "") return direct;
    const nested = auth?.claims?.[key];
    if (nested !== undefined && nested !== null && nested !== "") return nested;
  }
  return null;
}

export function resolveGovernedResponseChunkPrincipal(input = {}) {
  const auth = authObject(input);
  const sourceSurface = bounded(
    input.sourceSurface || input.source_surface || claim(auth, "source_surface", "runtime_surface"),
    64,
  );
  const workspaceId = bounded(claim(auth, "workspace_id", "workspaceId"), 64);

  if (auth?.is_admin === true) {
    return {
      privileged: true,
      legacy_allowed: true,
      owner_tenant_id: bounded(claim(auth, "tenant_id", "tenantId"), 64),
      owner_user_id: bounded(claim(auth, "user_id", "userId", "sub"), 64),
      owner_workspace_id: workspaceId,
      owner_principal_type: "admin",
      owner_principal_id: bounded(
        claim(auth, "principal_id", "principalId", "user_id", "userId", "sub") || "platform_admin",
        191,
      ),
      source_surface: sourceSurface,
    };
  }

  if (auth?.mode === "backend_api_key") {
    return {
      privileged: true,
      legacy_allowed: true,
      owner_tenant_id: bounded(claim(auth, "tenant_id", "tenantId"), 64),
      owner_user_id: bounded(claim(auth, "user_id", "userId", "sub"), 64),
      owner_workspace_id: workspaceId,
      owner_principal_type: "backend_service",
      owner_principal_id: bounded(
        claim(auth, "principal_id", "principalId", "service_id", "serviceId", "client_id", "clientId") || "backend_api_key",
        191,
      ),
      source_surface: sourceSurface,
    };
  }

  const tenantId = bounded(claim(auth, "tenant_id", "tenantId"), 64);
  const userId = bounded(claim(auth, "user_id", "userId", "sub"), 64);
  if (tenantId && userId) {
    return {
      privileged: false,
      legacy_allowed: false,
      owner_tenant_id: tenantId,
      owner_user_id: userId,
      owner_workspace_id: workspaceId,
      owner_principal_type: "tenant_user",
      owner_principal_id: bounded(claim(auth, "principal_id", "principalId") || userId, 191),
      source_surface: sourceSurface,
    };
  }

  if (input.trustedInternal === true || input.trusted_internal === true) {
    const principalId = bounded(
      input.principalId || input.principal_id || claim(auth, "principal_id", "principalId") || sourceSurface,
      191,
    );
    if (!principalId) return null;
    return {
      privileged: true,
      legacy_allowed: true,
      owner_tenant_id: bounded(claim(auth, "tenant_id", "tenantId"), 64),
      owner_user_id: bounded(claim(auth, "user_id", "userId", "sub"), 64),
      owner_workspace_id: workspaceId,
      owner_principal_type: "trusted_internal",
      owner_principal_id: principalId,
      source_surface: sourceSurface,
    };
  }

  return null;
}

export function governedResponseChunkRowHasOwner(row = {}) {
  return Boolean(
    text(row.owner_tenant_id)
    || text(row.owner_user_id)
    || text(row.owner_principal_type)
    || text(row.owner_principal_id),
  );
}

export function canAccessGovernedResponseChunk(principal, row = {}) {
  if (!principal) return false;
  if (principal.privileged === true) return true;
  if (!governedResponseChunkRowHasOwner(row)) return false;
  return principal.owner_principal_type === "tenant_user"
    && text(row.owner_principal_type) === "tenant_user"
    && text(row.owner_tenant_id) === text(principal.owner_tenant_id)
    && text(row.owner_user_id) === text(principal.owner_user_id)
    && text(row.owner_principal_id) === text(principal.owner_principal_id);
}

export function governedResponseChunkOwnerFields(principal = {}) {
  return {
    owner_tenant_id: principal.owner_tenant_id || null,
    owner_user_id: principal.owner_user_id || null,
    owner_workspace_id: principal.owner_workspace_id || null,
    owner_principal_type: principal.owner_principal_type || null,
    owner_principal_id: principal.owner_principal_id || null,
    source_surface: principal.source_surface || null,
  };
}
