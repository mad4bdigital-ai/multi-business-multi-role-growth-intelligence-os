import assert from "node:assert/strict";
import {
  REMOTE_MCP_SCOPES,
  REMOTE_MCP_SUPPORTED_SCOPES,
} from "./remoteMcpScopeCatalog.js";
import {
  buildRemoteMcpIncrementalConsentRequest,
  mergeRemoteMcpScopes,
} from "./remoteMcpIncrementalConsent.js";
import {
  buildRemoteMcpScopeCatalogReadiness,
} from "./remoteMcpScopeCatalogReadiness.js";
import {
  buildRemoteMcpWriteScopeReadback,
  evaluateRemoteMcpWriteScopeDecision,
} from "./remoteMcpWriteScopeGovernance.js";

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
  redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
});
assert.equal(request.required, true);
assert.equal(request.mode, "incremental");
assert.deepEqual(request.missing_scopes, ["brands.read"]);
assert.deepEqual(request.requested_scopes, ["identity.read", "workspaces.read", "brands.read"]);
assert.equal(request.authorization_parameters.client_id, "mcp_client");
assert.equal(request.authorization_parameters.scope, "brands.read");
assert.equal(request.authorization_parameters.resource, "https://mcp.example.test");
assert.equal(request.authorization_parameters.redirect_uri, "https://claude.ai/api/mcp/auth_callback");
assert.deepEqual(request.redirect_uri_options, ["https://claude.ai/api/mcp/auth_callback"]);
assert.deepEqual(request.required_parameters, ["redirect_uri", "state", "code_challenge", "code_challenge_method"]);
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

const catalogReadiness = buildRemoteMcpScopeCatalogReadiness({
  env: { REMOTE_MCP_CATALOG_FINGERPRINT_REQUIRED: "true" },
});
assert.equal(catalogReadiness.catalog_ready, true);
assert.equal(catalogReadiness.fingerprint_match, true);
assert.equal(catalogReadiness.drift_detected, false);
assert.equal(catalogReadiness.default_write_scope_count, 0);
assert.equal(catalogReadiness.write_governance.write_scope_count, 6);
assert.equal(catalogReadiness.write_governance.mode, "shadow");
assert.equal(catalogReadiness.write_governance.activation_ready, false);
assert.equal(catalogReadiness.write_governance.inventory_ready, false);

const writeReadback = buildRemoteMcpWriteScopeReadback({
  env: {
    REMOTE_MCP_ENVIRONMENT: "staging",
    REMOTE_MCP_WRITE_SCOPES_ENABLED: "true",
    REMOTE_MCP_WRITE_APPROVALS_READY: "true",
    REMOTE_MCP_WRITE_CAPABILITY_ENVELOPE_READY: "true",
    REMOTE_MCP_WRITE_LEASE_READY: "true",
  },
});
assert.equal(writeReadback.activation_ready, false, "inventory must gate activation");
const deniedWrite = evaluateRemoteMcpWriteScopeDecision({
  scopeKey: "github.write",
  tokenScopes: ["github.write"],
  resourceAuthority: true,
  operationEligible: true,
  approvalSatisfied: true,
  capabilitySatisfied: true,
  leaseActive: true,
  environment: "staging",
});
assert.equal(deniedWrite.ok, false);
assert.equal(deniedWrite.code, "MCP_WRITE_AUTHORIZATION_DENIED");
assert.equal(deniedWrite.provider_mutation_allowed, false);

const driftedReadiness = buildRemoteMcpScopeCatalogReadiness({
  env: {
    REMOTE_MCP_CATALOG_FINGERPRINT_REQUIRED: "true",
    REMOTE_MCP_EXPECTED_CATALOG_FINGERPRINT: "0000000000000000000000000000000000000000000000000000000000000000",
  },
});
assert.equal(driftedReadiness.catalog_ready, false);
assert.equal(driftedReadiness.drift_detected, true);

console.log("remote MCP incremental consent tests passed");
