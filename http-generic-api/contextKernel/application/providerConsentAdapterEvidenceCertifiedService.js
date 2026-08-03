import {
  createProviderConsentAdapterEvidenceService as createCoreEvidenceService,
} from "./providerConsentAdapterEvidenceService.js";

function certifiedEvidenceError(code, message, status = 503, details = {}) {
  const error = new Error(message);
  error.name = "ProviderConsentCertifiedAdapterEvidenceError";
  error.code = code;
  error.status = status;
  error.details = Object.freeze({ ...details, secrets_included: false });
  return error;
}

function assertHardenedHandoffEvidence(evidence) {
  if (
    evidence?.capabilities?.monotonicStages !== true
    || evidence?.capabilities?.retryAtEnforced !== true
  ) {
    throw certifiedEvidenceError(
      "provider_consent_handoff_hardening_evidence_missing",
      "Durable handoff evidence must prove monotonic stages and retry-at enforcement.",
    );
  }
}

function assertSanitizedExchangeEvidence(evidence) {
  if (evidence?.rawCauseRetained !== false) {
    throw certifiedEvidenceError(
      "provider_exchange_raw_cause_boundary_not_proven",
      "Provider exchange evidence must prove that raw upstream causes are not retained.",
    );
  }
}

function assertMigrationReadbackPlan(plan) {
  if (plan?.sameCycleReadbackRequired !== true) {
    throw certifiedEvidenceError(
      "provider_consent_migration_readback_plan_missing",
      "Migration planning evidence must require same-cycle readback.",
    );
  }
}

export function createProviderConsentAdapterEvidenceService(options = {}) {
  const core = createCoreEvidenceService(options);

  function assessNonProductionReadiness(input = {}) {
    assertHardenedHandoffEvidence(input.durableHandoffEvidence);
    assertSanitizedExchangeEvidence(input.providerExchangeEvidence);
    assertMigrationReadbackPlan(input.migrationPlan);
    return core.assessNonProductionReadiness(input);
  }

  return Object.freeze({
    assessNonProductionReadiness,
    certifyCredentialEnvelopeEvidence: core.certifyCredentialEnvelopeEvidence,
    certifyDurableHandoffEvidence: core.certifyDurableHandoffEvidence,
    certifyMigrationPlan: core.certifyMigrationPlan,
    certifyProviderExchangeEvidence: core.certifyProviderExchangeEvidence,
  });
}

export const _testingProviderConsentAdapterEvidenceCertifiedService = Object.freeze({
  assertHardenedHandoffEvidence,
  assertMigrationReadbackPlan,
  assertSanitizedExchangeEvidence,
});
