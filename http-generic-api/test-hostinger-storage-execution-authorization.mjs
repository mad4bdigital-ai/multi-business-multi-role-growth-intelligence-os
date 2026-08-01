#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  buildCanonicalHostingerStoragePlanEnvelope,
  buildHostingerStorageExecutionAuthorizationBundle,
  resolveHostingerStorageApprovalSet,
  verifyHostingerStorageExecutionAuthorizationBundle,
} from './hostingerStorageExecutionAuthorizationV2.js';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}
const digest = (value) => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const h = (character) => character.repeat(64);

const itemCore = {
  item_id: 'item-1', ordinal: 0, category: 'npm_cache', path_ref: 'paths/item-1',
  relative_path_digest: h('1'), size_bytes: 1024, device: 7, inode: 42,
  ctime_epoch: 700, mtime_epoch: 700, file_type: 'regular',
  eligibility_rule: 'npm-cache-age-14d', protected: false, secrets_included: false,
};
itemCore.item_hash = digest(itemCore);
const candidateSetHash = digest([{ item_hash: itemCore.item_hash, ordinal: 0, item_id: 'item-1' }]);
const planCore = {
  schema_version: 1,
  envelope_key: 'hostinger_storage_plan_envelope_v1',
  plan_id: 'plan-1', operation_id: 'operation-1', target_id: 'target-1',
  source_snapshot_id: 'snapshot-1', authority_context_hash: h('2'),
  ownership_revision: 'ownership-r1', policy_revision: 'policy-r1', impact_set_hash: h('3'),
  candidate_set_hash: candidateSetHash, item_count: 1, total_bytes: 1024,
  category_totals: [{ category: 'npm_cache', count: 1, bytes: 1024 }],
  created_at_epoch: 800, expires_at_epoch: 1800, items: [itemCore], secrets_included: false,
};
const planHash = digest(planCore);
const plan = {
  ...planCore,
  plan_hash: planHash,
  items: [{
    item_id: 'item-1', ordinal: 0, category: 'npm_cache', path_ref: 'paths/item-1',
    relative_path_digest: h('1'), size_bytes: 1024, device: 7, inode: 42,
    ctime_epoch: 700, mtime_epoch: 700, file_type: 'regular',
    eligibility_rule: 'npm-cache-age-14d', protected: false,
  }],
};

const canonical = buildCanonicalHostingerStoragePlanEnvelope(plan);
assert.equal(canonical.plan_hash, planHash);
assert.equal(canonical.candidate_set_hash, candidateSetHash);

const operationEnvelope = {
  allowed: true,
  operation_id: 'operation-1',
  operation_key: 'hostinger_storage_apply_plan',
  authority_context_hash: h('2'),
  target_binding: { target_id: 'target-1' },
  request_binding: { plan_hash: planHash, candidate_set_hash: candidateSetHash, execution_lease_id: 'lease-1' },
  provider_adapter: { adapter_key: 'hostinger_ssh_storage_v1' },
  authorization: {
    decision: 'allow',
    reason_codes: [],
    visibility: 'tenant_redacted_projection',
    required_workspace_approvals: ['workspace-1'],
    secrets_included: false,
  },
  secrets_included: false,
};
const approval = {
  approval_id: 'approval-1', slot: 'workspace_owner:workspace-1', workspace_id: 'workspace-1',
  status: 'approved', invalidated: false, decided_at_epoch: 850, expires_at_epoch: 1700,
  plan_hash: planHash, candidate_set_hash: candidateSetHash, authority_context_hash: h('2'),
  ownership_revision: 'ownership-r1', policy_revision: 'policy-r1', impact_set_hash: h('3'),
  approver_principal_id: 'principal-1', approver_authority_ref: 'authority/workspace-owner-1',
  evidence_digest: h('4'), secrets_included: false,
};
const approvalSet = resolveHostingerStorageApprovalSet({
  plan_envelope: { envelope: { ...canonical.envelope, plan_hash: canonical.plan_hash } },
  required_slots: ['workspace_owner:workspace-1'],
  approval_records: [approval],
  now_epoch: 1000,
});
assert.equal(approvalSet.ready, true);

const toolchain = {
  toolchain_ready: true, resolution_fingerprint: h('5'), policy_fingerprint: h('6'),
  selections: [
    { capability: 'transport', selected_tool_id: 'openssh', selected: { observed_version: '9.7.0', binary_sha256: h('7') } },
    { capability: 'checkpoint', selected_tool_id: 'restic', selected: { observed_version: '0.17.3', binary_sha256: h('8') } },
    { capability: 'attestation', selected_tool_id: 'cosign', selected: { observed_version: '2.4.1', binary_sha256: h('9') } },
  ],
  secrets_included: false,
};
const approvedTools = [
  { tool_id: 'openssh', version: '9.7.0', binary_sha256: h('7'), release_provenance_digest: h('a'), status: 'approved' },
  { tool_id: 'restic', version: '0.17.3', binary_sha256: h('8'), release_provenance_digest: h('b'), status: 'approved' },
  { tool_id: 'cosign', version: '2.4.1', binary_sha256: h('9'), release_provenance_digest: h('c'), status: 'approved' },
];
const signedSelectedTools = Object.fromEntries(toolchain.selections.map((row) => [row.capability, {
  tool_id: row.selected_tool_id,
  version: row.selected.observed_version,
  binary_sha256: row.selected.binary_sha256,
}]));
const selectedToolsDigest = digest(signedSelectedTools);

const lease = {
  lease_id: 'lease-1', operation_id: 'operation-1', target_id: 'target-1', generation: 2,
  status: 'active', expires_at_epoch: 1600, holder_ref: 'worker/session-1', evidence_digest: h('d'),
};
const recoveryRequirementDigest = h('e');
const recoveryProof = {
  ready: true,
  proof_digest: h('1'),
  proof: {
    plan_id: 'plan-1',
    plan_hash: planHash,
    candidate_set_hash: candidateSetHash,
    snapshot_id: 'recovery-snapshot-1',
    requirement_binding_digest: recoveryRequirementDigest,
  },
};
const attestationVerification = {
  ready: true,
  evidence_digest: h('2'),
  evidence: {
    subject_digest: h('3'),
    operation_id: 'operation-1',
    plan_id: 'plan-1',
    target_id: 'target-1',
    plan_hash: planHash,
    candidate_set_hash: candidateSetHash,
    authority_context_hash: h('2'),
    approval_set_hash: approvalSet.approval_set_hash,
    execution_lease_id: 'lease-1',
    recovery_required: true,
    recovery_proof_digest: recoveryProof.proof_digest,
    recovery_requirement_binding_digest: recoveryRequirementDigest,
    toolchain_resolution_fingerprint: toolchain.resolution_fingerprint,
    toolchain_policy_fingerprint: toolchain.policy_fingerprint,
    toolchain_selected_tools_digest: selectedToolsDigest,
    verified_at: '1970-01-01T00:16:30.000Z',
    secrets_included: false,
  },
};

function buildBundle(overrides = {}) {
  return buildHostingerStorageExecutionAuthorizationBundle({
    operation_envelope: operationEnvelope,
    plan,
    required_approval_slots: ['workspace_owner:workspace-1'],
    approval_records: [approval],
    lease,
    toolchain_resolution: toolchain,
    approved_tools: approvedTools,
    dispatch_certification: {
      certification_id: 'dispatch-cert-1', status: 'certified', adapter_key: 'hostinger_ssh_storage_v1',
      target_id: 'target-1', host_key_revision: 'host-key-r1', host_key_pinned: true,
      worker_image_digest: h('e'), approved_program_digest: h('f'), expires_at_epoch: 1600,
      evidence_digest: h('0'),
    },
    recovery_proof: recoveryProof,
    attestation_verification: attestationVerification,
    risk_profile: 'tenant_high',
    now_epoch: 1000,
    ...overrides,
  });
}

const bundle = buildBundle();
assert.equal(bundle.authorization_ready, true);
assert.equal(bundle.dispatch_allowed, false);
assert.deepEqual(bundle.blockers, ['STORAGE_PROVIDER_DISPATCH_DEFAULT_OFF']);
assert.match(bundle.bundle_hash, /^[0-9a-f]{64}$/);
assert.match(bundle.bundle.governance_decision_digest, /^[0-9a-f]{64}$/);
assert.equal(bundle.bundle.canonical_attestation_binding.operation_id, 'operation-1');
assert.equal(bundle.bundle.canonical_attestation_binding.plan_id, 'plan-1');
assert.equal(bundle.bundle.canonical_attestation_binding.target_id, 'target-1');
assert.equal(bundle.bundle.canonical_attestation_binding.plan_hash, planHash);
assert.equal(bundle.bundle.canonical_attestation_binding.candidate_set_hash, candidateSetHash);
assert.equal(bundle.bundle.canonical_attestation_binding.authority_context_hash, h('2'));
assert.equal(bundle.bundle.canonical_attestation_binding.approval_set_hash, approvalSet.approval_set_hash);
assert.equal(bundle.bundle.canonical_attestation_binding.execution_lease_id, 'lease-1');
assert.equal(bundle.bundle.canonical_attestation_binding.recovery_required, true);
assert.equal(bundle.bundle.canonical_attestation_binding.recovery_proof_digest, recoveryProof.proof_digest);
assert.equal(bundle.bundle.canonical_attestation_binding.recovery_requirement_binding_digest, recoveryRequirementDigest);
assert.equal(bundle.bundle.canonical_attestation_binding.toolchain_resolution_fingerprint, toolchain.resolution_fingerprint);
assert.equal(bundle.bundle.canonical_attestation_binding.toolchain_policy_fingerprint, toolchain.policy_fingerprint);
assert.equal(bundle.bundle.canonical_attestation_binding.toolchain_selected_tools_digest, selectedToolsDigest);
assert.equal(bundle.bundle.canonical_attestation_binding.evidence_digest, h('2'));

const verified = verifyHostingerStorageExecutionAuthorizationBundle({
  authorization: bundle,
  expected_bundle_hash: bundle.bundle_hash,
  current: {
    ownership_revision: 'ownership-r1', policy_revision: 'policy-r1', plan_hash: planHash,
    candidate_set_hash: candidateSetHash, impact_set_hash: h('3'), authority_context_hash: h('2'),
    approval_set_hash: bundle.bundle.approval_set_hash,
    toolchain_provenance_digest: bundle.bundle.toolchain_provenance_digest,
    governance_decision_digest: bundle.bundle.governance_decision_digest,
    attestation_evidence_digest: h('2'),
    recovery_proof_digest: recoveryProof.proof_digest,
    recovery_requirement_binding_digest: recoveryRequirementDigest,
    attestation_toolchain_selected_tools_digest: selectedToolsDigest,
    lease_generation: 2, host_key_revision: 'host-key-r1',
  },
});
assert.equal(verified.valid, true);
assert.equal(verified.dispatch_allowed, false);

const drift = verifyHostingerStorageExecutionAuthorizationBundle({
  authorization: bundle,
  current: {
    governance_decision_digest: h('4'),
    attestation_evidence_digest: h('5'),
    recovery_proof_digest: h('6'),
    recovery_requirement_binding_digest: h('7'),
    attestation_toolchain_selected_tools_digest: h('8'),
    lease_generation: 3,
  },
});
assert.equal(drift.valid, false);
assert(drift.blockers.includes('STORAGE_GOVERNANCE_DECISION_CHANGED'));
assert(drift.blockers.includes('STORAGE_ATTESTATION_EVIDENCE_CHANGED'));
assert(drift.blockers.includes('STORAGE_ATTESTATION_RECOVERY_PROOF_CHANGED'));
assert(drift.blockers.includes('STORAGE_ATTESTATION_RECOVERY_REQUIREMENT_CHANGED'));
assert(drift.blockers.includes('STORAGE_ATTESTATION_TOOLCHAIN_CHANGED'));
assert(drift.blockers.includes('STORAGE_EXECUTION_LEASE_GENERATION_CHANGED'));

assert.throws(
  () => buildBundle({
    attestation_verification: {
      ...attestationVerification,
      evidence: { subject_digest: h('3'), plan_id: 'plan-1', plan_hash: planHash, verified_at: '1970-01-01T00:16:30.000Z' },
    },
  }),
  (error) => error.code === 'STORAGE_ATTESTATION_PLAN_BINDING_REQUIRED'
    && error.details?.missing?.includes('operation_id')
    && error.details?.missing?.includes('target_id')
    && error.details?.missing?.includes('candidate_set_hash')
    && error.details?.missing?.includes('authority_context_hash'),
);

assert.throws(
  () => buildBundle({
    attestation_verification: {
      ...attestationVerification,
      evidence: {
        ...attestationVerification.evidence,
        approval_set_hash: undefined,
        recovery_proof_digest: undefined,
        recovery_requirement_binding_digest: undefined,
        toolchain_resolution_fingerprint: undefined,
        toolchain_policy_fingerprint: undefined,
        toolchain_selected_tools_digest: undefined,
      },
    },
  }),
  (error) => error.code === 'STORAGE_ATTESTATION_AUTHORIZATION_BINDING_REQUIRED'
    && error.details?.missing?.includes('approval_set_hash')
    && error.details?.missing?.includes('recovery_proof_digest')
    && error.details?.missing?.includes('toolchain_selected_tools_digest'),
);

assert.throws(
  () => buildBundle({
    attestation_verification: {
      ...attestationVerification,
      evidence: { ...attestationVerification.evidence, plan_id: 'plan-2' },
    },
  }),
  (error) => error.code === 'STORAGE_ATTESTATION_PLAN_BINDING_MISMATCH'
    && error.details?.mismatches?.includes('plan_id'),
);

assert.throws(
  () => buildBundle({
    attestation_verification: {
      ...attestationVerification,
      evidence: { ...attestationVerification.evidence, execution_lease_id: 'lease-2' },
    },
  }),
  (error) => error.code === 'STORAGE_ATTESTATION_LEASE_BINDING_MISMATCH',
);

for (const [field, value] of [
  ['approval_set_hash', h('0')],
  ['recovery_proof_digest', h('0')],
  ['recovery_requirement_binding_digest', h('0')],
  ['toolchain_resolution_fingerprint', h('0')],
  ['toolchain_policy_fingerprint', h('0')],
  ['toolchain_selected_tools_digest', h('0')],
  ['recovery_required', false],
]) {
  assert.throws(
    () => buildBundle({
      attestation_verification: {
        ...attestationVerification,
        evidence: { ...attestationVerification.evidence, [field]: value },
      },
    }),
    (error) => error.code === 'STORAGE_ATTESTATION_AUTHORIZATION_BINDING_MISMATCH'
      && error.details?.mismatches?.includes(field),
  );
}

assert.throws(
  () => buildBundle({ approval_records: [{ ...approval, evidence_digest: h('5') }] }),
  (error) => error.code === 'STORAGE_ATTESTATION_AUTHORIZATION_BINDING_MISMATCH'
    && error.details?.mismatches?.includes('approval_set_hash'),
);

assert.throws(
  () => buildBundle({
    recovery_proof: { ...recoveryProof, proof_digest: h('5') },
  }),
  (error) => error.code === 'STORAGE_ATTESTATION_AUTHORIZATION_BINDING_MISMATCH'
    && error.details?.mismatches?.includes('recovery_proof_digest'),
);

assert.throws(
  () => buildBundle({
    recovery_proof: {
      ...recoveryProof,
      proof: { ...recoveryProof.proof, requirement_binding_digest: h('5') },
    },
  }),
  (error) => error.code === 'STORAGE_ATTESTATION_AUTHORIZATION_BINDING_MISMATCH'
    && error.details?.mismatches?.includes('recovery_requirement_binding_digest'),
);

assert.throws(
  () => buildBundle({
    toolchain_resolution: { ...toolchain, resolution_fingerprint: h('4') },
  }),
  (error) => error.code === 'STORAGE_ATTESTATION_AUTHORIZATION_BINDING_MISMATCH'
    && error.details?.mismatches?.includes('toolchain_resolution_fingerprint'),
);

assert.throws(
  () => buildHostingerStorageExecutionAuthorizationBundle({
    operation_envelope: { ...operationEnvelope, authorization_header: 'Bearer forbidden' },
    plan,
    risk_profile: 'tenant_high',
  }),
  (error) => error.code === 'STORAGE_EXECUTION_SECRET_FIELD_REJECTED',
);

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_execution_authorization_v2',
  governance_authorization_projected: true,
  secret_bearing_authorization_rejected: true,
  canonical_plan_envelope: true,
  canonical_attestation_plan_and_lease_binding: true,
  canonical_attestation_approval_recovery_toolchain_binding: true,
  attestation_replay_across_authorization_inputs_rejected: true,
  approval_lease_toolchain_recovery_attestation_bound: true,
  dispatch_allowed: false,
  secrets_included: false,
}));
