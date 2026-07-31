const FORBIDDEN_PROJECTION_FIELDS = new Set([
  "values", "valuesJson", "values_json", "schema", "schemaJson", "schema_json",
  "defaultValues", "default_values_json", "mergeProfile", "merge_profile_json",
  "idempotencyKey", "idempotency_key", "createdBy", "created_by", "approvedBy",
  "approved_by", "approvalHoldId", "approval_hold_id", "executionContext",
  "execution_context_json", "credential", "credentials", "secret", "token"
]);

export class TenantGrowthControlProjectionError extends Error {
  constructor(code, message, status = 400, details = []) {
    super(message);
    this.name = "TenantGrowthControlProjectionError";
    this.code = code;
    this.status = status;
    this.details = Array.isArray(details) ? details : [];
  }
}

function requiredText(value, field, maxLength) {
  const text = String(value ?? "").trim();
  if (!text || text.length > maxLength) {
    throw new TenantGrowthControlProjectionError(
      "TENANT_GROWTH_CONTROL_VALIDATION_ERROR",
      `${field} is required and must be at most ${maxLength} characters.`,
      400,
      [{ field, issue: "required_or_too_long" }]
    );
  }
  return text;
}

function decodeCursor(value) {
  if (value == null || value === "") return 0;
  try {
    const decoded = Buffer.from(String(value), "base64url").toString("utf8");
    if (!/^\d+$/.test(decoded)) throw new Error("invalid");
    const offset = Number(decoded);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("invalid");
    if (Buffer.from(String(offset), "utf8").toString("base64url") !== String(value)) throw new Error("invalid");
    return offset;
  } catch {
    throw new TenantGrowthControlProjectionError(
      "TENANT_GROWTH_CONTROL_CURSOR_INVALID",
      "cursor must be an opaque cursor returned by this API.",
      400,
      [{ field: "cursor", issue: "invalid" }]
    );
  }
}

export function encodeTenantGrowthControlCursor(offset) {
  return Buffer.from(String(offset), "utf8").toString("base64url");
}

export function assertTenantGrowthControlAuth(auth = {}) {
  if (auth.mode !== "user_jwt" || !auth.user_id || !auth.tenant_id || auth.is_admin === true) {
    throw new TenantGrowthControlProjectionError(
      "TENANT_USER_JWT_REQUIRED",
      "A signed non-admin tenant user JWT is required.",
      401
    );
  }
  return Object.freeze({
    userId: String(auth.user_id),
    tenantId: String(auth.tenant_id),
    tenantRole: auth.tenant_role ? String(auth.tenant_role) : null
  });
}

export function normalizeTenantGrowthControlListQuery(input = {}) {
  const workspaceId = requiredText(input.workspaceId, "workspaceId", 36);
  const brandKey = requiredText(input.brandKey, "brandKey", 128);
  const limit = input.limit == null || input.limit === "" ? 25 : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new TenantGrowthControlProjectionError(
      "TENANT_GROWTH_CONTROL_LIMIT_INVALID",
      "limit must be an integer from 1 to 100.",
      400,
      [{ field: "limit", issue: "out_of_range" }]
    );
  }
  return Object.freeze({ workspaceId, brandKey, limit, offset: decodeCursor(input.cursor) });
}

function assertProjectionSafe(record) {
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_PROJECTION_FIELDS.has(key)) {
      throw new TenantGrowthControlProjectionError(
        "TENANT_GROWTH_CONTROL_PROJECTION_UNSAFE",
        "A restricted field was included in a tenant projection.",
        500,
        [{ field: key, issue: "restricted" }]
      );
    }
  }
  return record;
}

export function projectTenantConfigurationVersion(row = {}) {
  return Object.freeze(assertProjectionSafe({
    configVersionId: row.configVersionId,
    configKey: row.configKey,
    versionNumber: Number(row.versionNumber),
    scopeType: row.scopeType,
    scopeKey: row.scopeKey,
    tenantId: row.tenantId,
    workspaceId: row.workspaceId,
    brandKey: row.brandKey,
    activityTypeKey: row.activityTypeKey || null,
    activityBindingId: row.activityBindingId || null,
    profileKey: row.profileKey || null,
    workflowKey: row.workflowKey || null,
    workflowVersion: row.workflowVersion == null ? null : Number(row.workflowVersion),
    workflowNodeId: row.workflowNodeId || null,
    planId: row.planId || null,
    executionId: row.executionId || null,
    lifecycle: row.lifecycle,
    versionRevision: Number(row.versionRevision),
    checksumSha256: row.checksumSha256,
    effectiveFrom: row.effectiveFrom || null,
    effectiveTo: row.effectiveTo || null,
    createdAt: row.createdAt || null,
    metadataOnly: true,
    secretsIncluded: false
  }));
}

export function projectTenantActivityBinding(row = {}) {
  return Object.freeze(assertProjectionSafe({
    activityBindingId: row.activityBindingId,
    tenantId: row.tenantId,
    workspaceId: row.workspaceId,
    brandKey: row.brandKey,
    activityTypeKey: row.activityTypeKey,
    activityPackKey: row.activityPackKey,
    activityPackVersion: Number(row.activityPackVersion),
    markets: Array.isArray(row.markets) ? row.markets : [],
    locales: Array.isArray(row.locales) ? row.locales : [],
    channels: Array.isArray(row.channels) ? row.channels : [],
    objectives: Array.isArray(row.objectives) ? row.objectives : [],
    allowedCapabilities: Array.isArray(row.allowedCapabilities) ? row.allowedCapabilities : [],
    status: row.status,
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null,
    metadataOnly: true,
    secretsIncluded: false
  }));
}

export const _testingTenantGrowthControlProjection = Object.freeze({
  decodeCursor,
  forbiddenProjectionFields: FORBIDDEN_PROJECTION_FIELDS
});
