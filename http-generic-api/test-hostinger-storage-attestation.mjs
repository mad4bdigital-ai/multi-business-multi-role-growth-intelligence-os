#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildHostingerStorageAttestationSubject,
  verifyHostingerStorageAttestationEvidence,
  evaluateHostingerStoragePolicyParity,
  buildHostingerStorageTelemetryEnvelope,
} from './hostingerStorageAttestation.js';
import {
  buildHostingerStorageRecoveryCheckpoint,
  verifyHostingerStorageRecoveryEvidence,
} from './hostingerStorageRecovery.js';

const policy = JSON.parse(fs.readFileSync(new URL('./config/hostinger-storage-open-source-toolchain.json', import.meta.url), 'utf8'));
const planHash = 'a'.repeat(64);
const candidateHash = 'b'.repeat(64);
const authorityHash = 'c'.repeat(64);
const approvalHash = 'd'.repeat(64);
const resolutionHash = 'e'.repeat(64);
const policyHash = 'f'.repeat(64);
const binaryHash = '1'.repeat(64);

const plan = {
  plan_id: 'plan-1',
  operation_id: 'operation-1',
  target_id: 'target-1',
  plan_hash: planHash,
  candidate_set_hash: candidateHash,
  authority_context_hash: authorityHash,
  ownership_revision: 'ownership-r1',
  policy_revision: 'policy-r1',
};

const toolchainResolution = {
  resolution_fingerprint: resolutionHash,
  policy_fingerprint: policyHash,
  selections: [
    {
      capability: 'checkpoint',
      satisfied: true,
      selected_tool_id: 'restic',
      selected: { observed_version: '0.17.3', binary_sha256: binaryHash },
    },
    {
      capability: 'attestation',
      satisfied: true,
      selected_tool_id: 'cosign',
      selected: { observed_version: '2.4.1', binary_sha256: '2'.repeat(64) },
    },
  ],
};

const checkpoint = buildHostingerStorageRecoveryCheckpoint({
  policy,
  risk_profile: 'tenant_high',
  plan,
  repository: {
    repository_ref: 'recovery-repositories/tenant-1',
    backend: 's3',
    binding_revision: 'repository-r1',
    retention_policy_revision: 'retention-r1',
    external_to_target: true,
  },
  toolchain_resolution: toolchainResolution,
  requested_at: '2026-08-01T08:00:00.000Z',
});

const recoveryProof = verifyHostingerStorageRecoveryEvidence({
  checkpoint,
  verified_at: '2026-08-01T08:15:00.000Z',
  evidence: {
    snapshot_id: 'snapshot-1',
    repository_binding_digest: checkpoint.checkpoint_contract.repository_binding_digest,
    plan_hash: planHash,
    candidate_set_hash: candidateHash,
    repository_check_passed: true,
    backup_completed_at: '2026-08-01T08:05:00.000Z',
    restore_sample: {
      verified: true,
      content_digest: '3'.repeat(64),
      verified_at: '2026-08-01T08:10:00.000Z',
    },
    secrets_included: false,
  },
});
assert.equal(recoveryProof.ready, true);

const subject = buildHostingerStorageAttestationSubject({
  plan,
  authorization: {
    authority_context_hash: authorityHash,
    approval_set_hash: approvalHash,
    capability_envelope_id: 'capability-envelope-1',
    execution_lease_id: 'lease-1',
  },
  toolchain_resolution: toolchainResolution,
  recovery_proof: recoveryProof,
  created_at: '2026-08-01T08:16:00.000Z',
});

assert.equal(subject.ok, true);
assert.equal(subject.payload.plan.plan_hash, planHash);
assert.equal(subject.payload.authorization.authority_context_hash, authorityHash);
assert.equal(subject.payload.recovery.ready, true);
assert.equal(subject.payload.toolchain.selected_tools.attestation.tool_id, 'cosign');
assert.match(subject.subject_digest, /^[0-9a-f]{64}$/);
assert.equal(subject.signing_allowed, false);
assert.equal(subject.dispatch_allowed, false);
assert.deepEqual(subject.blockers, ['STORAGE_DISPATCH_DISABLED']);
assert.equal(subject.secrets_included, false);

const verificationPolicy = {
  allowed_signer_patterns: ['https://github.com/mad4bdigital-ai/*'],
  allowed_issuers: ['https://token.actions.githubusercontent.com'],
  transparency_log_required: true,
  max_age_minutes: 15,
};

const verified = verifyHostingerStorageAttestationEvidence({
  subject,
  now: '2026-08-01T08:25:00.000Z',
  policy: verificationPolicy,
  verification: {
    verified: true,
    subject_digest: subject.subject_digest,
    signer_identity: 'https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/.github/workflows/storage.yml@refs/heads/main',
    issuer: 'https://token.actions.githubusercontent.com',
    bundle_ref: 'attestations/hostinger-storage/bundle-1.json',
    transparency_log_verified: true,
    verified_at: '2026-08-01T08:20:00.000Z',
    secrets_included: false,
  },
});

assert.equal(verified.ok, true);
assert.equal(verified.ready, true);
assert.deepEqual(verified.blockers, []);
assert.equal(verified.authority_granted, false);
assert.equal(verified.dispatch_allowed, false);
assert.match(verified.evidence_digest, /^[0-9a-f]{64}$/);

const rejected = verifyHostingerStorageAttestationEvidence({
  subject,
  now: '2026-08-01T09:00:00.000Z',
  policy: verificationPolicy,
  verification: {
    verified: true,
    subject_digest: '0'.repeat(64),
    signer_identity: 'https://example.invalid/unauthorized',
    issuer: 'https://example.invalid',
    bundle_ref: 'attestations/hostinger-storage/bundle-2.json',
    transparency_log_verified: false,
    verified_at: '2026-08-01T08:00:00.000Z',
    secrets_included: false,
  },
});
assert.equal(rejected.ready, false);
assert(rejected.blockers.includes('STORAGE_ATTESTATION_SUBJECT_MISMATCH'));
assert(rejected.blockers.includes('STORAGE_ATTESTATION_SIGNER_FORBIDDEN'));
assert(rejected.blockers.includes('STORAGE_ATTESTATION_ISSUER_FORBIDDEN'));
assert(rejected.blockers.includes('STORAGE_ATTESTATION_TRANSPARENCY_LOG_REQUIRED'));
assert(rejected.blockers.includes('STORAGE_ATTESTATION_STALE'));

const tamperedSubject = structuredClone(subject);
tamperedSubject.payload.plan.plan_hash = '9'.repeat(64);
assert.throws(
  () => verifyHostingerStorageAttestationEvidence({ subject: tamperedSubject, verification: {}, policy: verificationPolicy, now: '2026-08-01T08:25:00.000Z' }),
  (error) => error.code === 'STORAGE_PLAN_TAMPERED',
);

const nativeDecision = {
  allow: false,
  blockers: ['STORAGE_APPROVALS_MISSING'],
  policy_revision: 'policy-r1',
};
const parity = evaluateHostingerStoragePolicyParity({
  native_decision: nativeDecision,
  shadow_decision: structuredClone(nativeDecision),
  policy_revision: 'policy-r1',
});
assert.equal(parity.parity, true);
assert.equal(parity.activation_allowed, false);
assert.deepEqual(parity.blockers, ['STORAGE_OPA_SHADOW_NOT_ACTIVATED']);

const mismatch = evaluateHostingerStoragePolicyParity({
  native_decision: nativeDecision,
  shadow_decision: { ...nativeDecision, allow: true },
  policy_revision: 'policy-r1',
});
assert.equal(mismatch.parity, false);
assert.deepEqual(mismatch.blockers, ['STORAGE_OPA_SHADOW_PARITY_MISMATCH']);

const requiredAttributes = policy.tools.opentelemetry.required_attributes;
const telemetry = buildHostingerStorageTelemetryEnvelope({
  required_attributes: requiredAttributes,
  event_name: 'hostinger.storage.operation.readback',
  observed_at: '2026-08-01T08:30:00.000Z',
  attributes: {
    'operation.id': 'operation-1',
    'operation.key': 'hostinger_storage_apply',
    'tenant.id': 'tenant-1',
    'workspace.id': 'workspace-1',
    'resource.id': 'resource-1',
    'plan.hash': planHash,
    'policy.revision': 'policy-r1',
    'tool.id': 'restic',
    'tool.version': '0.17.3',
    'outcome.classification': 'succeeded',
  },
});
assert.equal(telemetry.ok, true);
assert.equal(telemetry.emit_allowed, false);
assert.equal(telemetry.runtime_wired, false);
assert.deepEqual(telemetry.blockers, ['STORAGE_TELEMETRY_RUNTIME_NOT_WIRED']);
assert.equal(telemetry.envelope.secrets_included, false);

assert.throws(
  () => buildHostingerStorageTelemetryEnvelope({
    required_attributes: [],
    event_name: 'hostinger.storage.invalid',
    observed_at: '2026-08-01T08:30:00.000Z',
    attributes: { file_path: '/home/private' },
  }),
  (error) => error.code === 'STORAGE_ATTESTATION_SECRET_FIELD_REJECTED',
);

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_attestation',
  recovery_bound: true,
  signature_verification_ready: true,
  opa_shadow_activation_allowed: false,
  telemetry_runtime_wired: false,
  dispatch_allowed: false,
  secrets_included: false,
}));
