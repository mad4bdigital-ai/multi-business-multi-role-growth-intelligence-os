import assert from 'node:assert/strict';
import {
  buildHostingerStorageProviderInvocation,
  computeHostingerStorageAuthorityContextHash,
  computeHostingerStorageIdempotencyKey,
  createHostingerStorageOperationEnvelope,
  evaluateHostingerStorageDispatchReadiness,
  projectHostingerStorageEvidence,
  reconcileHostingerStorageOutcome,
} from './hostingerStorageOrchestrator.js';

const now = 2_000_000_000;

const admin = {
  principal_id: 'admin-1',
  principal_type: 'user',
  roles: ['platform_admin'],
};

const tenantOwner = {
  principal_id: 'owner-1',
  principal_type: 'user',
  tenant_id: 'tenant-a',
  workspace_id: 'workspace-a',
  roles: ['workspace_owner'],
};

const platformTarget = {
  target_id: 'target-platform',
  hosting_account_id: 'account-1',
  resource_id: 'auth-mad4b',
  ownership_scope: 'platform',
  account_ownership_scope: 'shared',
  ownership_revision: 'ownership-v1',
  policy_revision: 'policy-v1',
  storage_root_ref: 'root-ref-platform',
};

const tenantTarget = {
  target_id: 'target-tenant-a',
  hosting_account_id: 'account-1',
  resource_id: 'resource-a',
  ownership_scope: 'tenant',
  account_ownership_scope: 'shared',
  tenant_id: 'tenant-a',
  workspace_id: 'workspace-a',
  ownership_revision: 'ownership-v7',
  policy_revision: 'policy-v3',
  storage_root_ref: 'root-ref-tenant-a',
};

const adminContext = { mode: 'admin', resource_id: platformTarget.resource_id };
const tenantContext = {
  mode: 'tenant',
  tenant_id: 'tenant-a',
  workspace_id: 'workspace-a',
  resource_id: 'resource-a',
};

const scanEnvelope = createHostingerStorageOperationEnvelope({
  operation_id: 'op-scan-1',
  actor: admin,
  context: adminContext,
  target: platformTarget,
  request: { operation_key: 'hostinger_storage_scan' },
  created_at_epoch: now,
});
assert.equal(scanEnvelope.allowed, true);
assert.equal(scanEnvelope.operation_key, 'hostinger_storage_scan');
assert.equal(scanEnvelope.provider_adapter.provider_action, 'scan');
assert.equal(scanEnvelope.provider_adapter.freeform_shell_allowed, false);
assert.match(scanEnvelope.authority_context_hash, /^[a-f0-9]{64}$/);
assert.match(scanEnvelope.idempotency_key, /^[a-f0-9]{64}$/);

const repeatedKey = computeHostingerStorageIdempotencyKey({
  operation_key: 'hostinger_storage_scan',
  target: platformTarget,
  request: { operation_key: 'hostinger_storage_scan' },
  authority_context_hash: scanEnvelope.authority_context_hash,
});
assert.equal(repeatedKey, scanEnvelope.idempotency_key);

let readiness = evaluateHostingerStorageDispatchReadiness({
  envelope: scanEnvelope,
  dispatch_certification: {},
  runtime_flags: {},
  now_epoch: now,
});
assert.equal(readiness.allowed, false);
assert(readiness.reason_codes.includes('dispatch_not_certified'));
assert(readiness.reason_codes.includes('runtime_read_dispatch_flag_disabled'));

readiness = evaluateHostingerStorageDispatchReadiness({
  envelope: scanEnvelope,
  dispatch_certification: {
    status: 'certified',
    adapter_key: 'hostinger_ssh_storage_v1',
    host_key_pinned: true,
  },
  runtime_flags: { scan_enabled: true },
  now_epoch: now,
});
assert.equal(readiness.allowed, true);
assert.equal(readiness.ready, true);

let invocation = buildHostingerStorageProviderInvocation({ envelope: scanEnvelope, readiness });
assert.equal(invocation.allowed, true);
assert.equal(invocation.invocation.args.action, 'scan');
assert.equal(invocation.invocation.fixed_script_ref, 'repo:http-generic-api/scripts/hostinger-storage-cleanup.sh');
assert.equal(invocation.invocation.shell_command, null);
assert.equal(invocation.invocation.wildcard_allowed, false);
assert.equal(invocation.invocation.arbitrary_root_allowed, false);

const applyDraft = {
  operation_key: 'hostinger_storage_apply_plan',
  plan_id: 'plan-1',
  plan_hash: 'a'.repeat(64),
  candidate_set_hash: 'b'.repeat(64),
  ownership_revision: tenantTarget.ownership_revision,
  policy_revision: tenantTarget.policy_revision,
  capability_envelope_id: 'cap-1',
  resource_authority_id: 'resource-authority-1',
  execution_lease_id: 'lease-1',
  typed_confirmation: 'APPLY_HOSTINGER_STORAGE_CLEANUP:plan-1:token',
  approval_workspace_ids: ['workspace-a'],
};
const authorityContextHash = computeHostingerStorageAuthorityContextHash({
  actor: tenantOwner,
  context: tenantContext,
  target: tenantTarget,
  request: applyDraft,
});
const applyRequest = { ...applyDraft, authority_context_hash: authorityContextHash };

const applyEnvelope = createHostingerStorageOperationEnvelope({
  operation_id: 'op-apply-1',
  actor: tenantOwner,
  context: tenantContext,
  target: tenantTarget,
  request: applyRequest,
  created_at_epoch: now,
});
assert.equal(applyEnvelope.allowed, true);
assert.equal(applyEnvelope.visibility, 'tenant_redacted_projection');
assert.deepEqual(applyEnvelope.required_workspace_approvals, ['workspace-a']);
assert.equal(applyEnvelope.authority_context_hash, authorityContextHash);

const staleHashEnvelope = createHostingerStorageOperationEnvelope({
  operation_id: 'op-apply-stale',
  actor: tenantOwner,
  context: tenantContext,
  target: tenantTarget,
  request: { ...applyRequest, authority_context_hash: 'c'.repeat(64) },
  created_at_epoch: now,
});
assert.equal(staleHashEnvelope.allowed, false);
assert(staleHashEnvelope.reason_codes.includes('authority_context_hash_mismatch'));

const approvedPlan = {
  status: 'approved',
  plan_id: 'plan-1',
  plan_hash: 'a'.repeat(64),
  candidate_set_hash: 'b'.repeat(64),
  ownership_revision: tenantTarget.ownership_revision,
  policy_revision: tenantTarget.policy_revision,
  expires_at_epoch: now + 3600,
  consumed: false,
};
const validLease = {
  lease_id: 'lease-1',
  operation_id: 'op-apply-1',
  target_id: tenantTarget.target_id,
  expires_at_epoch: now + 600,
};
const certification = {
  status: 'certified',
  adapter_key: 'hostinger_ssh_storage_v1',
  host_key_pinned: true,
};

readiness = evaluateHostingerStorageDispatchReadiness({
  envelope: applyEnvelope,
  plan: approvedPlan,
  approvals: [],
  lease: validLease,
  dispatch_certification: certification,
  runtime_flags: { apply_enabled: true },
  now_epoch: now,
});
assert.equal(readiness.allowed, false);
assert(readiness.reason_codes.includes('required_workspace_approvals_missing'));

readiness = evaluateHostingerStorageDispatchReadiness({
  envelope: applyEnvelope,
  plan: approvedPlan,
  approvals: [{ workspace_id: 'workspace-a', status: 'approved', invalidated: false }],
  lease: validLease,
  dispatch_certification: certification,
  runtime_flags: { apply_enabled: true },
  now_epoch: now,
});
assert.equal(readiness.allowed, true);
assert.equal(readiness.ready, true);

invocation = buildHostingerStorageProviderInvocation({ envelope: applyEnvelope, readiness });
assert.equal(invocation.allowed, true);
assert.equal(invocation.invocation.args.action, 'apply');
assert.equal(invocation.invocation.args.plan_id, 'plan-1');
assert.equal(invocation.invocation.args.expected_plan_hash, 'a'.repeat(64));
assert.equal(invocation.invocation.args.typed_confirmation, applyRequest.typed_confirmation);
assert.equal('credential' in invocation.invocation, false);

const internalEnvelope = createHostingerStorageOperationEnvelope({
  operation_id: 'op-request-approval',
  actor: tenantOwner,
  context: tenantContext,
  target: tenantTarget,
  request: { operation_key: 'hostinger_storage_request_apply' },
  created_at_epoch: now,
});
assert.equal(internalEnvelope.allowed, true);
readiness = evaluateHostingerStorageDispatchReadiness({
  envelope: internalEnvelope,
  dispatch_certification: certification,
  runtime_flags: { scan_enabled: true, plan_enabled: true, apply_enabled: true },
  now_epoch: now,
});
assert.equal(readiness.allowed, false);
assert(readiness.reason_codes.includes('operation_has_no_provider_dispatch'));

const tenantProjection = projectHostingerStorageEvidence({
  context: tenantContext,
  evidence: {
    ok: true,
    operation_id: 'op-scan-tenant',
    operation_key: 'hostinger_storage_scan',
    state: 'completed',
    resource_id: 'resource-a',
    resource_usage_kb: 100,
    resource_inode_count: 12,
    absolute_path: '/home/account/domains/site/public_html',
    ssh_host: 'example.invalid',
    credentials: { password: 'secret' },
    raw_provider_payload: { token: 'secret' },
    candidates: [{
      relative_path: '.npm/_logs/old.log',
      category: 'npm_logs',
      size_bytes: 10,
      still_valid: true,
      absolute_path: '/home/account/.npm/_logs/old.log',
    }],
    secrets_included: true,
  },
});
assert.equal(tenantProjection.tenant_id, 'tenant-a');
assert.equal(tenantProjection.workspace_id, 'workspace-a');
assert.equal(tenantProjection.resource_id, 'resource-a');
assert.equal('absolute_path' in tenantProjection, false);
assert.equal('ssh_host' in tenantProjection, false);
assert.equal('credentials' in tenantProjection, false);
assert.equal('raw_provider_payload' in tenantProjection, false);
assert.equal('absolute_path' in tenantProjection.candidates[0], false);
assert.equal(tenantProjection.secrets_included, false);

const adminProjection = projectHostingerStorageEvidence({
  context: adminContext,
  evidence: {
    ok: true,
    operation_id: 'op-admin-evidence',
    provider_relative_path: 'domains/auth/logs/app.log.1',
    credentials: { password: 'secret' },
    raw_secret_values: ['secret'],
    raw_provider_payload: { token: 'secret' },
    secrets_included: true,
  },
});
assert.equal(adminProjection.provider_relative_path, 'domains/auth/logs/app.log.1');
assert.equal('credentials' in adminProjection, false);
assert.equal('raw_secret_values' in adminProjection, false);
assert.equal('raw_provider_payload' in adminProjection, false);
assert.equal(adminProjection.secrets_included, false);

let reconciliation = reconcileHostingerStorageOutcome({
  plan_items: [{ item_id: 'item-1' }, { item_id: 'item-2' }],
  journal_items: [
    { item_id: 'item-1', result: 'deleted' },
    { item_id: 'item-2', result: 'deleted' },
  ],
  observed_items: [
    { item_id: 'item-1', exists: false },
    { item_id: 'item-2', exists: false },
  ],
});
assert.equal(reconciliation.allowed, true);
assert.equal(reconciliation.outcome, 'applied');
assert.equal(reconciliation.retry_allowed, false);
assert.match(reconciliation.reconciliation_digest, /^[a-f0-9]{64}$/);

reconciliation = reconcileHostingerStorageOutcome({
  plan_items: [{ item_id: 'item-1' }, { item_id: 'item-2' }],
  journal_items: [{ item_id: 'item-1', result: 'deleted' }],
  observed_items: [
    { item_id: 'item-1', exists: false },
    { item_id: 'item-2', exists: true, matches_plan: true },
  ],
});
assert.equal(reconciliation.outcome, 'partially_applied');
assert.equal(reconciliation.retry_allowed, false);

reconciliation = reconcileHostingerStorageOutcome({
  plan_items: [{ item_id: 'item-1' }, { item_id: 'item-2' }],
  journal_items: [],
  observed_items: [
    { item_id: 'item-1', exists: true, matches_plan: true },
    { item_id: 'item-2', exists: true, matches_plan: true },
  ],
});
assert.equal(reconciliation.outcome, 'not_applied');
assert.equal(reconciliation.retry_allowed, true);

reconciliation = reconcileHostingerStorageOutcome({
  plan_items: [{ item_id: 'item-1' }],
  journal_items: [{ item_id: 'item-1', result: 'deleted' }],
  observed_items: [{ item_id: 'item-1', exists: true, matches_plan: true }],
});
assert.equal(reconciliation.outcome, 'conflict');
assert.equal(reconciliation.retry_allowed, false);

console.log('Hostinger storage orchestrator guard passed');
