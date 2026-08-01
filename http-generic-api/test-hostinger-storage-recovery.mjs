#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildHostingerStorageRecoveryCheckpoint,
  verifyHostingerStorageRecoveryEvidence,
} from './hostingerStorageRecovery.js';

const policy = JSON.parse(fs.readFileSync(new URL('./config/hostinger-storage-open-source-toolchain.json', import.meta.url), 'utf8'));
const planHash = 'a'.repeat(64);
const resticBinaryHash = 'b'.repeat(64);
const replicaBinaryHash = '9'.repeat(64);

const plan = {
  plan_id: 'plan-1',
  operation_id: 'operation-1',
  target_id: 'target-1',
  plan_hash: planHash,
  candidate_set_hash: 'c'.repeat(64),
  authority_context_hash: 'd'.repeat(64),
  ownership_revision: 'ownership-r1',
  policy_revision: 'policy-r1',
};

const toolchainResolution = {
  selections: [
    {
      capability: 'checkpoint',
      satisfied: true,
      selected_tool_id: 'restic',
      selected: { observed_version: '0.17.3', binary_sha256: resticBinaryHash },
    },
    {
      capability: 'replica_verification',
      satisfied: true,
      selected_tool_id: 'rclone',
      selected: { observed_version: '1.66.0', binary_sha256: replicaBinaryHash },
    },
  ],
};

const repository = {
  repository_ref: 'recovery-repositories/hostinger-primary',
  backend: 's3',
  binding_revision: 'repository-r1',
  retention_policy_revision: 'retention-r1',
  external_to_target: true,
};

const checkpoint = buildHostingerStorageRecoveryCheckpoint({
  policy,
  risk_profile: 'platform_or_shared',
  plan,
  repository,
  toolchain_resolution: toolchainResolution,
  requested_at: '2026-08-01T08:00:00.000Z',
});

assert.equal(checkpoint.ok, true);
assert.equal(checkpoint.checkpoint_required, true);
assert.equal(checkpoint.restore_sample_required, true);
assert.equal(checkpoint.replica_verification_required, true);
assert.equal(checkpoint.checkpoint_contract.checkpoint_tool.tool_id, 'restic');
assert.equal(checkpoint.checkpoint_contract.replica_verification_tool.tool_id, 'rclone');
assert.equal(checkpoint.checkpoint_contract.replica_verification_tool.binary_sha256, replicaBinaryHash);
assert(checkpoint.checkpoint_contract.required_tags.includes(`plan:${planHash}`));
assert.match(checkpoint.requirement_binding_digest, /^[0-9a-f]{64}$/);
assert.equal(checkpoint.dispatch_allowed, false);

const validEvidence = {
  snapshot_id: 'snapshot-1',
  repository_binding_digest: checkpoint.checkpoint_contract.repository_binding_digest,
  plan_hash: plan.plan_hash,
  candidate_set_hash: plan.candidate_set_hash,
  repository_check_passed: true,
  snapshot_tags: checkpoint.checkpoint_contract.required_tags,
  backup_completed_at: '2026-08-01T08:05:00.000Z',
  restore_sample: {
    verified: true,
    content_digest: 'e'.repeat(64),
    verified_at: '2026-08-01T08:10:00.000Z',
  },
  replica: {
    verified: true,
    verification_digest: 'f'.repeat(64),
    tool_id: 'rclone',
    tool_version: '1.66.0',
    tool_binary_sha256: replicaBinaryHash,
  },
  secrets_included: false,
};

const proof = verifyHostingerStorageRecoveryEvidence({
  checkpoint,
  verified_at: '2026-08-01T08:15:00.000Z',
  evidence: validEvidence,
});
assert.equal(proof.ready, true);
assert.deepEqual(proof.blockers, []);
assert.equal(proof.proof.operation_id, plan.operation_id);
assert.equal(proof.proof.plan_id, plan.plan_id);
assert.equal(proof.proof.target_id, plan.target_id);
assert.equal(proof.proof.snapshot_tags_digest.length, 64);
assert.equal(proof.proof.replica_tool_id, 'rclone');
assert.equal(proof.automatic_retry_allowed, false);

const missingTags = verifyHostingerStorageRecoveryEvidence({
  checkpoint,
  verified_at: '2026-08-01T08:15:00.000Z',
  evidence: { ...validEvidence, snapshot_tags: ['operation:unrelated'] },
});
assert.equal(missingTags.ready, false);
assert(missingTags.blockers.includes('STORAGE_RECOVERY_SNAPSHOT_TAGS_MISMATCH'));

const staleBackup = verifyHostingerStorageRecoveryEvidence({
  checkpoint,
  verified_at: '2026-08-01T08:15:00.000Z',
  evidence: { ...validEvidence, backup_completed_at: '2026-07-31T08:05:00.000Z' },
});
assert.equal(staleBackup.ready, false);
assert(staleBackup.blockers.includes('STORAGE_RECOVERY_BACKUP_BEFORE_CHECKPOINT_REQUEST'));

const futureBackup = verifyHostingerStorageRecoveryEvidence({
  checkpoint,
  verified_at: '2026-08-01T08:15:00.000Z',
  evidence: { ...validEvidence, backup_completed_at: '2026-08-01T09:05:00.000Z' },
});
assert.equal(futureBackup.ready, false);
assert(futureBackup.blockers.includes('STORAGE_RECOVERY_BACKUP_AFTER_VERIFICATION'));

const wrongReplicaTool = verifyHostingerStorageRecoveryEvidence({
  checkpoint,
  verified_at: '2026-08-01T08:15:00.000Z',
  evidence: { ...validEvidence, replica: { ...validEvidence.replica, tool_id: 'restic' } },
});
assert.equal(wrongReplicaTool.ready, false);
assert(wrongReplicaTool.blockers.includes('STORAGE_RECOVERY_REPLICA_TOOL_MISMATCH'));

assert.throws(
  () => buildHostingerStorageRecoveryCheckpoint({
    policy,
    risk_profile: 'platform_or_shared',
    plan,
    repository,
    toolchain_resolution: { selections: toolchainResolution.selections.filter((row) => row.capability !== 'replica_verification') },
    requested_at: '2026-08-01T08:00:00.000Z',
  }),
  (error) => error.code === 'STORAGE_RECOVERY_REPLICA_TOOL_REQUIRED',
);

const lowRisk = buildHostingerStorageRecoveryCheckpoint({
  policy,
  risk_profile: 'tenant_low',
  plan,
  repository: {},
  toolchain_resolution: {},
  requested_at: '2026-08-01T08:00:00.000Z',
});
assert.equal(lowRisk.checkpoint_required, false);
const lowRiskProof = verifyHostingerStorageRecoveryEvidence({
  checkpoint: lowRisk,
  evidence: {},
  verified_at: '2026-08-01T08:15:00.000Z',
});
assert.equal(lowRiskProof.ready, true);
assert.equal(lowRiskProof.required, false);

const downgraded = structuredClone(checkpoint);
downgraded.checkpoint_required = false;
assert.throws(
  () => verifyHostingerStorageRecoveryEvidence({ checkpoint: downgraded, evidence: {}, verified_at: '2026-08-01T08:15:00.000Z' }),
  (error) => error.code === 'STORAGE_RECOVERY_REQUIREMENT_TAMPERED',
);

const tamperedRequirement = structuredClone(lowRisk);
tamperedRequirement.requirement_binding.checkpoint_required = true;
assert.throws(
  () => verifyHostingerStorageRecoveryEvidence({ checkpoint: tamperedRequirement, evidence: {}, verified_at: '2026-08-01T08:15:00.000Z' }),
  (error) => error.code === 'STORAGE_RECOVERY_REQUIREMENT_TAMPERED',
);

const authorizationEnvelopeCheckpoint = buildHostingerStorageRecoveryCheckpoint({
  policy,
  risk_profile: 'tenant_high',
  plan: {
    ...plan,
    authorization: { authority_context_hash: plan.authority_context_hash, approval_set_hash: 'e'.repeat(64) },
  },
  repository,
  toolchain_resolution: toolchainResolution,
  requested_at: '2026-08-01T08:00:00.000Z',
});
assert.equal(authorizationEnvelopeCheckpoint.checkpoint_required, true);

assert.throws(
  () => buildHostingerStorageRecoveryCheckpoint({
    policy,
    risk_profile: 'tenant_high',
    plan: { ...plan, authorization: { authority_context_hash: plan.authority_context_hash, token: 'forbidden-token' } },
    repository,
    toolchain_resolution: toolchainResolution,
    requested_at: '2026-08-01T08:00:00.000Z',
  }),
  (error) => error.code === 'STORAGE_RECOVERY_SECRET_FIELD_REJECTED'
    && error.details?.path === 'checkpoint_request.plan.authorization.token',
);

assert.throws(
  () => buildHostingerStorageRecoveryCheckpoint({
    policy,
    risk_profile: 'tenant_high',
    plan,
    repository: { ...repository, external_to_target: false },
    toolchain_resolution: toolchainResolution,
    requested_at: '2026-08-01T08:00:00.000Z',
  }),
  (error) => error.code === 'STORAGE_RECOVERY_EXTERNAL_REPOSITORY_REQUIRED',
);

assert.throws(
  () => buildHostingerStorageRecoveryCheckpoint({
    policy,
    risk_profile: 'tenant_high',
    plan,
    repository: { ...repository, backend: 'local' },
    toolchain_resolution: toolchainResolution,
    requested_at: '2026-08-01T08:00:00.000Z',
  }),
  (error) => error.code === 'STORAGE_RECOVERY_BACKEND_INVALID',
);

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_recovery',
  checkpoint_requirement_bound: true,
  replica_capability_bound: true,
  snapshot_tags_bound: true,
  evidence_time_ordered: true,
  restore_sample_verified: true,
  authorization_envelope_validated: true,
  dispatch_allowed: false,
  secrets_included: false,
}));
