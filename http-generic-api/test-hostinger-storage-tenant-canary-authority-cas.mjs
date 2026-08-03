#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createMemoryHostingerStorageTenantCanaryAuthorityStore } from './hostingerStorageTenantCanary.js';

const h = (character) => character.repeat(64);

const allowlist = {
  allowlist_id: 'allowlist-cas-1',
  revision: 'allowlist-r1',
  status: 'active',
  environment: 'synthetic_non_production',
  target_scope: 'tenant_exclusive',
  tenant_id: 'tenant-1',
  workspace_id: 'workspace-1',
  resource_id: 'resource-1',
  target_id: 'target-1',
  root_ref: 'tenant-roots/tenant-1/workspace-1/resource-1',
  path_ref_prefix: 'paths/',
  shared_target: false,
  platform_target: false,
  valid_from_epoch: 1000,
  expires_at_epoch: 1500,
  max_items: 5,
  max_bytes: 10_000,
  evidence_digest: h('a'),
  secrets_included: false,
};

const approval = {
  approval_id: 'approval-cas-1',
  slot: 'workspace_owner:workspace-1',
  status: 'approved',
  tenant_id: 'tenant-1',
  workspace_id: 'workspace-1',
  operation_id: 'operation-1',
  target_id: 'target-1',
  plan_hash: h('1'),
  authority_context_hash: h('2'),
  approver_role: 'workspace_owner',
  approved_at_epoch: 1050,
  expires_at_epoch: 1450,
  evidence_digest: h('b'),
  secrets_included: false,
};

const store = createMemoryHostingerStorageTenantCanaryAuthorityStore();
store.registerAllowlist(allowlist);
store.registerApproval(approval);

assert.throws(
  () => store.updateAllowlist({
    allowlist_id: allowlist.allowlist_id,
    expected_revision: allowlist.revision,
    record: { ...allowlist, status: 'disabled', evidence_digest: h('c') },
  }),
  (error) => error.code === 'STORAGE_TENANT_CANARY_ALLOWLIST_REVISION_NOT_ADVANCED',
);
assert.equal(store.readAllowlist(allowlist.allowlist_id).status, 'active');
assert.equal(store.readAllowlist(allowlist.allowlist_id).revision, 'allowlist-r1');

store.updateAllowlist({
  allowlist_id: allowlist.allowlist_id,
  expected_revision: allowlist.revision,
  record: { ...allowlist, revision: 'allowlist-r2', status: 'disabled', evidence_digest: h('c') },
});
assert.throws(
  () => store.updateAllowlist({
    allowlist_id: allowlist.allowlist_id,
    expected_revision: allowlist.revision,
    record: { ...allowlist, revision: 'allowlist-r3', status: 'active', evidence_digest: h('d') },
  }),
  (error) => error.code === 'STORAGE_TENANT_CANARY_ALLOWLIST_REVISION_CONFLICT'
    && error.details?.current_revision === 'allowlist-r2',
);
assert.equal(store.readAllowlist(allowlist.allowlist_id).status, 'disabled');
assert.equal(store.readAllowlist(allowlist.allowlist_id).revision, 'allowlist-r2');

assert.throws(
  () => store.updateApproval({
    approval_id: approval.approval_id,
    expected_evidence_digest: approval.evidence_digest,
    record: { ...approval, status: 'revoked' },
  }),
  (error) => error.code === 'STORAGE_TENANT_CANARY_APPROVAL_EVIDENCE_NOT_ADVANCED',
);
assert.equal(store.readApproval(approval.approval_id).status, 'approved');
assert.equal(store.readApproval(approval.approval_id).evidence_digest, h('b'));

store.updateApproval({
  approval_id: approval.approval_id,
  expected_evidence_digest: approval.evidence_digest,
  record: { ...approval, status: 'revoked', evidence_digest: h('e') },
});
assert.throws(
  () => store.updateApproval({
    approval_id: approval.approval_id,
    expected_evidence_digest: approval.evidence_digest,
    record: { ...approval, status: 'approved', evidence_digest: h('f') },
  }),
  (error) => error.code === 'STORAGE_TENANT_CANARY_APPROVAL_EVIDENCE_CONFLICT',
);
assert.equal(store.readApproval(approval.approval_id).status, 'revoked');
assert.equal(store.readApproval(approval.approval_id).evidence_digest, h('e'));

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_tenant_canary_authority_cas',
  allowlist_revision_must_advance: true,
  approval_evidence_must_advance: true,
  stale_allowlist_writer_rejected: true,
  stale_approval_writer_rejected: true,
  synthetic_only: true,
  production_ready: false,
  secrets_included: false,
}));
