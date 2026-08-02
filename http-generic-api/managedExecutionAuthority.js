import {
  ACTIVE_CAPABILITY_STATUSES,
  PERMISSION_RANK,
  REQUIRED_PERMISSION_BY_EFFECT,
  managedError,
  normalizeManagedExecutionEnvelope,
} from "./managedExecutionCore.js";

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
  if (!ACTIVE_CAPABILITY_STATUSES.has(String(capability.runtime_status || "").toLowerCase())) throw managedError(409, "managed_execution_capability_not_active", `Capability runtime status '${capability.runtime_status || "unknown"}' is not executable.`);
  if (!Number(capability.dispatch_allowed || 0)) throw managedError(409, "managed_execution_capability_dispatch_blocked", "Capability dispatch is not allowed by runtime authority.");
  if (envelope.effect_class !== "read_only" && !Number(capability.apply_allowed || 0)) throw managedError(409, "managed_execution_capability_apply_blocked", "Capability apply is not allowed for the requested effect class.");
  if (Number(capability.resource_authority_required || 0) && !capability.evidence_ref) throw managedError(409, "managed_execution_capability_authority_evidence_missing", "Capability requires authority evidence before execution.");

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
      dispatch_allowed: Boolean(Number(capability.dispatch_allowed || 0)),
      apply_allowed: Boolean(Number(capability.apply_allowed || 0)),
      requires_audit_evidence: Boolean(Number(capability.requires_audit_evidence || 0)),
      requires_readback: Boolean(Number(capability.requires_readback || 0)),
      evidence_ref: capability.evidence_ref || null,
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
  if (drift.length) throw managedError(409, "managed_execution_authority_drift", "Managed execution authority changed after the immutable snapshot was recorded.", { drift });
  return { ok: true, current, secrets_included: false };
}
