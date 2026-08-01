#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildHostingerStorageRecoveryCheckpoint,
  verifyHostingerStorageRecoveryEvidence,
} from './hostingerStorageRecovery.js';

const policy = JSON.parse(fs.readFileSync(new URL('./config/hostinger-storage-open-source-toolchain.json', import.meta.url), 'utf8'));
const hash = 'a'.repeat(64);
const binaryHash = 'b'.repeat(64);

const plan = {
  plan_id: 'plan-1',
  operation_id: 'operation-1',
  target_id: 'target-1',
  plan_hash: hash,
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
      selected: {
        observed_version: '0.17.3',
        binary_sha256: binaryHash,
      },
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
assert.equal(checkpoint.dispatch_allowed, false);
assert.equal(checkpoint.authority_granted, false);
assert.deepEqual(checkpoint.blockers, ['STORAGE_DISPATCH_DISABLED']);
assert.equal(checkpoint.checkpoint_contract.checkpoint_tool.tool_id, 'restic');
assert.equal(checkpoint.checkpoint_contract.checkpoint_tool.binary_sha256, binaryHash);
assert(checkpoint.checkpoint_contract.required_tags.includes(`plan:${hash}`));
assert.equal(checkpoint.secrets_included, false);

const proof = verifyHostingerStorageRecoveryEvidence({
  checkpoint,
  verified_at: '2026-08-01T08:15:00.000Z',
  evidence: {
    snapshot_id: 'snapshot-1',
    repository_binding_digest: checkpoint.checkpoint_contract.repository_binding_digest,
    plan_hash: plan.plan_hash,
    candidate_set_hash: plan.candidate_set_hash,
    repository_check_passed: true,
    backup_completed_at: '2026-08-01T08:05:00.000Z',
    restore_sample: {
      verified: true,
      content_digest: 'e'.repeat(64),
      verified_at: '2026-08-01T08:10:00.000Z',
    },
    replica: {
      verified: true,
      verification_digest: 'f'.repeat(64),
    },
    secrets_included: false,
  },
});

assert.equal(proof.ok, true);
assert.equal(proof.required, true);
assert.equal(proof.ready, true);
assert.deepEqual(proof.blockers, []);
assert.equal(proof.proof.snapshot_id, 'snapshot-1');
assert.equal(proof.proof.restore_sample_verified, true);
assert.equal(proof.proof.replica_verified, true);
assert.match(proof.proof_digest, /^[0-9a-f]{64}$/);
assert.equal(proof.automatic_retry_allowed, false);

const incomplete = verifyHostingerStorageRecoveryEvidence({
  checkpoint,
  verified_at: '2026-08-01T08:15:00.000Z',
  evidence: {
    snapshot_id: 'snapshot-1',
    repository_binding_digest: '0'.repeat(64),
    plan_hash: plan.plan_hash,
    candidate_set_hash: plan.candidate_set_hash,
    repository_check_passed: false,
    backup_completed_at: '2026-08-01T08:05:00.000Z',
    restore_sample: { verified: false },
    replica: { verified: false },
    secrets_included: false,
  },
});
assert.equal(incomplete.ready, false);
assert(incomplete.blockers.includes('STORAGE_RECOVERY_REPOSITORY_BINDING_MISMATCH'));
assert(incomplete.blockers.includes('STORAGE_RECOVERY_REPOSITORY_CHECK_REQUIRED'));
assert(incomplete.blockers.includes('STORAGE_RECOVERY_RESTORE_SAMPLE_REQUIRED'));
assert(incomplete.blockers.includes('STORAGE_RECOVERY_REPLICA_VERIFICATION_REQUIRED'));

const lowRisk = buildHostingerStorageRecoveryCheckpoint({
  policy,
  risk_profile: 'tenant_low',
  plan,
  repository: {},
  toolchain_resolution: {},
  requested_at: '2026-08-01T08:00:00.000Z',
});
assert.equal(lowRisk.checkpoint_required, false);
assert.equal(lowRisk.dispatch_allowed, false);

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

assert.throws(
  () => buildHostingerStorageRecoveryCheckpoint({
    policy,
    risk_profile: 'tenant_high',
    plan,
    repository: { ...repository, password: 'forbidden' },
    toolchain_resolution: toolchainResolution,
    requested_at: '2026-08-01T08:00:00.000Z',
  }),
  (error) => error.code === 'STORAGE_RECOVERY_SECRET_FIELD_REJECTED',
);

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_recovery',
  checkpoint_required: true,
  restore_sample_verified: true,
  replica_verified: true,
  dispatch_allowed: false,
  secrets_included: false,
}));
