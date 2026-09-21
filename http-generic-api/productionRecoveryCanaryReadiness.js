import {
  RECOVERY_COMPOSITION_COMPONENT_KEYS,
  RECOVERY_COMPOSITION_CONTRACT,
} from "./recoveryComposition.js";
import {
  artifactParityMatches,
  attestationMatches,
  evaluateStagingRecoveryCertification,
} from "./recoveryActivationReadiness.js";

export const PRODUCTION_RECOVERY_CANARY_READINESS_CONTRACT =
  "mad4b.production-recovery-canary-readiness.v1";
export const PRODUCTION_RECOVERY_EXPECTED_IDENTITY_CONTRACT =
  "mad4b.production-recovery-expected-identity.v1";
export const PRODUCTION_RECOVERY_CONTROL_STORE_PROVISIONING_EVIDENCE_CONTRACT =
  "mad4b.production-recovery-control-store-provisioning-evidence.v1";
export const PRODUCTION_RECOVERY_INDEPENDENT_READBACK_CERTIFICATION_CONTRACT =
  "mad4b.production-recovery-independent-readback-certification.v1";

const SHA40 = /^[a-f0-9]{40}$/u;

function object(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function bounded(value, fallback = "unavailable") {
  const text = String(value || fallback).trim().slice(0, 128);
  return text || fallback;
}

function requireReader(value, name) {
  if (typeof value !== "function") {
    const error = new Error(name + " reader is required");
    error.code = "RECOVERY_PRODUCTION_CANARY_READER_REQUIRED";
    throw error;
  }
  return value;
}

async function safeRead(name, reader) {
  try {
    return { ok: true, value: await reader() };
  } catch (error) {
    return {
      ok: false,
      value: null,
      error_code: bounded(error?.code || error?.errno, name + "_read_failed"),
    };
  }
}

function evaluateOperationalGraph(composition) {
  const componentStatus = object(composition?.component_status)
    ? composition.component_status
    : {};
  const componentsConfigured = RECOVERY_COMPOSITION_COMPONENT_KEYS.every(
    (key) => componentStatus[key]?.configured === true,
  );
  const readiness = composition?.productionRecoveryCompositionFactory?.authority_readiness || {};
  const operational = composition?.operational_authority || {};
  const checks = {
    canonical_composition_contract: composition?.contract === RECOVERY_COMPOSITION_CONTRACT,
    composition_configured: composition?.configured === true,
    injected_non_live_mode: composition?.mode === "injected_non_live",
    live_activation_disabled: composition?.live_activation === false,
    mutation_graph_available_but_not_live: composition?.mutation_authority_available === true,
    all_components_configured: componentsConfigured,
    complete_adapter_graph: operational.complete_adapter_graph === true,
    source_production_live_disabled: operational.production_live_enabled === false,
    source_activation_ineligible: operational.activation_eligible === false,
    durability_capable: readiness.durability_capable === true,
    attestation_capable: readiness.attestation_capable === true,
    adapter_present: readiness.adapter_present === true,
    zero_construction_provider_activity:
      operational.provider_accessed_during_construction === false,
    zero_construction_database_connection:
      operational.database_connection_performed === false,
    zero_construction_database_mutation:
      operational.database_mutation_performed === false,
    secrets_forbidden: composition?.secrets_included === false,
  };
  return {
    valid: Object.values(checks).every(Boolean),
    checks,
  };
}

function evaluateExpectedProductionIdentity(identity) {
  const checks = {
    contract: identity?.contract === PRODUCTION_RECOVERY_EXPECTED_IDENTITY_CONTRACT,
    server_managed: identity?.server_managed === true,
    read_only: identity?.read_only === true,
    environment: identity?.environment === "production",
    branch: identity?.branch === "Production",
    sha: SHA40.test(identity?.expected_sha || ""),
    target_fingerprint: nonEmpty(identity?.target_fingerprint),
    secrets_forbidden: identity?.secrets_included === false,
  };
  return {
    valid: Object.values(checks).every(Boolean),
    checks,
    expected_sha: checks.sha ? identity.expected_sha : null,
    target_fingerprint: checks.target_fingerprint ? identity.target_fingerprint : null,
  };
}

function evaluateControlStoreProvisioning(evidence, identity) {
  const checks = {
    contract:
      evidence?.contract
      === PRODUCTION_RECOVERY_CONTROL_STORE_PROVISIONING_EVIDENCE_CONTRACT,
    provisioned: evidence?.provisioned === true,
    governed_authorization: evidence?.governed_provisioning_authorized === true,
    schema_readback: evidence?.schema_readback_verified === true,
    principal_isolated: evidence?.principal_isolated === true,
    recovery_store_contract:
      evidence?.recovery_store_contract === "mad4b.recovery-durable-store.v1",
    independent_store: evidence?.independent_of_target_databases === true,
    target_binding_forbidden: evidence?.target_database_binding === "forbidden",
    exact_sha: Boolean(identity.expected_sha)
      && evidence?.expected_sha === identity.expected_sha,
    exact_target: Boolean(identity.target_fingerprint)
      && evidence?.target_fingerprint === identity.target_fingerprint,
    production_live_disabled: evidence?.production_live_enabled === false,
    recovery_activation_not_performed: evidence?.recovery_activation_performed === false,
    secrets_forbidden: evidence?.secrets_included === false,
  };
  return { valid: Object.values(checks).every(Boolean), checks };
}

function evaluateIndependentReadbackCertification(evidence, stagingSha) {
  const checks = {
    contract:
      evidence?.contract
      === PRODUCTION_RECOVERY_INDEPENDENT_READBACK_CERTIFICATION_CONTRACT,
    verified: evidence?.verified === true,
    live_non_production: evidence?.live_non_production === true,
    certification_environment: evidence?.certification_environment === "staging",
    exact_implementation_sha: SHA40.test(stagingSha || "")
      && evidence?.implementation_sha === stagingSha,
    independent_authority: evidence?.independent_authority === true,
    role_aware: evidence?.role_aware === true,
    mutation_authority_forbidden: evidence?.mutation_authority === false,
    same_fence_readback: evidence?.same_fence_readback === true,
    postconditions_verified: evidence?.postconditions_verified === true,
    ambiguous_outcome_classification:
      evidence?.ambiguous_outcome_classification === true,
    production_mutation_forbidden: evidence?.production_mutation_performed === false,
    secrets_forbidden: evidence?.secrets_included === false,
  };
  return { valid: Object.values(checks).every(Boolean), checks };
}

export function evaluateProductionRecoveryCanaryReadiness({
  operationalComposition = null,
  stagingReadinessSnapshot = null,
  productionDeploymentAttestation = null,
  expectedProductionIdentity = null,
  controlStoreProvisioningEvidence = null,
  independentReadbackCertification = null,
} = {}) {
  const graph = evaluateOperationalGraph(operationalComposition);
  const identity = evaluateExpectedProductionIdentity(expectedProductionIdentity);
  const rawCertification =
    stagingReadinessSnapshot?.stagingCertification?.raw_certification
    || stagingReadinessSnapshot?.stagingCertification?.certification_evidence
    || stagingReadinessSnapshot?.stagingCertification
    || null;
  const stagingCertification = evaluateStagingRecoveryCertification({
    certification: rawCertification,
    expectedSha: stagingReadinessSnapshot?.candidateSha || null,
    expectedBranch: "main",
    expectedTargetFingerprint:
      stagingReadinessSnapshot?.candidateTargetFingerprint || null,
    requireExpectedTargetFingerprint: true,
  });
  const signedStagingSnapshot =
    stagingReadinessSnapshot?.authenticity_verified === true
    && stagingReadinessSnapshot?.pre_certification === false
    && stagingCertification.valid === true;
  const productionAttestation = identity.valid && attestationMatches({
    attestation: productionDeploymentAttestation,
    expectedSha: identity.expected_sha,
    expectedBranch: "Production",
    expectedEnvironment: "production",
    expectedTargetFingerprint: identity.target_fingerprint,
  });
  const artifactParity =
    signedStagingSnapshot
    && identity.valid
    && artifactParityMatches({
      parity: stagingReadinessSnapshot?.promotionArtifactParity || null,
      certification: stagingCertification,
      candidateSha: identity.expected_sha,
      candidateTargetFingerprint: identity.target_fingerprint,
    });
  const controlStore = evaluateControlStoreProvisioning(
    controlStoreProvisioningEvidence,
    identity,
  );
  const readback = evaluateIndependentReadbackCertification(
    independentReadbackCertification,
    stagingReadinessSnapshot?.candidateSha || null,
  );

  const checks = {
    complete_non_live_operational_graph: graph.valid,
    expected_production_identity_trusted: identity.valid,
    fresh_signed_staging_recovery_certification: signedStagingSnapshot,
    exact_production_deployment_attestation: productionAttestation,
    staging_to_production_artifact_parity: artifactParity,
    recovery_control_store_provisioned: controlStore.valid,
    independent_readback_certified_non_production: readback.valid,
  };
  const blockingReasons = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([key]) => key);
  const canaryReady = blockingReasons.length === 0;

  return Object.freeze({
    contract: PRODUCTION_RECOVERY_CANARY_READINESS_CONTRACT,
    status: canaryReady ? "ready" : "blocked",
    canary_ready: canaryReady,
    checks: Object.freeze(checks),
    blocking_reasons: Object.freeze(blockingReasons),
    evidence: Object.freeze({
      staging_certification_id:
        stagingCertification.evidence?.certification_id || null,
      staging_certification_sha:
        stagingCertification.evidence?.deployment_sha || null,
      production_expected_sha: identity.expected_sha,
      production_target_fingerprint_present:
        Boolean(identity.target_fingerprint),
      production_attestation_bound: productionAttestation,
      artifact_parity_bound: artifactParity,
    }),
    diagnostics: Object.freeze({
      operational_graph: graph.checks,
      expected_production_identity: identity.checks,
      staging_certification: stagingCertification.checks,
      control_store_provisioning: controlStore.checks,
      independent_readback_certification: readback.checks,
    }),
    activation_eligible: false,
    production_live_enabled: false,
    production_mutation_authorized: false,
    execution_ticket_issued: false,
    approval_issued: false,
    provider_accessed: false,
    database_connection_performed: false,
    database_mutation_performed: false,
    deployment_performed: false,
    secrets_included: false,
  });
}

export function createProductionRecoveryCanaryReadinessAuthority({
  readOperationalComposition,
  readStagingReadinessSnapshot,
  readProductionDeploymentAttestation,
  readExpectedProductionIdentity,
  readControlStoreProvisioningEvidence,
  readIndependentReadbackCertification,
} = {}) {
  const readers = Object.freeze({
    operationalComposition: requireReader(
      readOperationalComposition,
      "operationalComposition",
    ),
    stagingReadinessSnapshot: requireReader(
      readStagingReadinessSnapshot,
      "stagingReadinessSnapshot",
    ),
    productionDeploymentAttestation: requireReader(
      readProductionDeploymentAttestation,
      "productionDeploymentAttestation",
    ),
    expectedProductionIdentity: requireReader(
      readExpectedProductionIdentity,
      "expectedProductionIdentity",
    ),
    controlStoreProvisioningEvidence: requireReader(
      readControlStoreProvisioningEvidence,
      "controlStoreProvisioningEvidence",
    ),
    independentReadbackCertification: requireReader(
      readIndependentReadbackCertification,
      "independentReadbackCertification",
    ),
  });

  return Object.freeze({
    contract: "mad4b.production-recovery-canary-readiness-authority.v1",
    read_only: true,
    production_live_enabled: false,
    activation_eligible: false,
    async readReadiness() {
      const entries = await Promise.all(
        Object.entries(readers).map(async ([name, reader]) => [
          name,
          await safeRead(name, reader),
        ]),
      );
      const results = Object.fromEntries(entries);
      const readiness = evaluateProductionRecoveryCanaryReadiness(
        Object.fromEntries(
          Object.entries(results).map(([name, result]) => [
            name,
            result.ok ? result.value : null,
          ]),
        ),
      );
      const readerErrors = Object.fromEntries(
        Object.entries(results)
          .filter(([, result]) => !result.ok)
          .map(([name, result]) => [name, result.error_code]),
      );
      return Object.freeze({
        ...readiness,
        reader_errors: Object.freeze(readerErrors),
        canary_ready:
          readiness.canary_ready === true
          && Object.keys(readerErrors).length === 0,
        status:
          readiness.canary_ready === true
          && Object.keys(readerErrors).length === 0
            ? "ready"
            : "blocked",
        activation_eligible: false,
        production_live_enabled: false,
        production_mutation_authorized: false,
        secrets_included: false,
      });
    },
  });
}

export const _testingProductionRecoveryCanaryReadiness = Object.freeze({
  evaluateOperationalGraph,
  evaluateExpectedProductionIdentity,
  evaluateControlStoreProvisioning,
  evaluateIndependentReadbackCertification,
});
