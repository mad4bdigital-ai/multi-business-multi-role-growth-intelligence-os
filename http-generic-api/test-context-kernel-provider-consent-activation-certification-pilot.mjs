import assert from "node:assert/strict";

import {
  createProviderConsentActivationPilotService,
} from "./contextKernel/application/providerConsentActivationPilotService.js";
import {
  createCertifiedProviderConnectionRevocationRepository,
  createDurableProviderConsentHandoffAdapter,
} from "./contextKernel/infrastructure/sql/providerConsentActivationPilotRepositories.js";

function mysqlRows(rows) {
  return [rows, []];
}

function mysqlMutation(affectedRows = 1) {
  return [{ affectedRows }, []];
}

function createMemoryDurableStore() {
  const records = new Map();
  return {
    records,
    async insert(input) {
      if (records.has(input.handoffRef)) return { created: false };
      records.set(input.handoffRef, {
        ...input,
        attempt: 0,
        leaseRef: null,
        completed: false,
        failed: false,
        sealedCredentialCheckpoint: null,
        sealedCompletionCheckpoint: null,
      });
      return { created: true, handoffRef: input.handoffRef };
    },
    async acquire({ handoffRef, leaseRef }) {
      const row = records.get(handoffRef);
      if (!row || row.completed || row.failed || row.leaseRef) return null;
      row.leaseRef = leaseRef;
      row.attempt += 1;
      return {
        acquired: true,
        handoffRef,
        leaseRef,
        attempt: row.attempt,
        sealedPayload: row.sealedPayload,
        sealedCredentialCheckpoint: row.sealedCredentialCheckpoint,
        sealedCompletionCheckpoint: row.sealedCompletionCheckpoint,
      };
    },
    async checkpoint(input) {
      const row = records.get(input.handoffRef);
      if (!row || row.leaseRef !== input.leaseRef || row.completed) {
        return { checkpointed: false };
      }
      if (input.sealedCredentialCheckpoint) {
        row.sealedCredentialCheckpoint = input.sealedCredentialCheckpoint;
      }
      if (input.sealedCompletionCheckpoint) {
        row.sealedCompletionCheckpoint = input.sealedCompletionCheckpoint;
      }
      row.stage = input.stage;
      return { checkpointed: true };
    },
    async release({ handoffRef, leaseRef, retryable }) {
      const row = records.get(handoffRef);
      if (!row || row.leaseRef !== leaseRef || row.completed) return { released: false };
      row.leaseRef = null;
      if (!retryable) row.failed = true;
      return { released: true };
    },
    async complete({ handoffRef, leaseRef }) {
      const row = records.get(handoffRef);
      if (!row || row.leaseRef !== leaseRef || row.completed) return { completed: false };
      row.completed = true;
      row.leaseRef = null;
      return { completed: true };
    },
  };
}

function createPayloadCipher() {
  return {
    async seal({ purpose, plaintext }) {
      return `${purpose}:${Buffer.from(JSON.stringify(plaintext), "utf8").toString("base64url")}`;
    },
    async open({ purpose, sealed }) {
      assert.ok(sealed.startsWith(`${purpose}:`));
      return JSON.parse(Buffer.from(sealed.slice(purpose.length + 1), "base64url").toString("utf8"));
    },
  };
}

function createState(overrides = {}) {
  return {
    stateRef: "state-pilot",
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
    requestedProviderScopes: ["drive.file", "userinfo.email"],
    redirectTargetRef: "redirect-1",
    stateRevision: 2,
    claimRevision: 1,
    claimVerifierPersisted: true,
    expiresAt: "2026-07-31T13:00:00.000Z",
    status: "claimed",
    ...overrides,
  };
}

function createRepository(state, counters) {
  return {
    async issueAuthorizationState() { throw new Error("not used"); },
    async claimAuthorizationState() { throw new Error("not used"); },
    async findAuthorizationState() {
      counters.find += 1;
      return state;
    },
    async completeClaimedAuthorization(input) {
      counters.complete += 1;
      assert.equal(Object.hasOwn(input, "authorizationCode"), false);
      assert.equal(input.encryptedCredentials, "encrypted-envelope");
      assert.deepEqual(input.grantedScopes, ["drive.file", "userinfo.email"]);
      assert.deepEqual(input.accountMetadata, {
        account_id: "account-1",
        display_name: "Example",
        email: "user@example.test",
      });
      return {
        status: "consumed",
        connectionRef: input.connectionRef,
        connectionRevision: 1,
        authorizationRevision: 1,
      };
    },
  };
}

function createExchange(providerCalls, overrides = {}) {
  return {
    adapter: {
      async exchangeAuthorizationCode(input) {
        providerCalls.count += 1;
        assert.equal(input.authorizationCode, "provider-code");
        assert.match(input.idempotencyKey, /^state-[a-z-]+:1$/);
        return {
          providerKey: "google_drive",
          credentials: { access_token: "raw-token", refresh_token: "raw-refresh" },
          grantedScopes: ["drive.file", "userinfo.email"],
          account: { id: "account-1" },
          ...overrides,
        };
      },
    },
    certification: {
      status: "certified",
      providerKey: "google_drive",
      supportsIdempotency: true,
      timeoutMs: 15000,
      versionRef: "google-exchange.v1",
    },
  };
}

function createCredentialService(envelopeOverrides = {}) {
  return {
    certification: {
      status: "certified",
      algorithm: "aes-256-gcm",
      secretsExcludedFromProjection: true,
      metadataPolicyVersion: "provider-account-safe.v1",
    },
    async sealProviderCredential({ providerKey, providerResult }) {
      assert.equal(providerKey, "google_drive");
      assert.ok(providerResult.credentials.access_token);
      return {
        providerKey,
        encryptedCredentials: "encrypted-envelope",
        providerAccountRef: "account-1",
        providerAccountBindingHash: null,
        providerAccountBindingVersion: "google-sub.v1",
        displayLabel: "Drive",
        accountLabel: "user@example.test",
        accountMetadata: {
          account_id: "account-1",
          display_name: "Example",
          email: "user@example.test",
          ignored_complex: { nested: true },
        },
        grantedScopes: ["userinfo.email", "drive.file"],
        tokenExpiresAt: "2026-07-31T14:00:00.000Z",
        ...envelopeOverrides,
      };
    },
  };
}

function deterministicIds(prefix) {
  let index = 0;
  return () => `${prefix}-${++index}`;
}

const handoffCertification = {
  status: "certified",
  versionRef: "durable-handoff.v1",
  capabilities: {
    atomicCreate: true,
    leaseCas: true,
    checkpointCas: true,
    oneTimeCompletion: true,
    expiryEnforced: true,
    payloadEncryption: true,
  },
};

{
  const memoryStore = createMemoryDurableStore();
  const adapter = createDurableProviderConsentHandoffAdapter({
    store: memoryStore,
    payloadCipher: createPayloadCipher(),
    certification: handoffCertification,
    clock: () => new Date("2026-07-31T12:00:00.000Z"),
  });
  assert.equal(adapter.certification.status, "certified");
  const created = await adapter.create({
    handoffRef: "handoff-adapter",
    expiresAt: "2026-07-31T13:00:00.000Z",
    maxAttempts: 3,
    payload: { authorizationCode: "secret-code" },
  });
  assert.equal(created.payloadSealed, true);
  assert.equal(JSON.stringify(created).includes("secret-code"), false);
  const leased = await adapter.acquire({
    handoffRef: "handoff-adapter",
    leaseRef: "lease-adapter",
    leaseExpiresAt: "2026-07-31T12:01:00.000Z",
  });
  assert.equal(leased.payload.authorizationCode, "secret-code");
  await adapter.release({
    handoffRef: "handoff-adapter",
    leaseRef: "lease-adapter",
    retryable: true,
    errorCode: "provider_timeout",
    retryAt: "2026-07-31T12:00:05.000Z",
  });

  assert.throws(
    () => createDurableProviderConsentHandoffAdapter({
      store: createMemoryDurableStore(),
      payloadCipher: createPayloadCipher(),
      certification: {
        ...handoffCertification,
        capabilities: { ...handoffCertification.capabilities, leaseCas: false },
      },
    }),
    (error) => error.code === "provider_consent_handoff_capability_missing",
  );
}

{
  const state = createState();
  const counters = { find: 0, complete: 0 };
  const providerCalls = { count: 0 };
  const memoryStore = createMemoryDurableStore();
  const handoffStore = createDurableProviderConsentHandoffAdapter({
    store: memoryStore,
    payloadCipher: createPayloadCipher(),
    certification: handoffCertification,
    clock: () => new Date("2026-07-31T12:00:00.000Z"),
  });
  let injected = false;
  const service = createProviderConsentActivationPilotService({
    providerConsentService: {
      async claim() {
        return {
          stateRef: state.stateRef,
          stateRevision: state.stateRevision,
          claimRevision: state.claimRevision,
          tenantRef: state.tenantRef,
        };
      },
    },
    providerAuthorizationStateRepository: createRepository(state, counters),
    providerExchangeResolver: async () => createExchange(providerCalls),
    credentialEnvelopeService: createCredentialService(),
    handoffStore,
    clock: () => new Date("2026-07-31T12:00:00.000Z"),
    idFactory: deterministicIds("pilot"),
    claimTokenFactory: () => "claim-token",
    faultInjector: async (point) => {
      if (point === "after_provider_checkpoint" && !injected) {
        injected = true;
        const error = new Error("simulated worker crash");
        error.code = "provider_transient_error";
        error.retryable = true;
        throw error;
      }
    },
    retryDelayMs: 0,
  });

  const claimed = await service.claimCallback({
    authorizationState: "signed-state",
    authorizationCode: "provider-code",
  });
  assert.equal(claimed.status, "claimed_handoff_ready");
  assert.equal(JSON.stringify(claimed).includes("provider-code"), false);

  await assert.rejects(
    service.resumeCallback({ handoffRef: claimed.handoffRef }),
    (error) => error.code === "provider_transient_error",
  );
  assert.equal(providerCalls.count, 1);
  assert.equal(counters.complete, 0);

  const completed = await service.resumeCallback({ handoffRef: claimed.handoffRef });
  assert.equal(completed.status, "consumed");
  assert.equal(completed.secretsIncluded, false);
  assert.equal(providerCalls.count, 1);
  assert.equal(counters.complete, 1);

  await assert.rejects(
    service.resumeCallback({ handoffRef: claimed.handoffRef }),
    (error) => error.code === "provider_consent_handoff_unavailable",
  );
}

{
  const state = createState({ stateRef: "state-persistence-crash" });
  const counters = { find: 0, complete: 0 };
  const providerCalls = { count: 0 };
  const memoryStore = createMemoryDurableStore();
  const handoffStore = createDurableProviderConsentHandoffAdapter({
    store: memoryStore,
    payloadCipher: createPayloadCipher(),
    certification: handoffCertification,
    clock: () => new Date("2026-07-31T12:00:00.000Z"),
  });
  let injected = false;
  const ids = deterministicIds("persist");
  const repository = createRepository(state, counters);
  const service = createProviderConsentActivationPilotService({
    providerConsentService: {
      async claim() {
        return {
          stateRef: state.stateRef,
          stateRevision: state.stateRevision,
          claimRevision: state.claimRevision,
          tenantRef: state.tenantRef,
        };
      },
    },
    providerAuthorizationStateRepository: repository,
    providerExchangeResolver: async () => ({
      ...createExchange(providerCalls),
      adapter: {
        async exchangeAuthorizationCode(input) {
          providerCalls.count += 1;
          assert.equal(input.idempotencyKey, "state-persistence-crash:1");
          return {
            providerKey: "google_drive",
            credentials: { access_token: "raw-token" },
            grantedScopes: ["drive.file", "userinfo.email"],
          };
        },
      },
    }),
    credentialEnvelopeService: createCredentialService(),
    handoffStore,
    clock: () => new Date("2026-07-31T12:00:00.000Z"),
    idFactory: ids,
    claimTokenFactory: () => "claim-token-2",
    faultInjector: async (point) => {
      if (point === "after_persistence_checkpoint" && !injected) {
        injected = true;
        const error = new Error("simulated crash after persistence");
        error.code = "provider_transient_error";
        error.retryable = true;
        throw error;
      }
    },
    retryDelayMs: 0,
  });
  const claimed = await service.claimCallback({
    authorizationState: "signed-state-2",
    authorizationCode: "provider-code",
  });
  await assert.rejects(
    service.resumeCallback({ handoffRef: claimed.handoffRef }),
    (error) => error.code === "provider_transient_error",
  );
  assert.equal(providerCalls.count, 1);
  assert.equal(counters.complete, 1);
  const recovered = await service.resumeCallback({ handoffRef: claimed.handoffRef });
  assert.equal(recovered.status, "consumed");
  assert.equal(providerCalls.count, 1);
  assert.equal(counters.complete, 1);
}

{
  const state = createState({ stateRef: "state-scope-mismatch" });
  const counters = { find: 0, complete: 0 };
  const providerCalls = { count: 0 };
  const handoffStore = createDurableProviderConsentHandoffAdapter({
    store: createMemoryDurableStore(),
    payloadCipher: createPayloadCipher(),
    certification: handoffCertification,
    clock: () => new Date("2026-07-31T12:00:00.000Z"),
  });
  const service = createProviderConsentActivationPilotService({
    providerConsentService: {
      async claim() {
        return {
          stateRef: state.stateRef,
          stateRevision: state.stateRevision,
          claimRevision: state.claimRevision,
          tenantRef: state.tenantRef,
        };
      },
    },
    providerAuthorizationStateRepository: createRepository(state, counters),
    providerExchangeResolver: async () => createExchange(providerCalls),
    credentialEnvelopeService: createCredentialService({
      grantedScopes: ["drive.file"],
    }),
    handoffStore,
    clock: () => new Date("2026-07-31T12:00:00.000Z"),
    idFactory: deterministicIds("scope"),
    claimTokenFactory: () => "claim-token-3",
  });
  const claimed = await service.claimCallback({
    authorizationState: "signed-state-3",
    authorizationCode: "provider-code",
  });
  await assert.rejects(
    service.resumeCallback({ handoffRef: claimed.handoffRef }),
    (error) => error.code === "provider_consent_granted_scope_mismatch",
  );
  assert.equal(providerCalls.count, 1);
  assert.equal(counters.complete, 0);
}

{
  const state = createState({ stateRef: "state-secret-metadata" });
  const counters = { find: 0, complete: 0 };
  const providerCalls = { count: 0 };
  const handoffStore = createDurableProviderConsentHandoffAdapter({
    store: createMemoryDurableStore(),
    payloadCipher: createPayloadCipher(),
    certification: handoffCertification,
    clock: () => new Date("2026-07-31T12:00:00.000Z"),
  });
  const service = createProviderConsentActivationPilotService({
    providerConsentService: {
      async claim() {
        return {
          stateRef: state.stateRef,
          stateRevision: state.stateRevision,
          claimRevision: state.claimRevision,
          tenantRef: state.tenantRef,
        };
      },
    },
    providerAuthorizationStateRepository: createRepository(state, counters),
    providerExchangeResolver: async () => createExchange(providerCalls),
    credentialEnvelopeService: createCredentialService({
      accountMetadata: {
        account_id: "account-1",
        access_token: "must-not-project",
      },
    }),
    handoffStore,
    clock: () => new Date("2026-07-31T12:00:00.000Z"),
    idFactory: deterministicIds("secret"),
    claimTokenFactory: () => "claim-token-4",
  });
  const claimed = await service.claimCallback({
    authorizationState: "signed-state-4",
    authorizationCode: "provider-code",
  });
  await assert.rejects(
    service.resumeCallback({ handoffRef: claimed.handoffRef }),
    (error) => error.code === "provider_consent_secret_metadata_rejected",
  );
  assert.equal(counters.complete, 0);
}

{
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
        events.push("revoke-base");
        return mysqlMutation(1);
      }
      if (statement.includes("authorization_revision") && !statement.includes("FOR UPDATE")) {
        events.push("readback-ownership");
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
        }]);
      }
      if (statement.includes("last_used_at")) {
        events.push("readback-base");
        return mysqlRows([{
          connection_id: "connection-r",
          tenant_id: "tenant-1",
          app_key: "google_drive",
          status: "revoked",
        }]);
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
  assert.equal(revoked.ownershipStatus, "revoked");
  assert.equal(revoked.baseConnectionStatus, "revoked");
  assert.equal(revoked.connectionRevision, 8);
  assert.deepEqual(events, [
    "begin",
    "lock-ownership",
    "lock-base",
    "revoke-ownership",
    "revoke-base",
    "readback-ownership",
    "readback-base",
    "commit",
    "release",
  ]);
}

console.log("context kernel provider consent activation certification pilot tests passed");
