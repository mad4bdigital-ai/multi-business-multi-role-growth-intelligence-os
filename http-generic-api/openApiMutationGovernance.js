import { buildRemoteMcpWriteScopeReadback } from "./remoteMcpWriteScopeGovernance.js";
import { buildOpenApiMutationGovernanceDecision, isMutationMethod } from "./sharedMutationPolicy.js";
import { verifyUserJwtAuthorization } from "./userJwtAuth.js";

function isTenantGptAccessClaims(claims) {
  return String(claims?.purpose || "") === "tenant_gpt_access" && Boolean(claims?.tenant_id && claims?.user_id);
}

export function createOpenApiMutationGovernanceMiddleware({ env = process.env, catalog } = {}) {
  return function openApiMutationGovernance(req, res, next) {
    if (!isMutationMethod(req.method)) return next();
    const requestPath = String(req.path || req.originalUrl || "/").split("?")[0];
    if (requestPath.startsWith("/auth/oauth/") || requestPath.startsWith("/mcp")) return next();
    const verified = verifyUserJwtAuthorization(req.headers?.authorization, { env });
    if (!verified.ok || !isTenantGptAccessClaims(verified.claims)) return next();

    const governance = buildRemoteMcpWriteScopeReadback({ env, catalog });
    const decision = buildOpenApiMutationGovernanceDecision({
      method: req.method,
      path: requestPath,
      operationId: req.headers?.["x-openapi-operation-id"] || null,
      requiredScope: null,
      tokenScopes: verified.claims.scope || verified.claims.scopes || [],
      resourceAuthority: false,
      operationEligible: false,
      approvalSatisfied: false,
      capabilitySatisfied: false,
      leaseActive: false,
      environment: String(env?.REMOTE_MCP_ENVIRONMENT || "staging").trim().toLowerCase(),
      governance,
    });
    return res.status(403).json({
      ok: false,
      error: {
        code: "OPENAPI_MUTATION_GOVERNANCE_DENIED",
        message: "Custom GPT OpenAPI mutations require a registered shared policy and promoted write scope; no write scope is active in this environment.",
        operation_key: decision.operation_key,
        failed_checks: decision.failed_checks,
      },
      mutation_governance: decision,
      secrets_included: false,
    });
  };
}
