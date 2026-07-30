import assert from "node:assert/strict";
import fs from "node:fs";

import { _testingConnectionOwnershipRepository } from "./contextKernel/infrastructure/sql/connectionOwnershipRepository.js";
import { _testingProviderAuthorizationStateRepository } from "./contextKernel/infrastructure/sql/providerAuthorizationStateRepository.js";

const migration = fs.readFileSync(
  new URL("./migrations/20260730_context_kernel_connection_ownership_persistence.sql", import.meta.url),
  "utf8",
);

assert.match(migration, /BINARY l\.connection_id <=> BINARY c\.connection_id/);
assert.match(migration, /BINARY l\.tenant_id <=> BINARY c\.tenant_id/);
assert.match(migration, /BINARY o\.connection_id <=> BINARY c\.connection_id/);
assert.match(migration, /personal_workspace_type_conflict/);
assert.match(migration, /company_workspace_type_conflict/);
assert.match(migration, /workspace_owner_scope_ref_conflict/);
assert.match(migration, /brand_owner_scope_ref_conflict/);
assert.match(migration, /provider_key_conflict/);
assert.match(migration, /ownership_connected_by_user_id/);

const mapped = _testingConnectionOwnershipRepository.mapConnectionOwnership({
  ownership_id: "ownership-a",
  connection_id: "connection-a",
  tenant_id: "tenant-a",
  workspace_id: "workspace-a",
  workspace_key: "workspace-key",
  workspace_type: "project",
  workspace_ownership_type: "company",
  workspace_owner_user_id: null,
  workspace_ownership_revision: 3,
  owner_scope_type: "company_workspace",
  owner_scope_ref: "workspace-a",
  connection_owner_user_id: null,
  ownership_connected_by_user_id: "connector-user",
  legacy_connected_user_id: "legacy-user",
  brand_id: null,
  provider_key: "google_drive",
  provider_account_ref: "account-a",
  provider_account_binding_hash: null,
  provider_account_binding_version: null,
  authorization_revision: 4,
  connection_revision: 5,
  ownership_status: "active",
  ownership_resolution_status: "classified",
});
assert.equal(mapped.connectedByUserRef, "connector-user");
assert.equal(mapped.workspaceType, "project");
assert.equal(mapped.workspaceOwnershipType, "company");

assert.throws(
  () => _testingConnectionOwnershipRepository.validateOwnership({
    connection_id: "connection-a",
    tenant_id: "tenant-a",
    workspace_id: "workspace-a",
    ownership_resolution_status: "personal_workspace_type_conflict",
  }),
  (error) => error?.code === "connection_personal_workspace_type_conflict",
);

const state = {
  provider_key: "google_drive",
  owner_scope_type: "brand",
  owner_scope_ref: "brand-a",
  brand_id: "brand-a",
};
const ownership = {
  provider_key: "google_drive",
  owner_scope_type: "brand",
  owner_scope_ref: "brand-a",
  brand_id: "brand-a",
};
assert.equal(
  _testingProviderAuthorizationStateRepository.validateLockedOwnershipContext(ownership, state),
  true,
);
assert.equal(
  _testingProviderAuthorizationStateRepository.validateLockedOwnershipContext(
    { ...ownership, owner_scope_ref: "brand-b" },
    state,
  ),
  false,
);

assert.doesNotThrow(() => {
  _testingProviderAuthorizationStateRepository.assertCredentialMutationStatement(
    "UPDATE user_app_connections SET encrypted_credentials = ? WHERE tenant_id = ? AND connection_id = ?",
    ["ciphertext-placeholder", "tenant-a", "connection-a"],
    { tenantRef: "tenant-a", connectionRef: "connection-a" },
  );
});
assert.throws(
  () => _testingProviderAuthorizationStateRepository.assertCredentialMutationStatement(
    "UPDATE connection_ownership_scopes SET status = ? WHERE tenant_id = ? AND connection_id = ?",
    ["active", "tenant-a", "connection-a"],
    { tenantRef: "tenant-a", connectionRef: "connection-a" },
  ),
  (error) => error?.code === "credential_mutation_statement_forbidden",
);

console.log("context kernel connection ownership compatibility tests passed");
