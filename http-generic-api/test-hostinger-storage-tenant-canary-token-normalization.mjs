#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createMemoryHostingerStorageTenantCanaryAuthorityStore } from './hostingerStorageTenantCanary.js';

const h = (character) => character.repeat(64);
const revisionR1 = 'r'.repeat(256);
const revisionR2 = 's'.repeat(256);

const allowlist = {
  allowlist_id: 'allowlist-token-normalization',
  revision: revisionR1,
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
  approval_id: 'approval-token-normalization',
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

store.updateAllowlist({
  allowlist_id: allowlist.allowlist_id,
  expected_revision: revisionR1,
  record: { ...allowlist, revision: revisionR2, status: 'disabled', evidence_digest: h('c') },
});
store.updateApproval({
  approval_id: approval.approval_id,
  expected_evidence_digest: h('b'),
  record: { ...approval, status: 'revoked', evidence_digest: h('e') },
});

assert.throws(
  () => store.updateAllowlist({
    allowlist_id: allowlist.allowlist_id,
    expected_revision: revisionR2,
    record: { ...allowlist, revision: `${revisionR1}-suffix`, status: 'active', evidence_digest: h('d') },
  }),
  (error) => error.code === 'STORAGE_TENANT_CANARY_ALLOWLIST_TOKEN_REUSED'
    && error.details?.rejected_revision === revisionR1,
);
assert.throws(
  () => store.updateApproval({
    approval_id: approval.approval_id,
    expected_evidence_digest: h('e'),
    record: { ...approval, status: 'approved', evidence_digest: `${h('b')}suffix` },
  }),
  (error) => error.code === 'STORAGE_TENANT_CANARY_APPROVAL_TOKEN_REUSED'
    && error.details?.rejected_evidence_digest === h('b'),
);

assert.equal(store.readAllowlist(allowlist.allowlist_id).revision, revisionR2);
assert.equal(store.readAllowlist(allowlist.allowlist_id).status, 'disabled');
assert.equal(store.readApproval(approval.approval_id).evidence_digest, h('e'));
assert.equal(store.readApproval(approval.approval_id).status, 'revoked');

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_tenant_canary_token_normalization',
  allowlist_revision_normalized_before_history_check: true,
  approval_digest_normalized_before_history_check: true,
  valid_token_plus_suffix_rejected: true,
  authority_state_preserved: true,
  synthetic_only: true,
  production_ready: false,
  secrets_included: false,
}));
