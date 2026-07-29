import {
  AUTHORITY_SCOPE_TYPES,
  PLATFORM_AUTHORITY_SCOPE_KEY,
  AuthorityScopeError,
  authorityPrincipalDescriptor,
  isPlatformPrincipal,
  requireActiveAuthorityScope,
} from "../../domain/authorityScope/authorityScope.js";

function cleanString(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function requireRepository(repository) {
  if (!repository || typeof repository.findByKey !== "function" || typeof repository.findByTenantId !== "function") {
    throw new TypeError("Authority scope service requires findByKey and findByTenantId repository methods.");
  }
}

export function createAuthorityScopeService({ repository, auditWriter = null, requirePlatformTenantAudit = false }) {
  requireRepository(repository);

  async function resolve({ auth = {}, tenantId = null, scopeKey = null, requestId = null } = {}) {
    const explicitTenantId = cleanString(tenantId);
    const explicitScopeKey = cleanString(scopeKey);
    const platformPrincipal = isPlatformPrincipal(auth);
    const principal = authorityPrincipalDescriptor(auth);

    let row = null;
    let selectionMode = null;
    if (explicitScopeKey) {
      row = await repository.findByKey(explicitScopeKey);
      selectionMode = "explicit_scope_key";
    } else if (explicitTenantId) {
      row = await repository.findByTenantId(explicitTenantId);
      selectionMode = "explicit_tenant";
    } else if (platformPrincipal) {
      row = await repository.findByKey(PLATFORM_AUTHORITY_SCOPE_KEY);
      selectionMode = "platform_default";
    } else {
      throw new AuthorityScopeError("AUTHORITY_SCOPE_REQUIRED", "tenantId or scopeKey is required for a tenant principal.", 400);
    }

    if (!row) {
      throw new AuthorityScopeError("AUTHORITY_SCOPE_NOT_REGISTERED", "No registered authority scope matches the request.", 404);
    }

    const scope = requireActiveAuthorityScope(row);
    if (scope.scopeType === AUTHORITY_SCOPE_TYPES.PLATFORM) {
      if (!platformPrincipal) {
        throw new AuthorityScopeError("PLATFORM_SCOPE_FORBIDDEN", "Only a platform principal may resolve the platform authority scope.", 403);
      }
      if (explicitTenantId) {
        throw new AuthorityScopeError("PLATFORM_SCOPE_TENANT_MISMATCH", "Platform authority scope cannot be resolved with a tenant target.", 409);
      }
    } else {
      const principalTenantId = cleanString(auth?.tenant_id);
      if (platformPrincipal) {
        if (!explicitTenantId) {
          throw new AuthorityScopeError("PLATFORM_TENANT_TARGET_REQUIRED", "Platform access to a tenant authority scope requires an explicit tenantId.", 400);
        }
        if (explicitTenantId !== scope.tenantId) {
          throw new AuthorityScopeError("AUTHORITY_SCOPE_TENANT_MISMATCH", "Requested tenant does not match the resolved authority scope.", 409);
        }
      } else {
        if (!principalTenantId || principalTenantId !== scope.tenantId) {
          throw new AuthorityScopeError("CROSS_TENANT_AUTHORITY_SCOPE_DENIED", "Principal cannot resolve an authority scope owned by another tenant.", 403);
        }
        if (explicitTenantId && explicitTenantId !== principalTenantId) {
          throw new AuthorityScopeError("CROSS_TENANT_AUTHORITY_SCOPE_DENIED", "Requested tenant does not match the authenticated tenant.", 403);
        }
      }
    }

    if (platformPrincipal && scope.scopeType === AUTHORITY_SCOPE_TYPES.TENANT) {
      if (requirePlatformTenantAudit && typeof auditWriter !== "function") {
        throw new AuthorityScopeError("AUTHORITY_SCOPE_AUDIT_REQUIRED", "Platform access to a tenant authority scope requires an audit writer.", 503);
      }
      if (typeof auditWriter === "function") {
        try {
          await auditWriter({
            action: "platform_admin_tenant_authority_scope_resolved",
            tenantId: scope.tenantId,
            scopeId: scope.scopeId,
            scopeKey: scope.scopeKey,
            principal,
            requestId: cleanString(requestId),
            selectionMode,
            authorityGranted: false,
          });
        } catch (cause) {
          const error = new AuthorityScopeError("AUTHORITY_SCOPE_AUDIT_FAILED", "Platform tenant authority-scope access could not be audited.", 503);
          error.cause = cause;
          throw error;
        }
      }
    }

    return Object.freeze({
      status: "resolved",
      enforcementMode: "shadow_only",
      source: "authority_scope_registry",
      selectionMode,
      principal,
      scope,
      legacyTenantId: scope.tenantId,
      authorityGranted: false,
    });
  }

  return Object.freeze({ resolve, preview: resolve });
}

export const _testingAuthorityScopeService = Object.freeze({ cleanString });
