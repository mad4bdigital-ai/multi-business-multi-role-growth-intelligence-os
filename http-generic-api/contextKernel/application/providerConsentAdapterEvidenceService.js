import { createHash } from "node:crypto";

const SHA256_RE = /^[a-f0-9]{64}$/;
const FORBIDDEN_SECRET_KEY = /(^|_)(access|refresh|id)?_?token$|secret|credential|authorization|password|api_?key|private_?key/i;
const SAFE_ASSERTION_KEYS = new Set([
  "secretsIncluded",
  "secretsExcludedFromProjection",
  "liveCredentialRead",
  "liveCredentialMutated",
  "keyMaterialExported",
  "plaintextPersistencePossible",
  "liveProviderCalled",
  "migrationApplied",
  "databaseMutated",
]);
const REQUIRED_HANDOFF_CAPABILITIES = Object.freeze([
  "atomicCreate",
  "leaseCas",
  "checkpointCas",
  "oneTimeCompletion",
  "expiryEnforced",
  "payloadEncryption",
]);
const ALLOWED_READINESS_ENVIRONMENTS = new Set(["test", "development", "staging", "non_production"]);

function readinessError(code, message, status = 409, details = {}) {
  const error = new Error(message);
  error.name = "ProviderConsentAdapterEvidenceError";
  error.code = code;
  error.status = status;
  error.details = Object.freeze({ ...details, secrets_included: false });
  return error;
}

function requiredString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${fieldName} must be a non-empty string.`);
  }
  return value.trim();
}

function requiredInteger(value, fieldName, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new TypeError(`${fieldName} must be a safe integer between ${min} and ${max}.`);
  }
  return parsed;
}

function normalizeSha256(value, fieldName) {
  const normalized = requiredString(value, fieldName).toLowerCase();
  if (!SHA256_RE.test(normalized)) throw new TypeError(`${fieldName} must be a SHA-256 value.`);
  return normalized;
}

function assertNoSecretEvidence(value, path = "evidence") {
  if (value == null) return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecretEvidence(entry, `${path}[${index}]`));
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_SECRET_KEY.test(key) && !SAFE_ASSERTION_KEYS.has(key)) {
      throw readinessError(
        "provider_consent_evidence_secret_key_rejected",
        "Provider-consent certification evidence contains a forbidden secret-bearing key.",
        409,
        { evidence_path: `${path}.${key}` },
      );
    }
    assertNoSecretEvidence(entry, `${path}.${key}`);
  }
}

function stableDigest(value) {
  const serialize = (entry) => {
    if (entry == null || typeof entry !== "object") return JSON.stringify(entry);
    if (Array.isArray(entry)) return `[${entry.map(serialize).join(",")}]`;
    return `{${Object.keys(entry).sort().map((key) => `${JSON.stringify(key)}:${serialize(entry[key])}`).join(",")}}`;
  };
  return createHash("sha256").update(serialize(value), "utf8").digest("hex");
}

function frozen(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(frozen));
  if (!value || typeof value !== "object") return value;
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, frozen(entry)])));
}

function certifyDurableHandoffEvidence(input = {}) {
  assertNoSecretEvidence(input);
  const capabilities = input.capabilities || {};
  const missingCapabilities = REQUIRED_HANDOFF_CAPABILITIES.filter(
    (capability) => capabilities[capability] !== true,
  );
  if (missingCapabilities.length) {
    throw readinessError(
      "provider_consent_handoff_evidence_incomplete",
      "Durable handoff evidence does not prove every required atomic capability.",
      503,
      { missing_capability_count: missingCapabilities.length },
    );
  }
  if (input.payloadEncryptionAlgorithm !== "aes-256-gcm") {
    throw readinessError(
      "provider_consent_handoff_encryption_not_certified",
      "Durable handoff payload encryption must be AES-256-GCM.",
      503,
    );
  }
  if (input.plaintextPersistencePossible !== false || input.keyMaterialExported !== false) {
    throw readinessError(
      "provider_consent_handoff_secret_boundary_not_certified",
      "Durable handoff evidence must prove no plaintext persistence and no key export.",
      503,
    );
  }
  const maxLeaseSeconds = requiredInteger(input.maxLeaseSeconds, "maxLeaseSeconds", { min: 1, max: 300 });
  const maxAttempts = requiredInteger(input.maxAttempts, "maxAttempts", { min: 1, max: 20 });
  return frozen({
    kind: "durable_handoff",
    status: "certified",
    versionRef: requiredString(input.versionRef, "versionRef"),
    schemaRef: requiredString(input.schemaRef, "schemaRef"),
    schemaDigestSha256: normalizeSha256(input.schemaDigestSha256, "schemaDigestSha256"),
    storeAdapterRef: requiredString(input.storeAdapterRef, "storeAdapterRef"),
    capabilities: Object.fromEntries(REQUIRED_HANDOFF_CAPABILITIES.map((key) => [key, true])),
    payloadEncryptionAlgorithm: "aes-256-gcm",
    maxLeaseSeconds,
    maxAttempts,
    plaintextPersistencePossible: false,
    keyMaterialExported: false,
    testRunRef: requiredString(input.testRunRef, "testRunRef"),
    secretsIncluded: false,
  });
}

function certifyProviderExchangeEvidence(input = {}) {
  assertNoSecretEvidence(input);
  if (input.mode !== "simulation") {
    throw readinessError(
      "provider_exchange_live_mode_forbidden",
      "Provider exchange evidence must be produced by the non-sensitive simulation mode.",
      403,
    );
  }
  if (input.supportsIdempotency !== true || input.unknownOutcomeSafe !== true) {
    throw readinessError(
      "provider_exchange_recovery_evidence_incomplete",
      "Provider exchange evidence must prove idempotency and unknown-outcome safety.",
      503,
    );
  }
  const timeoutMs = requiredInteger(input.timeoutMs, "timeoutMs", { min: 1000, max: 60000 });
  const rateLimitRetryAfterMaxSeconds = requiredInteger(
    input.rateLimitRetryAfterMaxSeconds,
    "rateLimitRetryAfterMaxSeconds",
    { min: 1, max: 3600 },
  );
  return frozen({
    kind: "provider_exchange",
    status: "certified",
    providerKey: requiredString(input.providerKey, "providerKey"),
    versionRef: requiredString(input.versionRef, "versionRef"),
    mode: "simulation",
    transportRef: requiredString(input.transportRef, "transportRef"),
    supportsIdempotency: true,
    unknownOutcomeSafe: true,
    timeoutMs,
    rateLimitRetryAfterMaxSeconds,
    retryClassificationVersion: requiredString(
      input.retryClassificationVersion,
      "retryClassificationVersion",
    ),
    simulationScenarioDigestSha256: normalizeSha256(
      input.simulationScenarioDigestSha256,
      "simulationScenarioDigestSha256",
    ),
    testRunRef: requiredString(input.testRunRef, "testRunRef"),
    liveProviderCalled: false,
    secretsIncluded: false,
  });
}

function certifyCredentialEnvelopeEvidence(input = {}) {
  assertNoSecretEvidence(input);
  if (
    input.algorithm !== "aes-256-gcm"
    || input.keyRotationSupported !== true
    || input.keyMaterialExported !== false
    || input.secretsExcludedFromProjection !== true
  ) {
    throw readinessError(
      "credential_envelope_evidence_incomplete",
      "Credential envelope evidence does not satisfy encryption, rotation, and secret-boundary requirements.",
      503,
    );
  }
  return frozen({
    kind: "credential_envelope",
    status: "certified",
    versionRef: requiredString(input.versionRef, "versionRef"),
    algorithm: "aes-256-gcm",
    keyResolverRef: requiredString(input.keyResolverRef, "keyResolverRef"),
    keyVersionRef: requiredString(input.keyVersionRef, "keyVersionRef"),
    keyRotationSupported: true,
    keyMaterialExported: false,
    secretsExcludedFromProjection: true,
    metadataPolicyVersion: requiredString(input.metadataPolicyVersion, "metadataPolicyVersion"),
    envelopeFormatVersion: requiredString(input.envelopeFormatVersion, "envelopeFormatVersion"),
    bindingHashAlgorithm: input.bindingHashAlgorithm === "sha-256" ? "sha-256" : (() => {
      throw new TypeError("bindingHashAlgorithm must be sha-256.");
    })(),
    simulationCiphertextDigestSha256: normalizeSha256(
      input.simulationCiphertextDigestSha256,
      "simulationCiphertextDigestSha256",
    ),
    testRunRef: requiredString(input.testRunRef, "testRunRef"),
    liveCredentialRead: false,
    liveCredentialMutated: false,
    secretsIncluded: false,
  });
}

function certifyMigrationPlan(input = {}) {
  assertNoSecretEvidence(input);
  if (input.status !== "planned_not_applied" || input.migrationApplied !== false) {
    throw readinessError(
      "provider_consent_migration_state_invalid",
      "Migration evidence must remain planned and not applied in this phase.",
      403,
    );
  }
  return frozen({
    kind: "migration_plan",
    status: "planned_not_applied",
    migrationFile: requiredString(input.migrationFile, "migrationFile"),
    checksumSha256: normalizeSha256(input.checksumSha256, "checksumSha256"),
    expectedStatementCount: requiredInteger(
      input.expectedStatementCount,
      "expectedStatementCount",
      { min: 1, max: 100 },
    ),
    typedApplyConfirmation: requiredString(
      input.typedApplyConfirmation,
      "typedApplyConfirmation",
    ),
    resourceUri: requiredString(input.resourceUri, "resourceUri"),
    preflightRef: requiredString(input.preflightRef, "preflightRef"),
    rollbackPlanRef: requiredString(input.rollbackPlanRef, "rollbackPlanRef"),
    sameCycleReadbackRequired: input.sameCycleReadbackRequired === true,
    migrationApplied: false,
    databaseMutated: false,
    secretsIncluded: false,
  });
}

export function createProviderConsentAdapterEvidenceService({ clock = () => new Date() } = {}) {
  if (typeof clock !== "function") throw new TypeError("clock must be a function.");

  function assessNonProductionReadiness({
    environment,
    durableHandoffEvidence,
    providerExchangeEvidence,
    credentialEnvelopeEvidence,
    migrationPlan,
    unknownOutcomeEvidence,
    activationState = {},
  } = {}) {
    const normalizedEnvironment = requiredString(environment, "environment").toLowerCase();
    if (!ALLOWED_READINESS_ENVIRONMENTS.has(normalizedEnvironment)) {
      throw readinessError(
        "provider_consent_nonprod_environment_required",
        "Provider Consent readiness may only be assessed for an explicit non-Production environment.",
        403,
        { environment: normalizedEnvironment },
      );
    }
    assertNoSecretEvidence(unknownOutcomeEvidence, "unknownOutcomeEvidence");
    const handoff = certifyDurableHandoffEvidence(durableHandoffEvidence);
    const exchange = certifyProviderExchangeEvidence(providerExchangeEvidence);
    const credential = certifyCredentialEnvelopeEvidence(credentialEnvelopeEvidence);
    const migration = certifyMigrationPlan(migrationPlan);
    const blockers = [];
    const forbiddenTrueFlags = [
      "routeMounted",
      "openApiOperationAdded",
      "featureFlagEnabled",
      "runtimeAuthorityGranted",
      "liveProviderCalled",
      "liveCredentialRead",
      "liveCredentialMutated",
      "migrationApplied",
      "databaseMutated",
      "productionSynchronized",
      "deployed",
    ];
    for (const flag of forbiddenTrueFlags) {
      if (activationState?.[flag] === true) blockers.push(`forbidden_activation_state:${flag}`);
    }
    if (unknownOutcomeEvidence?.automaticRetryPerformed !== false) {
      blockers.push("unknown_outcome_automatic_retry_not_proven_absent");
    }
    if (unknownOutcomeEvidence?.conflictScenarioCovered !== true) {
      blockers.push("unknown_outcome_conflict_scenario_missing");
    }
    if (unknownOutcomeEvidence?.postCommitResponseLossCovered !== true) {
      blockers.push("post_commit_response_loss_scenario_missing");
    }
    const assessedAt = clock();
    if (!(assessedAt instanceof Date) || Number.isNaN(assessedAt.getTime())) {
      throw new TypeError("clock must return a valid Date.");
    }
    const evidenceDigestSha256 = stableDigest({ handoff, exchange, credential, migration, unknownOutcomeEvidence });
    return frozen({
      status: blockers.length ? "not_ready" : "ready_for_controlled_non_production_pilot",
      environment: normalizedEnvironment,
      blockers,
      activationDefaultOff: true,
      publicSurfaceAllowed: false,
      productionPromotionAllowed: false,
      migrationApplyAllowedByThisEvidence: false,
      automaticRetryAllowed: false,
      evidenceDigestSha256,
      evidence: {
        durableHandoff: handoff,
        providerExchange: exchange,
        credentialEnvelope: credential,
        migrationPlan: migration,
        unknownOutcome: {
          versionRef: requiredString(unknownOutcomeEvidence?.versionRef, "unknownOutcomeEvidence.versionRef"),
          automaticRetryPerformed: false,
          conflictScenarioCovered: unknownOutcomeEvidence?.conflictScenarioCovered === true,
          postCommitResponseLossCovered: unknownOutcomeEvidence?.postCommitResponseLossCovered === true,
          testRunRef: requiredString(unknownOutcomeEvidence?.testRunRef, "unknownOutcomeEvidence.testRunRef"),
          secretsIncluded: false,
        },
      },
      assessedAt: assessedAt.toISOString(),
      secretsIncluded: false,
    });
  }

  return Object.freeze({
    assessNonProductionReadiness,
    certifyCredentialEnvelopeEvidence,
    certifyDurableHandoffEvidence,
    certifyMigrationPlan,
    certifyProviderExchangeEvidence,
  });
}

export const _testingProviderConsentAdapterEvidenceService = Object.freeze({
  assertNoSecretEvidence,
  normalizeSha256,
  stableDigest,
});
