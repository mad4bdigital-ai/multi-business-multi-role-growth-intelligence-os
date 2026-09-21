import assert from "node:assert/strict";
import test from "node:test";
import {
  RECOVERY_CERTIFICATION_TRACE_STEPS,
  RECOVERY_STAGING_CERTIFICATION_CONTRACT,
  certificationPayloadHash,
} from "./recoveryActivationReadiness.js";
import {
  RECOVERY_COMPOSITION_COMPONENT_KEYS,
  RECOVERY_COMPOSITION_CONTRACT,
} from "./recoveryComposition.js";
import {
  PRODUCTION_RECOVERY_CONTROL_STORE_PROVISIONING_EVIDENCE_CONTRACT,
  PRODUCTION_RECOVERY_EXPECTED_IDENTITY_CONTRACT,
  PRODUCTION_RECOVERY_INDEPENDENT_READBACK_CERTIFICATION_CONTRACT,
  createProductionRecoveryCanaryReadinessAuthority,
  evaluateProductionRecoveryCanaryReadiness,
} from "./productionRecoveryCanaryReadiness.js";

const STAGING_SHA = "a".repeat(40);
const PRODUCTION_SHA = "b".repeat(40);
const STAGING_TARGET = "staging-target:" + "c".repeat(64);
const PRODUCTION_TARGET = "production-target:" + "d".repeat(64);

function validCertification({
  deploymentSha = STAGING_SHA,
  targetFingerprint = STAGING_TARGET,
  expiresAt = new Date(Date.now() + 3600000).toISOString(),
} = {}) {
  const lifecycleTrace = Object.fromEntries(
    RECOVERY_CERTIFICATION_TRACE_STEPS.map((step) => [step, { status: "pass" }]),
  );
  const negativeNames = [
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
  ];
  const certification = {
    contract: RECOVERY_STAGING_CERTIFICATION_CONTRACT,
    certification_id: "cert:production-recovery-canary:001",
    status: "passed",
    result: "pass",
    environment_key: "staging",
    deployment_sha: deploymentSha,
    runtime_sha: deploymentSha,
    branch: "main",
    target_fingerprint: targetFingerprint,
    server_identity_fingerprint: "server:" + "e".repeat(64),
    provider_environment: "staging",
    authority_graph: {
      ready: true,
      test_or_mock_adapter_detected: false,
    },
    lifecycle_trace: lifecycleTrace,
    negative_tests: {
      all_passed: true,
      cases: Object.fromEntries(
        negativeNames.map((name) => [name, { status: "pass" }]),
      ),
    },
    audit_evidence: {
      durable: true,
      evidence_hash: "f".repeat(64),
    },
    artifact_integrity: { valid: true },
    expires_at: expiresAt,
    safety: {
      production_mutation_performed: false,
      secrets_included: false,
      caller_credentials_accepted: false,
      local_connector_production_authority: false,
    },
    secrets_included: false,
  };
  certification.audit_evidence.canonical_payload_hash =
    certificationPayloadHash(certification);
  return certification;
}

function validOperationalComposition(overrides = {}) {
  const componentStatus = Object.fromEntries(
    RECOVERY_COMPOSITION_COMPONENT_KEYS.map((key) => [
      key,
      { configured: true, missing_methods: [] },
    ]),
  );
  return {
    contract: RECOVERY_COMPOSITION_CONTRACT,
    mode: "injected_non_live",
    configured: true,
    live_activation: false,
    mutation_authority_available: true,
    component_status: componentStatus,
    productionRecoveryCompositionFactory: {
      authority_readiness: {
        adapter_present: true,
        durability_capable: true,
        attestation_capable: true,
      },
    },
    operational_authority: {
      complete_adapter_graph: true,
      production_live_enabled: false,
      activation_eligible: false,
      provider_accessed_during_construction: false,
      database_connection_performed: false,
      database_mutation_performed: false,
    },
    secrets_included: false,
    ...overrides,
  };
}

function validSnapshot({ certification = validCertification() } = {}) {
  return {
    stagingCertification: certification,
    candidateSha: STAGING_SHA,
    candidateTargetFingerprint: STAGING_TARGET,
    authenticity_verified: true,
    pre_certification: false,
    promotionArtifactParity: {
      verified: true,
      source_environment: "staging",
      target_environment: "production",
      source_sha: STAGING_SHA,
      target_sha: PRODUCTION_SHA,
      source_target_fingerprint: STAGING_TARGET,
      target_target_fingerprint: PRODUCTION_TARGET,
      source_artifact_set_hash: "artifact:" + "1".repeat(64),
      target_artifact_set_hash: "artifact:" + "1".repeat(64),
      source_manifest_hash: "manifest:" + "2".repeat(64),
      target_manifest_hash: "manifest:" + "2".repeat(64),
      generated_artifacts_verified: true,
    },
  };
}

function validExpectedIdentity(overrides = {}) {
  return {
    contract: PRODUCTION_RECOVERY_EXPECTED_IDENTITY_CONTRACT,
    server_managed: true,
    read_only: true,
    environment: "production",
    branch: "Production",
    expected_sha: PRODUCTION_SHA,
    target_fingerprint: PRODUCTION_TARGET,
    secrets_included: false,
    ...overrides,
  };
}

function validProductionAttestation(overrides = {}) {
  return {
    repository_match: true,
    branch_match: true,
    sha_match: true,
    manifest_bound: true,
    read_only: true,
    repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
    branch: "Production",
    sha: PRODUCTION_SHA,
    environment: "production",
    target_fingerprint: PRODUCTION_TARGET,
    secrets_included: false,
    ...overrides,
  };
}

function validControlStoreProvisioning(overrides = {}) {
  return {
    contract: PRODUCTION_RECOVERY_CONTROL_STORE_PROVISIONING_EVIDENCE_CONTRACT,
    provisioned: true,
    governed_provisioning_authorized: true,
    schema_readback_verified: true,
    principal_isolated: true,
    recovery_store_contract: "mad4b.recovery-durable-store.v1",
    independent_of_target_databases: true,
    target_database_binding: "forbidden",
    expected_sha: PRODUCTION_SHA,
    target_fingerprint: PRODUCTION_TARGET,
    production_live_enabled: false,
    recovery_activation_performed: false,
    secrets_included: false,
    ...overrides,
  };
}

function validReadbackCertification(overrides = {}) {
  return {
    contract:
      PRODUCTION_RECOVERY_INDEPENDENT_READBACK_CERTIFICATION_CONTRACT,
    verified: true,
    live_non_production: true,
    certification_environment: "staging",
    implementation_sha: STAGING_SHA,
    independent_authority: true,
    role_aware: true,
    mutation_authority: false,
    same_fence_readback: true,
    postconditions_verified: true,
    ambiguous_outcome_classification: true,
    production_mutation_performed: false,
    secrets_included: false,
    ...overrides,
  };
}

function validInputs(overrides = {}) {
  return {
    operationalComposition: validOperationalComposition(),
    stagingReadinessSnapshot: validSnapshot(),
    productionDeploymentAttestation: validProductionAttestation(),
    expectedProductionIdentity: validExpectedIdentity(),
    controlStoreProvisioningEvidence: validControlStoreProvisioning(),
    independentReadbackCertification: validReadbackCertification(),
    ...overrides,
  };
}

test("complete evidence makes canary ready without granting Production activation", () => {
  const result = evaluateProductionRecoveryCanaryReadiness(validInputs());
  assert.equal(result.canary_ready, true);
  assert.deepEqual(result.blocking_reasons, []);
  assert.equal(result.activation_eligible, false);
  assert.equal(result.production_live_enabled, false);
  assert.equal(result.production_mutation_authorized, false);
  assert.equal(result.execution_ticket_issued, false);
  assert.equal(result.approval_issued, false);
  assert.equal(result.database_mutation_performed, false);
  assert.equal(result.provider_accessed, false);
  assert.equal(result.secrets_included, false);
});

test("live composition cannot satisfy the non-live canary boundary", () => {
  const result = evaluateProductionRecoveryCanaryReadiness(validInputs({
    operationalComposition: validOperationalComposition({
      mode: "production_live",
      live_activation: true,
      operational_authority: {
        complete_adapter_graph: true,
        production_live_enabled: true,
        activation_eligible: true,
        provider_accessed_during_construction: false,
        database_connection_performed: false,
        database_mutation_performed: false,
      },
    }),
  }));
  assert.equal(result.canary_ready, false);
  assert.ok(result.blocking_reasons.includes("complete_non_live_operational_graph"));
  assert.equal(result.activation_eligible, false);
  assert.equal(result.production_live_enabled, false);
});

test("stale or wrong signed Staging evidence fails closed", () => {
  const stale = validCertification({
    expiresAt: new Date(Date.now() - 1000).toISOString(),
  });
  const result = evaluateProductionRecoveryCanaryReadiness(validInputs({
    stagingReadinessSnapshot: validSnapshot({ certification: stale }),
  }));
  assert.equal(result.canary_ready, false);
  assert.ok(
    result.blocking_reasons.includes(
      "fresh_signed_staging_recovery_certification",
    ),
  );
  assert.equal(result.diagnostics.staging_certification.freshness, false);
});

test("unprovisioned Recovery control store cannot be treated as canary ready", () => {
  const result = evaluateProductionRecoveryCanaryReadiness(validInputs({
    controlStoreProvisioningEvidence: validControlStoreProvisioning({
      provisioned: false,
      schema_readback_verified: false,
    }),
  }));
  assert.equal(result.canary_ready, false);
  assert.ok(
    result.blocking_reasons.includes("recovery_control_store_provisioned"),
  );
});

test("Production identity drift invalidates attestation and artifact parity", () => {
  const result = evaluateProductionRecoveryCanaryReadiness(validInputs({
    expectedProductionIdentity: validExpectedIdentity({
      expected_sha: "9".repeat(40),
    }),
  }));
  assert.equal(result.canary_ready, false);
  assert.ok(
    result.blocking_reasons.includes(
      "exact_production_deployment_attestation",
    ),
  );
  assert.ok(
    result.blocking_reasons.includes("staging_to_production_artifact_parity"),
  );
});

test("authority reader failures are bounded and cannot accidentally authorize", async () => {
  const values = validInputs();
  const authority = createProductionRecoveryCanaryReadinessAuthority({
    readOperationalComposition: async () => values.operationalComposition,
    readStagingReadinessSnapshot: async () => values.stagingReadinessSnapshot,
    readProductionDeploymentAttestation:
      async () => values.productionDeploymentAttestation,
    readExpectedProductionIdentity: async () => values.expectedProductionIdentity,
    readControlStoreProvisioningEvidence: async () => {
      const error = new Error("must-never-leak:super-secret-password");
      error.code = "RECOVERY_CONTROL_STORE_EVIDENCE_UNAVAILABLE";
      throw error;
    },
    readIndependentReadbackCertification:
      async () => values.independentReadbackCertification,
  });
  const result = await authority.readReadiness();
  assert.equal(result.canary_ready, false);
  assert.equal(result.status, "blocked");
  assert.equal(
    result.reader_errors.controlStoreProvisioningEvidence,
    "RECOVERY_CONTROL_STORE_EVIDENCE_UNAVAILABLE",
  );
  assert.equal(
    JSON.stringify(result).includes("must-never-leak:super-secret-password"),
    false,
  );
  assert.equal(result.activation_eligible, false);
  assert.equal(result.production_live_enabled, false);
  assert.equal(result.secrets_included, false);
});
