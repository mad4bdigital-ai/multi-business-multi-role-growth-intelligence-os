#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createMemoryHostingerStorageTenantCanaryAuthorityStore } from './hostingerStorageTenantCanary.js';

const sha = (value) => value.repeat(64);
const store = createMemoryHostingerStorageTenantCanaryAuthorityStore();

const allowlistV1 = {
  allowlist_id: 'allowlist-cas',
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
  max_bytes: 10000,
  evidence_digest: sha('a'),
  secrets_included: false,
};
const registeredAllowlist = store.registerAllowlist(allowlistV1);
assert.equal(registeredAllowlist.authority_generation, 1);

assert.throws(
  () => store.updateAllowlist({
    allowlist_id: allowlistV1.allowlist_id,
    expected_revision: allowlistV1.revision,
    expected_generation: 1,
    record: { ...allowlistV1, status: 'disabled' },
  }),
  (error) => error.code === 'STORAGE_TENANT_CANARY_ALLOWLIST_REVISION_NOT_ADVANCED',
);
assert.deepEqual(store.readAllowlist(allowlistV1.allowlist_id), registeredAllowlist);

const allowlistV2 = store.updateAllowlist({
  allowlist_id: allowlistV1.allowlist_id,
  expected_revision: allowlistV1.revision,
  expected_generation: 1,
  record: { ...allowlistV1, revision: 'allowlist-r2', status: 'disabled', evidence_digest: sha('b') },
});
assert.equal(allowlistV2.revision, 'allowlist-r2');
assert.equal(allowlistV2.authority_generation, 2);

assert.throws(
  () => store.updateAllowlist({
    allowlist_id: allowlistV1.allowlist_id,
    expected_revision: 'allowlist-r2',
    expected_generation: 2,
    record: { ...allowlistV1, revision: 'allowlist-r1', status: 'active' },
  }),
  (error) => error.code === 'STORAGE_TENANT_CANARY_ALLOWLIST_TOKEN_REUSED',
);
assert.throws(
  () => store.updateAllowlist({
    allowlist_id: allowlistV1.allowlist_id,
    expected_revision: 'allowlist-r2',
    expected_generation: 1,
    record: { ...allowlistV1, revision: 'allowlist-r3', evidence_digest: sha('c') },
  }),
  (error) => error.code === 'STORAGE_TENANT_CANARY_ALLOWLIST_GENERATION_CONFLICT',
);
assert.throws(
  () => store.updateAllowlist({
    allowlist_id: allowlistV1.allowlist_id,
    expected_revision: 'allowlist-r1',
    expected_generation: 1,
    record: { ...allowlistV1, revision: 'allowlist-r3', evidence_digest: sha('c') },
  }),
  (error) => error.code === 'STORAGE_TENANT_CANARY_ALLOWLIST_REVISION_CONFLICT',
);
assert.deepEqual(store.readAllowlist(allowlistV1.allowlist_id), allowlistV2);

const approvalV1 = {
  approval_id: 'approval-cas',
  slot: 'workspace_owner:workspace-1',
  status: 'approved',
  tenant_id: 'tenant-1',
  workspace_id: 'workspace-1',
  operation_id: 'operation-1',
  target_id: 'target-1',
  plan_hash: sha('c'),
  authority_context_hash: sha('d'),
  approver_role: 'workspace_owner',
  approved_at_epoch: 1000,
  expires_at_epoch: 1500,
  evidence_digest: sha('e'),
  secrets_included: false,
};
const registeredApproval = store.registerApproval(approvalV1);
assert.equal(registeredApproval.authority_generation, 1);

assert.throws(
  () => store.updateApproval({
    approval_id: approvalV1.approval_id,
    expected_evidence_digest: approvalV1.evidence_digest,
    expected_generation: 1,
    record: { ...approvalV1, status: 'revoked' },
  }),
  (error) => error.code === 'STORAGE_TENANT_CANARY_APPROVAL_EVIDENCE_NOT_ADVANCED',
);
assert.deepEqual(store.readApproval(approvalV1.approval_id), registeredApproval);

const approvalV2 = store.updateApproval({
  approval_id: approvalV1.approval_id,
  expected_evidence_digest: approvalV1.evidence_digest,
  expected_generation: 1,
  record: { ...approvalV1, status: 'revoked', evidence_digest: sha('f') },
});
assert.equal(approvalV2.status, 'revoked');
assert.equal(approvalV2.authority_generation, 2);

assert.throws(
  () => store.updateApproval({
    approval_id: approvalV1.approval_id,
    expected_evidence_digest: sha('f'),
    expected_generation: 2,
    record: { ...approvalV1, status: 'approved', evidence_digest: sha('e') },
  }),
  (error) => error.code === 'STORAGE_TENANT_CANARY_APPROVAL_TOKEN_REUSED',
);
assert.throws(
  () => store.updateApproval({
    approval_id: approvalV1.approval_id,
    expected_evidence_digest: sha('f'),
    expected_generation: 1,
    record: { ...approvalV1, evidence_digest: sha('1') },
  }),
  (error) => error.code === 'STORAGE_TENANT_CANARY_APPROVAL_GENERATION_CONFLICT',
);
assert.throws(
  () => store.updateApproval({
    approval_id: approvalV1.approval_id,
    expected_evidence_digest: approvalV1.evidence_digest,
    expected_generation: 1,
    record: { ...approvalV1, evidence_digest: sha('1') },
  }),
  (error) => error.code === 'STORAGE_TENANT_CANARY_APPROVAL_EVIDENCE_CONFLICT',
);
assert.deepEqual(store.readApproval(approvalV1.approval_id), approvalV2);

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_tenant_canary_authority_cas_v2',
  allowlist_generation_monotonic: true,
  approval_generation_monotonic: true,
  issued_tokens_never_reused: true,
  stale_writers_rejected: true,
  aba_prevented: true,
  synthetic_only: true,
  production_ready: false,
  secrets_included: false,
}));
