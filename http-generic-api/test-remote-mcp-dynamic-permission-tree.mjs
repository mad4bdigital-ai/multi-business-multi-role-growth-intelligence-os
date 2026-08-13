import assert from "node:assert/strict";
import {
  getRemoteMcpCatalogFingerprint,
  getRemoteMcpCatalogReadback,
  getRemoteMcpScopeCatalog,
  REMOTE_MCP_SCOPES,
  validateRemoteMcpScopeCatalog,
} from "./remoteMcpScopeCatalog.js";
import { explainRemoteMcpPermissionDecision } from "./remoteMcpPermissionTree.js";
import { buildRemoteMcpAuthorizationDecision } from "./remoteMcpAuthorizationDecision.js";
import { projectRemoteMcpTools } from "./remoteMcpToolProjection.js";
import { buildRemoteMcpScopeCatalogReadiness } from "./remoteMcpScopeCatalogReadiness.js";

const catalog = getRemoteMcpScopeCatalog();
assert.equal(validateRemoteMcpScopeCatalog(catalog).ok, true);
const invalidDefaultWriteCatalog = structuredClone(catalog);
invalidDefaultWriteCatalog.scopes.push({
  scope_key: "test.write",
  effect_class: "internal_write",
  default_request: true,
  status: "shadow",
});
assert.equal(validateRemoteMcpScopeCatalog(invalidDefaultWriteCatalog).ok, false);
assert(validateRemoteMcpScopeCatalog(invalidDefaultWriteCatalog).errors.includes("write_scope_default_request_forbidden:test.write"));
const invalidActiveWriteCatalog = structuredClone(catalog);
invalidActiveWriteCatalog.scopes.push({
  scope_key: "test.active_write",
  effect_class: "external_write",
  default_request: false,
  status: "active",
});
assert.equal(validateRemoteMcpScopeCatalog(invalidActiveWriteCatalog).ok, false);
assert(validateRemoteMcpScopeCatalog(invalidActiveWriteCatalog).errors.includes("write_scope_promotion_marker_required:test.active_write"));
assert.deepEqual(REMOTE_MCP_SCOPES, ["identity.read", "workspaces.read", "brands.read", "permissions.read"]);
assert.equal(getRemoteMcpCatalogFingerprint(catalog).length, 64);

const projected = projectRemoteMcpTools([
  { name: "list_accessible_workspaces", description: "ok" },
  { name: "unbound_tool", description: "must not export" },
], catalog);
assert.deepEqual(projected.tools.map((tool) => tool.name), ["list_accessible_workspaces"]);
assert.equal(projected.excluded[0].code, "MCP_TOOL_SCOPE_BINDING_MISSING");
assert.deepEqual(projected.tools[0].securitySchemes[0].scopes, ["workspaces.read"]);

const allowed = explainRemoteMcpPermissionDecision({
  tokenScopes: ["workspaces.read"],
  toolKey: "list_accessible_workspaces",
  resourceKey: "workspaces",
  operationKey: "list",
  catalog,
});
assert.equal(allowed.ok, true);

const denied = explainRemoteMcpPermissionDecision({
  tokenScopes: ["brands.read"],
  toolKey: "list_accessible_workspaces",
  resourceKey: "workspaces",
  operationKey: "list",
  catalog,
});
assert.equal(denied.code, "MCP_AUTHORIZATION_DENIED");

const unbound = explainRemoteMcpPermissionDecision({
  tokenScopes: ["workspaces.read"],
  toolKey: "unknown_tool",
  resourceKey: "workspaces",
  operationKey: "list",
  catalog,
});
assert.equal(unbound.code, "MCP_TOOL_SCOPE_BINDING_MISSING");

const authorization = buildRemoteMcpAuthorizationDecision({
  verification: { ok: true, claims: { user_id: "u1", tenant_id: "t1", scope: "workspaces.read" } },
  toolKey: "list_accessible_workspaces",
  resourceKey: "workspaces",
  operationKey: "list",
  catalog,
});
assert.equal(authorization.ok, true);
assert.equal(authorization.secrets_included, false);
const writeAuthorization = buildRemoteMcpAuthorizationDecision({
  verification: { ok: true, claims: { user_id: "u1", tenant_id: "t1", scope: "github.write" } },
  toolKey: "write_tool",
  resourceKey: "github",
  operationKey: "write",
  effectClass: "external_write",
  catalog,
});
assert.equal(writeAuthorization.ok, false);
assert.equal(writeAuthorization.write_effect, true);
assert.equal(writeAuthorization.write_defaults_fail_closed, true);

const readiness = buildRemoteMcpScopeCatalogReadiness({
  env: {
    REMOTE_MCP_OAUTH_DCR_ENABLED: "true",
    REMOTE_MCP_OAUTH_ALLOWED_REDIRECT_ORIGINS: "https://chatgpt.com,https://claude.ai",
  },
  catalog,
});
assert.equal(readiness.catalog_ready, true);
assert.equal(readiness.catalog_valid, true);
assert.equal(readiness.operational_ready, true);
assert.equal(readiness.write_ready, false);
assert.equal(readiness.dcr.enabled, true);
assert.equal(readiness.dcr.redirect_policy_ready, true);
assert.equal(readiness.dcr.advertised, true);
assert.equal(readiness.secrets_included, false);
assert.equal(getRemoteMcpCatalogReadback(catalog).unbound_tool_count, 0);

console.log("remote MCP dynamic permission tree tests passed");
