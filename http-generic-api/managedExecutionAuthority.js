import {
  ACTIVE_CAPABILITY_STATUSES,
  PERMISSION_RANK,
  REQUIRED_PERMISSION_BY_EFFECT,
  managedError,
  normalizeManagedExecutionEnvelope,
} from "./managedExecutionCore.js";
import { TenantPlatformPluginManagedRepairContract } from "./tenantPlatformPluginEligibility.js";

const MANAGED_REPAIR_BASE_RUNTIME_STATUSES = new Set(["baseline_registered", "active", "available", "certified"]);
const ACTIVE_DRY_RUN_CERTIFICATION_STATUSES = new Set(["ci_certified"]);

function isTenantPlatformPluginManagedRepairDryRun(envelope = {}) {
  return envelope.execution_mode === "dry_run"
    && envelope.effect_class === TenantPlatformPluginManagedRepairContract.effect_class
    && envelope.capability_key === TenantPlatformPluginManagedRepairContract.capability_key
    && envelope.workflow_key === TenantPlatformPluginManagedRepairContract.workflow_key
    && envelope.resource_type === TenantPlatformPluginManagedRepairContract.resource_type;
}

function assertManagedRepairBaseCapability(capability) {
  const runtimeStatus = String(capability.runtime_status || "").toLowerCase();
  if (!MANAGED_REPAIR_BASE_RUNTIME_STATUSES.has(runtimeStatus)) {
    throw managedError(409, "managed_execution_capability_not_active", `Managed repair capability runtime status '${capability.runtime_status || "unknown"}' is not eligible for dry-run certification.`);
  }
  if (!Number(capability.resource_authority_required || 0)) {
    throw managedError(409, "managed_execution_dry_run_resource_authority_required", "Managed repair dry-run requires resource authority enforcement.");
  }
  if (!Number(capability.requires_audit_evidence || 0)) {
    throw managedError(409, "managed_execution_dry_run_audit_required", "Managed repair dry-run requires audit evidence.");
  }
  if (!Number(capability.requires_readback || 0)) {
    throw managedError(409, "managed_execution_dry_run_readback_required", "Managed repair dry-run requires readback.");
  }
  if (String(capability.evidence_ref || "").trim() !== TenantPlatformPluginManagedRepairContract.authority_requirement_key) {
    throw managedError(409, "managed_execution_capability_authority_evidence_missing", "Managed repair capability authority evidence does not match the canonical requirement.", {
      expected_evidence_ref: TenantPlatformPluginManagedRepairContract.authority_requirement_key,
    });
  }
}

function normalizeCertificationTimestamp(value, code, message) {
  const parsed = value instanceof Date ? value.getTime() : new Date(value || "").getTime();
  if (!Number.isFinite(parsed)) throw managedError(409, code, message);
  return new Date(parsed).toISOString();
}

async function resolveManagedRepairDryRunCertification({ connection, now = new Date() }) {
  const [rows] = await connection.query(
    `SELECT certification_key, surface_key, surface_family, tool_or_action_key, risk_class,
            certification_status, smoke_strategy, dispatch_allowed, apply_allowed,
            requires_resource_authority, requires_dry_run, requires_audit_evidence,
            requires_readback, last_evidence_ref, last_certified_at, expires_at
       FROM runtime_dispatch_certification_registry
      WHERE certification_key = ?
        AND surface_key = ?
        AND tool_or_action_key = ?
      LIMIT 2`,
    [
      TenantPlatformPluginManagedRepairContract.dry_run_certification_key,
      TenantPlatformPluginManagedRepairContract.dry_run_certification_surface_key,
      TenantPlatformPluginManagedRepairContract.dry_run_certification_target_key,
    ],
  );
  if (rows.length !== 1) {
    throw managedError(
      409,
      rows.length ? "managed_execution_dry_run_certification_ambiguous" : "managed_execution_dry_run_certification_required",
      rows.length ? "Managed repair dry-run certification resolved ambiguously." : "Managed repair dry-run requires an exact runtime dispatch certification.",
      { candidate_count: rows.length },
    );
  }
  const [certification] = rows;
  const certificationStatus = String(certification.certification_status || "").toLowerCase();
  if (!ACTIVE_DRY_RUN_CERTIFICATION_STATUSES.has(certificationStatus)) {
    throw managedError(409, "managed_execution_dry_run_certification_not_active", "Managed repair dry-run certification is not active.", {
      certification_status: certification.certification_status || null,
      allowed_statuses: [...ACTIVE_DRY_RUN_CERTIFICATION_STATUSES],
    });
  }
  if (Number(certification.dispatch_allowed || 0) !== 1) {
    throw managedError(409, "managed_execution_dry_run_certification_dispatch_blocked", "Managed repair dry-run certification does not allow dispatch.");
  }
  if (Number(certification.apply_allowed || 0) !== 0) {
    throw managedError(409, "managed_execution_dry_run_certification_apply_must_be_blocked", "Managed repair dry-run certification must keep apply disabled.");
  }
  for (const [field, code] of [
    ["requires_resource_authority", "managed_execution_dry_run_certification_resource_authority_required"],
    ["requires_dry_run", "managed_execution_dry_run_certification_mode_required"],
    ["requires_audit_evidence", "managed_execution_dry_run_certification_audit_required"],
    ["requires_readback", "managed_execution_dry_run_certification_readback_required"],
  ]) {
    if (Number(certification[field] || 0) !== 1) {
      throw managedError(409, code, `Managed repair certification must set ${field}=1.`);
    }
  }
  const evidenceRef = String(certification.last_evidence_ref || "").trim();
  if (!evidenceRef) {
    throw managedError(409, "managed_execution_dry_run_certification_evidence_required", "Managed repair dry-run certification requires bounded evidence.");
  }
  const lastCertifiedAt = normalizeCertificationTimestamp(
    certification.last_certified_at,
    "managed_execution_dry_run_certification_timestamp_required",
    "Managed repair dry-run certification requires a valid certification timestamp.",
  );
  const expiresAt = normalizeCertificationTimestamp(
    certification.expires_at,
    "managed_execution_dry_run_certification_expiry_required",
    "Managed repair dry-run certification requires a valid expiry.",
  );
  if (new Date(expiresAt).getTime() <= now.getTime()) {
    throw managedError(409, "managed_execution_dry_run_certification_expired", "Managed repair dry-run certification has expired.", {
      expires_at: expiresAt,
    });
  }
  return Object.freeze({
    certification_key: certification.certification_key,
    surface_key: certification.surface_key,
    surface_family: certification.surface_family || null,
    tool_or_action_key: certification.tool_or_action_key,
    risk_class: certification.risk_class || null,
    certification_status: certification.certification_status,
    smoke_strategy: certification.smoke_strategy || null,
    dispatch_allowed: true,
    apply_allowed: false,
    requires_resource_authority: true,
    requires_dry_run: true,
    requires_audit_evidence: true,
    requires_readback: true,
    last_evidence_ref: evidenceRef,
    last_certified_at: lastCertifiedAt,
    expires_at: expiresAt,
  });
}

function selectEffectiveResourceGrant(rows, envelope) {
  const requiredPermission = REQUIRED_PERMISSION_BY_EFFECT[envelope.effect_class];
  const minimumRank = PERMISSION_RANK[requiredPermission] || Number.MAX_SAFE_INTEGER;
  const eligible = (Array.isArray(rows) ? rows : [])
    .filter((row) => (PERMISSION_RANK[String(row.permission || "").toLowerCase()] || 0) >= minimumRank)
    .sort((left, right) => {
      const leftExact = left.resource_type === envelope.resource_type && left.resource_ref === envelope.resource_ref ? 1 : 0;
      const rightExact = right.resource_type === envelope.resource_type && right.resource_ref === envelope.resource_ref ? 1 : 0;
      if (leftExact !== rightExact) return rightExact - leftExact;
      return (PERMISSION_RANK[String(right.permission || "").toLowerCase()] || 0) - (PERMISSION_RANK[String(left.permission || "").toLowerCase()] || 0);
    });
  const grant = eligible[0] || null;
  if (!grant) throw managedError(403, "managed_execution_resource_grant_required", `An active '${requiredPermission}' or stronger resource grant is required.`, { resource_type: envelope.resource_type, resource_ref: envelope.resource_ref, required_permission: requiredPermission });
  return {
    grant_id: grant.grant_id,
    resource_type: grant.resource_type,
    resource_ref: grant.resource_ref,
    permission: grant.permission,
    source: grant.source || null,
    granted_by: grant.granted_by || null,
    granted_at: grant.granted_at || null,
    expires_at: grant.expires_at || null,
    required_permission: requiredPermission,
    exact_resource: grant.resource_type === envelope.resource_type && grant.resource_ref === envelope.resource_ref,
  };
}

export async function resolveManagedExecutionAuthority({ connection, envelope }) {
  const [capabilityRows] = await connection.query(
    `SELECT capability_key, display_name, operation_class, risk_class, runtime_status,
            exposure_scope, resource_authority_required, dispatch_allowed, apply_allowed,
            requires_audit_evidence, requires_readback, evidence_ref
       FROM v_platform_capabilities_effective_evidence
      WHERE capability_key = ? LIMIT 2`,
    [envelope.capability_key],
  );
  if (capabilityRows.length !== 1) throw managedError(409, capabilityRows.length ? "managed_execution_capability_ambiguous" : "managed_execution_capability_not_registered", "Capability authority could not be resolved uniquely.");
  const capability = capabilityRows[0];
  const managedRepairDryRun = isTenantPlatformPluginManagedRepairDryRun(envelope);
  let dryRunCertification = null;

  if (managedRepairDryRun) {
    assertManagedRepairBaseCapability(capability);
    dryRunCertification = await resolveManagedRepairDryRunCertification({ connection });
  } else {
    if (!ACTIVE_CAPABILITY_STATUSES.has(String(capability.runtime_status || "").toLowerCase())) throw managedError(409, "managed_execution_capability_not_active", `Capability runtime status '${capability.runtime_status || "unknown"}' is not executable.`);
    if (!Number(capability.dispatch_allowed || 0)) throw managedError(409, "managed_execution_capability_dispatch_blocked", "Capability dispatch is not allowed by runtime authority.");
    if (envelope.effect_class !== "read_only" && !Number(capability.apply_allowed || 0)) throw managedError(409, "managed_execution_capability_apply_blocked", "Capability apply is not allowed for the requested effect class.");
    if (Number(capability.resource_authority_required || 0) && !capability.evidence_ref) throw managedError(409, "managed_execution_capability_authority_evidence_missing", "Capability requires authority evidence before execution.");
  }

  const [grantRows] = await connection.query(
    `SELECT grant_id, tenant_id, grantee_user_id, resource_type, resource_ref, permission,
            grant_status, source, granted_by, granted_at, expires_at
       FROM v_workspace_resource_grant_effective
      WHERE tenant_id = ? AND grantee_user_id = ?
        AND ((resource_type = ? AND resource_ref = ?)
          OR (resource_type = 'workspace' AND resource_ref = ?))
      LIMIT 20`,
    [envelope.tenant_id, envelope.user_id, envelope.resource_type, envelope.resource_ref, envelope.tenant_id],
  );
  return {
    capability: {
      capability_key: capability.capability_key,
      operation_class: capability.operation_class || null,
      risk_class: capability.risk_class || null,
      runtime_status: capability.runtime_status,
      exposure_scope: capability.exposure_scope || null,
      resource_authority_required: Boolean(Number(capability.resource_authority_required || 0)),
      dispatch_allowed: managedRepairDryRun ? true : Boolean(Number(capability.dispatch_allowed || 0)),
      apply_allowed: managedRepairDryRun ? false : Boolean(Number(capability.apply_allowed || 0)),
      base_dispatch_allowed: Boolean(Number(capability.dispatch_allowed || 0)),
      base_apply_allowed: Boolean(Number(capability.apply_allowed || 0)),
      execution_mode: envelope.execution_mode || "live",
      requires_audit_evidence: Boolean(Number(capability.requires_audit_evidence || 0)),
      requires_readback: Boolean(Number(capability.requires_readback || 0)),
      evidence_ref: capability.evidence_ref || null,
      ...(dryRunCertification ? { dry_run_certification: dryRunCertification } : {}),
    },
    resource_grant: selectEffectiveResourceGrant(grantRows, envelope),
    resolved_at: new Date().toISOString(),
    secrets_included: false,
  };
}

export async function assertManagedExecutionAuthorityStillEffective({ connection, authoritySnapshot }) {
  const resource = authoritySnapshot?.resource || {};
  const envelope = normalizeManagedExecutionEnvelope({
    tenant_id: authoritySnapshot?.tenant_id,
    user_id: authoritySnapshot?.user_id,
    parent_ticket_id: authoritySnapshot?.parent_ticket_id,
    workflow_key: authoritySnapshot?.workflow_key,
    capability_key: authoritySnapshot?.capability_key,
    resource_type: resource.type,
    resource_ref: resource.ref,
    effect_class: authoritySnapshot?.effect_class,
    execution_mode: authoritySnapshot?.execution_mode || "live",
    idempotency_key: authoritySnapshot?.idempotency_key,
    service_mode: authoritySnapshot?.service_mode || "managed",
  });
  const current = await resolveManagedExecutionAuthority({ connection, envelope });
  const expectedGrant = authoritySnapshot.resource_grant || {};
  const expectedCapability = authoritySnapshot.capability_authority || {};
  const drift = [];
  if (current.resource_grant.grant_id !== expectedGrant.grant_id) drift.push("resource_grant_id_changed");
  if (current.resource_grant.permission !== expectedGrant.permission) drift.push("resource_permission_changed");
  if (current.capability.runtime_status !== expectedCapability.runtime_status) drift.push("capability_runtime_status_changed");
  if (current.capability.evidence_ref !== expectedCapability.evidence_ref) drift.push("capability_evidence_ref_changed");
  const expectedCertification = expectedCapability.dry_run_certification || null;
  const currentCertification = current.capability.dry_run_certification || null;
  if (Boolean(expectedCertification) !== Boolean(currentCertification)) drift.push("dry_run_certification_presence_changed");
  if (expectedCertification && currentCertification) {
    if (currentCertification.certification_key !== expectedCertification.certification_key) drift.push("dry_run_certification_key_changed");
    if (currentCertification.last_evidence_ref !== expectedCertification.last_evidence_ref) drift.push("dry_run_certification_evidence_changed");
    if (currentCertification.last_certified_at !== expectedCertification.last_certified_at) drift.push("dry_run_certification_timestamp_changed");
    if (currentCertification.expires_at !== expectedCertification.expires_at) drift.push("dry_run_certification_expiry_changed");
  }
  if (drift.length) throw managedError(409, "managed_execution_authority_drift", "Managed execution authority changed after the immutable snapshot was recorded.", { drift });
  return { ok: true, current, secrets_included: false };
}

export const _testingManagedExecutionAuthority = {
  isTenantPlatformPluginManagedRepairDryRun,
  assertManagedRepairBaseCapability,
  normalizeCertificationTimestamp,
  resolveManagedRepairDryRunCertification,
};
