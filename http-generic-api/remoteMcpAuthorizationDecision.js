import { explainRemoteMcpPermissionDecision } from "./remoteMcpPermissionTree.js";

export function buildRemoteMcpAuthorizationDecision({
  verification,
  toolKey,
  resourceKey,
  operationKey,
  effectClass,
  environmentClass,
  resourceAuthority = true,
  approvalSatisfied = true,
  capabilitySatisfied = true,
  leaseActive = true,
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
  const decision = explainRemoteMcpPermissionDecision({
    tokenScopes: claims.scope || claims.scopes || [],
    toolKey,
    resourceKey,
    operationKey,
    effectClass,
    environmentClass,
    subjectActive: verification.subject_active !== false,
    membershipActive: verification.membership_active !== false,
    resourceAuthority,
    approvalSatisfied,
    capabilitySatisfied,
    leaseActive,
    catalog,
  });
  return {
    ...decision,
    status: decision.ok ? 200 : 403,
    claims_subject: claims.sub || claims.user_id || null,
    tenant_id: claims.tenant_id || null,
    message: decision.ok ? "Authorized." : "The requested MCP operation is not authorized.",
    secrets_included: false,
  };
}
