import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { createOpenApiMutationGovernanceMiddleware } from "./openApiMutationGovernance.js";

const secret = "staging-oauth-policy-regression-only-" + "x".repeat(24);
const env = { JWT_SECRET: secret, REMOTE_MCP_ENVIRONMENT: "staging" };
const token = jwt.sign({
  purpose: "tenant_gpt_access",
  user_id: "staging-regression-user",
  tenant_id: "staging-regression-tenant",
  scope: "workspaces.read",
}, secret, { algorithm: "HS256", expiresIn: 60 });
const middleware = createOpenApiMutationGovernanceMiddleware({ env });

function run(method, path) {
  const req = { method, path, originalUrl: path, headers: { authorization: "Bearer " + token } };
  let called = false;
  let status = null;
  let body = null;
  const res = {
    status(code) { status = code; return this; },
    json(value) { body = value; return this; },
  };
  middleware(req, res, () => { called = true; });
  return { called, status, body };
}
assert.equal(run("POST", "/auth/mcp/oauth/code").called, true,
  "signed OAuth authorization-code issuance must retain its own route-level checks");
for (const path of ["/auth/mcp/oauth/unrelated", "/auth/mcp/oauth/evil", "/connect/bootstrap", "/auth/mcp/oauth/revoke"]) {
  const result = run("POST", path);
  assert.equal(result.called, false, "unexpected write-governance bypass on " + path);
  assert.equal(result.status, 403, "other user-token mutations must remain blocked");
  assert.equal(result.body?.error?.code, "OPENAPI_MUTATION_GOVERNANCE_DENIED");
}
assert.equal(run("GET", "/auth/mcp/oauth/authorize").called, true);
console.log("Scoped Staging MCP OAuth code mutation-governance regression passed.");
