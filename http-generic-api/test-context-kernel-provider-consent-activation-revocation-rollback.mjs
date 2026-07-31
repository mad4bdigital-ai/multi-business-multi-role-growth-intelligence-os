import assert from "node:assert/strict";

import {
  createCertifiedProviderConnectionRevocationRepository,
} from "./contextKernel/infrastructure/sql/providerConsentActivationPilotRepositories.js";

function mysqlRows(rows) {
  return [rows, []];
}

function mysqlMutation(affectedRows = 1) {
  return [{ affectedRows }, []];
}

const events = [];
const transaction = {
  async beginTransaction() { events.push("begin"); },
  async commit() { events.push("commit"); },
  async rollback() { events.push("rollback"); },
  release() { events.push("release"); },
  async execute(statement) {
    if (statement.includes("FROM connection_ownership_scopes") && statement.includes("FOR UPDATE")) {
      events.push("lock-ownership");
      return mysqlRows([{
        connection_id: "connection-r",
        tenant_id: "tenant-1",
        workspace_id: "workspace-1",
        brand_id: null,
        owner_scope_type: "company_workspace",
        owner_scope_ref: "workspace-1",
        provider_key: "google_drive",
        authorization_revision: 4,
        connection_revision: 7,
        status: "active",
      }]);
    }
    if (statement.includes("FROM user_app_connections") && statement.includes("FOR UPDATE")) {
      events.push("lock-base");
      return mysqlRows([{
        connection_id: "connection-r",
        tenant_id: "tenant-1",
        app_key: "google_drive",
        status: "active",
      }]);
    }
    if (statement.includes("UPDATE connection_ownership_scopes")) {
      events.push("revoke-ownership");
      return mysqlMutation(1);
    }
    if (statement.includes("UPDATE user_app_connections")) {
      events.push("revoke-base-conflict");
      return mysqlMutation(0);
    }
    throw new Error(`Unexpected SQL: ${statement}`);
  },
};

const repository = createCertifiedProviderConnectionRevocationRepository({
  pool: {
    async getConnection() { return transaction; },
    async execute() { throw new Error("root execute should not run"); },
  },
});

await assert.rejects(
  repository.revokeProviderConnection({
    tenantRef: "tenant-1",
    workspaceRef: "workspace-1",
    brandRef: null,
    ownerScopeType: "company_workspace",
    ownerScopeRef: "workspace-1",
    connectionRef: "connection-r",
    expectedConnectionRevision: 7,
    principalRef: "user-1",
    userRef: "user-1",
    reasonCode: "user_requested",
  }),
  (error) => error.code === "provider_connection_revoke_atomic_conflict",
);

assert.deepEqual(events, [
  "begin",
  "lock-ownership",
  "lock-base",
  "revoke-ownership",
  "revoke-base-conflict",
  "rollback",
  "release",
]);
assert.equal(events.includes("commit"), false);

console.log("context kernel provider consent activation revocation rollback tests passed");
