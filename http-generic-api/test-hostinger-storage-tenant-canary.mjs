#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildHostingerStorageTenantCanaryAuthorization,
  verifyHostingerStorageTenantCanaryAuthorization,
} from './hostingerStorageTenantCanaryPolicy.js';
import {
  createHostingerStorageTenantCanarySyntheticAdapter,
  createMemoryHostingerStorageTenantCanaryAuthorityStore,
  createMemoryHostingerStorageTenantCanaryEnablementRegistry,
  executeHostingerStorageTenantCanary,
} from './hostingerStorageTenantCanary.js';
import {
  createSyntheticExecutorFixture as createBaseSyntheticExecutorFixture,
  digest,
  h,
} from './test-hostinger-storage-executor-fixtures.mjs';

function createSyntheticExecutorFixture(options = {}) {
  const fixture = createBaseSyntheticExecutorFixture(options);
  const items = fixture.adapter.exportState().items.map((item) => ({
    item_id: item.item_id,
    path_ref: item.path_ref,
    item_hash: item.item_hash,
    metadata: item.metadata,
    exists: item.exists,
    protected: item.protected,
  }));
  return {
    ...fixture,
    adapter: createHostingerStorageTenantCanarySyntheticAdapter({ items }),
  };
}

function canaryInputs(fixture, overrides = {}) {
  const operation = fixture.repository.readAggregate(fixture.operation_id).operation;
  const allowlist = {
    allowlist_id: `allowlist-${fixture.operation_id}`,
    revision: 'allowlist-r1',
    status: 'active',
    environment: 'synthetic_non_production',
    target_scope: 'tenant_exclusive',
    tenant_id: operation.tenant_id,
    workspace_id: operation.workspace_id,
    resource_id: operation.resource_id,
    target_id: operation.target_id,
    root_ref: `tenant-roots/${operation.tenant_id}/${operation.workspace_id}/${operation.resource_id}`,
    path_ref_prefix: 'paths/',
    shared_target: false,
    platform_target: false,
    valid_from_epoch: 1000,
    expires_at_epoch: 1500,
    max_items: 5,
    max_bytes: 10_000,
    evidence_digest: h('a'),
    ...(overrides.allowlist || {}),
  };
  const approval = {
    approval_id: `canary-approval-${fixture.operation_id}`,
    slot: `workspace_owner:${operation.workspace_id}`,
    status: 'approved',
    tenant_id: operation.tenant_id,
    workspace_id: operation.workspace_id,
    operation_id: operation.operation_id,
    target_id: operation.target_id,
    plan_hash: fixture.protocol.protocol.plan_hash,
    authority_context_hash: operation.authority_context_hash,
    approver_role: 'workspace_owner',
    approved_at_epoch: 1050,
    expires_at_epoch: 1450,
    evidence_digest: h('b'),
    ...(overrides.approval || {}),
  };
  const enablement = {
    enablement_id: `enablement-${fixture.operation_id}`,
    mode: 'manual_one_shot',
    status: 'enabled',
    tenant_id: operation.tenant_id,
    workspace_id: operation.workspace_id,
    resource_id: operation.resource_id,
    operation_id: operation.operation_id,
    target_id: operation.target_id,
    plan_hash: fixture.protocol.protocol.plan_hash,
    allowlist_revision: allowlist.revision,
    approved_by_role: 'workspace_owner',
    enabled_at_epoch: 1060,
    expires_at_epoch: 1400,
    generation: 1,
    consumed: false,
    evidence_digest: h('c'),
    ...(overrides.enablement || {}),
  };
  return { operation, allowlist, approval, enablement };
}

function authorize(fixture, overrides = {}, now = 1100) {
  const inputs = canaryInputs(fixture, overrides);
  const protocol = overrides.protocol || fixture.protocol.protocol;
  const protocolDigest = overrides.protocol_digest || fixture.protocol.protocol_digest;
  const authorization = buildHostingerStorageTenantCanaryAuthorization({
    operation: inputs.operation,
    protocol,
    protocol_digest: protocolDigest,
    immutable_plan: fixture.plan,
    allowlist_entry: inputs.allowlist,
    workspace_owner_approval: inputs.approval,
    manual_enablement: inputs.enablement,
    now_epoch: now,
  });
  return { ...inputs, protocol, protocolDigest, authorization };
}

function registerEnablement(registry, fixture, authorization) {
  const enablement = authorization.authorization.manual_enablement;
  registry.register({
    enablement_id: enablement.enablement_id,
    authorization_digest: authorization.authorization_digest,
    operation_id: fixture.operation_id,
    run_id: fixture.run_id,
    generation: enablement.generation,
    expires_at_epoch: enablement.expires_at_epoch,
  });
}

function registerAuthority(store, authorization) {
  store.registerAllowlist(authorization.authorization.allowlist);
  store.registerApproval(authorization.authorization.workspace_owner_approval);
}

function executeCanary({ fixture, authorization, registry, authorityStore, fault = null, now = 1100, protocol = null, protocolDigest = null, adapter = null }) {
  return executeHostingerStorageTenantCanary({
    canary_authorization: authorization,
    protocol: protocol || fixture.protocol.protocol,
    protocol_digest: protocolDigest || fixture.protocol.protocol_digest,
    repository: fixture.repository,
    adapter: adapter || fixture.adapter,
    authority_store: authorityStore,
    enablement_registry: registry,
    fault,
    now_epoch: now,
  });
}

const fixture = createSyntheticExecutorFixture({
  run_id: 'tenant-canary-run-1', operation_id: 'tenant-canary-operation-1', plan_id: 'tenant-canary-plan-1', target_id: 'tenant-canary-target-1',
});
const ready = authorize(fixture);
assert.equal(ready.authorization.canary_ready, true);
assert.deepEqual(ready.authorization.blockers, []);
assert.equal(ready.authorization.authorization.protocol.item_set_digest, ready.authorization.authorization.immutable_plan.item_set_digest);
assert.equal(ready.authorization.dispatch_allowed, false);
assert.equal(ready.authorization.live_provider_allowed, false);
assert.equal(ready.authorization.production_ready, false);
const verified = verifyHostingerStorageTenantCanaryAuthorization({
  authorization: ready.authorization.authorization,
  expected_digest: ready.authorization.authorization_digest,
  now_epoch: 1100,
});
assert.equal(verified.valid, true);

const registry = createMemoryHostingerStorageTenantCanaryEnablementRegistry();
const authorityStore = createMemoryHostingerStorageTenantCanaryAuthorityStore();
registerEnablement(registry, fixture, ready.authorization);
registerAuthority(authorityStore, ready.authorization);
const applied = executeCanary({ fixture, authorization: ready.authorization, registry, authorityStore });
assert.equal(applied.outcome, 'applied');
assert.equal(applied.projection.tenant_id, 'tenant-1');
assert.equal(applied.projection.workspace_id, 'workspace-1');
assert.equal(applied.projection.resource_id, 'resource-1');
assert.equal(applied.projection.tenant_exclusive, true);
assert.equal(applied.projection.manual_enablement_consumed, true);
assert.equal(applied.projection.live_provider_mutated, false);
assert.equal(applied.projection.dispatch_allowed, false);
assert.equal(registry.exportState()[0].consumed, true);
assert.equal(registry.exportState()[0].generation, 2);
assert.throws(
  () => executeCanary({ fixture, authorization: ready.authorization, registry, authorityStore, now: 1110 }),
  (error) => ['STORAGE_TENANT_CANARY_EXECUTOR_OPERATION_STATE_INVALID', 'STORAGE_TENANT_CANARY_ENABLEMENT_GENERATION_MISMATCH', 'STORAGE_TENANT_CANARY_ENABLEMENT_ALREADY_CONSUMED'].includes(error.code),
);

const interruptedFixture = createSyntheticExecutorFixture({
  run_id: 'tenant-canary-run-interrupted', operation_id: 'tenant-canary-operation-interrupted', plan_id: 'tenant-canary-plan-interrupted', target_id: 'tenant-canary-target-interrupted',
});
const interruptedAuthorization = authorize(interruptedFixture).authorization;
const interruptedRegistry = createMemoryHostingerStorageTenantCanaryEnablementRegistry();
const interruptedAuthority = createMemoryHostingerStorageTenantCanaryAuthorityStore();
registerEnablement(interruptedRegistry, interruptedFixture, interruptedAuthorization);
registerAuthority(interruptedAuthority, interruptedAuthorization);
const interrupted = executeCanary({
  fixture: interruptedFixture,
  authorization: interruptedAuthorization,
  registry: interruptedRegistry,
  authorityStore: interruptedAuthority,
  fault: { phase: 'after_prepared', item_id: 'item-1' },
});
assert.equal(interrupted.outcome, 'unknown_outcome');
assert.equal(interrupted.projection.read_before_retry_required, true);
assert.equal(interruptedRegistry.exportState()[0].consumed, true);
assert.equal(interruptedFixture.repository.readAggregate(interruptedFixture.operation_id).operation.state, 'unknown_outcome');

const revokedAllowlistFixture = createSyntheticExecutorFixture({
  run_id: 'tenant-canary-run-allowlist-revoked', operation_id: 'tenant-canary-operation-allowlist-revoked', plan_id: 'tenant-canary-plan-allowlist-revoked', target_id: 'tenant-canary-target-allowlist-revoked',
});
const revokedAllowlistAuthorization = authorize(revokedAllowlistFixture).authorization;
const revokedAllowlistRegistry = createMemoryHostingerStorageTenantCanaryEnablementRegistry();
const revokedAllowlistAuthority = createMemoryHostingerStorageTenantCanaryAuthorityStore();
registerEnablement(revokedAllowlistRegistry, revokedAllowlistFixture, revokedAllowlistAuthorization);
registerAuthority(revokedAllowlistAuthority, revokedAllowlistAuthorization);
const signedAllowlist = revokedAllowlistAuthorization.authorization.allowlist;
revokedAllowlistAuthority.updateAllowlist({
  allowlist_id: signedAllowlist.allowlist_id,
  expected_revision: signedAllowlist.revision,
  record: { ...signedAllowlist, revision: 'allowlist-r2', status: 'disabled', evidence_digest: h('d') },
});
assert.throws(
  () => executeCanary({ fixture: revokedAllowlistFixture, authorization: revokedAllowlistAuthorization, registry: revokedAllowlistRegistry, authorityStore: revokedAllowlistAuthority }),
  (error) => error.code === 'STORAGE_TENANT_CANARY_ALLOWLIST_CURRENT_STATE_INVALID'
    && error.details?.mismatches?.includes('revision') && error.details?.mismatches?.includes('status') && error.details?.mismatches?.includes('evidence_digest'),
);
assert.equal(revokedAllowlistRegistry.exportState()[0].consumed, false);
assert.equal(revokedAllowlistFixture.adapter.exportState().items[0].exists, true);

const revokedApprovalFixture = createSyntheticExecutorFixture({
  run_id: 'tenant-canary-run-approval-revoked', operation_id: 'tenant-canary-operation-approval-revoked', plan_id: 'tenant-canary-plan-approval-revoked', target_id: 'tenant-canary-target-approval-revoked',
});
const revokedApprovalAuthorization = authorize(revokedApprovalFixture).authorization;
const revokedApprovalRegistry = createMemoryHostingerStorageTenantCanaryEnablementRegistry();
const revokedApprovalAuthority = createMemoryHostingerStorageTenantCanaryAuthorityStore();
registerEnablement(revokedApprovalRegistry, revokedApprovalFixture, revokedApprovalAuthorization);
registerAuthority(revokedApprovalAuthority, revokedApprovalAuthorization);
const signedApproval = revokedApprovalAuthorization.authorization.workspace_owner_approval;
revokedApprovalAuthority.updateApproval({
  approval_id: signedApproval.approval_id,
  expected_evidence_digest: signedApproval.evidence_digest,
  record: { ...signedApproval, status: 'revoked', evidence_digest: h('e') },
});
assert.throws(
  () => executeCanary({ fixture: revokedApprovalFixture, authorization: revokedApprovalAuthorization, registry: revokedApprovalRegistry, authorityStore: revokedApprovalAuthority }),
  (error) => error.code === 'STORAGE_TENANT_CANARY_APPROVAL_CURRENT_STATE_INVALID'
    && error.details?.mismatches?.includes('status') && error.details?.mismatches?.includes('evidence_digest'),
);
assert.equal(revokedApprovalRegistry.exportState()[0].consumed, false);
assert.equal(revokedApprovalFixture.adapter.exportState().items[0].exists, true);

const crossTenantFixture = createSyntheticExecutorFixture({ run_id: 'tenant-canary-run-cross', operation_id: 'tenant-canary-operation-cross', plan_id: 'tenant-canary-plan-cross', target_id: 'tenant-canary-target-cross' });
const crossTenant = authorize(crossTenantFixture, { allowlist: { tenant_id: 'tenant-other' } }).authorization;
assert.equal(crossTenant.canary_ready, false);
assert(crossTenant.blockers.includes('STORAGE_TENANT_CANARY_ALLOWLIST_TENANT_ID_MISMATCH'));

const sharedFixture = createSyntheticExecutorFixture({ run_id: 'tenant-canary-run-shared', operation_id: 'tenant-canary-operation-shared', plan_id: 'tenant-canary-plan-shared', target_id: 'tenant-canary-target-shared' });
const shared = authorize(sharedFixture, { allowlist: { target_scope: 'shared', shared_target: true } }).authorization;
assert.equal(shared.canary_ready, false);
assert(shared.blockers.includes('STORAGE_TENANT_CANARY_TENANT_EXCLUSIVE_TARGET_REQUIRED'));

const expiredFixture = createSyntheticExecutorFixture({ run_id: 'tenant-canary-run-expired', operation_id: 'tenant-canary-operation-expired', plan_id: 'tenant-canary-plan-expired', target_id: 'tenant-canary-target-expired' });
const expired = authorize(expiredFixture, { allowlist: { expires_at_epoch: 1099 }, enablement: { expires_at_epoch: 1099 } }).authorization;
assert.equal(expired.canary_ready, false);
assert(expired.blockers.includes('STORAGE_TENANT_CANARY_ALLOWLIST_EXPIRED'));
assert(expired.blockers.includes('STORAGE_TENANT_CANARY_ENABLEMENT_EXPIRED'));

const wrongApproverFixture = createSyntheticExecutorFixture({ run_id: 'tenant-canary-run-approver', operation_id: 'tenant-canary-operation-approver', plan_id: 'tenant-canary-plan-approver', target_id: 'tenant-canary-target-approver' });
const wrongApprover = authorize(wrongApproverFixture, { approval: { approver_role: 'workspace_editor' } }).authorization;
assert.equal(wrongApprover.canary_ready, false);
assert(wrongApprover.blockers.includes('STORAGE_TENANT_CANARY_WORKSPACE_OWNER_APPROVAL_REQUIRED'));

const overLimitFixture = createSyntheticExecutorFixture({ run_id: 'tenant-canary-run-limit', operation_id: 'tenant-canary-operation-limit', plan_id: 'tenant-canary-plan-limit', target_id: 'tenant-canary-target-limit' });
const overLimit = authorize(overLimitFixture, { allowlist: { max_bytes: 100 } }).authorization;
assert.equal(overLimit.canary_ready, false);
assert(overLimit.blockers.includes('STORAGE_TENANT_CANARY_BYTE_LIMIT_EXCEEDED'));

const pathBoundaryFixture = createSyntheticExecutorFixture({ run_id: 'tenant-canary-run-path-boundary', operation_id: 'tenant-canary-operation-path-boundary', plan_id: 'tenant-canary-plan-path-boundary', target_id: 'tenant-canary-target-path-boundary' });
const pathBoundary = authorize(pathBoundaryFixture, { allowlist: { path_ref_prefix: 'paths' } }).authorization;
assert.equal(pathBoundary.canary_ready, false);
assert(pathBoundary.blockers.includes('STORAGE_TENANT_CANARY_PATH_PREFIX_BOUNDARY_REQUIRED'));

const pathMismatchFixture = createSyntheticExecutorFixture({ run_id: 'tenant-canary-run-path', operation_id: 'tenant-canary-operation-path', plan_id: 'tenant-canary-plan-path', target_id: 'tenant-canary-target-path' });
const pathMismatch = authorize(pathMismatchFixture, { allowlist: { path_ref_prefix: 'tenant-root/' } }).authorization;
assert.equal(pathMismatch.canary_ready, false);
assert(pathMismatch.blockers.includes('STORAGE_TENANT_CANARY_PATH_PREFIX_MISMATCH'));

const versionFixture = createSyntheticExecutorFixture({ run_id: 'tenant-canary-run-version', operation_id: 'tenant-canary-operation-version', plan_id: 'tenant-canary-plan-version', target_id: 'tenant-canary-target-version' });
const inventedProtocol = structuredClone(versionFixture.protocol.protocol);
inventedProtocol.protocol_version = 'invented-synthetic-v9';
const inventedProtocolDigest = digest(inventedProtocol);
const wrongVersion = authorize(versionFixture, { protocol: inventedProtocol, protocol_digest: inventedProtocolDigest }).authorization;
assert.equal(wrongVersion.canary_ready, false);
assert(wrongVersion.blockers.includes('STORAGE_TENANT_CANARY_PROTOCOL_VERSION_INVALID'));

const emptyFixture = createSyntheticExecutorFixture({ run_id: 'tenant-canary-run-empty', operation_id: 'tenant-canary-operation-empty', plan_id: 'tenant-canary-plan-empty', target_id: 'tenant-canary-target-empty' });
const emptyProtocol = structuredClone(emptyFixture.protocol.protocol);
emptyProtocol.items = [];
const emptyProtocolDigest = digest(emptyProtocol);
const emptyCanary = authorize(emptyFixture, { protocol: emptyProtocol, protocol_digest: emptyProtocolDigest }).authorization;
assert.equal(emptyCanary.canary_ready, false);
assert(emptyCanary.blockers.includes('STORAGE_TENANT_CANARY_ITEMS_REQUIRED'));
assert(emptyCanary.blockers.includes('STORAGE_TENANT_CANARY_CANDIDATE_ITEMS_MISMATCH'));

const substitutedFixture = createSyntheticExecutorFixture({ run_id: 'tenant-canary-run-substituted', operation_id: 'tenant-canary-operation-substituted', plan_id: 'tenant-canary-plan-substituted', target_id: 'tenant-canary-target-substituted' });
const substitutedProtocol = structuredClone(substitutedFixture.protocol.protocol);
substitutedProtocol.items[0].path_ref = 'paths/substituted-item';
substitutedProtocol.items[0].expected.inode = 999;
const substitutedProtocolDigest = digest(substitutedProtocol);
const substitutedCanary = authorize(substitutedFixture, { protocol: substitutedProtocol, protocol_digest: substitutedProtocolDigest }).authorization;
assert.equal(substitutedCanary.canary_ready, false);
assert(substitutedCanary.blockers.includes('STORAGE_TENANT_CANARY_CANDIDATE_ITEMS_MISMATCH'));

const tamperedExecutionFixture = createSyntheticExecutorFixture({ run_id: 'tenant-canary-run-tampered', operation_id: 'tenant-canary-operation-tampered', plan_id: 'tenant-canary-plan-tampered', target_id: 'tenant-canary-target-tampered' });
const tamperedExecutionAuthorization = authorize(tamperedExecutionFixture).authorization;
const tamperedExecutionRegistry = createMemoryHostingerStorageTenantCanaryEnablementRegistry();
const tamperedExecutionAuthority = createMemoryHostingerStorageTenantCanaryAuthorityStore();
registerEnablement(tamperedExecutionRegistry, tamperedExecutionFixture, tamperedExecutionAuthorization);
registerAuthority(tamperedExecutionAuthority, tamperedExecutionAuthorization);
const tamperedAtExecution = structuredClone(tamperedExecutionFixture.protocol.protocol);
tamperedAtExecution.items[0].expected.inode = 1001;
assert.throws(
  () => executeCanary({
    fixture: tamperedExecutionFixture,
    authorization: tamperedExecutionAuthorization,
    registry: tamperedExecutionRegistry,
    authorityStore: tamperedExecutionAuthority,
    protocol: tamperedAtExecution,
    protocolDigest: tamperedExecutionFixture.protocol.protocol_digest,
  }),
  (error) => error.code === 'STORAGE_EXECUTOR_PROTOCOL_TAMPERED',
);
assert.equal(tamperedExecutionRegistry.exportState()[0].consumed, false);
assert.equal(tamperedExecutionFixture.adapter.exportState().items[0].exists, true);

const staleLeaseFixture = createSyntheticExecutorFixture({ run_id: 'tenant-canary-run-stale-lease', operation_id: 'tenant-canary-operation-stale-lease', plan_id: 'tenant-canary-plan-stale-lease', target_id: 'tenant-canary-target-stale-lease' });
const staleLeaseAuthorization = authorize(staleLeaseFixture).authorization;
const staleLeaseRegistry = createMemoryHostingerStorageTenantCanaryEnablementRegistry();
const staleLeaseAuthority = createMemoryHostingerStorageTenantCanaryAuthorityStore();
registerEnablement(staleLeaseRegistry, staleLeaseFixture, staleLeaseAuthorization);
registerAuthority(staleLeaseAuthority, staleLeaseAuthorization);
staleLeaseFixture.repository.renewLease({
  target_id: staleLeaseFixture.target_id,
  lease_id: staleLeaseFixture.lease.lease_id,
  operation_id: staleLeaseFixture.operation_id,
  holder_ref: staleLeaseFixture.lease.holder_ref,
  expected_generation: staleLeaseFixture.lease.generation,
  expires_at_epoch: 1700,
  evidence_digest: h('f'),
  now_epoch: 1050,
});
assert.throws(
  () => executeCanary({ fixture: staleLeaseFixture, authorization: staleLeaseAuthorization, registry: staleLeaseRegistry, authorityStore: staleLeaseAuthority }),
  (error) => error.code === 'STORAGE_TENANT_CANARY_EXECUTOR_LEASE_INVALID' && error.details?.mismatches?.includes('generation'),
);
assert.equal(staleLeaseRegistry.exportState()[0].consumed, false);
assert.equal(staleLeaseFixture.adapter.exportState().items[0].exists, true);

const invalidAdapterFixture = createSyntheticExecutorFixture({ run_id: 'tenant-canary-run-invalid-adapter', operation_id: 'tenant-canary-operation-invalid-adapter', plan_id: 'tenant-canary-plan-invalid-adapter', target_id: 'tenant-canary-target-invalid-adapter' });
const invalidAdapterAuthorization = authorize(invalidAdapterFixture).authorization;
const invalidAdapterRegistry = createMemoryHostingerStorageTenantCanaryEnablementRegistry();
const invalidAdapterAuthority = createMemoryHostingerStorageTenantCanaryAuthorityStore();
registerEnablement(invalidAdapterRegistry, invalidAdapterFixture, invalidAdapterAuthorization);
registerAuthority(invalidAdapterAuthority, invalidAdapterAuthorization);
assert.throws(
  () => executeCanary({
    fixture: invalidAdapterFixture,
    authorization: invalidAdapterAuthorization,
    registry: invalidAdapterRegistry,
    authorityStore: invalidAdapterAuthority,
    adapter: { synthetic_only: false, production_ready: true, live_provider: true },
  }),
  (error) => error.code === 'STORAGE_TENANT_CANARY_EXECUTOR_ADAPTER_INVALID',
);
assert.equal(invalidAdapterRegistry.exportState()[0].consumed, false);
assert.equal(invalidAdapterFixture.adapter.exportState().items[0].exists, true);

const unsafeRegistryFixture = createSyntheticExecutorFixture({ run_id: 'tenant-canary-run-registry', operation_id: 'tenant-canary-operation-registry', plan_id: 'tenant-canary-plan-registry', target_id: 'tenant-canary-target-registry' });
const unsafeRegistryAuthorization = authorize(unsafeRegistryFixture).authorization;
const unsafeRegistryAuthority = createMemoryHostingerStorageTenantCanaryAuthorityStore();
registerAuthority(unsafeRegistryAuthority, unsafeRegistryAuthorization);
assert.throws(
  () => executeHostingerStorageTenantCanary({
    canary_authorization: unsafeRegistryAuthorization,
    protocol: unsafeRegistryFixture.protocol.protocol,
    protocol_digest: unsafeRegistryFixture.protocol.protocol_digest,
    repository: unsafeRegistryFixture.repository,
    adapter: unsafeRegistryFixture.adapter,
    authority_store: unsafeRegistryAuthority,
    enablement_registry: { synthetic_only: false, production_ready: true },
    now_epoch: 1100,
  }),
  (error) => error.code === 'STORAGE_TENANT_CANARY_ENABLEMENT_REGISTRY_INVALID',
);

const unsafeAuthorityFixture = createSyntheticExecutorFixture({ run_id: 'tenant-canary-run-authority', operation_id: 'tenant-canary-operation-authority', plan_id: 'tenant-canary-plan-authority', target_id: 'tenant-canary-target-authority' });
const unsafeAuthorityAuthorization = authorize(unsafeAuthorityFixture).authorization;
const unsafeAuthorityRegistry = createMemoryHostingerStorageTenantCanaryEnablementRegistry();
registerEnablement(unsafeAuthorityRegistry, unsafeAuthorityFixture, unsafeAuthorityAuthorization);
assert.throws(
  () => executeHostingerStorageTenantCanary({
    canary_authorization: unsafeAuthorityAuthorization,
    protocol: unsafeAuthorityFixture.protocol.protocol,
    protocol_digest: unsafeAuthorityFixture.protocol.protocol_digest,
    repository: unsafeAuthorityFixture.repository,
    adapter: unsafeAuthorityFixture.adapter,
    authority_store: { synthetic_only: false, production_ready: true },
    enablement_registry: unsafeAuthorityRegistry,
    now_epoch: 1100,
  }),
  (error) => error.code === 'STORAGE_TENANT_CANARY_AUTHORITY_STORE_INVALID',
);

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_tenant_canary',
  tenant_exclusive_allowlist: true,
  tenant_owned_adapter_factory_brand: true,
  immutable_plan_candidate_items_bound: true,
  executor_preflight_before_enablement_consumption: true,
  current_allowlist_and_approval_revalidated: true,
  revoked_or_stale_inputs_do_not_consume_enablement: true,
  workspace_owner_approval_required: true,
  manual_one_shot_enablement_consumed: true,
  unknown_outcome_consumes_enablement: true,
  protocol_version_and_nonempty_items_required: true,
  path_segment_boundary_required: true,
  cross_tenant_and_shared_targets_rejected: true,
  bounded_items_and_bytes: true,
  synthetic_only: true,
  dispatch_allowed: false,
  live_provider_mutated: false,
  production_ready: false,
  secrets_included: false,
}));