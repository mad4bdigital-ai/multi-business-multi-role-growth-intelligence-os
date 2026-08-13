import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { buildRemoteMcpWriteScopeReadback, evaluateRemoteMcpWriteScopeDecision } from "./remoteMcpWriteScopeGovernance.js";
import { createOpenApiMutationGovernanceMiddleware } from "./openApiMutationGovernance.js";
import { buildOpenApiMutationGovernanceDecision } from "./sharedMutationPolicy.js";

const secret = "shared-mutation-policy-test-secret-32-chars";
const env = {
  JWT_SECRET: secret,
  REMOTE_MCP_ENVIRONMENT: "staging",
  REMOTE_MCP_WRITE_SCOPES_ENABLED: "false",
};
const claims = {
  purpose: "tenant_gpt_access",
  user_id: "user-1",
  tenant_id: "tenant-1",
  scope: "https://auth.mad4b.com/scopes/tenant.links",
};
const token = jwt.sign(claims, secret, { expiresIn: "1h" });
const governance = buildRemoteMcpWriteScopeReadback({ env });
const openApi = buildOpenApiMutationGovernanceDecision({
  method: "POST",
  path: "/me/workspaces/tenant-1/resources/foo",
  operationId: "postMeWorkspacesTenantIdResourcesResourceKey",
  requiredScope: "assets.create",
  tokenScopes: ["assets.create"],
  resourceAuthority: true,
  operationEligible: true,
  approvalSatisfied: true,
  capabilitySatisfied: true,
  leaseActive: true,
  environment: "staging",
  governance,
});
const mcp = evaluateRemoteMcpWriteScopeDecision({
  scopeKey: "assets.create",
  tokenScopes: ["assets.create"],
  resourceAuthority: true,
  operationEligible: true,
  approvalSatisfied: true,
  capabilitySatisfied: true,
  leaseActive: true,
  environment: "staging",
  env,
});
assert.equal(openApi.ok, false);
assert.equal(mcp.ok, false);
assert.deepEqual(openApi.failed_checks, mcp.decision_path.filter((check) => !check.ok).map((check) => check.key));
assert.equal(openApi.governance.shadow_write_scope_count, mcp.governance.shadow_write_scope_count);

let nextCalled = false;
let responseStatus = null;
let responseBody = null;
createOpenApiMutationGovernanceMiddleware({ env })({
  method: "POST",
  path: "/me/workspaces/tenant-1/resources/foo",
  originalUrl: "/me/workspaces/tenant-1/resources/foo",
  headers: { authorization: `Bearer ${token}` },
}, {
  status(status) { responseStatus = status; return this; },
  json(body) { responseBody = body; return body; },
}, () => { nextCalled = true; });
assert.equal(nextCalled, false);
assert.equal(responseStatus, 403);
assert.equal(responseBody.error.code, "OPENAPI_MUTATION_GOVERNANCE_DENIED");

let readNext = false;
createOpenApiMutationGovernanceMiddleware({ env })({ method: "GET", path: "/me/workspaces/tenant-1/resources/foo", headers: { authorization: `Bearer ${token}` } }, {}, () => { readNext = true; });
assert.equal(readNext, true);
console.log("Shared mutation policy tests passed.");
