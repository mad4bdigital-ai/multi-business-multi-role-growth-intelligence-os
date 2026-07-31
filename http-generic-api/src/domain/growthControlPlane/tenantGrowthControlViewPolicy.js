const ROLE_PROFILE_ALIASES = Object.freeze({
  manager: Object.freeze([
    "owner",
    "tenant_owner",
    "administrator",
    "admin",
    "manager",
  ]),
  operator: Object.freeze([
    "operator",
    "editor",
    "contributor",
    "marketer",
  ]),
  viewer: Object.freeze([
    "member",
    "viewer",
    "analyst",
    "auditor",
    "read_only",
    "readonly",
  ]),
});

const RESOURCE_FIELD_ALLOWLISTS = Object.freeze({
  configuration_version: Object.freeze({
    viewer: Object.freeze([
      "configVersionId",
      "configKey",
      "versionNumber",
      "scopeType",
      "lifecycle",
      "checksumSha256",
      "effectiveFrom",
      "effectiveTo",
      "metadataOnly",
      "secretsIncluded",
    ]),
    operator: Object.freeze([
      "configVersionId",
      "configKey",
      "versionNumber",
      "scopeType",
      "scopeKey",
      "tenantId",
      "workspaceId",
      "brandKey",
      "activityTypeKey",
      "activityBindingId",
      "profileKey",
      "workflowKey",
      "workflowVersion",
      "lifecycle",
      "versionRevision",
      "checksumSha256",
      "effectiveFrom",
      "effectiveTo",
      "createdAt",
      "metadataOnly",
      "secretsIncluded",
    ]),
    manager: Object.freeze([
      "configVersionId",
      "configKey",
      "versionNumber",
      "scopeType",
      "scopeKey",
      "tenantId",
      "workspaceId",
      "brandKey",
      "activityTypeKey",
      "activityBindingId",
      "profileKey",
      "workflowKey",
      "workflowVersion",
      "workflowNodeId",
      "planId",
      "executionId",
      "lifecycle",
      "versionRevision",
      "checksumSha256",
      "effectiveFrom",
      "effectiveTo",
      "createdAt",
      "metadataOnly",
      "secretsIncluded",
    ]),
  }),
  activity_binding: Object.freeze({
    viewer: Object.freeze([
      "activityBindingId",
      "activityTypeKey",
      "activityPackKey",
      "activityPackVersion",
      "markets",
      "locales",
      "channels",
      "objectives",
      "status",
      "metadataOnly",
      "secretsIncluded",
    ]),
    operator: Object.freeze([
      "activityBindingId",
      "tenantId",
      "workspaceId",
      "brandKey",
      "activityTypeKey",
      "activityPackKey",
      "activityPackVersion",
      "markets",
      "locales",
      "channels",
      "objectives",
      "allowedCapabilities",
      "status",
      "updatedAt",
      "metadataOnly",
      "secretsIncluded",
    ]),
    manager: Object.freeze([
      "activityBindingId",
      "tenantId",
      "workspaceId",
      "brandKey",
      "activityTypeKey",
      "activityPackKey",
      "activityPackVersion",
      "markets",
      "locales",
      "channels",
      "objectives",
      "allowedCapabilities",
      "status",
      "createdAt",
      "updatedAt",
      "metadataOnly",
      "secretsIncluded",
    ]),
  }),
});

const ROLE_TO_PROFILE = Object.freeze(Object.fromEntries(
  Object.entries(ROLE_PROFILE_ALIASES).flatMap(([profile, aliases]) => aliases.map((alias) => [alias, profile])),
));

function normalizeRole(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s.-]+/g, "_")
    .slice(0, 64);
}

export function resolveTenantGrowthControlRoleProfile(role) {
  const normalizedRole = normalizeRole(role);
  const profile = ROLE_TO_PROFILE[normalizedRole] || "viewer";
  return Object.freeze({
    role: normalizedRole || null,
    profile,
    recognized: Boolean(ROLE_TO_PROFILE[normalizedRole]),
    fallbackApplied: !ROLE_TO_PROFILE[normalizedRole],
  });
}

function requireResourcePolicy(resourceType) {
  const normalized = String(resourceType ?? "").trim();
  const policy = RESOURCE_FIELD_ALLOWLISTS[normalized];
  if (!policy) {
    const error = new Error(`Unsupported tenant Growth Control resource policy: ${normalized || "missing"}.`);
    error.code = "TENANT_GROWTH_CONTROL_FIELD_POLICY_UNKNOWN";
    error.status = 500;
    throw error;
  }
  return Object.freeze({ resourceType: normalized, policy });
}

export function buildTenantGrowthControlFieldPolicy(resourceType, role) {
  const resource = requireResourcePolicy(resourceType);
  const roleProfile = resolveTenantGrowthControlRoleProfile(role);
  const allowedFields = resource.policy[roleProfile.profile];
  return Object.freeze({
    contract: "mad4b.growth-control.tenant-field-policy.v1",
    policyVersion: 1,
    resourceType: resource.resourceType,
    role: roleProfile.role,
    profile: roleProfile.profile,
    roleRecognized: roleProfile.recognized,
    fallbackApplied: roleProfile.fallbackApplied,
    defaultDeny: true,
    allowedFields,
    secretsIncluded: false,
  });
}

export function applyTenantGrowthControlFieldPolicy(resourceType, source = {}, role = null) {
  const fieldPolicy = buildTenantGrowthControlFieldPolicy(resourceType, role);
  const projected = {};
  for (const field of fieldPolicy.allowedFields) {
    if (Object.hasOwn(source, field)) projected[field] = source[field];
  }
  return Object.freeze({
    record: Object.freeze(projected),
    fieldPolicy,
  });
}

export const _testingTenantGrowthControlViewPolicy = Object.freeze({
  ROLE_PROFILE_ALIASES,
  RESOURCE_FIELD_ALLOWLISTS,
  ROLE_TO_PROFILE,
  normalizeRole,
  requireResourcePolicy,
});
