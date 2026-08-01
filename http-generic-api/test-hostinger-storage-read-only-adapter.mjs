#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildHostingerStorageReadOnlyDescriptor,
  evaluateHostingerQuotaEvidence,
  projectHostingerStorageReadOnlyEvidence,
} from './hostingerStorageReadOnlyAdapter.js';

const policy = JSON.parse(fs.readFileSync(new URL('./config/hostinger-storage-cleanup-policy.json', import.meta.url), 'utf8'));
const hash = 'a'.repeat(64);
const fingerprint = `SHA256:${'A'.repeat(43)}`;

const adminContext = {
  mode: 'admin',
  principal_id: 'principal-admin-1',
  authority_context_hash: hash,
};

const tenantContext = {
  mode: 'tenant',
  principal_id: 'principal-tenant-1',
  tenant_id: 'tenant-1',
  workspace_id: 'workspace-1',
  resource_id: 'resource-1',
  authority_context_hash: hash,
};

const tenantTarget = {
  target_id: 'target-1',
  hosting_account_id: 'hostinger-account-1',
  tenant_id: 'tenant-1',
  workspace_id: 'workspace-1',
  resource_id: 'resource-1',
  ownership_scope: 'tenant',
  ownership_mode: 'exclusive',
  ownership_revision: 'ownership-r1',
  policy_revision: 'policy-r1',
  root_ref: 'storage-root:resource-1',
  host_alias: 'hostinger-managed-target-1',
  host_key_fingerprint: fingerprint,
  ssh_config_ref: 'refs/ssh/config/hostinger-1',
  known_hosts_ref: 'refs/ssh/known-hosts/hostinger-1',
  remote_program_ref: 'programs/hostinger-storage-read-only-v1',
};

const descriptor = buildHostingerStorageReadOnlyDescriptor({
  policy,
  context: tenantContext,
  target: tenantTarget,
  operation: 'filesystem_inventory',
  operation_id: 'storage-read-1',
  requested_at: '2026-08-01T08:00:00.000Z',
  limits: { max_records: 5000, timeout_seconds: 180 },
});

assert.equal(descriptor.ok, true);
assert.equal(descriptor.descriptor_type, 'managed_hostinger_read_only_worker_request');
assert.equal(descriptor.execution_class, 'managed_worker_only');
assert.equal(descriptor.executable, 'ssh');
assert.equal(descriptor.shell, false);
assert.equal(descriptor.user_supplied_argv, false);
assert.equal(descriptor.dispatch_allowed, false);
assert.equal(descriptor.authority_granted, false);
assert.equal(descriptor.mutates_target, false);
assert.deepEqual(descriptor.blockers, ['STORAGE_DISPATCH_DISABLED']);
assert.equal(descriptor.stdin_contract.target_binding.root_ref, 'storage-root:resource-1');
assert(descriptor.argv.includes('StrictHostKeyChecking=yes'));
assert(descriptor.argv.includes('ForwardAgent=no'));
assert.equal(descriptor.argv.at(-1), '--read-only-contract-stdin');
assert.equal(descriptor.secrets_included, false);

const repeated = buildHostingerStorageReadOnlyDescriptor({
  policy,
  context: tenantContext,
  target: tenantTarget,
  operation: 'filesystem_inventory',
  operation_id: 'storage-read-1',
  requested_at: '2026-08-01T08:00:00.000Z',
  limits: { timeout_seconds: 180, max_records: 5000 },
});
assert.equal(repeated.descriptor_fingerprint, descriptor.descriptor_fingerprint);

assert.throws(
  () => buildHostingerStorageReadOnlyDescriptor({
    policy,
    context: tenantContext,
    target: tenantTarget,
    operation: 'apply',
    operation_id: 'storage-read-2',
    requested_at: '2026-08-01T08:00:00.000Z',
  }),
  (error) => error.code === 'STORAGE_READ_ONLY_OPERATION_FORBIDDEN',
);

assert.throws(
  () => buildHostingerStorageReadOnlyDescriptor({
    policy,
    context: tenantContext,
    target: { ...tenantTarget, root_path: '/home/example' },
    operation: 'filesystem_inventory',
    operation_id: 'storage-read-3',
    requested_at: '2026-08-01T08:00:00.000Z',
  }),
  (error) => error.code === 'STORAGE_READ_ONLY_FORBIDDEN_INPUT_FIELD',
);

assert.throws(
  () => buildHostingerStorageReadOnlyDescriptor({
    policy,
    context: tenantContext,
    target: { ...tenantTarget, ownership_scope: 'shared', ownership_mode: 'shared' },
    operation: 'quota_snapshot',
    operation_id: 'storage-read-4',
    requested_at: '2026-08-01T08:00:00.000Z',
  }),
  (error) => error.code === 'STORAGE_SHARED_TARGET_TENANT_FORBIDDEN',
);

assert.throws(
  () => buildHostingerStorageReadOnlyDescriptor({
    policy,
    context: tenantContext,
    target: { ...tenantTarget, tenant_id: 'tenant-2' },
    operation: 'quota_snapshot',
    operation_id: 'storage-read-5',
    requested_at: '2026-08-01T08:00:00.000Z',
  }),
  (error) => error.code === 'STORAGE_TARGET_NOT_OWNED',
);

assert.throws(
  () => buildHostingerStorageReadOnlyDescriptor({
    policy,
    context: adminContext,
    target: { ...tenantTarget, host_key_fingerprint: null },
    operation: 'target_probe',
    operation_id: 'storage-read-6',
    requested_at: '2026-08-01T08:00:00.000Z',
  }),
  (error) => error.code === 'STORAGE_HOST_KEY_FINGERPRINT_REQUIRED',
);

const quota = evaluateHostingerQuotaEvidence({
  policy,
  source: 'hpanel_resources_usage',
  observed_at: '2026-08-01T08:00:00.000Z',
  now: '2026-08-01T08:10:00.000Z',
  disk: { limit_bytes: 1000, used_bytes: 810, used_percent: 81 },
  inodes: { limit: 1000, used: 920, used_percent: 92 },
});
assert.equal(quota.fresh, true);
assert.equal(quota.byte_state, 'critical');
assert.equal(quota.inode_state, 'emergency');
assert.equal(quota.effective_state, 'emergency');
assert.deepEqual(quota.blockers, []);

const staleQuota = evaluateHostingerQuotaEvidence({
  policy,
  source: 'hpanel_resources_usage',
  observed_at: '2026-08-01T07:00:00.000Z',
  now: '2026-08-01T08:00:00.000Z',
  disk: { used_percent: 50 },
  inodes: { used_percent: 50 },
});
assert.equal(staleQuota.fresh, false);
assert.deepEqual(staleQuota.blockers, ['STORAGE_QUOTA_EVIDENCE_STALE']);

assert.throws(
  () => evaluateHostingerQuotaEvidence({
    policy,
    source: 'df',
    observed_at: '2026-08-01T08:00:00.000Z',
    now: '2026-08-01T08:01:00.000Z',
  }),
  (error) => error.code === 'STORAGE_QUOTA_EVIDENCE_REQUIRED',
);

const tenantProjection = projectHostingerStorageReadOnlyEvidence({
  context: tenantContext,
  target: tenantTarget,
  quota,
  inventory: {
    observed_at: '2026-08-01T08:09:00.000Z',
    logical_usage_bytes: 800,
    logical_inode_count: 900,
    complete: true,
  },
  layout: {
    certified: true,
    revision: 'layout-r1',
    active_deployment_ref: 'deployment:active-sha',
  },
});
assert.equal(tenantProjection.audience, 'tenant');
assert.equal(tenantProjection.completeness, 'complete');
assert.equal(tenantProjection.layout.active_deployment_ref, null);
assert.equal(Object.hasOwn(tenantProjection, 'host_alias'), false);
assert.equal(Object.hasOwn(tenantProjection, 'root_ref'), false);
assert.equal(tenantProjection.secrets_included, false);

const adminProjection = projectHostingerStorageReadOnlyEvidence({
  context: adminContext,
  target: tenantTarget,
  quota,
  inventory: { complete: false },
  layout: { certified: false },
});
assert.equal(adminProjection.audience, 'admin');
assert.equal(adminProjection.host_alias, tenantTarget.host_alias);
assert.equal(adminProjection.root_ref, tenantTarget.root_ref);
assert.equal(adminProjection.completeness, 'partial');

assert.throws(
  () => projectHostingerStorageReadOnlyEvidence({
    context: tenantContext,
    target: tenantTarget,
    quota,
    inventory: { raw_provider_output: 'forbidden' },
  }),
  (error) => error.code === 'STORAGE_READ_ONLY_FORBIDDEN_INPUT_FIELD',
);

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_read_only_adapter',
  descriptor_operations: 5,
  assertions: 42,
  dispatch_allowed: false,
  provider_write: false,
  secrets_included: false,
}));
