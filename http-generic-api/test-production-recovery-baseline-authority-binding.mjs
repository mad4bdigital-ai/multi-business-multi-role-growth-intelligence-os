import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createProductionRecoveryComposition } from "./productionRecoveryCompositionFactory.js";
import { createServerManagedRecoveryBindingProvider } from "./serverManagedRecoveryBindingProvider.js";
import {
  createProductionRecoveryBaselineBindingForEnv,
  createProductionRecoveryReadinessAuthoritiesForEnv,
} from "./productionRecoveryBaselineAuthorityBinding.js";
import {
  createFileRecoveryEvidenceStore,
  readinessEvidencePayload,
} from "./recoveryReadinessEvidence.js";

const SHA = "a".repeat(40);
const TARGET = "b".repeat(64);
const MANIFEST = "c".repeat(64);
const ATTESTATION = "d".repeat(64);

function asyncMethod(value = {}) {
  return async () => value;
}

function mutationGradeStore({ executionTicketVerifier } = {}) {
  const generic = asyncMethod(null);
  return {
    recovery_store_contract: "mad4b.recovery-durable-store.v1",
    independent_of_target_databases: true,
    target_database_binding: "forbidden",
    provider_accessed: false,
    shared_replica_safe: true,
    schema_auto_apply: false,
    payload_integrity_verified_on_read: true,
    executionTicketVerifier,
    recoveryLock: {
      acquire: asyncMethod({ acquired: true, lease_id: "lease:test", fencing_token: "fence:test", expires_at: new Date(Date.now() + 60_000).toISOString() }),
      heartbeat: asyncMethod({ renewed: true }),
      assertFence: asyncMethod({ valid: true }),
      release: asyncMethod({ released: true }),
    },
    putRun: generic,
    getRun: generic,
    putPlan: generic,
    getPlan: generic,
    putFinding: generic,
    getFinding: generic,
    getRunByIdempotency: generic,
    appendEvidenceEvent: generic,
    putIdempotencyReceipt: generic,
    putApproval: generic,
    getApprovalByPlanStep: generic,
    claimExecution: generic,
    reserveApproval: asyncMethod({ reserved: true }),
    getExecutionTicket: generic,
    putExecutionTicket: generic,
    reserveExecutionTicket: asyncMethod({ reserved: true }),
    releaseExecutionTicket: asyncMethod({ released: true }),
    finalizeExecutionTicket: asyncMethod({ finalized: true }),
    releaseExecutionClaim: asyncMethod({ released: true }),
    releaseApprovalReservation: asyncMethod({ released: true }),
    finalizeApproval: asyncMethod({ finalized: true }),
    markApprovalUsed: asyncMethod({ finalized: true }),
    putEphemeralCapability: generic,
    getEphemeralCapability: generic,
  };
}

function env(overrides = {}) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    DEPLOYMENT_ENVIRONMENT: "production_hostinger_autodeploy",
    RECOVERY_SERVER_MANAGED_BINDING_MODE: "production_live",
    RECOVERY_PRODUCTION_APPROVAL_SECRET: "server-owned-approval-material-with-at-least-thirty-two-bytes",
    RECOVERY_PRODUCTION_EXECUTION_PRIVATE_KEY_JWK: JSON.stringify(privateKey.export({ format: "jwk" })),
    RECOVERY_PRODUCTION_EXECUTION_PUBLIC_KEY_JWK: JSON.stringify(publicKey.export({ format: "jwk" })),
    ...overrides,
  };
}

function attestationReader() {
  return {
    repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
    branch: "Production",
    environment: "production",
    sha: SHA,
    target_fingerprint: TARGET,
    target_fingerprints: {
      runtime: "1".repeat(64),
      governance: "2".repeat(64),
      runtime_persistence: "3".repeat(64),
    },
    recovery_manifest_hash: MANIFEST,
    attestation_hash: ATTESTATION,
    manifest_bound: true,
    read_only_probe: true,
    database_connection_performed: false,
    database_mutation_performed: false,
    provider_mutation_performed: false,
    secrets_included: false,
  };
}

function buildResolver(testEnv) {
  return (context) => createProductionRecoveryBaselineBindingForEnv(
    context,
    testEnv,
    {
      controlStoreFactory: ({ executionTicketVerifier }) => mutationGradeStore({ executionTicketVerifier }),
      baselineExecutorFactory: () => async () => ({
        ok: true,
        status: "synthetic-not-executed",
        database_mutation_performed: false,
        secrets_included: false,
      }),
      baselineReadbackFactory: () => async () => ({
        ok: true,
        verified: true,
        postconditions_passed: true,
        structural_postconditions_passed: true,
        data_postconditions_passed: true,
        behavioral_probe_passed: null,
        secrets_included: false,
      }),
      attestationReader,
    },
  );
}

{
  const testEnv = env();
  const provider = createServerManagedRecoveryBindingProvider({
    env: testEnv,
    resolver: buildResolver(testEnv),
  });
  const composition = createProductionRecoveryComposition({
    mode: "production_live",
    source: "test-production-baseline-binding",
    serverManagedBindingProvider: provider,
  });
  assert.equal(composition.mode, "production_live");
  assert.equal(composition.live_activation, true);
  assert.equal(composition.mutation_authority_available, true);
  assert.equal(composition.productionRecoveryCompositionFactory.authority_readiness.live_ready, true);
  assert.equal(composition.productionRecoveryCompositionFactory.live_authorization.ok, true);
  assert.equal(composition.productionRecoveryCompositionFactory.live_authorization.server_side_approval_resolution, true);
  assert.equal(composition.productionRecoveryCompositionFactory.live_authorization.bootstrap_evidence_independent, true);
  assert.equal(composition.provider_accessed, false);
  assert.equal(composition.database_connection_performed, false);
  assert.equal(composition.database_mutation_performed, false);
  const serialized = JSON.stringify(provider({ requested_mode: "production_live" }));
  assert(!serialized.includes(testEnv.RECOVERY_PRODUCTION_APPROVAL_SECRET));
  assert(!serialized.includes(testEnv.RECOVERY_PRODUCTION_EXECUTION_PRIVATE_KEY_JWK));
  assert(!serialized.includes("raw_sql"));
  assert(!serialized.includes("caller_credentials"));
  assert(!serialized.includes("gpt_credentials"));
  assert(!serialized.includes("local_connector"));
}

{
  const testEnv = env({ RECOVERY_PRODUCTION_APPROVAL_SECRET: "" });
  const provider = createServerManagedRecoveryBindingProvider({
    env: testEnv,
    resolver: buildResolver(testEnv),
  });
  assert.throws(
    () => createProductionRecoveryComposition({
      mode: "production_live",
      source: "test-production-baseline-binding-missing-secret",
      serverManagedBindingProvider: provider,
    }),
    (error) => error?.code === "RECOVERY_SERVER_MANAGED_BINDING_RESOLUTION_FAILED",
  );
}

{
  const testEnv = env({ RECOVERY_SERVER_MANAGED_BINDING_MODE: "disabled" });
  const provider = createServerManagedRecoveryBindingProvider({
    env: testEnv,
    resolver: buildResolver(testEnv),
  });
  const composition = createProductionRecoveryComposition({
    mode: "production_live",
    source: "test-production-baseline-binding-disabled",
    serverManagedBindingProvider: provider,
  });
  assert.equal(composition.mode, "fail_closed");
  assert.equal(composition.live_activation, false);
  assert.equal(composition.mutation_authority_available, false);
  assert.equal(composition.productionRecoveryCompositionFactory.denial_reason, "production_live_server_managed_intent_mismatch");
}

{
  const testEnv = env();
  const envelope = buildResolver(testEnv)({
    environment: "production",
    runtime_class: "hostinger_autodeploy",
    requested_mode: "production_live",
  });
  assert.equal(envelope.live_authorization.authority_scope, "baseline_rebuild_only");
  assert.equal(envelope.live_authorization.ordinary_migration_enabled, false);
  assert.equal(envelope.live_authorization.grant_repair_enabled, false);
  assert.equal(Object.hasOwn(envelope.live_authorization, "raw_sql_enabled"), false);
  assert.equal(envelope.live_authorization.shell_enabled, false);
  assert.equal(envelope.live_authorization.production_auto_apply, false);
  await assert.rejects(
    () => envelope.adapters.migrationLedger.finalize({ migration: "1051" }),
    (error) => error?.code === "RECOVERY_PRODUCTION_ORDINARY_MIGRATION_NOT_ENABLED",
  );
}

{
  const root = await mkdtemp(path.join(os.tmpdir(), "production-recovery-readiness-"));
  const certificationKeys = generateKeyPairSync("ed25519");
  const testEnv = env({
    RECOVERY_PRODUCTION_READINESS_DIRECTORY: root,
    RECOVERY_PRODUCTION_CERTIFICATION_PUBLIC_KEY: certificationKeys.publicKey.export({ type: "spki", format: "pem" }),
    RECOVERY_PRODUCTION_CERTIFICATION_KEY_ID: "production-certification-test-key",
    RECOVERY_PRODUCTION_CERTIFICATION_ISSUER: "production-certification-test-workflow",
  });

  try {
    const context = {
      environment: "production",
      runtime_class: "hostinger_autodeploy",
      read_only: true,
      production_live: false,
    };

    const authority = createProductionRecoveryReadinessAuthoritiesForEnv(
      context,
      testEnv,
      { attestationReader },
    );
    const preCertification = await authority.readSnapshot();
    assert.equal(preCertification.pre_certification, true);
    assert.equal(preCertification.candidateSha, SHA);
    assert.equal(preCertification.candidateTargetFingerprint, TARGET);
    assert.equal(preCertification.runtimeClass, "hostinger_autodeploy");
    assert.equal(preCertification.stagingCertification, null);

    const store = createFileRecoveryEvidenceStore({
      directory: path.join(root, "certification-evidence"),
      replayDirectory: path.join(root, "replay"),
    });
    const payload = {
      contract: "mad4b.recovery-readiness-evidence.v1",
      issuer: testEnv.RECOVERY_PRODUCTION_CERTIFICATION_ISSUER,
      key_id: testEnv.RECOVERY_PRODUCTION_CERTIFICATION_KEY_ID,
      environment: "production",
      deployment_sha: SHA,
      target_fingerprint: TARGET,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      stagingCertification: {
        contract: "mad4b.staging-recovery-certification-reference.v1",
        certified: true,
        secrets_included: false,
      },
      unresolvedRecoveryIncidents: [],
      secrets_included: false,
    };
    const record = {
      payload,
      signature: sign(
        null,
        Buffer.from(readinessEvidencePayload(payload)),
        certificationKeys.privateKey,
      ).toString("base64url"),
    };
    const recordId = await store.putCertification(record);
    await store.setCurrentCertification(recordId);

    const certifiedAuthority = createProductionRecoveryReadinessAuthoritiesForEnv(
      context,
      testEnv,
      { attestationReader },
    );
    const certified = await certifiedAuthority.readSnapshot();
    assert.equal(certified.pre_certification, false);
    assert.equal(certified.authenticity_verified, true);
    assert.equal(certified.candidateSha, SHA);
    assert.equal(certified.candidateTargetFingerprint, TARGET);
    assert.equal(certified.stagingCertification.certified, true);

    const wrongPayload = {
      ...payload,
      target_fingerprint: "f".repeat(64),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    };
    const wrongRecord = {
      payload: wrongPayload,
      signature: sign(
        null,
        Buffer.from(readinessEvidencePayload(wrongPayload)),
        certificationKeys.privateKey,
      ).toString("base64url"),
    };
    const wrongRecordId = await store.putCertification(wrongRecord);
    await store.setCurrentCertification(wrongRecordId);

    const mismatchedAuthority = createProductionRecoveryReadinessAuthoritiesForEnv(
      context,
      testEnv,
      { attestationReader },
    );
    await assert.rejects(
      () => mismatchedAuthority.readSnapshot(),
      (error) => error?.code === "RECOVERY_EVIDENCE_TARGET_MISMATCH",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

{
  const testEnv = env({
    RECOVERY_PRODUCTION_READINESS_DIRECTORY: "relative/recovery-readiness",
    RECOVERY_PRODUCTION_CERTIFICATION_PUBLIC_KEY: generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }),
    RECOVERY_PRODUCTION_CERTIFICATION_KEY_ID: "production-certification-test-key",
    RECOVERY_PRODUCTION_CERTIFICATION_ISSUER: "production-certification-test-workflow",
  });
  assert.throws(
    () => createProductionRecoveryReadinessAuthoritiesForEnv(
      {
        environment: "production",
        runtime_class: "hostinger_autodeploy",
        read_only: true,
        production_live: false,
      },
      testEnv,
      { attestationReader },
    ),
    (error) => error?.code === "RECOVERY_PRODUCTION_READINESS_DIRECTORY_INVALID",
  );
}

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.production-recovery-baseline-authority-binding-regression.v1",
  production_live_requires_external_configuration: true,
  baseline_rebuild_only: true,
  ordinary_migration_enabled: false,
  grant_repair_enabled: false,
  raw_sql_enabled: false,
  shell_enabled: false,
  composition_database_connection_performed: false,
  composition_database_mutation_performed: false,
  secrets_included: false,
}));
