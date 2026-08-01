#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createMemoryHostingerStorageTenantCanaryAuthorityStore } from './hostingerStorageTenantCanary.js';

const h = (character) => character.repeat(64);

const allowlist = {
  allowlist_id: 'allowlist-token-delegation',
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
  approval_id: 'approval-token-delegation',
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

let revisionReads = 0;
const accessorAllowlist = { ...allowlist, status: 'disabled', evidence_digest: h('c') };
Object.defineProperty(accessorAllowlist, 'revision', {
  enumerable: true,
  configurable: true,
  get() {
    revisionReads += 1;
    return revisionReads === 1 ? 'allowlist-r2' : 'allowlist-r1';
  },
});
assert.throws(
  () => store.updateAllowlist({
    allowlist_id: allowlist.allowlist_id,
    expected_revision: allowlist.revision,
    record: accessorAllowlist,
  }),
  (error) => error.code === 'STORAGE_TENANT_CANARY_AUTHORITY_TOKEN_INPUT_INVALID'
    && error.details?.field === 'revision',
);
assert.equal(revisionReads, 0);
assert.equal(store.readAllowlist(allowlist.allowlist_id).revision, 'allowlist-r1');
assert.equal(store.readAllowlist(allowlist.allowlist_id).status, 'active');

let evidenceReads = 0;
const accessorApproval = { ...approval, status: 'revoked' };
Object.defineProperty(accessorApproval, 'evidence_digest', {
  enumerable: true,
  configurable: true,
  get() {
    evidenceReads += 1;
    return evidenceReads === 1 ? h('e') : h('b');
  },
});
assert.throws(
  () => store.updateApproval({
    approval_id: approval.approval_id,
    expected_evidence_digest: approval.evidence_digest,
    record: accessorApproval,
  }),
  (error) => error.code === 'STORAGE_TENANT_CANARY_AUTHORITY_TOKEN_INPUT_INVALID'
    && error.details?.field === 'evidence_digest',
);
assert.equal(evidenceReads, 0);
assert.equal(store.readApproval(approval.approval_id).evidence_digest, h('b'));
assert.equal(store.readApproval(approval.approval_id).status, 'approved');

assert.throws(
  () => store.updateAllowlist({
    allowlist_id: allowlist.allowlist_id,
    expected_revision: allowlist.revision,
    record: { ...allowlist, revision: { toString: () => 'allowlist-r2' } },
  }),
  (error) => error.code === 'STORAGE_TENANT_CANARY_AUTHORITY_TOKEN_INPUT_INVALID',
);
assert.throws(
  () => store.updateApproval({
    approval_id: approval.approval_id,
    expected_evidence_digest: approval.evidence_digest,
    record: { ...approval, evidence_digest: { toString: () => h('e') } },
  }),
  (error) => error.code === 'STORAGE_TENANT_CANARY_AUTHORITY_TOKEN_INPUT_INVALID',
);

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_tenant_canary_token_delegation',
  token_accessors_rejected_without_read: true,
  coercible_token_objects_rejected: true,
  captured_primitive_tokens_delegated: true,
  authority_state_preserved: true,
  synthetic_only: true,
  production_ready: false,
  secrets_included: false,
}));
