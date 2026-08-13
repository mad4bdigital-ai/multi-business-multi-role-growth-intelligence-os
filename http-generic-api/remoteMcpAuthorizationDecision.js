import { explainRemoteMcpPermissionDecision } from "./remoteMcpPermissionTree.js";

export function buildRemoteMcpAuthorizationDecision({
  verification,
  toolKey,
  resourceKey,
  operationKey,
  effectClass = "read_only",
  environmentClass = "all",
  resourceAuthority = undefined,
  approvalSatisfied = undefined,
  capabilitySatisfied = undefined,
  leaseActive = undefined,
  catalog,
} = {}) {
  if (!verification?.ok) {
    return {
      ok: false,
      code: verification?.code || "MCP_AUTH_REQUIRED",
      status: verification?.status || 401,
      message: verification?.message || "A valid OAuth access token is required.",
      decision_path: [{ key: "token_verification", ok: false, detail: verification?.code || "invalid_token" }],
      secrets_included: false,
    };
  }

  const claims = verification.claims || {};
  const writeEffect = effectClass !== "read_only";
  const resolvedResourceAuthority = writeEffect ? resourceAuthority === true : resourceAuthority !== false;
  const resolvedApproval = writeEffect ? approvalSatisfied === true : approvalSatisfied !== false;
  const resolvedCapability = writeEffect ? capabilitySatisfied === true : capabilitySatisfied !== false;
  const resolvedLease = writeEffect ? leaseActive === true : leaseActive !== false;
  const decision = explainRemoteMcpPermissionDecision({
    tokenScopes: claims.scope || claims.scopes || [],
    toolKey,
    resourceKey,
    operationKey,
    effectClass,
    environmentClass,
    subjectActive: verification.subject_active !== false,
    membershipActive: verification.membership_active !== false,
    resourceAuthority: resolvedResourceAuthority,
    approvalSatisfied: resolvedApproval,
    capabilitySatisfied: resolvedCapability,
    leaseActive: resolvedLease,
    catalog,
  });
  return {
    ...decision,
    status: decision.ok ? 200 : 403,
    claims_subject: claims.sub || claims.user_id || null,
    tenant_id: claims.tenant_id || null,
    message: decision.ok ? "Authorized." : "The requested MCP operation is not authorized.",
    write_effect: writeEffect,
    write_defaults_fail_closed: writeEffect,
    secrets_included: false,
  };
}
