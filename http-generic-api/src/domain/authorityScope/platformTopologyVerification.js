export const PLATFORM_TOPOLOGY_CONTRACT = Object.freeze({
  authorityScopeKey: "platform:root",
  adminWorkspaceKey: "platform_admin_workspace",
  platformBrandTargetKey: "growth_intelligence_platform",
});

function cleanString(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function compactRow(row, fields) {
  if (!row) return null;
  return Object.freeze(Object.fromEntries(fields.map((field) => [field, row[field] ?? null])));
}

function createGap(code, message, evidence = {}) {
  return Object.freeze({ code, message, evidence: Object.freeze({ ...evidence }) });
}

function exactlyOne(rows) {
  return Array.isArray(rows) && rows.length === 1;
}

export function evaluatePlatformTopologyEvidence(evidence = {}) {
  const platformScope = evidence.platformScope || null;
  const platformOwnerTenants = Array.isArray(evidence.platformOwnerTenants) ? evidence.platformOwnerTenants : [];
  const adminWorkspaces = Array.isArray(evidence.adminWorkspaces) ? evidence.adminWorkspaces : [];
  const platformBrand = evidence.platformBrand || null;
  const platformContainers = Array.isArray(evidence.platformContainers) ? evidence.platformContainers : [];
  const workspaceContainers = Array.isArray(evidence.workspaceContainers) ? evidence.workspaceContainers : [];
  const brandContainers = Array.isArray(evidence.brandContainers) ? evidence.brandContainers : [];
  const relationships = Array.isArray(evidence.relationships) ? evidence.relationships : [];
  const roleAssignments = Array.isArray(evidence.roleAssignments) ? evidence.roleAssignments : [];
  const gaps = [];

  if (!platformScope) {
    gaps.push(createGap("platform_scope_missing", "Canonical platform authority scope is not registered."));
  } else {
    if (cleanString(platformScope.scope_key) !== PLATFORM_TOPOLOGY_CONTRACT.authorityScopeKey) {
      gaps.push(createGap("platform_scope_key_mismatch", "Platform authority scope key does not match the canonical contract."));
    }
    if (cleanString(platformScope.scope_type) !== "platform" || cleanString(platformScope.status) !== "active") {
      gaps.push(createGap("platform_scope_inactive_or_invalid", "Platform authority scope must be active and have platform scope type."));
    }
    if (cleanString(platformScope.tenant_id)) {
      gaps.push(createGap("platform_scope_tenant_forbidden", "Global platform authority scope must not be tenant-owned."));
    }
  }

  if (!exactlyOne(platformOwnerTenants)) {
    gaps.push(createGap(
      platformOwnerTenants.length ? "platform_owner_tenant_ambiguous" : "platform_owner_tenant_missing",
      "Exactly one active platform-owner tenant is required for canonical topology verification.",
      { candidateCount: platformOwnerTenants.length }
    ));
  }

  if (!exactlyOne(adminWorkspaces)) {
    gaps.push(createGap(
      adminWorkspaces.length ? "platform_admin_workspace_ambiguous" : "platform_admin_workspace_marker_missing",
      "Exactly one workspace must carry an explicit platform-admin workspace marker; display names are not evidence.",
      { candidateCount: adminWorkspaces.length }
    ));
  }

  if (!platformBrand || cleanString(platformBrand.target_key) !== PLATFORM_TOPOLOGY_CONTRACT.platformBrandTargetKey) {
    gaps.push(createGap("platform_brand_missing", "Canonical Growth Intelligence Platform brand target is not registered."));
  } else if (cleanString(platformBrand.status) !== "active") {
    gaps.push(createGap("platform_brand_inactive", "Canonical Growth Intelligence Platform brand must be active."));
  }

  if (!exactlyOne(platformContainers)) {
    gaps.push(createGap(
      platformContainers.length ? "global_platform_container_ambiguous" : "global_platform_container_missing",
      "Exactly one global platform container must represent platform:root without tenant ownership.",
      { candidateCount: platformContainers.length }
    ));
  }
  if (!exactlyOne(workspaceContainers)) {
    gaps.push(createGap(
      workspaceContainers.length ? "platform_admin_workspace_container_ambiguous" : "platform_admin_workspace_container_missing",
      "Exactly one workspace container must represent the explicitly marked Platform Admin Workspace.",
      { candidateCount: workspaceContainers.length }
    ));
  }
  if (!exactlyOne(brandContainers)) {
    gaps.push(createGap(
      brandContainers.length ? "platform_brand_container_ambiguous" : "platform_brand_container_missing",
      "Exactly one brand container must represent growth_intelligence_platform.",
      { candidateCount: brandContainers.length }
    ));
  }

  const platformContainerId = cleanString(platformContainers[0]?.container_id);
  const workspaceContainerId = cleanString(workspaceContainers[0]?.container_id);
  const brandContainerId = cleanString(brandContainers[0]?.container_id);
  const activeEdges = relationships.filter((row) => cleanString(row.status) === "active");
  if (platformContainerId && workspaceContainerId && !activeEdges.some((row) => cleanString(row.from_container_id) === platformContainerId && cleanString(row.to_container_id) === workspaceContainerId)) {
    gaps.push(createGap("platform_admin_workspace_relationship_missing", "Global platform container must explicitly contain the Platform Admin Workspace container."));
  }
  if (workspaceContainerId && brandContainerId && !activeEdges.some((row) => cleanString(row.from_container_id) === workspaceContainerId && cleanString(row.to_container_id) === brandContainerId)) {
    gaps.push(createGap("platform_brand_relationship_missing", "Platform Admin Workspace container must explicitly contain the platform brand container."));
  }
  if (platformContainerId && !roleAssignments.some((row) => cleanString(row.container_id) === platformContainerId && cleanString(row.role_template_key) === "platform_owner" && cleanString(row.status) === "active")) {
    gaps.push(createGap("platform_owner_assignment_missing", "Global platform container requires at least one active platform_owner assignment."));
  }

  return Object.freeze({
    status: gaps.length ? "gaps_detected" : "verified",
    readinessCode: gaps.length ? "topology_remediation_required" : "ready_for_review",
    contract: PLATFORM_TOPOLOGY_CONTRACT,
    summary: Object.freeze({
      gapCount: gaps.length,
      platformOwnerTenantCount: platformOwnerTenants.length,
      adminWorkspaceCandidateCount: adminWorkspaces.length,
      platformContainerCount: platformContainers.length,
      workspaceContainerCount: workspaceContainers.length,
      brandContainerCount: brandContainers.length,
      relationshipCount: relationships.length,
      platformOwnerAssignmentCount: roleAssignments.filter((row) => cleanString(row.role_template_key) === "platform_owner" && cleanString(row.status) === "active").length,
    }),
    evidence: Object.freeze({
      platformScope: compactRow(platformScope, ["scope_id", "scope_key", "scope_type", "tenant_id", "status", "version"]),
      platformOwnerTenants: Object.freeze(platformOwnerTenants.map((row) => compactRow(row, ["tenant_id", "tenant_type", "status"]))),
      adminWorkspaces: Object.freeze(adminWorkspaces.map((row) => compactRow(row, ["workspace_id", "tenant_id", "workspace_key", "workspace_type", "bootstrap_status"]))),
      platformBrand: compactRow(platformBrand, ["id", "target_key", "status"]),
      platformContainers: Object.freeze(platformContainers.map((row) => compactRow(row, ["container_id", "tenant_id", "container_key", "container_type_key", "canonical_subject_type", "canonical_subject_ref", "status"]))),
      workspaceContainers: Object.freeze(workspaceContainers.map((row) => compactRow(row, ["container_id", "tenant_id", "container_key", "canonical_subject_ref", "status"]))),
      brandContainers: Object.freeze(brandContainers.map((row) => compactRow(row, ["container_id", "tenant_id", "container_key", "canonical_subject_ref", "status"]))),
    }),
    gaps: Object.freeze(gaps),
    authorityGranted: false,
    providerCalls: false,
    credentialPayloadReads: false,
    externalWrites: false,
    secretsIncluded: false,
  });
}

export const _testingPlatformTopologyVerification = Object.freeze({ cleanString, exactlyOne });
