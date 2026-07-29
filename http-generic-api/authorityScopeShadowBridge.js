import { getPool } from "./db.js";
import { writeAuditLog } from "./auditLogger.js";
import { createAuthorityScopeService } from "./src/application/authorityScope/authorityScopeService.js";
import { createAuthorityScopeRepository } from "./src/infrastructure/authorityScope/authorityScopeRepository.js";

let defaultService = null;

function cleanString(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function getDefaultService() {
  if (defaultService) return defaultService;
  const repository = createAuthorityScopeRepository({
    resolvePool: async () => getPool()
  });
  defaultService = createAuthorityScopeService({
    repository,
    requirePlatformTenantAudit: true,
    auditWriter: (event) => writeAuditLog({
      tenant_id: event.tenantId,
      actor_id: event.principal?.principalId || "platform_admin",
      actor_type: "service",
      request_id: event.requestId,
      action: event.action,
      resource_type: "authority_scope",
      resource_id: event.scopeKey,
      service_mode: "platform_admin",
      outcome: "resolved_shadow_only",
      metadata: {
        scope_id: event.scopeId,
        selection_mode: event.selectionMode,
        authority_granted: false,
        secrets_included: false,
      },
    }),
  });
  return defaultService;
}

export function principalToAuthorityAuth(principal = {}, tenantId = null) {
  const type = cleanString(principal?.type)?.toLowerCase() || "tenant_member";
  const id = cleanString(principal?.id);
  const normalizedTenantId = cleanString(tenantId);
  const isPlatformAdmin = type === "service" && id === "platform_admin";

  if (isPlatformAdmin) {
    return Object.freeze({
      mode: "backend_api_key",
      is_admin: true,
      principal_type: "platform_admin",
      user_id: id
    });
  }

  return Object.freeze({
    principal_type: type,
    principal_id: id,
    user_id: type === "user" ? id : null,
    agent_id: type === "agent" ? id : null,
    service_id: type === "service" ? id : null,
    tenant_id: normalizedTenantId
  });
}

export function compareAuthorityScopeShadow({ tenantId, resolution } = {}) {
  const expectedTenantId = cleanString(tenantId);
  const scope = resolution?.scope || null;
  if (!scope) {
    return Object.freeze({
      status: "unresolved",
      mismatchCodes: ["authority_scope_unresolved"]
    });
  }

  const mismatchCodes = [];
  if (scope.scopeType !== "tenant") mismatchCodes.push("authority_scope_type_mismatch");
  if (cleanString(scope.tenantId) !== expectedTenantId) mismatchCodes.push("authority_scope_tenant_mismatch");

  return Object.freeze({
    status: mismatchCodes.length ? "mismatch" : "match",
    mismatchCodes
  });
}

export async function resolveAuthorityScopeShadowContext(input = {}, dependencies = {}) {
  const startedAt = performance.now();
  const service = dependencies.service || getDefaultService();
  const tenantId = cleanString(input.tenantId);
  const scopeKey = cleanString(input.scopeKey);

  try {
    const resolution = await service.preview({
      auth: principalToAuthorityAuth(input.principal, tenantId),
      tenantId,
      scopeKey,
      requestId: cleanString(input.requestId),
    });
    const comparison = compareAuthorityScopeShadow({ tenantId, resolution });

    return Object.freeze({
      status: "resolved",
      enforcementMode: "shadow_only",
      authorityGranted: false,
      source: resolution.source,
      selectionMode: resolution.selectionMode,
      principal: resolution.principal,
      scope: resolution.scope,
      comparisonStatus: comparison.status,
      mismatchCodes: comparison.mismatchCodes,
      requestId: cleanString(input.requestId),
      durationMs: performance.now() - startedAt,
      providerCallMade: false,
      credentialPayloadRead: false,
      secretsIncluded: false
    });
  } catch (error) {
    const code = cleanString(error?.code) || "AUTHORITY_SCOPE_SHADOW_UNRESOLVED";
    return Object.freeze({
      status: "unresolved",
      enforcementMode: "shadow_only",
      authorityGranted: false,
      comparisonStatus: "unresolved",
      mismatchCodes: [code],
      error: Object.freeze({
        code,
        status: Number(error?.status || 500)
      }),
      requestId: cleanString(input.requestId),
      durationMs: performance.now() - startedAt,
      providerCallMade: false,
      credentialPayloadRead: false,
      secretsIncluded: false
    });
  }
}

export function resetAuthorityScopeShadowBridgeForTests() {
  defaultService = null;
}
