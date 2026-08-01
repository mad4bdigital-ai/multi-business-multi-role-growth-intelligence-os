#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildHostingerStorageTenantCanaryAuthorization } from './hostingerStorageTenantCanaryPolicy.js';
import {
  createHostingerStorageTenantCanaryControlPlaneRepository,
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
    repository: createHostingerStorageTenantCanaryControlPlaneRepository({ snapshot: fixture.repository.exportSnapshot() }),
    adapter: createHostingerStorageTenantCanarySyntheticAdapter({ items }),
  };
}

function buildAuthorization(fixture, { allowlist = {}, approval = {}, enablement = {}, now = 1100 } = {}) {
  const operation = fixture.repository.readAggregate(fixture.operation_id).operation;
  const allowlistEntry = {
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
    ...allowlist,
  };
  const workspaceOwnerApproval = {
    approval_id: `approval-${fixture.operation_id}`,
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
    ...approval,
  };
  const manualEnablement = {
    enablement_id: `enablement-${fixture.operation_id}`,
    mode: 'manual_one_shot',
    status: 'enabled',
    tenant_id: operation.tenant_id,
    workspace_id: operation.workspace_id,
    resource_id: operation.resource_id,
    operation_id: operation.operation_id,
    target_id: operation.target_id,
    plan_hash: fixture.protocol.protocol.plan_hash,
    allowlist_revision: allowlistEntry.revision,
    approved_by_role: 'workspace_owner',
    enabled_at_epoch: 1060,
    expires_at_epoch: 1400,
    generation: 1,
    consumed: false,
    evidence_digest: h('c'),
    ...enablement,
  };
  return buildHostingerStorageTenantCanaryAuthorization({
    operation,
    protocol: fixture.protocol.protocol,
    protocol_digest: fixture.protocol.protocol_digest,
    immutable_plan: fixture.plan,
    allowlist_entry: allowlistEntry,
    workspace_owner_approval: workspaceOwnerApproval,
    manual_enablement: manualEnablement,
    now_epoch: now,
  });
}

function prepare(fixture, authorization) {
  const authorityStore = createMemoryHostingerStorageTenantCanaryAuthorityStore();
  const registry = createMemoryHostingerStorageTenantCanaryEnablementRegistry();
  authorityStore.registerAllowlist(authorization.authorization.allowlist);
  authorityStore.registerApproval(authorization.authorization.workspace_owner_approval);
  const enablement = authorization.authorization.manual_enablement;
  registry.register({
    enablement_id: enablement.enablement_id,
    authorization_digest: authorization.authorization_digest,
    operation_id: fixture.operation_id,
    run_id: fixture.run_id,
    generation: enablement.generation,
    expires_at_epoch: enablement.expires_at_epoch,
  });
  return { authorityStore, registry };
}

function execute({ fixture, authorization, authorityStore, registry, repository = fixture.repository, adapter = fixture.adapter, now = 1100 }) {
  return executeHostingerStorageTenantCanary({
    canary_authorization: authorization,
    protocol: fixture.protocol.protocol,
    protocol_digest: fixture.protocol.protocol_digest,
    repository,
    adapter,
    authority_store: authorityStore,
    enablement_registry: registry,
    now_epoch: now,
  });
}

function assertUnconsumedAndUnchanged(fixture, registry) {
  assert.equal(registry.exportState()[0].consumed, false);
  assert.equal(fixture.adapter.exportState().items[0].exists, true);
}

const spoofedAdapterFixture = createSyntheticExecutorFixture({
  run_id: 'tenant-canary-spoofed-adapter-run',
  operation_id: 'tenant-canary-spoofed-adapter-operation',
  plan_id: 'tenant-canary-spoofed-adapter-plan',
  target_id: 'tenant-canary-spoofed-adapter-target',
});
const spoofedAdapterAuthorization = buildAuthorization(spoofedAdapterFixture);
const spoofedAdapterPrepared = prepare(spoofedAdapterFixture, spoofedAdapterAuthorization);
const spoofedAdapter = Object.freeze({ ...spoofedAdapterFixture.adapter });
assert.equal(spoofedAdapter.adapter_key, 'hostinger_storage_synthetic_memory_adapter_v1');
assert.equal(spoofedAdapter.adapter_version, 'spec014-hostinger-storage-synthetic-adapter-v1');
assert.equal(Object.isFrozen(spoofedAdapter), true);
assert.throws(
  () => execute({
    fixture: spoofedAdapterFixture,
    authorization: spoofedAdapterAuthorization,
    ...spoofedAdapterPrepared,
    adapter: spoofedAdapter,
  }),
  (error) => error.code === 'STORAGE_TENANT_CANARY_EXECUTOR_ADAPTER_INVALID',
);
assertUnconsumedAndUnchanged(spoofedAdapterFixture, spoofedAdapterPrepared.registry);

const incompleteRepositoryFixture = createSyntheticExecutorFixture({
  run_id: 'tenant-canary-incomplete-repository-run',
  operation_id: 'tenant-canary-incomplete-repository-operation',
  plan_id: 'tenant-canary-incomplete-repository-plan',
  target_id: 'tenant-canary-incomplete-repository-target',
});
const incompleteRepositoryAuthorization = buildAuthorization(incompleteRepositoryFixture);
const incompleteRepositoryPrepared = prepare(incompleteRepositoryFixture, incompleteRepositoryAuthorization);
const incompleteRepository = {
  production_ready: false,
  readAggregate: (...args) => incompleteRepositoryFixture.repository.readAggregate(...args),
};
assert.throws(
  () => execute({
    fixture: incompleteRepositoryFixture,
    authorization: incompleteRepositoryAuthorization,
    ...incompleteRepositoryPrepared,
    repository: incompleteRepository,
  }),
  (error) => error.code === 'STORAGE_TENANT_CANARY_CONTROL_PLANE_INVALID'
    && error.details?.missing_methods?.includes('transitionOperation')
    && error.details?.missing_methods?.includes('recordReconciliation'),
);
assertUnconsumedAndUnchanged(incompleteRepositoryFixture, incompleteRepositoryPrepared.registry);

const spoofedRepositoryFixture = createSyntheticExecutorFixture({
  run_id: 'tenant-canary-spoofed-repository-run',
  operation_id: 'tenant-canary-spoofed-repository-operation',
  plan_id: 'tenant-canary-spoofed-repository-plan',
  target_id: 'tenant-canary-spoofed-repository-target',
});
const spoofedRepositoryAuthorization = buildAuthorization(spoofedRepositoryFixture);
const spoofedRepositoryPrepared = prepare(spoofedRepositoryFixture, spoofedRepositoryAuthorization);
const spoofedRepository = Object.freeze({
  repository_version: 'spec014-storage-control-plane-repository-v1',
  adapter_key: 'hostinger_storage_memory_test_adapter_v1',
  production_ready: false,
  readAggregate: (...args) => spoofedRepositoryFixture.repository.readAggregate(...args),
  transitionOperation: (...args) => spoofedRepositoryFixture.repository.transitionOperation(...args),
  consumePlan: (...args) => spoofedRepositoryFixture.repository.consumePlan(...args),
  appendJournalEvent: (...args) => spoofedRepositoryFixture.repository.appendJournalEvent(...args),
  recordReconciliation: (...args) => spoofedRepositoryFixture.repository.recordReconciliation(...args),
});
assert.throws(
  () => execute({
    fixture: spoofedRepositoryFixture,
    authorization: spoofedRepositoryAuthorization,
    ...spoofedRepositoryPrepared,
    repository: spoofedRepository,
  }),
  (error) => error.code === 'STORAGE_TENANT_CANARY_CONTROL_PLANE_INVALID'
    && error.details?.repository_provenance === 'tenant_and_control_plane_factory_owned_required',
);
assertUnconsumedAndUnchanged(spoofedRepositoryFixture, spoofedRepositoryPrepared.registry);

const stalePlanFixture = createSyntheticExecutorFixture({
  run_id: 'tenant-canary-stale-plan-authority-run',
  operation_id: 'tenant-canary-stale-plan-authority-operation',
  plan_id: 'tenant-canary-stale-plan-authority-plan',
  target_id: 'tenant-canary-stale-plan-authority-target',
});
const stalePlanAuthorization = buildAuthorization(stalePlanFixture);
const stalePlanPrepared = prepare(stalePlanFixture, stalePlanAuthorization);
const stalePlanSnapshot = structuredClone(stalePlanFixture.repository.exportSnapshot());
const stalePlanRecord = stalePlanSnapshot.state.plans[stalePlanFixture.plan_id];
delete stalePlanRecord.record_digest;
stalePlanRecord.authority_context_hash = h('f');
stalePlanRecord.ownership_revision = 'ownership-stale';
stalePlanRecord.policy_revision = 'policy-stale';
stalePlanRecord.record_digest = digest(stalePlanRecord);
stalePlanSnapshot.state_digest = digest(stalePlanSnapshot.state);
const stalePlanRepository = createHostingerStorageTenantCanaryControlPlaneRepository({ snapshot: stalePlanSnapshot });
assert.throws(
  () => execute({
    fixture: stalePlanFixture,
    authorization: stalePlanAuthorization,
    ...stalePlanPrepared,
    repository: stalePlanRepository,
  }),
  (error) => error.code === 'STORAGE_TENANT_CANARY_EXECUTOR_PLAN_INVALID'
    && error.details?.mismatches?.includes('authority_context_hash')
    && error.details?.mismatches?.includes('ownership_revision')
    && error.details?.mismatches?.includes('policy_revision'),
);
assertUnconsumedAndUnchanged(stalePlanFixture, stalePlanPrepared.registry);

const rollbackFixture = createSyntheticExecutorFixture({
  run_id: 'tenant-canary-clock-rollback-run',
  operation_id: 'tenant-canary-clock-rollback-operation',
  plan_id: 'tenant-canary-clock-rollback-plan',
  target_id: 'tenant-canary-clock-rollback-target',
});
const rollbackAuthorization = buildAuthorization(rollbackFixture, {
  allowlist: { valid_from_epoch: 1050 },
  now: 1100,
});
const rollbackPrepared = prepare(rollbackFixture, rollbackAuthorization);
assert.throws(
  () => execute({
    fixture: rollbackFixture,
    authorization: rollbackAuthorization,
    ...rollbackPrepared,
    now: 1040,
  }),
  (error) => error.code === 'STORAGE_TENANT_CANARY_AUTHORIZATION_INVALID'
    && error.details?.blockers?.includes('STORAGE_TENANT_CANARY_EVALUATION_NOT_STARTED')
    && error.details?.blockers?.includes('STORAGE_TENANT_CANARY_ALLOWLIST_NOT_STARTED')
    && error.details?.blockers?.includes('STORAGE_TENANT_CANARY_APPROVAL_NOT_STARTED')
    && error.details?.blockers?.includes('STORAGE_TENANT_CANARY_ENABLEMENT_NOT_STARTED'),
);
assertUnconsumedAndUnchanged(rollbackFixture, rollbackPrepared.registry);

const abaStore = createMemoryHostingerStorageTenantCanaryAuthorityStore();
const allowlistR1 = {
  allowlist_id: 'allowlist-aba', revision: 'r1', status: 'active', environment: 'synthetic_non_production',
  target_scope: 'tenant_exclusive', tenant_id: 'tenant-1', workspace_id: 'workspace-1', resource_id: 'resource-1',
  target_id: 'target-1', root_ref: 'tenant-roots/tenant-1/workspace-1/resource-1', path_ref_prefix: 'paths/',
  shared_target: false, platform_target: false, valid_from_epoch: 1000, expires_at_epoch: 1500,
  max_items: 5, max_bytes: 10_000, evidence_digest: h('a'), secrets_included: false,
};
const approvalB = {
  approval_id: 'approval-aba', slot: 'workspace_owner:workspace-1', status: 'approved', tenant_id: 'tenant-1',
  workspace_id: 'workspace-1', operation_id: 'operation-1', target_id: 'target-1', plan_hash: h('1'),
  authority_context_hash: h('2'), approver_role: 'workspace_owner', approved_at_epoch: 1050,
  expires_at_epoch: 1450, evidence_digest: h('b'), secrets_included: false,
};
abaStore.registerAllowlist(allowlistR1);
abaStore.registerApproval(approvalB);
abaStore.updateAllowlist({
  allowlist_id: 'allowlist-aba', expected_revision: 'r1',
  record: { ...allowlistR1, revision: 'r2', status: 'disabled', evidence_digest: h('c') },
});
abaStore.updateApproval({
  approval_id: 'approval-aba', expected_evidence_digest: h('b'),
  record: { ...approvalB, status: 'revoked', evidence_digest: h('e') },
});
assert.throws(
  () => abaStore.updateAllowlist({
    allowlist_id: 'allowlist-aba', expected_revision: 'r2',
    record: { ...allowlistR1, revision: 'r1', status: 'active', evidence_digest: h('d') },
  }),
  (error) => error.code === 'STORAGE_TENANT_CANARY_ALLOWLIST_TOKEN_REUSED',
);
assert.throws(
  () => abaStore.updateApproval({
    approval_id: 'approval-aba', expected_evidence_digest: h('e'),
    record: { ...approvalB, status: 'approved', evidence_digest: h('b') },
  }),
  (error) => error.code === 'STORAGE_TENANT_CANARY_APPROVAL_TOKEN_REUSED',
);
assert.equal(abaStore.readAllowlist('allowlist-aba').revision, 'r2');
assert.equal(abaStore.readAllowlist('allowlist-aba').status, 'disabled');
assert.equal(abaStore.readApproval('approval-aba').evidence_digest, h('e'));
assert.equal(abaStore.readApproval('approval-aba').status, 'revoked');

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_tenant_canary_postmerge_hardening',
  tenant_owned_factory_weakset_brand_required: true,
  tenant_owned_repository_weakset_brand_required: true,
  frozen_public_metadata_copy_rejected: true,
  frozen_repository_method_copy_rejected: true,
  full_repository_contract_required_before_consumption: true,
  immutable_plan_authority_revisions_revalidated: true,
  clock_rollback_and_not_before_rejected: true,
  authority_tokens_never_reusable: true,
  one_shot_enablement_preserved_on_preflight_failure: true,
  synthetic_only: true,
  production_ready: false,
  secrets_included: false,
}));