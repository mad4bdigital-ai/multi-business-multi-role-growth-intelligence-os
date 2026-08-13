import assert from "node:assert/strict";
import {
  REMOTE_MCP_SCOPES,
  REMOTE_MCP_SUPPORTED_SCOPES,
} from "./remoteMcpScopeCatalog.js";
import {
  buildRemoteMcpIncrementalConsentRequest,
  mergeRemoteMcpScopes,
} from "./remoteMcpIncrementalConsent.js";

assert.deepEqual(REMOTE_MCP_SCOPES, ["identity.read", "workspaces.read", "brands.read", "permissions.read"]);
assert(REMOTE_MCP_SUPPORTED_SCOPES.includes("sessions.read"));
assert(!REMOTE_MCP_SUPPORTED_SCOPES.includes("approvals.request"), "write scopes must remain unavailable in this phase");
assert.deepEqual(mergeRemoteMcpScopes("workspaces.read", ["brands.read", "workspaces.read"]), ["workspaces.read", "brands.read"]);

const request = buildRemoteMcpIncrementalConsentRequest({
  toolKey: "list_accessible_brands",
  grantedScopes: ["identity.read", "workspaces.read"],
  clientAllowedScopes: [...REMOTE_MCP_SUPPORTED_SCOPES],
  clientId: "mcp_client",
  resource: "https://mcp.example.test",
  authorizationEndpoint: "https://auth.example.test/auth/mcp/oauth/authorize",
});
assert.equal(request.required, true);
assert.equal(request.mode, "incremental");
assert.deepEqual(request.missing_scopes, ["brands.read"]);
assert.deepEqual(request.requested_scopes, ["identity.read", "workspaces.read", "brands.read"]);
assert.equal(request.authorization_parameters.client_id, "mcp_client");
assert.equal(request.authorization_parameters.scope, "brands.read");
assert.equal(request.authorization_parameters.resource, "https://mcp.example.test");
assert.equal(request.secrets_included, false);

const alreadyGranted = buildRemoteMcpIncrementalConsentRequest({
  toolKey: "list_accessible_brands",
  grantedScopes: ["brands.read"],
  clientAllowedScopes: [...REMOTE_MCP_SUPPORTED_SCOPES],
});
assert.equal(alreadyGranted.required, false);
assert.equal(alreadyGranted.ok, true);

const clientLimited = buildRemoteMcpIncrementalConsentRequest({
  toolKey: "list_accessible_brands",
  grantedScopes: [],
  clientAllowedScopes: ["workspaces.read"],
});
assert.equal(clientLimited.ok, false);
assert.equal(clientLimited.code, "MCP_SCOPE_NOT_ALLOWED_FOR_CLIENT");

const unbound = buildRemoteMcpIncrementalConsentRequest({
  toolKey: "unbound_tool",
  grantedScopes: [],
  clientAllowedScopes: [...REMOTE_MCP_SUPPORTED_SCOPES],
});
assert.equal(unbound.ok, false);
assert.equal(unbound.code, "MCP_TOOL_SCOPE_BINDING_MISSING");

console.log("remote MCP incremental consent tests passed");
