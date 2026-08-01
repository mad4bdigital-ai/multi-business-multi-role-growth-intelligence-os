import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  createProviderConsentAdapterEvidenceService,
} from "./contextKernel/application/providerConsentAdapterEvidenceService.js";
import {
  createAes256GcmProviderCredentialEnvelopeService,
  _testingProviderConsentNonProductionCredentialEnvelope,
} from "./contextKernel/infrastructure/sql/providerConsentNonProductionCredentialEnvelope.js";
import {
  createSqlProviderConsentHandoffStore,
} from "./contextKernel/infrastructure/sql/providerConsentNonProductionHandoffStore.js";
import {
  createNonProductionProviderExchangeAdapter,
} from "./contextKernel/infrastructure/sql/providerConsentNonProductionProviderExchange.js";

const digest = (value) => createHash("sha256").update(value).digest("hex");

const sqlEvents = [];
const executor = {
  async execute(statement, params) {
    sqlEvents.push({ statement, params });
    if (statement.includes("INSERT INTO")) return [{ affectedRows: 1 }, []];
    if (statement.includes("status = 'leased'") && statement.includes("retry_at")) {
      return [{ affectedRows: 1 }, []];
    }
    if (statement.includes("SELECT") && statement.includes("lease_ref")) {
      return [[{
        handoff_ref: "handoff-1",
        lease_ref: "lease-1",
        attempt: 1,
        sealed_payload: "sealed-payload",
        sealed_credential_checkpoint: null,
        sealed_completion_checkpoint: null,
      }], []];
    }
    if (statement.includes("stage = 'provider_completed'")) {
      return [{ affectedRows: 1 }, []];
    }
    if (statement.includes("stage = 'persistence_completed'")) {
      return [{ affectedRows: 1 }, []];
    }
    if (statement.includes("SET status = ?")) return [{ affectedRows: 1 }, []];
    if (statement.includes("SET status = 'completed'")) {
      return [{ affectedRows: 1 }, []];
    }
    if (statement.includes("provider_checkpoint_present")) {
      return [[{
        handoff_ref: "handoff-1",
        status: "retryable",
        stage: "provider_completed",
        attempt_count: 1,
        max_attempts: 4,
        provider_checkpoint_present: 1,
        completion_checkpoint_present: 0,
      }], []];
    }
    throw new Error(`Unexpected SQL: ${statement}`);
  },
};

const store = createSqlProviderConsentHandoffStore({
  executor,
  environment: "staging",
  schemaDigestSha256: digest("provider-consent-handoff-schema-v2"),
});
assert.equal(store.certification.environment, "staging");
assert.equal(store.certification.capabilities.monotonicStages, true);
assert.equal(store.certification.capabilities.retryAtEnforced, true);
assert.equal((await store.insert({
  handoffRef: "handoff-1",
  expiresAt: "2026-08-01T00:00:00.000Z",
  maxAttempts: 4,
  sealedPayload: "sealed-payload",
  certificationVersionRef: "handoff.v2",
})).created, true);
const acquired = await store.acquire({
  handoffRef: "handoff-1",
  leaseRef: "lease-1",
  leaseExpiresAt: "2026-07-31T14:00:00.000Z",
  now: "2026-07-31T13:59:00.000Z",
});
assert.equal(acquired.acquired, true);
assert.equal((await store.checkpoint({
  handoffRef: "handoff-1",
  leaseRef: "lease-1",
  stage: "provider_completed",
  sealedCredentialCheckpoint: "sealed-provider-checkpoint",
})).checkpointed, true);
assert.equal((await store.checkpoint({
  handoffRef: "handoff-1",
  leaseRef: "lease-1",
  stage: "persistence_completed",
  sealedCompletionCheckpoint: "sealed-completion-checkpoint",
})).checkpointed, true);
assert.equal((await store.release({
  handoffRef: "handoff-1",
  leaseRef: "lease-1",
  retryable: true,
  retryAt: "2026-07-31T14:00:05.000Z",
  errorCode: "provider_timeout",
})).released, true);
assert.equal((await store.complete({
  handoffRef: "handoff-1",
  leaseRef: "lease-1",
})).completed, true);
assert.equal(
  (await store.readStatus({ handoffRef: "handoff-1" }))
    .providerCheckpointPresent,
  true,
);
const acquireEvent = sqlEvents.find(
  (event) => event.statement.includes("status = 'leased'")
    && event.statement.includes("retry_at"),
);
assert.equal(acquireEvent.params.length, 6);
assert.match(acquireEvent.statement, /retry_at IS NULL OR retry_at <= \?/);
const providerCheckpointEvent = sqlEvents.find(
  (event) => event.statement.includes("stage = 'provider_completed'"),
);
assert.match(providerCheckpointEvent.statement, /stage = 'claimed_handoff_ready'/);
assert.match(providerCheckpointEvent.statement, /sealed_completion_checkpoint IS NULL/);
const persistenceCheckpointEvent = sqlEvents.find(
  (event) => event.statement.includes("stage = 'persistence_completed'"),
);
assert.match(persistenceCheckpointEvent.statement, /stage = 'provider_completed'/);
assert.match(persistenceCheckpointEvent.statement, /sealed_credential_checkpoint IS NOT NULL/);
const completionEvent = sqlEvents.find(
  (event) => event.statement.includes("SET status = 'completed'"),
);
assert.match(completionEvent.statement, /stage = 'persistence_completed'/);
assert.ok(sqlEvents.every((event) => !event.statement.includes("production")));
assert.throws(
  () => createSqlProviderConsentHandoffStore({
    executor,
    environment: "production",
    schemaDigestSha256: digest("schema"),
  }),
  (error) => error.code === "provider_consent_nonprod_adapter_environment_forbidden",
);

let providerCalls = 0;
const exchange = createNonProductionProviderExchangeAdapter({
  providerKey: "google_drive",
  environment: "non_production",
  simulationTransport: async (input) => {
    providerCalls += 1;
    assert.equal(input.simulationOnly, true);
    assert.equal(input.idempotencyKey, "state-1:1");
    return {
      providerKey: "google_drive",
      credentials: {
        access_token: "simulated-access",
        refresh_token: "simulated-refresh",
      },
      providerAccountRef: "account-1",
      account: {
        id: "account-1",
        email: "simulated@example.test",
        name: "Simulation",
      },
      grantedScopes: ["drive.file", "userinfo.email"],
      tokenExpiresAt: "2026-08-01T00:00:00.000Z",
    };
  },
});
const providerResult = await exchange.exchangeAuthorizationCode({
  providerKey: "google_drive",
  authorizationCode: "simulated-code",
  redirectTargetRef: "redirect-1",
  requestedProviderScopes: ["userinfo.email", "drive.file"],
  idempotencyKey: "state-1:1",
  timeoutMs: 15000,
});
assert.equal(providerCalls, 1);
assert.equal(exchange.certification.liveProviderCalled, false);
assert.equal(exchange.certification.rawCauseRetained, false);

const sanitizedFailure = createNonProductionProviderExchangeAdapter({
  providerKey: "google_drive",
  environment: "test",
  simulationTransport: async () => {
    const error = new Error("raw provider failure with simulated-access");
    error.status = 503;
    error.response = { access_token: "must-not-escape" };
    throw error;
  },
});
await assert.rejects(
  sanitizedFailure.exchangeAuthorizationCode({
    providerKey: "google_drive",
    authorizationCode: "simulated-code",
    redirectTargetRef: "redirect-1",
    requestedProviderScopes: ["drive.file"],
    idempotencyKey: "state-failure:1",
  }),
  (error) => {
    assert.equal(error.code, "provider_transient_error");
    assert.equal(Object.hasOwn(error, "cause"), false);
    assert.equal(JSON.stringify(error).includes("must-not-escape"), false);
    return true;
  },
);

const key = Buffer.alloc(32, 7);
const keyResolver = async () => ({
  key,
  keyRef: "nonprod-key",
  keyVersionRef: "nonprod-key.v1",
});
const credentialService = createAes256GcmProviderCredentialEnvelopeService({
  keyResolver,
  environment: "test",
  randomBytesFn: () => Buffer.alloc(12, 3),
});
const envelope = await credentialService.sealProviderCredential({
  providerKey: "google_drive",
  providerResult,
  tenantRef: "tenant-1",
  workspaceRef: "workspace-1",
  brandRef: "brand-1",
  ownerScopeType: "brand",
  ownerScopeRef: "brand-1",
});
assert.equal(envelope.providerAccountRef, "account-1");
assert.match(envelope.providerAccountBindingHash, /^[a-f0-9]{64}$/);
assert.equal(JSON.stringify(envelope).includes("simulated-access"), false);
const opened = await _testingProviderConsentNonProductionCredentialEnvelope
  .openEnvelopeForTest({
    encryptedCredentials: envelope.encryptedCredentials,
    keyResolver,
    context: {
      providerKey: "google_drive",
      tenantRef: "tenant-1",
      workspaceRef: "workspace-1",
      brandRef: "brand-1",
      ownerScopeType: "brand",
      ownerScopeRef: "brand-1",
    },
  });
assert.equal(opened.access_token, "simulated-access");

const evidenceService = createProviderConsentAdapterEvidenceService({
  clock: () => new Date("2026-07-31T13:30:00.000Z"),
});
const readiness = evidenceService.assessNonProductionReadiness({
  environment: "staging",
  durableHandoffEvidence: {
    versionRef: store.certification.versionRef,
    schemaRef: store.certification.schemaRef,
    schemaDigestSha256: store.certification.schemaDigestSha256,
    storeAdapterRef: "createSqlProviderConsentHandoffStore",
    capabilities: store.certification.capabilities,
    payloadEncryptionAlgorithm: "aes-256-gcm",
    maxLeaseSeconds: store.certification.maxLeaseSeconds,
    maxAttempts: store.certification.maxAttempts,
    plaintextPersistencePossible: false,
    keyMaterialExported: false,
    testRunRef: "registered-contract-test",
  },
  providerExchangeEvidence: {
    ...exchange.certification,
    rateLimitRetryAfterMaxSeconds: 300,
    simulationScenarioDigestSha256: digest(
      "google-drive-simulation-scenarios-v2",
    ),
    testRunRef: "registered-contract-test",
  },
  credentialEnvelopeEvidence: {
    ...credentialService.certification,
    keyResolverRef: "nonprod-key-resolver.v1",
    keyVersionRef: "nonprod-key.v1",
    simulationCiphertextDigestSha256: digest(envelope.encryptedCredentials),
    testRunRef: "registered-contract-test",
  },
  migrationPlan: {
    status: "planned_not_applied",
    migrationFile: "20260730_context_kernel_connection_ownership_persistence.sql",
    checksumSha256: "8689a9440be9224e1b19ee1d88c983feb10f4056cc7a83d59790e9230ed28faf",
    expectedStatementCount: 4,
    typedApplyConfirmation: "APPLY_20260730_CONTEXT_KERNEL_CONNECTION_OWNERSHIP_PERSISTENCE",
    resourceUri: "db-migration://growth_intelligence_platform/20260730_context_kernel_connection_ownership_persistence.sql",
    preflightRef: "spec-012-pr-3628",
    rollbackPlanRef: "provider-consent-nonprod-rollback.v1",
    sameCycleReadbackRequired: true,
    migrationApplied: false,
  },
  unknownOutcomeEvidence: {
    versionRef: "provider-consent-unknown-outcome.v1",
    automaticRetryPerformed: false,
    conflictScenarioCovered: true,
    postCommitResponseLossCovered: true,
    testRunRef: "registered-contract-test",
  },
  activationState: {
    routeMounted: false,
    openApiOperationAdded: false,
    featureFlagEnabled: false,
    runtimeAuthorityGranted: false,
    liveProviderCalled: false,
    liveCredentialRead: false,
    liveCredentialMutated: false,
    migrationApplied: false,
    databaseMutated: false,
    productionSynchronized: false,
    deployed: false,
  },
});
assert.equal(readiness.status, "ready_for_controlled_non_production_pilot");
assert.equal(readiness.activationDefaultOff, true);
assert.equal(readiness.productionPromotionAllowed, false);
assert.match(readiness.evidenceDigestSha256, /^[a-f0-9]{64}$/);

assert.throws(
  () => evidenceService.assessNonProductionReadiness({ environment: "production" }),
  (error) => error.code === "provider_consent_nonprod_environment_required",
);

console.log(
  "context kernel provider consent adapter evidence and non-production readiness tests passed",
);
