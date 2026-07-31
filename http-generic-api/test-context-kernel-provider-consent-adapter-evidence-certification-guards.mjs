import assert from "node:assert/strict";

import {
  createProviderConsentAdapterEvidenceService,
} from "./contextKernel/application/providerConsentAdapterEvidenceCertifiedService.js";

const service = createProviderConsentAdapterEvidenceService({
  clock: () => new Date("2026-07-31T14:00:00.000Z"),
});

function input(overrides = {}) {
  return {
    environment: "staging",
    durableHandoffEvidence: {
      versionRef: "handoff.v2",
      schemaRef: "db-schema://provider_consent_handoffs",
      schemaDigestSha256: "a".repeat(64),
      storeAdapterRef: "createSqlProviderConsentHandoffStore",
      capabilities: {
        atomicCreate: true,
        leaseCas: true,
        checkpointCas: true,
        monotonicStages: true,
        retryAtEnforced: true,
        oneTimeCompletion: true,
        expiryEnforced: true,
        payloadEncryption: true,
      },
      payloadEncryptionAlgorithm: "aes-256-gcm",
      maxLeaseSeconds: 60,
      maxAttempts: 4,
      plaintextPersistencePossible: false,
      keyMaterialExported: false,
      testRunRef: "guard-test",
    },
    providerExchangeEvidence: {
      status: "certified",
      providerKey: "google_drive",
      versionRef: "exchange.v2",
      mode: "simulation",
      transportRef: "simulation.v1",
      supportsIdempotency: true,
      unknownOutcomeSafe: true,
      rawCauseRetained: false,
      timeoutMs: 15000,
      rateLimitRetryAfterMaxSeconds: 300,
      retryClassificationVersion: "retry.v1",
      simulationScenarioDigestSha256: "b".repeat(64),
      testRunRef: "guard-test",
    },
    credentialEnvelopeEvidence: {
      status: "certified",
      versionRef: "credential.v2",
      algorithm: "aes-256-gcm",
      keyResolverRef: "key-resolver.v1",
      keyVersionRef: "key.v1",
      keyRotationSupported: true,
      keyMaterialExported: false,
      secretsExcludedFromProjection: true,
      metadataPolicyVersion: "safe.v1",
      envelopeFormatVersion: "aesgcm.v1",
      bindingHashAlgorithm: "sha-256",
      simulationCiphertextDigestSha256: "c".repeat(64),
      testRunRef: "guard-test",
    },
    migrationPlan: {
      status: "planned_not_applied",
      migrationFile: "20260730_context_kernel_connection_ownership_persistence.sql",
      checksumSha256: "8689a9440be9224e1b19ee1d88c983feb10f4056cc7a83d59790e9230ed28faf",
      expectedStatementCount: 4,
      typedApplyConfirmation: "APPLY_20260730_CONTEXT_KERNEL_CONNECTION_OWNERSHIP_PERSISTENCE",
      resourceUri: "db-migration://growth_intelligence_platform/20260730_context_kernel_connection_ownership_persistence.sql",
      preflightRef: "pr-3628",
      rollbackPlanRef: "rollback.v1",
      sameCycleReadbackRequired: true,
      migrationApplied: false,
    },
    unknownOutcomeEvidence: {
      versionRef: "unknown.v1",
      automaticRetryPerformed: false,
      conflictScenarioCovered: true,
      postCommitResponseLossCovered: true,
      testRunRef: "guard-test",
    },
    activationState: {},
    ...overrides,
  };
}

assert.equal(
  service.assessNonProductionReadiness(input()).status,
  "ready_for_controlled_non_production_pilot",
);

assert.throws(
  () => service.assessNonProductionReadiness(input({
    durableHandoffEvidence: {
      ...input().durableHandoffEvidence,
      capabilities: {
        ...input().durableHandoffEvidence.capabilities,
        monotonicStages: false,
      },
    },
  })),
  (error) => error.code === "provider_consent_handoff_hardening_evidence_missing",
);

assert.throws(
  () => service.assessNonProductionReadiness(input({
    providerExchangeEvidence: {
      ...input().providerExchangeEvidence,
      rawCauseRetained: true,
    },
  })),
  (error) => error.code === "provider_exchange_raw_cause_boundary_not_proven",
);

assert.throws(
  () => service.assessNonProductionReadiness(input({
    migrationPlan: {
      ...input().migrationPlan,
      sameCycleReadbackRequired: false,
    },
  })),
  (error) => error.code === "provider_consent_migration_readback_plan_missing",
);

console.log("context kernel provider consent adapter evidence certification guard tests passed");
