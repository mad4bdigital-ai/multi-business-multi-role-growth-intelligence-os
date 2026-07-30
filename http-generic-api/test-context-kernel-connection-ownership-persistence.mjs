import assert from "node:assert/strict";
import fs from "node:fs";

import {
  assertConnectionOwnershipRepository,
  assertProviderAuthorizationStateRepository,
  assertWorkspaceOwnershipRepository,
} from "./contextKernel/application/repositoryPorts.js";
import {
  createConnectionOwnershipRepository,
  createProviderAuthorizationStateRepository,
  createWorkspaceOwnershipRepository,
} from "./contextKernel/infrastructure/sql/index.js";

const CLAIM_HASH = "a".repeat(64);
const ACCOUNT_HASH = "b".repeat(64);

async function assertRejectCode(run, expectedCode) {
  let error = null;
  try {
    await run();
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, `Expected ${expectedCode} to be thrown.`);
  assert.equal(error.code, expectedCode);
  return error;
}

function createReadPool(handler) {
  const calls = [];
  return {
    calls,
    pool: {
      async execute(sql, params = []) {
        const call = { sql: String(sql), params: [...params] };
        calls.push(call);
        return [await handler(call.sql, call.params, calls.length - 1), []];
      },
    },
  };
}

const migration = fs.readFileSync(
  new URL("./migrations/20260730_context_kernel_connection_ownership_persistence.sql", import.meta.url),
  "utf8",
);
assert.match(migration, /ADD COLUMN IF NOT EXISTS `workspace_ownership_type`/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS `connection_ownership_scopes`/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS `provider_authorization_states`/);
assert.match(migration, /CREATE OR REPLACE VIEW `v_context_kernel_connection_ownership_compatibility`/);
assert.match(migration, /provider_account_binding_hash/);
assert.match(migration, /claim_token_hash/);
assert.doesNotMatch(migration, /ADD KEY IF NOT EXISTS/i);
assert.doesNotMatch(migration, /(?:MODIFY|CHANGE)\s+(?:COLUMN\s+)?`workspace_type`/i);
assert.doesNotMatch(
  migration,
  /\b(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+`?(?:workspace_registry|user_app_connections|workspace_app_links|connection_ownership_scopes)`?/i,
);
assert.doesNotMatch(
  migration,
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
);

const workspaceRow = {
  workspace_id: "workspace-a",
  tenant_id: "tenant-a",
  workspace_key: "project-a",
  display_name: "Project A",
  workspace_type: "project",
  workspace_ownership_type: "company",
  owner_user_id: null,
  ownership_revision: 7,
  bootstrap_status: "ready",
  updated_at: "2026-07-30T08:00:00.000Z",
};
const workspaceMock = createReadPool(() => [workspaceRow]);
const workspaceRepository = createWorkspaceOwnershipRepository({ pool: workspaceMock.pool });
assertWorkspaceOwnershipRepository(workspaceRepository);
const workspace = await workspaceRepository.findWorkspaceOwnership({
  tenantRef: "tenant-a",
  workspaceRef: "workspace-a",
});
assert.equal(workspace.workspaceType, "project");
assert.equal(workspace.workspaceOwnershipType, "company");
assert.equal(workspace.ownershipRevision, 7);
assert.match(workspaceMock.calls[0].sql, /tenant_id\s*=\s*\?/i);
assert.deepEqual(workspaceMock.calls[0].params, ["tenant-a", "workspace-a"]);

const unclassifiedWorkspaceMock = createReadPool(() => [{
  ...workspaceRow,
  workspace_ownership_type: null,
}]);
await assertRejectCode(
  () => createWorkspaceOwnershipRepository({ pool: unclassifiedWorkspaceMock.pool })
    .findWorkspaceOwnership({ tenantRef: "tenant-a", workspaceRef: "workspace-a" }),
  "workspace_ownership_unclassified",
);

const ownershipRow = {
  connection_id: "connection-a",
  tenant_id: "tenant-a",
  legacy_connected_user_id: "user-a",
  provider_key: "google_drive",
  connection_status: "active",
  link_id: "link-a",
  workspace_id: "workspace-a",
  workspace_key: "project-a",
  link_status: "active",
  workspace_type: "project",
  workspace_ownership_type: "personal",
  workspace_owner_user_id: "user-a",
  workspace_ownership_revision: 4,
  ownership_id: "ownership-a",
  owner_scope_type: "personal_workspace",
  owner_scope_ref: "workspace-a",
  connection_owner_user_id: "user-a",
  brand_id: null,
  provider_account_ref: null,
  provider_account_binding_hash: ACCOUNT_HASH,
  provider_account_binding_version: "sha256-v1",
  authorization_revision: 3,
  connection_revision: 9,
  ownership_status: "active",
  ownership_resolution_status: "classified",
};
const ownershipMock = createReadPool(() => [ownershipRow]);
const ownershipRepository = createConnectionOwnershipRepository({ pool: ownershipMock.pool });
assertConnectionOwnershipRepository(ownershipRepository);
const ownership = await ownershipRepository.findConnectionOwnership({
  tenantRef: "tenant-a",
  workspaceRef: "workspace-a",
  connectionRef: "connection-a",
  effectiveUserRef: "user-a",
});
assert.equal(ownership.ownerScopeType, "personal_workspace");
assert.equal(ownership.providerAccountBindingHash, ACCOUNT_HASH);
assert.equal(ownership.secretsIncluded, false);
assert.doesNotMatch(ownershipMock.calls[0].sql, /encrypted_credentials/i);
assert.deepEqual(ownershipMock.calls[0].params, ["tenant-a", "workspace-a", "connection-a"]);

await assertRejectCode(
  () => createConnectionOwnershipRepository({ pool: createReadPool(() => [ownershipRow]).pool })
    .findConnectionOwnership({
      tenantRef: "tenant-a",
      workspaceRef: "workspace-a",
      connectionRef: "connection-a",
      effectiveUserRef: "user-b",
    }),
  "connection_owner_mismatch",
);

const brandOwnershipRow = {
  ...ownershipRow,
  workspace_ownership_type: "company",
  workspace_owner_user_id: null,
  owner_scope_type: "brand",
  owner_scope_ref: "brand-a",
  connection_owner_user_id: null,
  brand_id: "brand-a",
};
await assertRejectCode(
  () => createConnectionOwnershipRepository({
    pool: createReadPool(() => [brandOwnershipRow]).pool,
  }).findConnectionOwnership({
    tenantRef: "tenant-a",
    workspaceRef: "workspace-a",
    connectionRef: "connection-a",
    brandRef: "brand-b",
  }),
  "connection_brand_owner_mismatch",
);

function baseStateRow(overrides = {}) {
  return {
    state_ref: "state-a",
    flow_type: "reconnect",
    provider_key: "google_drive",
    principal_ref: "user-a",
    user_id: "user-a",
    tenant_id: "tenant-a",
    workspace_id: "workspace-a",
    brand_id: null,
    owner_scope_type: "personal_workspace",
    owner_scope_ref: "workspace-a",
    target_connection_id: "connection-a",
    expected_connection_revision: 9,
    expected_provider_account_ref: null,
    expected_provider_account_binding_hash: ACCOUNT_HASH,
    requested_provider_scopes_json: JSON.stringify(["drive.readonly"]),
    redirect_target_ref: "tenant-oauth-callback",
    signature_version: "v1",
    state_revision: 1,
    claim_revision: 0,
    claim_verifier_persisted: 0,
    claimed_at: null,
    consumed_at: null,
    completion_revision: 0,
    status: "issued",
    failure_code: null,
    issued_at: "2026-07-30T08:00:00.000Z",
    expires_at: "2030-01-01T00:00:00.000Z",
    updated_at: "2026-07-30T08:00:00.000Z",
    ...overrides,
  };
}

let claimState = baseStateRow();
const claimCalls = [];
const claimPool = {
  async execute(sql, params = []) {
    const statement = String(sql);
    claimCalls.push({ sql: statement, params: [...params] });
    if (/SET status = 'claimed'/.test(statement)) {
      if (claimState.status !== "issued" || claimState.state_revision !== params[3]) {
        return [{ affectedRows: 0 }, []];
      }
      claimState = baseStateRow({
        status: "claimed",
        state_revision: 2,
        claim_revision: 1,
        claim_verifier_persisted: 1,
        claimed_at: "2026-07-30T08:01:00.000Z",
      });
      return [{ affectedRows: 1 }, []];
    }
    if (/FROM provider_authorization_states/.test(statement)) return [[claimState], []];
    throw new Error(`Unexpected claim SQL: ${statement}`);
  },
};
const authorizationRepository = createProviderAuthorizationStateRepository({ pool: claimPool });
assertProviderAuthorizationStateRepository(authorizationRepository);
const claimed = await authorizationRepository.claimAuthorizationState({
  tenantRef: "tenant-a",
  stateRef: "state-a",
  expectedStateRevision: 1,
  claimTokenHash: CLAIM_HASH,
});
assert.equal(claimed.status, "claimed");
assert.equal(claimed.claimVerifierPersisted, true);
assert.equal(claimed.claimRevision, 1);
assert.doesNotMatch(claimCalls.at(-1).sql, /state_signature_hash|nonce_hash/i);

await assertRejectCode(
  () => authorizationRepository.claimAuthorizationState({
    tenantRef: "tenant-a",
    stateRef: "state-a",
    expectedStateRevision: 1,
    claimTokenHash: CLAIM_HASH,
  }),
  "oauth_state_claim_conflict",
);

function createCompletionPool({ failStateConsume = false } = {}) {
  const events = [];
  let finalState = baseStateRow({
    status: "claimed",
    state_revision: 2,
    claim_revision: 1,
    claim_verifier_persisted: 1,
    claimed_at: "2026-07-30T08:01:00.000Z",
  });
  const lockedState = {
    state_ref: "state-a",
    flow_type: "reconnect",
    provider_key: "google_drive",
    tenant_id: "tenant-a",
    workspace_id: "workspace-a",
    brand_id: null,
    owner_scope_type: "personal_workspace",
    owner_scope_ref: "workspace-a",
    target_connection_id: "connection-a",
    expected_connection_revision: 9,
    expected_provider_account_ref: null,
    expected_provider_account_binding_hash: ACCOUNT_HASH,
    state_revision: 2,
    claim_revision: 1,
    status: "claimed",
    expires_at: "2030-01-01T00:00:00.000Z",
  };
  const lockedOwnership = {
    ownership_id: "ownership-a",
    connection_id: "connection-a",
    tenant_id: "tenant-a",
    workspace_id: "workspace-a",
    brand_id: null,
    owner_scope_type: "personal_workspace",
    owner_scope_ref: "workspace-a",
    provider_key: "google_drive",
    provider_account_ref: null,
    provider_account_binding_hash: ACCOUNT_HASH,
    provider_account_binding_version: "sha256-v1",
    authorization_revision: 3,
    connection_revision: 9,
    status: "active",
  };
  const tx = {
    async beginTransaction() { events.push("begin"); },
    async commit() { events.push("commit"); },
    async rollback() { events.push("rollback"); },
    release() { events.push("release"); },
    async execute(sql, params = []) {
      const statement = String(sql);
      events.push({ sql: statement, params: [...params] });
      if (/FROM provider_authorization_states/.test(statement) && /FOR UPDATE/.test(statement)) {
        return [[lockedState], []];
      }
      if (/FROM connection_ownership_scopes/.test(statement) && /FOR UPDATE/.test(statement)) {
        return [[lockedOwnership], []];
      }
      if (/UPDATE user_app_connections/.test(statement)) return [{ affectedRows: 1 }, []];
      if (/UPDATE connection_ownership_scopes/.test(statement)) return [{ affectedRows: 1 }, []];
      if (/SET status = 'consumed'/.test(statement)) {
        if (failStateConsume) return [{ affectedRows: 0 }, []];
        finalState = baseStateRow({
          status: "consumed",
          state_revision: 3,
          claim_revision: 1,
          claim_verifier_persisted: 0,
          claimed_at: "2026-07-30T08:01:00.000Z",
          consumed_at: "2026-07-30T08:02:00.000Z",
          completion_revision: 1,
        });
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`Unexpected transaction SQL: ${statement}`);
    },
  };
  const pool = {
    async getConnection() { return tx; },
    async execute(sql) {
      const statement = String(sql);
      if (/FROM provider_authorization_states/.test(statement)) return [[finalState], []];
      throw new Error(`Unexpected root SQL: ${statement}`);
    },
  };
  return { pool, events };
}

const completionMock = createCompletionPool();
const completionRepository = createProviderAuthorizationStateRepository({ pool: completionMock.pool });
const consumed = await completionRepository.completeClaimedAuthorization({
  tenantRef: "tenant-a",
  stateRef: "state-a",
  expectedStateRevision: 2,
  claimRevision: 1,
  claimTokenHash: CLAIM_HASH,
  expectedConnectionRevision: 9,
  providerAccountBindingHash: ACCOUNT_HASH,
  providerAccountBindingVersion: "sha256-v1",
  async mutateConnection({ execute, state }) {
    assert.equal(state.connectionRef, "connection-a");
    const result = await execute(
      "UPDATE user_app_connections SET encrypted_credentials = ? WHERE tenant_id = ? AND connection_id = ?",
      ["ciphertext-placeholder", state.tenantRef, state.connectionRef],
    );
    return { credentialMutationApplied: result.affectedRows === 1 };
  },
});
assert.equal(consumed.status, "consumed");
assert.deepEqual(
  completionMock.events.filter((event) => typeof event === "string"),
  ["begin", "commit", "release"],
);
const transactionalSql = completionMock.events
  .filter((event) => typeof event === "object")
  .map((event) => event.sql)
  .join("\n");
assert.match(transactionalSql, /FOR UPDATE/);
assert.match(transactionalSql, /connection_revision = \?/);
assert.match(transactionalSql, /claim_token_hash = \?/);

const rollbackMock = createCompletionPool({ failStateConsume: true });
const rollbackRepository = createProviderAuthorizationStateRepository({ pool: rollbackMock.pool });
await assertRejectCode(
  () => rollbackRepository.completeClaimedAuthorization({
    tenantRef: "tenant-a",
    stateRef: "state-a",
    expectedStateRevision: 2,
    claimRevision: 1,
    claimTokenHash: CLAIM_HASH,
    expectedConnectionRevision: 9,
    providerAccountBindingHash: ACCOUNT_HASH,
    providerAccountBindingVersion: "sha256-v1",
    async mutateConnection({ execute, state }) {
      const result = await execute(
        "UPDATE user_app_connections SET encrypted_credentials = ? WHERE tenant_id = ? AND connection_id = ?",
        ["ciphertext-placeholder", state.tenantRef, state.connectionRef],
      );
      return { credentialMutationApplied: result.affectedRows === 1 };
    },
  }),
  "oauth_state_completion_conflict",
);
assert.ok(rollbackMock.events.includes("rollback"));
assert.ok(!rollbackMock.events.includes("commit"));

const callbackFailureMock = createCompletionPool();
const callbackFailureRepository = createProviderAuthorizationStateRepository({
  pool: callbackFailureMock.pool,
});
await assert.rejects(
  () => callbackFailureRepository.completeClaimedAuthorization({
    tenantRef: "tenant-a",
    stateRef: "state-a",
    expectedStateRevision: 2,
    claimRevision: 1,
    claimTokenHash: CLAIM_HASH,
    expectedConnectionRevision: 9,
    providerAccountBindingHash: ACCOUNT_HASH,
    providerAccountBindingVersion: "sha256-v1",
    async mutateConnection() {
      throw new Error("fault injection: credential update failed");
    },
  }),
  /fault injection/,
);
assert.ok(callbackFailureMock.events.includes("rollback"));
assert.ok(!callbackFailureMock.events.includes("commit"));

console.log("context kernel connection ownership persistence contract tests passed");
