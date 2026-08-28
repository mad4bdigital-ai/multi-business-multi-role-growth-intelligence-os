import crypto from "node:crypto";
import {
  RECOVERY_COMPOSITION_COMPONENT_KEYS,
  RECOVERY_COMPOSITION_CONTRACT,
} from "./recoveryComposition.js";

export const RECOVERY_STAGING_CERTIFICATION_CONTRACT = "mad4b.recovery-staging-certification.v1";
export const RECOVERY_PRODUCTION_AUTHORITY_READINESS_CONTRACT = "mad4b.recovery-production-authority-readiness.v1";

export const RECOVERY_CERTIFICATION_TRACE_STEPS = Object.freeze([
  "durable_inspection",
  "finding",
  "immutable_remediation_plan",
  "approval_challenge",
  "approval_verification",
  "approval_reservation",
  "server_issued_execution_ticket",
  "ticket_reservation",
  "idempotency_claim",
  "fenced_lock",
  "provider_execution",
  "same_fence_readback",
  "durable_evidence",
  "ticket_finalization",
  "approval_finalization",
  "lock_release",
]);

const CERTIFICATION_REQUIRED_NEGATIVE_TESTS = Object.freeze([
  "wrong_plan_hash",
  "wrong_step",
  "expired_approval",
  "approval_reuse",
  "cross_target_approval",
  "cross_sha_approval",
  "cross_environment_approval",
  "caller_ticket_fields",
  "ticket_replay",
  "expired_ticket",
  "cross_target_ticket",
  "cross_sha_ticket",
  "idempotency_race",
  "restart_durability",
  "lost_fence",
  "provider_timeout_unknown_outcome",
  "partial_execution_reconciliation",
  "readback_failure",
  "artifact_drift",
  "schema_precondition_drift",
]);

const PRODUCTION_LIVE_BLOCKERS = Object.freeze({
  certification_missing: "RECOVERY_STAGING_CERTIFICATION_REQUIRED",
  certification_expired: "RECOVERY_STAGING_CERTIFICATION_EXPIRED",
  authority_graph_incomplete: "RECOVERY_PRODUCTION_LIVE_COMPOSITION_INCOMPLETE",
  deployment_attestation_mismatch: "RECOVERY_DEPLOYMENT_ATTESTATION_MISMATCH",
  exact_sha_mismatch: "RECOVERY_DEPLOYMENT_ATTESTATION_MISMATCH",
  recovery_incident_open: "RECOVERY_RECONCILIATION_REQUIRED",
  test_or_mock_adapter: "RECOVERY_PRODUCTION_LIVE_COMPOSITION_INCOMPLETE",
  non_live_composition: "RECOVERY_PRODUCTION_LIVE_COMPOSITION_INCOMPLETE",
});

function object(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function bool(value) {
  return value === true;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value)), "utf8").digest("hex");
}

export function certificationPayloadHash(certification) {
  return digest({
    contract: certification?.contract || null,
    certification_id: certification?.certification_id || null,
    environment_key: certification?.environment_key || null,
    deployment_sha: certification?.deployment_sha || null,
    runtime_sha: certification?.runtime_sha || null,
    branch: certification?.branch || null,
    target_fingerprint: certification?.target_fingerprint || null,
    server_identity_fingerprint: certification?.server_identity_fingerprint || null,
    provider_environment: certification?.provider_environment || null,
    lifecycle_trace: certification?.lifecycle_trace || null,
    negative_tests: certification?.negative_tests || null,
    authority_graph: certification?.authority_graph || null,
    artifact_integrity: certification?.artifact_integrity || null,
    safety: certification?.safety || null,
    expires_at: certification?.expires_at || null,
  });
}

function bounded(value, max = 160) {
  return String(value || "").trim().slice(0, max);
}

function noSecrets(value) {
  return value === false;
}

function authorityComponentState(composition) {
  const status = object(composition?.component_status) ? composition.component_status : {};
  return Object.fromEntries(RECOVERY_COMPOSITION_COMPONENT_KEYS.map((key) => [key, {
    configured: status[key]?.configured === true,
    missing_methods: Array.isArray(status[key]?.missing_methods)
      ? status[key].missing_methods.slice(0, 20)
      : [],
  }]));
}

function forbiddenAdapterMarker(value) {
  const text = JSON.stringify(value || {}).toLowerCase();
  return /(mock|dummy|fake|in[_-]?memory|test[_-]?double|fixture|no[_-]?op|stub)/u.test(text);
}

export function buildRecoveryAuthorityReadiness({
  composition = null,
  environmentKey = "production",
  adapterProvenance = null,
  capabilities = null,
} = {}) {
  const componentState = authorityComponentState(composition);
  const configuredComponents = RECOVERY_COMPOSITION_COMPONENT_KEYS.filter((key) => componentState[key].configured);
  const missingComponents = RECOVERY_COMPOSITION_COMPONENT_KEYS.filter((key) => !componentState[key].configured);
  const compositionContractValid = composition?.contract === RECOVERY_COMPOSITION_CONTRACT;
  const compositionConfigured = compositionContractValid && composition?.configured === true;
  const capabilitySource = object(capabilities)
    ? capabilities
    : object(composition?.productionRecoveryCompositionFactory?.authority_readiness)
      ? composition.productionRecoveryCompositionFactory.authority_readiness
      : object(composition?.capabilities) ? composition.capabilities : {};
  const normalizedCapabilities = capabilitySource;
  const provenance = object(adapterProvenance) ? adapterProvenance : {};
  const provenanceMarkers = Object.values(provenance).some((entry) => forbiddenAdapterMarker(entry));
  const explicitTestOrMock = composition?.test_only === true
    || composition?.mock === true
    || composition?.in_memory === true
    || provenanceMarkers;
  const allRequiredComponentsConfigured = compositionConfigured && missingComponents.length === 0;
  const durable = normalizedCapabilities.durability_capable === true;
  const attestation = normalizedCapabilities.attestation_capable === true;
  const stagingModeValid = environmentKey === "staging"
    ? composition?.mode === "injected_non_live"
    : composition?.mode === "production_live" && composition?.live_activation === true;
  const reasons = [];
  if (!compositionContractValid) reasons.push("recovery_composition_contract_invalid");
  if (!compositionConfigured) reasons.push("recovery_composition_not_configured");
  if (missingComponents.length) reasons.push("recovery_authority_components_missing");
  if (!durable) reasons.push("recovery_authority_durability_not_attested");
  if (!attestation) reasons.push("recovery_authority_attestation_not_attested");
  if (explicitTestOrMock) reasons.push("test_or_mock_adapter_detected");
  if (!stagingModeValid) reasons.push(environmentKey === "staging"
    ? "staging_requires_injected_non_live_composition"
    : "production_requires_separately_enabled_live_composition");
  return {
    contract: "mad4b.recovery-authority-graph-readiness.v1",
    environment_key: environmentKey,
    composition_contract_valid: compositionContractValid,
    composition_configured: compositionConfigured,
    composition_mode: composition?.mode || null,
    configured_components: configuredComponents,
    missing_components: missingComponents,
    component_status: componentState,
    all_required_components_configured: allRequiredComponentsConfigured,
    durability_capable: durable,
    attestation_capable: attestation,
    test_or_mock_adapter_detected: explicitTestOrMock,
    environment_mode_valid: stagingModeValid,
    ready: reasons.length === 0,
    blocking_reasons: reasons,
    live_activation: false,
    provider_accessed: false,
    database_connection_performed: false,
    database_mutation_performed: false,
    secrets_included: false,
  };
}

function traceIsComplete(trace) {
  if (!object(trace)) return false;
  return RECOVERY_CERTIFICATION_TRACE_STEPS.every((step) => trace[step]?.status === "pass");
}

function negativeTestsPass(negativeTests) {
  if (!object(negativeTests)) return false;
  return CERTIFICATION_REQUIRED_NEGATIVE_TESTS.every((key) => negativeTests[key]?.status === "pass");
}

export function evaluateStagingRecoveryCertification({
  certification = null,
  expectedSha = null,
  expectedBranch = "main",
  expectedTargetFingerprint = null,
  requireExpectedTargetFingerprint = false,
} = {}) {
  const checks = {
    contract: certification?.contract === RECOVERY_STAGING_CERTIFICATION_CONTRACT,
    result: certification?.result === "pass" && certification?.status === "passed",
    environment: certification?.environment_key === "staging",
    certification_id: nonEmpty(certification?.certification_id),
    exact_sha: nonEmpty(certification?.deployment_sha)
      && (!expectedSha || certification.deployment_sha === expectedSha)
      && (!certification.runtime_sha || certification.runtime_sha === certification.deployment_sha),
    exact_branch: certification?.branch === expectedBranch,
    target_fingerprint: nonEmpty(certification?.target_fingerprint)
      && (!requireExpectedTargetFingerprint || nonEmpty(expectedTargetFingerprint))
      && (!expectedTargetFingerprint || certification.target_fingerprint === expectedTargetFingerprint),
    server_identity_fingerprint: nonEmpty(certification?.server_identity_fingerprint),
    provider_environment: certification?.provider_environment === "staging",
    authority_graph: certification?.authority_graph?.ready === true
      && certification.authority_graph.test_or_mock_adapter_detected === false,
    lifecycle_trace: traceIsComplete(certification?.lifecycle_trace),
    negative_tests: certification?.negative_tests?.all_passed === true
      && negativeTestsPass(certification?.negative_tests?.cases),
    audit_evidence: certification?.audit_evidence?.durable === true
      && nonEmpty(certification.audit_evidence.evidence_hash),
    canonical_payload_hash: nonEmpty(certification?.audit_evidence?.canonical_payload_hash)
      && certification.audit_evidence.canonical_payload_hash === certificationPayloadHash(certification),
    artifact_integrity: certification?.artifact_integrity?.valid === true,
    freshness: certification?.expires_at
      ? Number.isFinite(Date.parse(certification.expires_at)) && Date.parse(certification.expires_at) > Date.now()
      : false,
    production_mutation_forbidden: certification?.safety?.production_mutation_performed === false,
    secrets_forbidden: noSecrets(certification?.safety?.secrets_included)
      && noSecrets(certification?.secrets_included),
    caller_credentials_forbidden: certification?.safety?.caller_credentials_accepted === false,
    local_connector_production_authority_forbidden: certification?.safety?.local_connector_production_authority === false,
  };
  const blockingFailures = Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key);
  const normalizedEvidence = {
    certification_id: certification?.certification_id || null,
    environment_key: certification?.environment_key || null,
    deployment_sha: certification?.deployment_sha || null,
    runtime_sha: certification?.runtime_sha || null,
    branch: certification?.branch || null,
    target_fingerprint: certification?.target_fingerprint || null,
    provider_environment: certification?.provider_environment || null,
    evidence_hash: certification?.audit_evidence?.evidence_hash || null,
    canonical_payload_hash: certification?.audit_evidence?.canonical_payload_hash || null,
    expires_at: certification?.expires_at || null,
  };
  return {
    contract: RECOVERY_STAGING_CERTIFICATION_CONTRACT,
    valid: blockingFailures.length === 0,
    status: blockingFailures.length === 0 ? "valid" : "blocked",
    checks,
    blocking_failures: blockingFailures,
    certification_fingerprint: digest(normalizedEvidence),
    evidence: normalizedEvidence,
    database_mutation_performed: false,
    provider_mutation_performed: false,
    production_mutation_performed: false,
    secrets_included: false,
  };
}

export function artifactParityMatches({ parity, certification, candidateSha, candidateTargetFingerprint }) {
  if (!object(parity) || parity.verified !== true) return false;
  if (parity.source_environment !== "staging" || parity.target_environment !== "production") return false;
  if (!nonEmpty(parity.source_sha) || !nonEmpty(parity.target_sha) || parity.target_sha !== candidateSha) return false;
  if (parity.source_sha !== certification?.evidence?.deployment_sha) return false;
  if (parity.source_target_fingerprint !== certification?.evidence?.target_fingerprint) return false;
  if (parity.target_target_fingerprint !== candidateTargetFingerprint) return false;
  if (!nonEmpty(parity.source_artifact_set_hash) || parity.source_artifact_set_hash !== parity.target_artifact_set_hash) return false;
  if (!nonEmpty(parity.source_manifest_hash) || parity.source_manifest_hash !== parity.target_manifest_hash) return false;
  return parity.generated_artifacts_verified === true;
}

export function attestationMatches({ attestation, expectedSha, expectedBranch, expectedEnvironment, expectedTargetFingerprint = null }) {
  if (!object(attestation)) return false;
  return attestation.repository_match === true
    && attestation.branch_match === true
    && attestation.sha_match === true
    && attestation.manifest_bound === true
    && attestation.read_only === true
    && (!expectedSha || attestation.sha === expectedSha)
    && (!expectedBranch || attestation.branch === expectedBranch)
    && (!expectedEnvironment || attestation.environment === expectedEnvironment)
    && (!expectedTargetFingerprint || attestation.target_fingerprint === expectedTargetFingerprint)
    && attestation.secrets_included === false;
}

export function buildProductionAuthorityActivationReadiness({
  productionLiveRequested = false,
  productionLiveEnabled = false,
  composition = null,
  stagingCertification = null,
  deploymentAttestation = null,
  candidateSha = null,
  candidateBranch = "Production",
  candidateTargetFingerprint = null,
  promotionArtifactParity = null,
  unresolvedRecoveryIncidents = [],
  adapterProvenance = null,
} = {}) {
  const authorityGraph = buildRecoveryAuthorityReadiness({
    composition,
    environmentKey: "production",
    adapterProvenance,
  });
  const rawCertification = stagingCertification?.raw_certification
    || stagingCertification?.certification_evidence
    || stagingCertification;
  const rawCertificationPresent = object(rawCertification)
    && rawCertification.result === "pass"
    && rawCertification.status === "passed"
    && nonEmpty(rawCertification.deployment_sha)
    && nonEmpty(rawCertification.environment_key);
  const certificationExpectedSha = promotionArtifactParity?.source_sha || candidateSha;
  const certificationExpectedTargetFingerprint = promotionArtifactParity?.source_target_fingerprint || candidateTargetFingerprint;
  const certification = evaluateStagingRecoveryCertification({
    certification: rawCertification,
    expectedSha: certificationExpectedSha,
    expectedBranch: "main",
    expectedTargetFingerprint: certificationExpectedTargetFingerprint,
    requireExpectedTargetFingerprint: true,
  });
  const attestationValid = attestationMatches({
    attestation: deploymentAttestation,
    expectedSha: candidateSha,
    expectedBranch: candidateBranch,
    expectedEnvironment: "production",
    expectedTargetFingerprint: candidateTargetFingerprint,
  });
  const noOpenIncident = Array.isArray(unresolvedRecoveryIncidents) && unresolvedRecoveryIncidents.length === 0;
  const checks = {
    production_live_requested: productionLiveRequested === true,
    staging_certification_valid: certification.valid === true,
    all_authorities_ready: authorityGraph.ready === true,
    deployment_attestation_valid: attestationValid,
    exact_sha_certified: Boolean(candidateSha)
      && (promotionArtifactParity
        ? promotionArtifactParity.target_sha === candidateSha
          && promotionArtifactParity.source_sha === certification.evidence?.deployment_sha
          && deploymentAttestation?.sha === candidateSha
        : certification.evidence?.deployment_sha === candidateSha
          && deploymentAttestation?.sha === candidateSha),
    target_fingerprint_bound: Boolean(candidateTargetFingerprint)
      && deploymentAttestation?.target_fingerprint === candidateTargetFingerprint
      && (promotionArtifactParity
        ? certification.evidence?.target_fingerprint === promotionArtifactParity.source_target_fingerprint
        : certification.evidence?.target_fingerprint === candidateTargetFingerprint),
    artifact_parity_bound: !productionLiveRequested || artifactParityMatches({
      parity: promotionArtifactParity,
      certification,
      candidateSha,
      candidateTargetFingerprint,
    }),
    no_unresolved_recovery_incident: noOpenIncident,
    no_test_or_mock_adapter: authorityGraph.test_or_mock_adapter_detected === false,
  };
  const blockingReasons = [];
  if (!checks.production_live_requested) blockingReasons.push("production_live_not_requested");
  if (!checks.staging_certification_valid) {
    blockingReasons.push(rawCertificationPresent && certification.blocking_failures?.includes("freshness")
      ? PRODUCTION_LIVE_BLOCKERS.certification_expired
      : PRODUCTION_LIVE_BLOCKERS.certification_missing);
  }
  if (!checks.all_authorities_ready) blockingReasons.push(PRODUCTION_LIVE_BLOCKERS.authority_graph_incomplete);
  if (!checks.deployment_attestation_valid) blockingReasons.push(PRODUCTION_LIVE_BLOCKERS.deployment_attestation_mismatch);
  if (!checks.exact_sha_certified) blockingReasons.push(PRODUCTION_LIVE_BLOCKERS.exact_sha_mismatch);
  if (!checks.target_fingerprint_bound) blockingReasons.push("RECOVERY_TARGET_FINGERPRINT_MISMATCH");
  if (!checks.artifact_parity_bound) blockingReasons.push("RECOVERY_ARTIFACT_PARITY_REQUIRED");
  if (!checks.no_unresolved_recovery_incident) blockingReasons.push(PRODUCTION_LIVE_BLOCKERS.recovery_incident_open);
  if (!checks.no_test_or_mock_adapter) blockingReasons.push(PRODUCTION_LIVE_BLOCKERS.test_or_mock_adapter);
  const eligible = Object.values(checks).every(Boolean);
  return {
    contract: RECOVERY_PRODUCTION_AUTHORITY_READINESS_CONTRACT,
    production_live: {
      requested: productionLiveRequested === true,
      eligible,
      enabled: false,
      observed_enabled: productionLiveEnabled === true,
    },
    certification: {
      id: certification.evidence?.certification_id || null,
      valid: certification.valid === true,
      expired: certification.blocking_failures?.includes("freshness") === true,
      sha_bound: certification.evidence?.deployment_sha || null,
      fingerprint: certification.certification_fingerprint || null,
    },
    deployment_attestation: {
      repository_match: deploymentAttestation?.repository_match === true,
      branch_match: deploymentAttestation?.branch_match === true,
      sha_match: deploymentAttestation?.sha_match === true,
      environment_match: deploymentAttestation?.environment === "production",
      target_fingerprint: deploymentAttestation?.target_fingerprint || null,
      manifest_bound: deploymentAttestation?.manifest_bound === true,
      valid: attestationValid,
    },
    authorities: authorityGraph,
    checks,
    blocking_reasons: [...new Set(blockingReasons)],
    mutation_grade_durable: eligible && authorityGraph.durability_capable === true,
    live_activation: false,
    activation_eligible: eligible,
    database_mutation_performed: false,
    provider_accessed: false,
    provider_mutation_performed: false,
    secrets_included: false,
  };
}

export const _testingRecoveryActivationReadiness = Object.freeze({
  CERTIFICATION_REQUIRED_NEGATIVE_TESTS,
  PRODUCTION_LIVE_BLOCKERS,
  traceIsComplete,
  negativeTestsPass,
  forbiddenAdapterMarker,
  digest,
  certificationPayloadHash,
  attestationMatches,
  artifactParityMatches,
});
