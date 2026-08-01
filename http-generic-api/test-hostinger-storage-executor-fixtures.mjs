import { createHash } from 'node:crypto';
import { buildHostingerStorageExecutionAuthorizationBundle } from './hostingerStorageExecutionAuthorizationV2.js';
import {
  createHostingerStorageControlPlaneRepository,
  createMemoryHostingerStoragePersistenceAdapter,
} from './hostingerStorageControlPlaneRepository.js';
import { buildHostingerStorageSyntheticExecutionProtocol } from './hostingerStorageExecutorProtocol.js';
import { createHostingerStorageSyntheticAdapter } from './hostingerStorageSyntheticAdapter.js';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}
export const digest = (value) => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
export const h = (character) => character.repeat(64);

export function createSyntheticExecutorFixture({
  run_id = 'run-1',
  operation_id = 'operation-1',
  plan_id = 'plan-1',
  target_id = 'target-1',
  item_metadata = null,
  plan_expires_at_epoch = 1800,
} = {}) {
  const expected = item_metadata || {
    size_bytes: 1024,
    device: 7,
    inode: 42,
    ctime_epoch: 700,
    mtime_epoch: 700,
    file_type: 'regular',
  };
  const itemCore = {
    item_id: 'item-1',
    ordinal: 0,
    category: 'npm_cache',
    path_ref: 'paths/item-1',
    relative_path_digest: h('1'),
    ...expected,
    eligibility_rule: 'npm-cache-age-14d',
    protected: false,
    secrets_included: false,
  };
  itemCore.item_hash = digest(itemCore);
  const candidateSetHash = digest([{ item_hash: itemCore.item_hash, ordinal: 0, item_id: 'item-1' }]);
  const planCore = {
    schema_version: 1,
    envelope_key: 'hostinger_storage_plan_envelope_v1',
    plan_id,
    operation_id,
    target_id,
    source_snapshot_id: 'snapshot-1',
    authority_context_hash: h('2'),
    ownership_revision: 'ownership-r1',
    policy_revision: 'policy-r1',
    impact_set_hash: h('3'),
    candidate_set_hash: candidateSetHash,
    item_count: 1,
    total_bytes: expected.size_bytes,
    category_totals: [{ category: 'npm_cache', count: 1, bytes: expected.size_bytes }],
    created_at_epoch: 800,
    expires_at_epoch: plan_expires_at_epoch,
    items: [itemCore],
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
      relative_path_digest: h('1'),
      ...expected,
      eligibility_rule: 'npm-cache-age-14d',
      protected: false,
    }],
  };
  const operationEnvelope = {
    allowed: true,
    operation_id,
    operation_key: 'hostinger_storage_apply_plan',
    authority_context_hash: h('2'),
    target_binding: { target_id },
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
    approval_id: 'approval-1',
    slot: 'workspace_owner:workspace-1',
    workspace_id: 'workspace-1',
    status: 'approved',
    invalidated: false,
    decided_at_epoch: 850,
    expires_at_epoch: 1700,
    plan_hash: planHash,
    candidate_set_hash: candidateSetHash,
    authority_context_hash: h('2'),
    ownership_revision: 'ownership-r1',
    policy_revision: 'policy-r1',
    impact_set_hash: h('3'),
    approver_principal_id: 'principal-1',
    approver_authority_ref: 'authority/workspace-owner-1',
    evidence_digest: h('4'),
    secrets_included: false,
  };
  const toolchain = {
    toolchain_ready: true,
    resolution_fingerprint: h('5'),
    policy_fingerprint: h('6'),
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

  const persistence = createMemoryHostingerStoragePersistenceAdapter();
  const repository = createHostingerStorageControlPlaneRepository({ adapter: persistence });
  repository.createOperation({
    operation_id,
    operation_key: 'hostinger_storage_apply_plan',
    target_id,
    tenant_id: 'tenant-1',
    workspace_id: 'workspace-1',
    resource_id: 'resource-1',
    context_mode: 'tenant',
    authority_context_hash: h('2'),
    ownership_revision: 'ownership-r1',
    policy_revision: 'policy-r1',
    idempotency_key: h('d'),
    risk_profile: 'tenant_high',
    state: 'lease_acquired',
    version: 1,
    created_at_epoch: 900,
    updated_at_epoch: 900,
    secrets_included: false,
  }, { now_epoch: 900 });
  repository.persistImmutablePlan({
    plan_id,
    operation_id,
    target_id,
    plan_hash: planHash,
    candidate_set_hash: candidateSetHash,
    impact_set_hash: h('3'),
    authority_context_hash: h('2'),
    ownership_revision: 'ownership-r1',
    policy_revision: 'policy-r1',
    source_snapshot_id: 'snapshot-1',
    item_count: 1,
    total_bytes: expected.size_bytes,
    expires_at_epoch: plan_expires_at_epoch,
    status: 'approved',
    consumed: false,
    immutable_envelope_digest: planHash,
    secrets_included: false,
  });
  const lease = repository.acquireLease({
    lease_id: 'lease-1',
    target_id,
    operation_id,
    purpose: 'cleanup_apply',
    holder_ref: 'worker/session-1',
    expires_at_epoch: 1600,
    evidence_digest: h('e'),
  }, { expected_generation: 0, now_epoch: 950 });

  const attestationVerification = {
    ready: true,
    evidence_digest: h('f'),
    evidence: {
      subject_digest: h('0'),
      operation_id,
      plan_id,
      target_id,
      plan_hash: planHash,
      candidate_set_hash: candidateSetHash,
      authority_context_hash: h('2'),
      execution_lease_id: 'lease-1',
      verified_at: '1970-01-01T00:16:30.000Z',
      secrets_included: false,
    },
  };
  const authorization = buildHostingerStorageExecutionAuthorizationBundle({
    operation_envelope: operationEnvelope,
    plan,
    required_approval_slots: ['workspace_owner:workspace-1'],
    approval_records: [approval],
    lease,
    toolchain_resolution: toolchain,
    approved_tools: approvedTools,
    dispatch_certification: {
      certification_id: 'dispatch-cert-1',
      status: 'certified',
      adapter_key: 'hostinger_ssh_storage_v1',
      target_id,
      host_key_revision: 'host-key-r1',
      host_key_pinned: true,
      worker_image_digest: h('1'),
      approved_program_digest: h('2'),
      expires_at_epoch: 1600,
      evidence_digest: h('3'),
    },
    recovery_proof: {
      ready: true,
      proof_digest: h('4'),
      proof: { plan_id, plan_hash: planHash, candidate_set_hash: candidateSetHash, snapshot_id: 'recovery-snapshot-1' },
    },
    attestation_verification: attestationVerification,
    risk_profile: 'tenant_high',
    now_epoch: 1000,
  });
  const currentBindings = {
    ownership_revision: 'ownership-r1',
    policy_revision: 'policy-r1',
    plan_hash: planHash,
    candidate_set_hash: candidateSetHash,
    impact_set_hash: h('3'),
    authority_context_hash: h('2'),
    approval_set_hash: authorization.bundle.approval_set_hash,
    toolchain_provenance_digest: authorization.bundle.toolchain_provenance_digest,
    governance_decision_digest: authorization.bundle.governance_decision_digest,
    attestation_evidence_digest: h('f'),
    lease_generation: lease.generation,
    host_key_revision: 'host-key-r1',
  };
  const protocol = buildHostingerStorageSyntheticExecutionProtocol({
    authorization,
    expected_bundle_hash: authorization.bundle_hash,
    current_bindings: currentBindings,
    plan,
    run_id,
  });
  const adapter = createHostingerStorageSyntheticAdapter({
    items: [{ item_id: 'item-1', path_ref: 'paths/item-1', item_hash: itemCore.item_hash, metadata: expected, exists: true, protected: false }],
  });
  return {
    plan,
    planHash,
    candidateSetHash,
    authorization,
    currentBindings,
    protocol,
    repository,
    persistence,
    adapter,
    lease,
    operation_id,
    run_id,
    plan_id,
    target_id,
    item: protocol.protocol.items[0],
  };
}
