#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  buildCanonicalHostingerStoragePlanEnvelope,
  buildHostingerStorageExecutionAuthorizationBundle,
  resolveHostingerStorageApprovalSet,
  verifyHostingerStorageExecutionAuthorizationBundle,
} from './hostingerStorageExecutionAuthorization.js';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}
function digest(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

const H = {
  path: '1'.repeat(64),
  authority: '2'.repeat(64),
  ownership: 'ownership-r1',
  policy: 'policy-r1',
  impact: '3'.repeat(64),
  leaseEvidence: '4'.repeat(64),
  dispatchEvidence: '5'.repeat(64),
  worker: '6'.repeat(64),
  program: '7'.repeat(64),
  binarySsh: '8'.repeat(64),
  binaryRestic: '9'.repeat(64),
  binaryCosign: 'a'.repeat(64),
  releaseSsh: 'b'.repeat(64),
  releaseRestic: 'c'.repeat(64),
  releaseCosign: 'd'.repeat(64),
  recovery: 'e'.repeat(64),
  attestationSubject: 'f'.repeat(64),
  attestationEvidence: '0'.repeat(64),
  toolResolution: '1'.repeat(64),
  toolPolicy: '2'.repeat(64),
};

const normalizedItem = {
  item_id: 'item-1',
  ordinal: 0,
  category: 'npm_cache',
  path_ref: 'paths/item-1',
  relative_path_digest: H.path,
  size_bytes: 1024,
  device: 7,
  inode: 42,
  ctime_epoch: 700,
  mtime_epoch: 700,
  file_type: 'regular',
  eligibility_rule: 'npm-cache-age-14d',
  protected: false,
  secrets_included: false,
};
normalizedItem.item_hash = digest(normalizedItem);
const candidateSetHash = digest([{ item_hash: normalizedItem.item_hash, ordinal: 0, item_id: 'item-1' }]);
const planCore = {
  schema_version: 1,
  envelope_key: 'hostinger_storage_plan_envelope_v1',
  plan_id: 'plan-1',
  operation_id: 'operation-1',
  target_id: 'target-1',
  source_snapshot_id: 'snapshot-1',
  authority_context_hash: H.authority,
  ownership_revision: H.ownership,
  policy_revision: H.policy,
  impact_set_hash: H.impact,
  candidate_set_hash: candidateSetHash,
  item_count: 1,
  total_bytes: 1024,
  category_totals: [{ category: 'npm_cache', count: 1, bytes: 1024 }],
  created_at_epoch: 800,
  expires_at_epoch: 1800,
  items: [normalizedItem],
  secrets_included: false,
};
const planHash = digest(planCore);
const plan = {
  ...planCore,
  plan_hash: planHash,
  items: [{
    item_id: 'item-1',
    ordinal: 0,
    category: 'npm_cache',
    path_ref: 'paths/item-1',
    relative_path_digest: H.path,
    size_bytes: 1024,
    device: 7,
    inode: 42,
    ctime_epoch: 700,
    mtime_epoch: 700,
    file_type: 'regular',
    eligibility_rule: 'npm-cache-age-14d',
    protected: false,
  }],
};

const canonical = buildCanonicalHostingerStoragePlanEnvelope(plan);
assert.equal(canonical.plan_hash, planHash);
assert.equal(canonical.candidate_set_hash, candidateSetHash);
assert.equal(canonical.envelope.total_bytes, 1024);
assert.equal(canonical.envelope.items[0].item_hash, normalizedItem.item_hash);

const operationEnvelope = {
  allowed: true,
  operation_id: 'operation-1',
  operation_key: 'hostinger_storage_apply_plan',
  authority_context_hash: H.authority,
  target_binding: { target_id: 'target-1' },
  request_binding: {
    plan_hash: planHash,
    candidate_set_hash: candidateSetHash,
    execution_lease_id: 'lease-1',
  },
  provider_adapter: { adapter_key: 'hostinger_ssh_storage_v1' },
  secrets_included: false,
};

const approvalRecord = {
  approval_id: 'approval-1',
  slot: 'workspace_owner:workspace-1',
  workspace_id: 'workspace-1',
  status: 'approved',
  invalidated: false,
  decided_at_epoch: 850,
  expires_at_epoch: 1700,
  plan_hash: planHash,
  candidate_set_hash: candidateSetHash,
  authority_context_hash: H.authority,
  ownership_revision: H.ownership,
  policy_revision: H.policy,
  impact_set_hash: H.impact,
  approver_principal_id: 'principal-1',
  approver_authority_ref: 'authority/workspace-owner-1',
  evidence_digest: '3'.repeat(64),
  secrets_included: false,
};
const approvalSet = resolveHostingerStorageApprovalSet({
  plan_envelope: { envelope: { ...canonical.envelope, plan_hash: planHash } },
  required_slots: ['workspace_owner:workspace-1'],
  approval_records: [approvalRecord],
  now_epoch: 1000,
});
assert.equal(approvalSet.ready, true);
assert.match(approvalSet.approval_set_hash, /^[0-9a-f]{64}$/);

const toolchainResolution = {
  toolchain_ready: true,
  resolution_fingerprint: H.toolResolution,
  policy_fingerprint: H.toolPolicy,
  selections: [
    { capability: 'transport', selected_tool_id: 'openssh', selected: { observed_version: '9.7.0', binary_sha256: H.binarySsh } },
    { capability: 'checkpoint', selected_tool_id: 'restic', selected: { observed_version: '0.17.3', binary_sha256: H.binaryRestic } },
    { capability: 'attestation', selected_tool_id: 'cosign', selected: { observed_version: '2.4.1', binary_sha256: H.binaryCosign } },
  ],
  secrets_included: false,
};
const approvedTools = [
  { tool_id: 'openssh', version: '9.7.0', binary_sha256: H.binarySsh, release_provenance_digest: H.releaseSsh, status: 'approved' },
  { tool_id: 'restic', version: '0.17.3', binary_sha256: H.binaryRestic, release_provenance_digest: H.releaseRestic, status: 'approved' },
  { tool_id: 'cosign', version: '2.4.1', binary_sha256: H.binaryCosign, release_provenance_digest: H.releaseCosign, status: 'approved' },
];

const bundle = buildHostingerStorageExecutionAuthorizationBundle({
  operation_envelope: operationEnvelope,
  plan,
  required_approval_slots: ['workspace_owner:workspace-1'],
  approval_records: [approvalRecord],
  lease: {
    lease_id: 'lease-1',
    operation_id: 'operation-1',
    target_id: 'target-1',
    generation: 2,
    status: 'active',
    expires_at_epoch: 1600,
    holder_ref: 'worker/session-1',
    evidence_digest: H.leaseEvidence,
  },
  toolchain_resolution: toolchainResolution,
  approved_tools: approvedTools,
  dispatch_certification: {
    certification_id: 'dispatch-cert-1',
    status: 'certified',
    adapter_key: 'hostinger_ssh_storage_v1',
    target_id: 'target-1',
    host_key_revision: 'host-key-r1',
    host_key_pinned: true,
    worker_image_digest: H.worker,
    approved_program_digest: H.program,
    expires_at_epoch: 1600,
    evidence_digest: H.dispatchEvidence,
  },
  recovery_proof: {
    ready: true,
    proof_digest: H.recovery,
    proof: {
      plan_id: 'plan-1',
      plan_hash: planHash,
      candidate_set_hash: candidateSetHash,
      snapshot_id: 'recovery-snapshot-1',
    },
  },
  attestation_verification: {
    ready: true,
    evidence_digest: H.attestationEvidence,
    evidence: {
      subject_digest: H.attestationSubject,
      plan_id: 'plan-1',
      plan_hash: planHash,
      verified_at: '1970-01-01T00:16:30.000Z',
    },
  },
  risk_profile: 'tenant_high',
  now_epoch: 1000,
});

assert.equal(bundle.ok, true);
assert.equal(bundle.authorization_ready, true);
assert.equal(bundle.dispatch_allowed, false);
assert.deepEqual(bundle.blockers, ['STORAGE_PROVIDER_DISPATCH_DEFAULT_OFF']);
assert.equal(bundle.bundle.plan_hash, planHash);
assert.equal(bundle.bundle.candidate_set_hash, candidateSetHash);
assert.equal(bundle.bundle.execution_lease.generation, 2);
assert.equal(bundle.bundle.toolchain_provenance.selected_tools.length, 3);
assert.equal(bundle.bundle.recovery.ready, true);
assert.equal(bundle.bundle.attestation.ready, true);
assert.match(bundle.bundle_hash, /^[0-9a-f]{64}$/);

const verified = verifyHostingerStorageExecutionAuthorizationBundle({
  authorization: bundle,
  expected_bundle_hash: bundle.bundle_hash,
  current: {
    ownership_revision: H.ownership,
    policy_revision: H.policy,
    plan_hash: planHash,
    candidate_set_hash: candidateSetHash,
    impact_set_hash: H.impact,
    authority_context_hash: H.authority,
    approval_set_hash: bundle.bundle.approval_set_hash,
    toolchain_provenance_digest: bundle.bundle.toolchain_provenance_digest,
    lease_generation: 2,
    host_key_revision: 'host-key-r1',
  },
});
assert.equal(verified.valid, true);
assert.equal(verified.dispatch_allowed, false);

const drifted = verifyHostingerStorageExecutionAuthorizationBundle({
  authorization: bundle,
  current: { ownership_revision: 'ownership-r2', lease_generation: 3 },
});
assert.equal(drifted.valid, false);
assert(drifted.blockers.includes('STORAGE_OWNERSHIP_REVISION_CHANGED'));
assert(drifted.blockers.includes('STORAGE_EXECUTION_LEASE_GENERATION_CHANGED'));

const missingProvenance = buildHostingerStorageExecutionAuthorizationBundle({
  operation_envelope: operationEnvelope,
  plan,
  required_approval_slots: ['workspace_owner:workspace-1'],
  approval_records: [approvalRecord],
  lease: {
    lease_id: 'lease-1', operation_id: 'operation-1', target_id: 'target-1', generation: 2,
    status: 'active', expires_at_epoch: 1600, holder_ref: 'worker/session-1', evidence_digest: H.leaseEvidence,
  },
  toolchain_resolution: toolchainResolution,
  approved_tools: approvedTools.filter((row) => row.tool_id !== 'restic'),
  dispatch_certification: {
    certification_id: 'dispatch-cert-1', status: 'certified', adapter_key: 'hostinger_ssh_storage_v1',
    target_id: 'target-1', host_key_revision: 'host-key-r1', host_key_pinned: true,
    worker_image_digest: H.worker, approved_program_digest: H.program,
    expires_at_epoch: 1600, evidence_digest: H.dispatchEvidence,
  },
  recovery_proof: { ready: true, proof_digest: H.recovery, proof: { plan_id: 'plan-1', plan_hash: planHash, candidate_set_hash: candidateSetHash, snapshot_id: 'recovery-snapshot-1' } },
  attestation_verification: { ready: true, evidence_digest: H.attestationEvidence, evidence: { subject_digest: H.attestationSubject, plan_id: 'plan-1', plan_hash: planHash, verified_at: '1970-01-01T00:16:30.000Z' } },
  risk_profile: 'tenant_high',
  now_epoch: 1000,
});
assert.equal(missingProvenance.authorization_ready, false);
assert(missingProvenance.blockers.includes('STORAGE_TOOL_BINARY_NOT_APPROVED:restic'));
assert.equal(missingProvenance.dispatch_allowed, false);

const staleApproval = { ...approvalRecord, approval_id: 'approval-2', expires_at_epoch: 999 };
const rejectedApproval = resolveHostingerStorageApprovalSet({
  plan_envelope: { envelope: { ...canonical.envelope, plan_hash: planHash } },
  required_slots: ['workspace_owner:workspace-1'],
  approval_records: [staleApproval],
  now_epoch: 1000,
});
assert.equal(rejectedApproval.ready, false);
assert(rejectedApproval.blockers.includes('STORAGE_APPROVAL_EXPIRED:workspace_owner:workspace-1'));

assert.throws(
  () => buildCanonicalHostingerStoragePlanEnvelope({ ...plan, plan_hash: 'f'.repeat(64) }),
  (error) => error.code === 'STORAGE_PLAN_HASH_MISMATCH',
);

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_execution_authorization',
  canonical_plan_envelope: true,
  approval_binding: true,
  lease_generation_binding: true,
  binary_provenance_binding: true,
  recovery_and_attestation_binding: true,
  dispatch_allowed: false,
  secrets_included: false,
}));
