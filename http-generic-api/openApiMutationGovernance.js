import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRemoteMcpWriteScopeReadback } from "./remoteMcpWriteScopeGovernance.js";
import { buildOpenApiMutationGovernanceDecision, isMutationMethod } from "./sharedMutationPolicy.js";
import { verifyUserJwtAuthorization } from "./userJwtAuth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_FILE = path.resolve(__dirname, "openapi/openapi-mutation-policy.generated.json");

function loadRegistry() {
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf8"));
  } catch {
    return { operations: [] };
  }
}

const REGISTRY = loadRegistry();

function templateMatches(template, requestPath) {
  const templateParts = String(template || "").split("/").filter(Boolean);
  const requestParts = String(requestPath || "").split("/").filter(Boolean);
  if (templateParts.length !== requestParts.length) return false;
  return templateParts.every((part, index) => part.startsWith("{") && part.endsWith("}") || part === requestParts[index]);
}

function resolveOperationPolicy(method, requestPath, operationId = null) {
  const candidates = Array.isArray(REGISTRY.operations) ? REGISTRY.operations : [];
  return candidates.find((candidate) => (
    String(candidate.method || "").toUpperCase() === String(method || "").toUpperCase()
      && ((operationId && candidate.operation_id === operationId) || templateMatches(candidate.path, requestPath))
  )) || null;
}

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

    const operationPolicy = resolveOperationPolicy(req.method, requestPath, req.headers?.["x-openapi-operation-id"] || null);
    const governance = buildRemoteMcpWriteScopeReadback({ env, catalog });
    const decision = buildOpenApiMutationGovernanceDecision({
      method: req.method,
      path: requestPath,
      operationId: operationPolicy?.operation_id || req.headers?.["x-openapi-operation-id"] || null,
      effectClass: operationPolicy?.effect_class || null,
      requiredScope: operationPolicy?.required_scope || null,
      tokenScopes: verified.claims.scope || verified.claims.scopes || [],
      resourceAuthority: false,
      operationEligible: Boolean(operationPolicy),
      approvalSatisfied: false,
      capabilitySatisfied: false,
      leaseActive: false,
      environment: String(env?.REMOTE_MCP_ENVIRONMENT || "staging").trim().toLowerCase(),
      governance,
      operationPolicy,
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

export { resolveOperationPolicy };
