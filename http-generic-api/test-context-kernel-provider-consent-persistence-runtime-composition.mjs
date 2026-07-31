import assert from "node:assert/strict";

import {
  createProviderConsentCallbackRuntimeService,
} from "./contextKernel/application/providerConsentCallbackRuntimeService.js";
import {
  createProviderAuthorizationRuntimeRepository,
} from "./contextKernel/infrastructure/sql/providerAuthorizationRuntimeRepository.js";
import {
  _testingProviderConsentRuntimeRepositories,
  createBrandManagementAuthorityRepository,
  createProviderConnectionAccessRepository,
  createProviderConsentReadinessRepository,
} from "./contextKernel/infrastructure/sql/providerConsentRuntimeRepositories.js";

const shaA = "a".repeat(64);
const shaB = "b".repeat(64);
const expectedChecksum =
  "8689a9440be9224e1b19ee1d88c983feb10f4056cc7a83d59790e9230ed28faf";

function mysqlRows(rows) {
  return [rows, []];
}

function mysqlMutation(affectedRows = 1) {
  return [{ affectedRows }, []];
}

{
  const pool = {
    async execute(statement) {
      assert.match(statement, /information_schema\.tables/);
      return mysqlRows([{
        ownership_table_ready: 1,
        authorization_state_table_ready: 1,
        compatibility_view_ready: 1,
        workspace_ownership_column_count: 3,
      }]);
    },
  };
  const readyRepository = createProviderConsentReadinessRepository({
    pool,
    enablementResolver: async (request) => ({
      migrationReadbackVerified: true,
      applicationUseCasesEnabled: true,
      migrationChecksumSha256: request.migrationChecksumSha256,
      versionRef: "readiness-v7",
    }),
  });
  const ready = await readyRepository.findProviderConsentReadiness({ operation: "list" });
  assert.equal(ready.status, "ready");
  assert.equal(ready.schemaReady, true);
  assert.equal(ready.migrationReadbackVerified, true);
  assert.equal(ready.applicationUseCasesEnabled, true);
  assert.equal(ready.secretsIncluded, false);

  const blockedRepository = createProviderConsentReadinessRepository({
    pool,
    enablementResolver: async () => ({
      migrationReadbackVerified: true,
      applicationUseCasesEnabled: true,
      migrationChecksumSha256: shaB,
    }),
  });
  const blocked = await blockedRepository.findProviderConsentReadiness({ operation: "authorize" });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.migrationReadbackVerified, false);
  assert.equal(blocked.applicationUseCasesEnabled, false);
  assert.equal(blocked.reasonCode, "provider_consent_enablement_not_authorized");
}

{
  const repository = createBrandManagementAuthorityRepository({
    authorityResolver: async (request) => ({
      ...request,
      status: "active",
      permissions: [
        "provider_connection.manage",
        "credential.read",
        "provider_connection.manage",
      ],
      versionRef: "brand-authority-v4",
      authorityEpoch: "epoch-91",
    }),
  });
  const authority = await repository.findBrandManagementAuthority({
    tenantRef: "tenant-1",
    workspaceRef: "workspace-1",
    brandRef: "brand-1",
    principalRef: "user-1",
  });
  assert.deepEqual(authority.permissions, ["provider_connection.manage"]);
  assert.equal(authority.secretsIncluded, false);

  const mismatched = createBrandManagementAuthorityRepository({
    authorityResolver: async (request) => ({ ...request, brandRef: "brand-other", status: "active" }),
  });
  await assert.rejects(
    mismatched.findBrandManagementAuthority({
      tenantRef: "tenant-1",
      workspaceRef: "workspace-1",
      brandRef: "brand-1",
      principalRef: "user-1",
    }),
    (error) => error.code === "brand_management_authority_context_mismatch",
  );
}

{
  const listRows = [
    {
      connection_id: "connection-a",
      tenant_id: "tenant-1",
      workspace_id: "workspace-1",
      provider_key: "google_drive",
      owner_scope_type: "brand",
      owner_scope_ref: "brand-1",
      brand_id: "brand-1",
      authorization_revision: 2,
      connection_revision: 3,
      ownership_status: "active",
      updated_at: "2026-07-31T10:00:00.000Z",
    },
    {
      connection_id: "connection-b",
      tenant_id: "tenant-1",
      workspace_id: "workspace-1",
      provider_key: "notion",
      owner_scope_type: "brand",
      owner_scope_ref: "brand-1",
      brand_id: "brand-1",
      authorization_revision: 1,
      connection_revision: 1,
      ownership_status: "active",
      updated_at: "2026-07-31T10:01:00.000Z",
    },
  ];
  const listPool = {
    async execute(statement, params) {
      assert.match(statement, /v_context_kernel_connection_ownership_compatibility/);
      assert.deepEqual(params.slice(0, 5), [
        "tenant-1",
        "workspace-1",
        "brand",
        "brand-1",
        "brand-1",
      ]);
      return mysqlRows(listRows);
    },
  };
  const repository = createProviderConnectionAccessRepository({ pool: listPool });
  const firstPage = await repository.listProviderConnections({
    tenantRef: "tenant-1",
    workspaceRef: "workspace-1",
    brandRef: "brand-1",
    ownerScopeType: "brand",
    ownerScopeRef: "brand-1",
    limit: 1,
  });
  assert.equal(firstPage.connections.length, 1);
  assert.equal(firstPage.connections[0].connectionRef, "connection-a");
  assert.ok(firstPage.nextCursor);
  assert.deepEqual(
    _testingProviderConsentRuntimeRepositories.decodeCursor(firstPage.nextCursor),
    { providerKey: "google_drive", connectionRef: "connection-a" },
  );
}

{
  const events = [];
  const transaction = {
    async beginTransaction() { events.push("begin"); },
    async commit() { events.push("commit"); },
    async rollback() { events.push("rollback"); },
    release() { events.push("release"); },
    async execute(statement) {
      if (statement.includes("FOR UPDATE")) {
        events.push("lock");
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
      if (statement.includes("SET status = 'revoked'")) {
        events.push("revoke");
        return mysqlMutation(1);
      }
      if (statement.includes("authorization_revision") && statement.includes("updated_at")) {
        events.push("readback");
        return mysqlRows([{
          connection_id: "connection-r",
          tenant_id: "tenant-1",
          workspace_id: "workspace-1",
          brand_id: null,
          owner_scope_type: "company_workspace",
          owner_scope_ref: "workspace-1",
          provider_key: "google_drive",
          authorization_revision: 5,
          connection_revision: 8,
          status: "revoked",
          updated_at: "2026-07-31T10:20:00.000Z",
        }]);
      }
      throw new Error(`Unexpected SQL: ${statement}`);
    },
  };
  const pool = {
    async getConnection() { return transaction; },
    async execute() { throw new Error("root execute should not be used"); },
  };
  const repository = createProviderConnectionAccessRepository({ pool });
  const revoked = await repository.revokeProviderConnection({
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
  });
  assert.equal(revoked.status, "revoked");
  assert.equal(revoked.connectionRevision, 8);
  assert.deepEqual(events, ["begin", "lock", "revoke", "readback", "commit", "release"]);
}

{
  const sqlEvents = [];
  const claimedStateRow = {
    state_ref: "state-authorize",
    flow_type: "authorize",
    provider_key: "google_drive",
    principal_ref: "user-1",
    user_id: "user-1",
    tenant_id: "tenant-1",
    workspace_id: "workspace-1",
    brand_id: "brand-1",
    owner_scope_type: "brand",
    owner_scope_ref: "brand-1",
    target_connection_id: null,
    expected_connection_revision: null,
    expected_provider_account_ref: null,
    expected_provider_account_binding_hash: null,
    requested_provider_scopes_json: JSON.stringify(["drive.file"]),
    redirect_target_ref: "redirect-1",
    signature_version: "hmac-sha256.v1",
    state_revision: 2,
    claim_revision: 1,
    claim_verifier_persisted: 1,
    claimed_at: "2026-07-31T10:00:00.000Z",
    consumed_at: null,
    completion_revision: 0,
    status: "claimed",
    failure_code: null,
    issued_at: "2026-07-31T09:59:00.000Z",
    expires_at: "2026-07-31T10:10:00.000Z",
    updated_at: "2026-07-31T10:00:00.000Z",
  };
  const transaction = {
    async beginTransaction() { sqlEvents.push("begin"); },
    async commit() { sqlEvents.push("commit"); },
    async rollback() { sqlEvents.push("rollback"); },
    release() { sqlEvents.push("release"); },
    async execute(statement) {
      if (statement.includes("flow_type = 'authorize'") && statement.includes("FOR UPDATE")) {
        sqlEvents.push("lock-state");
        return mysqlRows([claimedStateRow]);
      }
      if (statement.includes("INSERT INTO user_app_connections")) {
        sqlEvents.push("insert-connection");
        return mysqlMutation(1);
      }
      if (statement.includes("INSERT INTO workspace_app_links")) {
        sqlEvents.push("insert-link");
        return mysqlMutation(1);
      }
      if (statement.includes("INSERT INTO connection_ownership_scopes")) {
        sqlEvents.push("insert-ownership");
        return mysqlMutation(1);
      }
      if (statement.includes("SET status = 'consumed'")) {
        sqlEvents.push("consume-state");
        return mysqlMutation(1);
      }
      if (statement.includes("ownership_resolution_status")) {
        sqlEvents.push("readback");
        return mysqlRows([{
          connection_id: "connection-new",
          tenant_id: "tenant-1",
          workspace_id: "workspace-1",
          provider_key: "google_drive",
          owner_scope_type: "brand",
          owner_scope_ref: "brand-1",
          brand_id: "brand-1",
          provider_account_ref: "account-1",
          provider_account_binding_hash: null,
          provider_account_binding_version: "google-sub.v1",
          authorization_revision: 1,
          connection_revision: 1,
          ownership_status: "active",
          ownership_resolution_status: "classified",
        }]);
      }
      throw new Error(`Unexpected transaction SQL: ${statement}`);
    },
  };
  const pool = {
    async getConnection() { return transaction; },
    async execute(statement) {
      if (statement.includes("FROM provider_authorization_states")) {
        return mysqlRows([claimedStateRow]);
      }
      throw new Error(`Unexpected root SQL: ${statement}`);
    },
  };
  const repository = createProviderAuthorizationRuntimeRepository({ pool });
  const completed = await repository.completeClaimedAuthorization({
    tenantRef: "tenant-1",
    stateRef: "state-authorize",
    expectedStateRevision: 2,
    claimRevision: 1,
    claimTokenHash: shaA,
    expectedConnectionRevision: 0,
    connectionRef: "connection-new",
    linkRef: "link-new",
    ownershipRef: "ownership-new",
    encryptedCredentials: "encrypted-envelope",
    providerAccountRef: "account-1",
    providerAccountBindingVersion: "google-sub.v1",
    displayLabel: "Drive",
    accountLabel: "account@example.test",
    accountMetadata: { displayName: "Example" },
    grantedScopes: ["drive.file"],
    tokenExpiresAt: "2026-07-31T11:00:00.000Z",
  });
  assert.equal(completed.status, "consumed");
  assert.equal(completed.connectionRef, "connection-new");
  assert.equal(completed.connectionRevision, 1);
  assert.deepEqual(sqlEvents, [
    "begin",
    "lock-state",
    "insert-connection",
    "insert-link",
    "insert-ownership",
    "consume-state",
    "readback",
    "commit",
    "release",
  ]);
}

{
  const events = [];
  const state = {
    stateRef: "state-runtime",
    flowType: "authorize",
    providerKey: "google_drive",
    principalRef: "user-1",
    userRef: "user-1",
    tenantRef: "tenant-1",
    workspaceRef: "workspace-1",
    brandRef: "brand-1",
    ownerScopeType: "brand",
    ownerScopeRef: "brand-1",
    targetConnectionRef: null,
    expectedConnectionRevision: null,
    expectedProviderAccountRef: null,
    expectedProviderAccountBindingHash: null,
    requestedProviderScopes: ["drive.file"],
    redirectTargetRef: "redirect-1",
    stateRevision: 2,
    claimRevision: 1,
    claimVerifierPersisted: true,
    expiresAt: "2026-07-31T14:00:00.000Z",
    status: "claimed",
  };
  let handoffRecord = null;
  let taken = false;
  const repository = {
    async issueAuthorizationState() { throw new Error("not used"); },
    async claimAuthorizationState() { throw new Error("not used"); },
    async findAuthorizationState() {
      events.push("find-state");
      return state;
    },
    async completeClaimedAuthorization(input) {
      events.push("complete");
      assert.equal(input.encryptedCredentials, "sealed-credentials");
      assert.equal(input.providerAccountRef, "account-1");
      assert.ok(input.connectionRef);
      assert.ok(input.linkRef);
      assert.ok(input.ownershipRef);
      assert.equal(Object.hasOwn(input, "authorizationCode"), false);
      return {
        status: "consumed",
        connectionRef: input.connectionRef,
        connectionRevision: 1,
        authorizationRevision: 1,
      };
    },
  };
  const service = createProviderConsentCallbackRuntimeService({
    providerConsentService: {
      async claim() {
        events.push("claim");
        return {
          stateRef: state.stateRef,
          stateRevision: state.stateRevision,
          claimRevision: state.claimRevision,
          tenantRef: state.tenantRef,
        };
      },
    },
    providerAuthorizationStateRepository: repository,
    providerExchangeResolver: async ({ providerKey }) => {
      events.push("resolve-exchange");
      assert.equal(providerKey, "google_drive");
      return {
        async exchangeAuthorizationCode(input) {
          events.push("exchange");
          assert.equal(input.authorizationCode, "provider-code");
          return { accessToken: "raw-token", providerAccountRef: "account-1" };
        },
      };
    },
    credentialEnvelopeService: {
      async sealProviderCredential({ providerResult }) {
        events.push("seal");
        assert.equal(providerResult.accessToken, "raw-token");
        return {
          providerKey: "google_drive",
          encryptedCredentials: "sealed-credentials",
          providerAccountRef: "account-1",
          providerAccountBindingVersion: "google-sub.v1",
          grantedScopes: ["drive.file"],
          accountMetadata: { safe: true },
        };
      },
    },
    handoffStore: {
      async create(record) {
        events.push("create-handoff");
        handoffRecord = record;
        return { handoffRef: record.handoffRef, persisted: true };
      },
      async take({ handoffRef }) {
        events.push("take-handoff");
        if (taken || !handoffRecord || handoffRecord.handoffRef !== handoffRef) return null;
        taken = true;
        return { consumed: true, payload: handoffRecord.payload };
      },
    },
    idFactory: (() => {
      const ids = ["handoff-1", "connection-1", "link-1", "ownership-1"];
      return () => ids.shift();
    })(),
    claimTokenFactory: () => "claim-token-secret",
  });

  const claimed = await service.claimCallback({
    authorizationState: "signed-state",
    authorizationCode: "provider-code",
  });
  assert.equal(claimed.status, "claimed_handoff_ready");
  assert.equal(claimed.providerCallMade, false);
  assert.deepEqual(events, ["claim", "find-state", "create-handoff"]);

  const completed = await service.resumeCallback({ handoffRef: claimed.handoffRef });
  assert.equal(completed.status, "consumed");
  assert.equal(completed.providerCallMade, true);
  assert.equal(completed.credentialPayloadRead, false);
  assert.equal(completed.secretsIncluded, false);
  assert.deepEqual(events, [
    "claim",
    "find-state",
    "create-handoff",
    "take-handoff",
    "find-state",
    "resolve-exchange",
    "exchange",
    "seal",
    "complete",
  ]);
  await assert.rejects(
    service.resumeCallback({ handoffRef: claimed.handoffRef }),
    (error) => error.code === "provider_consent_handoff_unavailable",
  );
}

assert.equal(expectedChecksum.length, 64);
console.log("context kernel provider consent persistence runtime composition tests passed");
