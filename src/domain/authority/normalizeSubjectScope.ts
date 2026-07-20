import {
  PLATFORM_PLACEHOLDER_TENANT_ID,
  type AuthorityActor,
  type NormalizedSubjectScope,
  type ScopeResolution,
  type SubjectScopeRequest,
} from "./authorityTypes";

function clean(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function isPlatformAdmin(actor: AuthorityActor): boolean {
  return actor.principalType === "platform_admin" && actor.platformScopeGranted === true;
}

function success(request: SubjectScopeRequest, tenantId: string | null): ScopeResolution {
  const scope: NormalizedSubjectScope = {
    mode: request.mode,
    tenantId,
    workspaceId: clean(request.workspaceId),
    brandKey: clean(request.brandKey),
    delegationId: clean(request.delegationId),
    reasonCode: clean(request.reasonCode),
    explicitTarget: Boolean(tenantId || clean(request.workspaceId) || clean(request.brandKey)),
  };
  return { ok: true, scope };
}

export function normalizeSubjectScope(
  actor: AuthorityActor,
  request: SubjectScopeRequest,
): ScopeResolution {
  const requestedTenantId = clean(request.tenantId);
  const actorTenantId = clean(actor.tenantId);

  if (isPlatformAdmin(actor)) {
    if (request.mode === "platform_global") {
      return success(request, null);
    }

    if (request.mode === "explicit_tenant_diagnostic") {
      if (!requestedTenantId || requestedTenantId === PLATFORM_PLACEHOLDER_TENANT_ID) {
        return {
          ok: false,
          gap: {
            code: "SCOPE_EXPLICIT_TENANT_REQUIRED",
            layer: "scope",
            message: "An explicit non-placeholder tenant is required for tenant diagnostics.",
          },
        };
      }
      return success(request, requestedTenantId);
    }

    if (request.mode === "delegated_support" || request.mode === "break_glass") {
      if (!requestedTenantId || !clean(request.delegationId)) {
        return {
          ok: false,
          gap: {
            code: "SCOPE_DELEGATION_CONTEXT_REQUIRED",
            layer: "scope",
            message: "Delegated and break-glass scopes require a tenant and delegation context.",
          },
        };
      }
      return success(request, requestedTenantId);
    }

    return {
      ok: false,
      gap: {
        code: "SCOPE_MODE_NOT_ALLOWED_FOR_PLATFORM_ADMIN",
        layer: "scope",
      },
    };
  }

  if (request.mode === "signed_membership") {
    if (!actorTenantId || actorTenantId === PLATFORM_PLACEHOLDER_TENANT_ID) {
      return {
        ok: false,
        gap: { code: "SCOPE_SIGNED_TENANT_REQUIRED", layer: "scope" },
      };
    }
    if (requestedTenantId && requestedTenantId !== actorTenantId) {
      return {
        ok: false,
        gap: {
          code: "SCOPE_TENANT_EXPANSION_FORBIDDEN",
          layer: "scope",
          message: "The requested tenant does not match the authenticated tenant.",
        },
      };
    }
    return success(request, actorTenantId);
  }

  if (actor.principalType === "agency_operator" && request.mode === "agency_assignment") {
    if (!requestedTenantId) {
      return { ok: false, gap: { code: "SCOPE_AGENCY_TENANT_REQUIRED", layer: "scope" } };
    }
    return success(request, requestedTenantId);
  }

  if (
    (actor.principalType === "support_operator" && request.mode === "delegated_support") ||
    (actor.principalType === "agent" && request.mode === "agent_assignment")
  ) {
    if (!requestedTenantId || !clean(request.delegationId)) {
      return { ok: false, gap: { code: "SCOPE_DELEGATION_CONTEXT_REQUIRED", layer: "scope" } };
    }
    return success(request, requestedTenantId);
  }

  return {
    ok: false,
    gap: { code: "SCOPE_MODE_NOT_ALLOWED_FOR_PRINCIPAL", layer: "scope" },
  };
}
