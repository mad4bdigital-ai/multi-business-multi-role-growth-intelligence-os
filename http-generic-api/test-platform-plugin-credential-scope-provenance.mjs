import assert from "node:assert/strict";
import { _testingPlatformPluginConnectionOwnership } from "./platformPluginConnectionOwnership.js";

const { buildCredentialScopeProvenance, rowMatchesProvenance } = _testingPlatformPluginConnectionOwnership;

const personal = buildCredentialScopeProvenance({
  tenant: "tenant-a",
  workspace: "workspace-a",
  plugin: "google_drive",
  user: "user-a",
  ownershipType: "personal",
  ownerScopeType: "personal_workspace",
  ownerScopeRef: "workspace-a",
  credentialScope: "user_connection",
  ownershipRevision: 7,
  requestedBrandRef: null,
  brandAuthority: null,
});
assert.equal(personal.schema_version, "connection-credential-scope-provenance-v1");
assert.equal(personal.source, "v_context_kernel_connection_ownership_compatibility");
assert.equal(personal.subject_user_id, "user-a");
assert.equal(personal.credential_scope, "user_connection");
assert.equal(personal.ownership_resolution_status, "classified");
assert.equal(personal.secrets_included, false);
assert.equal(rowMatchesProvenance({
  workspace_id: "workspace-a",
  owner_scope_type: "personal_workspace",
  owner_scope_ref: "workspace-a",
  brand_id: null,
  ownership_status: "active",
  ownership_resolution_status: "classified",
}, personal), true);
assert.equal(rowMatchesProvenance({
  workspace_id: "workspace-a",
  owner_scope_type: "company_workspace",
  owner_scope_ref: "workspace-a",
  brand_id: null,
  ownership_status: "active",
  ownership_resolution_status: "classified",
}, personal), false);

const brand = buildCredentialScopeProvenance({
  tenant: "tenant-a",
  workspace: "root-a",
  plugin: "wordpress_rest",
  user: "user-b",
  ownershipType: "company",
  ownerScopeType: "brand",
  ownerScopeRef: "brand-a",
  credentialScope: "tenant_connection",
  ownershipRevision: 11,
  requestedBrandRef: "brand-a",
  brandAuthority: { source: "workspace_resource_grant", grant_id: "grant-a", permission: "operate" },
});
assert.equal(brand.brand_authority_source, "workspace_resource_grant");
assert.equal(brand.brand_authority_grant_id, "grant-a");
assert.equal(brand.brand_authority_permission, "operate");
assert.equal(brand.subject_user_id, null);
assert.equal(rowMatchesProvenance({
  workspace_id: "root-a",
  owner_scope_type: "brand",
  owner_scope_ref: "brand-a",
  brand_id: "brand-a",
  ownership_status: "active",
  ownership_resolution_status: "classified",
}, brand), true);
assert.equal(rowMatchesProvenance({
  workspace_id: "root-a",
  owner_scope_type: "brand",
  owner_scope_ref: "brand-a",
  brand_id: "brand-other",
  ownership_status: "active",
  ownership_resolution_status: "classified",
}, brand), false);

console.log("platform plugin credential scope provenance tests passed");
