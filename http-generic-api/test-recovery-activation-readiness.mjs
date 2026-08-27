import assert from "node:assert/strict";
import test from "node:test";
import {
  RECOVERY_CERTIFICATION_TRACE_STEPS,
  RECOVERY_PRODUCTION_AUTHORITY_READINESS_CONTRACT,
  RECOVERY_STAGING_CERTIFICATION_CONTRACT,
  buildProductionAuthorityActivationReadiness,
  buildRecoveryAuthorityReadiness,
  evaluateStagingRecoveryCertification,
} from "./recoveryActivationReadiness.js";
import { RECOVERY_COMPOSITION_COMPONENT_KEYS } from "./recoveryComposition.js";
import { runProductionActivationReadiness } from "./productionActivationReadiness.js";

const SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);
const TARGET = "target:" + "c".repeat(64);

function completeComposition(overrides = {}) {
  const componentStatus = Object.fromEntries(RECOVERY_COMPOSITION_COMPONENT_KEYS.map((key) => [key, {
    configured: true,
    missing_methods: [],
  }]));
  return {
    contract: "mad4b.recovery-composition.v1",
    mode: "production_live",
    configured: true,
    live_activation: true,
    component_status: { ...componentStatus, ...(overrides.component_status || {}) },
    productionRecoveryCompositionFactory: {
      authority_readiness: {
        adapter_present: true,
        durability_capable: true,
        attestation_capable: true,
      },
    },
    ...overrides,
  };
}

function validCertification({ deploymentSha = SHA, expiresAt = new Date(Date.now() + 3600000).toISOString() } = {}) {
  const lifecycleTrace = Object.fromEntries(RECOVERY_CERTIFICATION_TRACE_STEPS.map((step) => [step, { status: "pass" }]));
  const negativeCases = {
    wrong_plan_hash: { status: "pass" },
    wrong_step: { status: "pass" },
    expired_approval: { status: "pass" },
    approval_reuse: { status: "pass" },
    cross_target_approval: { status: "pass" },
    cross_sha_approval: { status: "pass" },
    cross_environment_approval: { status: "pass" },
    caller_ticket_fields: { status: "pass" },
    ticket_replay: { status: "pass" },
    expired_ticket: { status: "pass" },
    cross_target_ticket: { status: "pass" },
    cross_sha_ticket: { status: "pass" },
    idempotency_race: { status: "pass" },
    restart_durability: { status: "pass" },
    lost_fence: { status: "pass" },
    provider_timeout_unknown_outcome: { status: "pass" },
    partial_execution_reconciliation: { status: "pass" },
    readback_failure: { status: "pass" },
    artifact_drift: { status: "pass" },
    schema_precondition_drift: { status: "pass" },
  };
  return {
    contract: RECOVERY_STAGING_CERTIFICATION_CONTRACT,
    certification_id: "cert:staging:001",
    status: "passed",
    result: "pass",
    environment_key: "staging",
    deployment_sha: deploymentSha,
    runtime_sha: deploymentSha,
    branch: "main",
    target_fingerprint: TARGET,
    server_identity_fingerprint: "server:" + "d".repeat(64),
    provider_environment: "staging",
    authority_graph: {
      ready: true,
      test_or_mock_adapter_detected: false,
    },
    lifecycle_trace: lifecycleTrace,
    negative_tests: {
      all_passed: true,
      cases: negativeCases,
    },
    audit_evidence: {
      durable: true,
      evidence_hash: "e".repeat(64),
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
}

function validAttestation({ sha = SHA } = {}) {
  return {
    repository_match: true,
    branch_match: true,
    sha_match: true,
    manifest_bound: true,
    read_only: true,
    repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
    branch: "Production",
    sha,
    secrets_included: false,
  };
}

test("valid staging certification is exact-bound and secret-free", () => {
  const result = evaluateStagingRecoveryCertification({
    certification: validCertification(),
    expectedSha: SHA,
    expectedTargetFingerprint: TARGET,
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.blocking_failures, []);
  assert.equal(result.database_mutation_performed, false);
  assert.equal(result.provider_mutation_performed, false);
  assert.equal(result.secrets_included, false);
});

test("staging certification rejects stale, wrong-SHA, and cross-target evidence", () => {
  const stale = evaluateStagingRecoveryCertification({
    certification: validCertification({ expiresAt: new Date(Date.now() - 1000).toISOString() }),
    expectedSha: SHA,
    expectedTargetFingerprint: TARGET,
  });
  assert.equal(stale.valid, false);
  assert.ok(stale.blocking_failures.includes("freshness"));

  const wrongSha = evaluateStagingRecoveryCertification({
    certification: validCertification({ deploymentSha: OTHER_SHA }),
    expectedSha: SHA,
    expectedTargetFingerprint: TARGET,
  });
  assert.equal(wrongSha.valid, false);
  assert.ok(wrongSha.blocking_failures.includes("exact_sha"));

  const wrongTarget = evaluateStagingRecoveryCertification({
    certification: validCertification(),
    expectedSha: SHA,
    expectedTargetFingerprint: "target:" + "f".repeat(64),
  });
  assert.equal(wrongTarget.valid, false);
  assert.ok(wrongTarget.blocking_failures.includes("target_fingerprint"));
});

test("production activation eligibility requires every gate and never enables live mode", () => {
  const certification = evaluateStagingRecoveryCertification({
    certification: validCertification(),
    expectedSha: SHA,
    expectedTargetFingerprint: TARGET,
  });
  const result = buildProductionAuthorityActivationReadiness({
    productionLiveRequested: true,
    productionLiveEnabled: true,
    composition: completeComposition(),
    stagingCertification: certification,
    deploymentAttestation: validAttestation(),
    candidateSha: SHA,
    unresolvedRecoveryIncidents: [],
  });
  assert.equal(result.contract, RECOVERY_PRODUCTION_AUTHORITY_READINESS_CONTRACT);
  assert.equal(result.activation_eligible, true);
  assert.equal(result.production_live.requested, true);
  assert.equal(result.production_live.eligible, true);
  assert.equal(result.production_live.enabled, false);
  assert.equal(result.production_live.observed_enabled, true);
  assert.equal(result.mutation_grade_durable, true);
  assert.equal(result.database_mutation_performed, false);
  assert.equal(result.provider_mutation_performed, false);
  assert.equal(result.secrets_included, false);
});

test("production activation remains blocked for missing authority, stale cert, wrong SHA, mock, or incident", () => {
  const certification = evaluateStagingRecoveryCertification({
    certification: validCertification(),
    expectedSha: SHA,
    expectedTargetFingerprint: TARGET,
  });
  const cases = [
    {
      name: "missing authority",
      options: { composition: completeComposition({ component_status: { recoveryLock: { configured: false, missing_methods: ["acquire"] } } }) },
      reason: "RECOVERY_PRODUCTION_LIVE_COMPOSITION_INCOMPLETE",
    },
    {
      name: "stale certification",
      options: { stagingCertification: evaluateStagingRecoveryCertification({ certification: validCertification({ expiresAt: new Date(Date.now() - 1000).toISOString() }), expectedSha: SHA, expectedTargetFingerprint: TARGET }) },
      reason: "RECOVERY_STAGING_CERTIFICATION_EXPIRED",
    },
    {
      name: "wrong SHA",
      options: { candidateSha: OTHER_SHA, deploymentAttestation: validAttestation({ sha: OTHER_SHA }) },
      reason: "RECOVERY_DEPLOYMENT_ATTESTATION_MISMATCH",
    },
    {
      name: "mock provenance",
      options: { adapterProvenance: { recoveryStore: "mock-adapter" } },
      reason: "RECOVERY_PRODUCTION_LIVE_COMPOSITION_INCOMPLETE",
    },
    {
      name: "open incident",
      options: { unresolvedRecoveryIncidents: ["run:unknown:001"] },
      reason: "RECOVERY_RECONCILIATION_REQUIRED",
    },
  ];
  for (const item of cases) {
    const result = buildProductionAuthorityActivationReadiness({
      productionLiveRequested: true,
      composition: completeComposition(),
      stagingCertification: certification,
      deploymentAttestation: validAttestation(),
      candidateSha: SHA,
      ...item.options,
    });
    assert.equal(result.activation_eligible, false, item.name);
    assert.ok(result.blocking_reasons.includes(item.reason), item.name);
    assert.equal(result.production_live.enabled, false, item.name);
    assert.equal(result.database_mutation_performed, false, item.name);
  }
});

test("server readiness reader exposes authority readiness without accepting live activation input", async () => {
  const readonly = {
    ok: true,
    ready: true,
    read_only_probe: true,
    database_connection_performed: false,
    sql_readback_performed: false,
    sql_mutation_performed: false,
    migration_apply_performed: false,
    provider_mutation_performed: false,
    deployment_performed: false,
    secrets_included: false,
  };
  const result = await runProductionActivationReadiness({
    mcpCatalogReader: async () => readonly,
    governanceDbReader: async () => readonly,
    runtimePersistenceReader: async () => readonly,
    recoveryComposition: completeComposition(),
    productionLiveRequested: true,
    productionLiveEnabled: true,
    candidateSha: SHA,
    stagingCertification: evaluateStagingRecoveryCertification({ certification: validCertification(), expectedSha: SHA, expectedTargetFingerprint: TARGET }),
    deploymentAttestation: validAttestation(),
  });
  assert.equal(result.ok, true);
  assert.equal(result.production_authority_readiness.activation_eligible, true);
  assert.equal(result.production_live.enabled, false);
  assert.equal(result.database_mutation_performed, false);
  assert.equal(result.provider_mutation_performed, false);
});

console.log("Recovery activation readiness contract tests passed");
