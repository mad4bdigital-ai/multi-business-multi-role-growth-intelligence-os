export const AUTHORITY_SCOPE_TYPES = Object.freeze({
  PLATFORM: "platform",
  TENANT: "tenant",
});

export const AUTHORITY_SCOPE_STATUSES = Object.freeze({
  ACTIVE: "active",
  SUSPENDED: "suspended",
  ARCHIVED: "archived",
});

export const PLATFORM_AUTHORITY_SCOPE_KEY = "platform:root";

const VALID_SCOPE_TYPES = new Set(Object.values(AUTHORITY_SCOPE_TYPES));
const VALID_SCOPE_STATUSES = new Set(Object.values(AUTHORITY_SCOPE_STATUSES));

export class AuthorityScopeError extends Error {
  constructor(code, message, status = 500, details = undefined) {
    super(message);
    this.name = "AuthorityScopeError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function cleanString(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function requireString(value, code, message, status = 400) {
  const normalized = cleanString(value);
  if (!normalized) throw new AuthorityScopeError(code, message, status);
  return normalized;
}

export function tenantAuthorityScopeKey(tenantId) {
  return `tenant:${requireString(
    tenantId,
    "TENANT_ID_REQUIRED",
    "tenantId is required to derive a tenant authority scope."
  )}`;
}

export function isPlatformPrincipal(auth = {}) {
  return Boolean(
    auth?.is_admin === true ||
      auth?.mode === "backend_api_key" ||
      auth?.principal_type === "platform_admin"
  );
}

export function normalizeAuthorityScope(record = {}) {
  const scopeType = requireString(
    record.scopeType ?? record.scope_type,
    "AUTHORITY_SCOPE_TYPE_REQUIRED",
    "Authority scope type is required."
  );
  if (!VALID_SCOPE_TYPES.has(scopeType)) {
    throw new AuthorityScopeError(
      "AUTHORITY_SCOPE_TYPE_INVALID",
      `Unsupported authority scope type: ${scopeType}.`,
      422
    );
  }

  const tenantId = cleanString(record.tenantId ?? record.tenant_id);
  if (scopeType === AUTHORITY_SCOPE_TYPES.PLATFORM && tenantId) {
    throw new AuthorityScopeError(
      "PLATFORM_SCOPE_TENANT_FORBIDDEN",
      "Platform authority scope cannot carry tenant ownership.",
      422
    );
  }
  if (scopeType === AUTHORITY_SCOPE_TYPES.TENANT && !tenantId) {
    throw new AuthorityScopeError(
      "TENANT_SCOPE_TENANT_REQUIRED",
      "Tenant authority scope requires tenant ownership.",
      422
    );
  }

  const scopeKey = requireString(
    record.scopeKey ?? record.scope_key,
    "AUTHORITY_SCOPE_KEY_REQUIRED",
    "Authority scope key is required."
  );
  const expectedScopeKey =
    scopeType === AUTHORITY_SCOPE_TYPES.PLATFORM
      ? PLATFORM_AUTHORITY_SCOPE_KEY
      : tenantAuthorityScopeKey(tenantId);
  if (scopeKey !== expectedScopeKey) {
    throw new AuthorityScopeError(
      "AUTHORITY_SCOPE_KEY_MISMATCH",
      "Authority scope key does not match its scope type and owner.",
      422,
      { expectedScopeKey }
    );
  }

  const scopeId = requireString(
    record.scopeId ?? record.scope_id,
    "AUTHORITY_SCOPE_ID_REQUIRED",
    "Authority scope id is required."
  );
  const status = cleanString(record.status) || AUTHORITY_SCOPE_STATUSES.ACTIVE;
  if (!VALID_SCOPE_STATUSES.has(status)) {
    throw new AuthorityScopeError(
      "AUTHORITY_SCOPE_STATUS_INVALID",
      `Unsupported authority scope status: ${status}.`,
      422
    );
  }

  const parsedVersion = Number.parseInt(String(record.version ?? 1), 10);
  if (!Number.isInteger(parsedVersion) || parsedVersion < 1) {
    throw new AuthorityScopeError(
      "AUTHORITY_SCOPE_VERSION_INVALID",
      "Authority scope version must be a positive integer.",
      422
    );
  }

  return Object.freeze({
    scopeId,
    scopeKey,
    scopeType,
    tenantId,
    status,
    version: parsedVersion,
    metadata: record.metadata ?? record.metadata_json ?? null,
    createdAt: record.createdAt ?? record.created_at ?? null,
    updatedAt: record.updatedAt ?? record.updated_at ?? null,
  });
}

export function requireActiveAuthorityScope(scope) {
  const normalized = normalizeAuthorityScope(scope);
  if (normalized.status !== AUTHORITY_SCOPE_STATUSES.ACTIVE) {
    throw new AuthorityScopeError(
      "AUTHORITY_SCOPE_INACTIVE",
      "Authority scope is not active.",
      409,
      { scopeKey: normalized.scopeKey, status: normalized.status }
    );
  }
  return normalized;
}

export function authorityPrincipalDescriptor(auth = {}) {
  if (isPlatformPrincipal(auth)) {
    return Object.freeze({
      principalType: "platform_admin",
      principalId: cleanString(auth?.user_id) || "platform_admin",
    });
  }

  const principalId =
    cleanString(auth?.user_id) ||
    cleanString(auth?.principal_id) ||
    cleanString(auth?.agent_id) ||
    cleanString(auth?.service_id);
  if (!principalId) {
    throw new AuthorityScopeError(
      "AUTHENTICATED_PRINCIPAL_REQUIRED",
      "An authenticated principal identifier is required.",
      401
    );
  }

  return Object.freeze({
    principalType: cleanString(auth?.principal_type) || "tenant_member",
    principalId,
  });
}
