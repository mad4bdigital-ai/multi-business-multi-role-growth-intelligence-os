#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildHostingerStorageSharedCanaryAuthorization,
  verifyHostingerStorageSharedCanaryAuthorization,
  createMemoryHostingerStorageSharedCanaryAuthorityStore,
  createMemoryHostingerStorageSharedCanaryEnablementRegistry,
  executeHostingerStorageSharedCanary,
} from './hostingerStorageSharedCanary.js';
import { createSyntheticExecutorFixture, digest, h } from './test-hostinger-storage-executor-fixtures.mjs';

const productionSha = '1'.repeat(40);

function createAdminRepository(fixture) {
  return new Proxy(fixture.repository, {
    get(target, property) {
      if (property === 'readAggregate') {
        return (operationId) => {
          const aggregate = target.readAggregate(operationId);
          if (aggregate?.operation) aggregate.operation.context_mode = 'admin';
          return aggregate;
        };
      }
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function inputs(fixture, overrides = {}) {
  const repository = createAdminRepository(fixture);
  const current = repository.readAggregate(fixture.operation_id).operation;
  const operation = {
    operation_id: current.operation_id,
    operation_key: current.operation_key,
    context_mode: 'admin',
    target_scope: 'shared',
    target_id: current.target_id,
    authority_context_hash: current.authority_context_hash,
    ownership_revision: current.ownership_revision,
    policy_revision: current.policy_revision,
    ...(overrides.operation || {}),
  };
  const impactSet = {
    impact_set_id: `impact-${fixture.operation_id}`,
    status: 'resolved',
    target_id: fixture.target_id,
    plan_hash: fixture.planHash,
    impact_set_hash: h('3'),
    workspace_ids: ['workspace-1', 'workspace-2'],
    complete: true,
    unknown_count: 0,
    evidence_digest: h('a'),
    ...(overrides.impact_set || {}),
  };
  const baseApproval = {
    status: 'approved',
    target_id: fixture.target_id,
    plan_hash: fixture.planHash,
    impact_set_hash: impactSet.impact_set_hash,
    authority_context_hash: operation.authority_context_hash,
    decided_at_epoch: 1050,
    expires_at_epoch: 1450,
  };
  const platformApproval = {
    ...baseApproval,
    approval_id: `platform-approval-${fixture.operation_id}`,
    slot: 'platform_admin',
    role: 'platform_admin',
    evidence_digest: h('b'),
    ...(overrides.platform_admin_approval || {}),
  };
  const releaseApproval = {
    ...baseApproval,
    approval_id: `release-approval-${fixture.operation_id}`,
    slot: 'release_authority',
    role: 'release_authority',
    active_production_sha: productionSha,
    evidence_digest: h('c'),
    ...(overrides.release_authority_approval || {}),
  };
  const defaultWorkspaceApprovals = impactSet.workspace_ids.map((workspaceId, index) => ({
    ...baseApproval,
    approval_id: `workspace-approval-${index + 1}-${fixture.operation_id}`,
    slot: `workspace_owner:${workspaceId}`,
    role: 'workspace_owner',
    workspace_id: workspaceId,
    evidence_digest: String(index + 4).repeat(64),
  }));
  const workspaceApprovals = overrides.workspace_approvals || defaultWorkspaceApprovals;
  const quorumPolicy = {
    mode: 'all_required',
    minimum_approvals: impactSet.workspace_ids.length,
    release_authority_approved: true,
    ...(overrides.quorum_policy || {}),
  };
  const layout = {
    layout_proof_id: `layout-${fixture.operation_id}`,
    status: 'verified',
    target_id: fixture.target_id,
    layout_revision: 'layout-r1',
    active_production_sha: productionSha,
    active_root_excluded: true,
    rollback_set_retained: true,
    rollback_set_count: 2,
    candidate_roots_certified: true,
    evidence_digest: h('d'),
    ...(overrides.deployment_layout_proof || {}),
  };
  const reserve = {
    certification_id: `reserve-cert-${fixture.operation_id}`,
    status: 'certified',
    target_id: fixture.target_id,
    reserve_ref: `reserves/${fixture.target_id}/emergency-reserve`,
    reserve_fingerprint_digest: h('e'),
    reserve_size_bytes: 2_097_152,
    reserve_file_type: 'regular',
    active_incident_id: `incident-${fixture.operation_id}`,
    release_separate_authorization_required: true,
    evidence_digest: h('f'),
    ...(overrides.reserve_certification || {}),
  };
  const enablement = {
    enablement_id: `shared-enablement-${fixture.operation_id}`,
    mode: 'manual_one_shot',
    status: 'enabled',
    operation_id: fixture.operation_id,
    target_id: fixture.target_id,
    plan_hash: fixture.planHash,
    impact_set_hash: impactSet.impact_set_hash,
    approved_by_role: 'platform_admin',
    generation: 1,
    enabled_at_epoch: 1060,
    expires_at_epoch: 1400,
    consumed: false,
    evidence_digest: h('0'),
    ...(overrides.manual_enablement || {}),
  };
  return { repository, operation, impactSet, platformApproval, releaseApproval, workspaceApprovals, quorumPolicy, layout, reserve, enablement };
}

function authorize(fixture, overrides = {}, now = 1100) {
  const value = inputs(fixture, overrides);
  const protocol = overrides.protocol || fixture.protocol.protocol;
  const protocolDigest = overrides.protocol_digest || fixture.protocol.protocol_digest;
  const authorization = buildHostingerStorageSharedCanaryAuthorization({
    operation: value.operation,
    protocol,
    protocol_digest: protocolDigest,
    immutable_plan: fixture.plan,
    impact_set: value.impactSet,
    platform_admin_approval: value.platformApproval,
    release_authority_approval: value.releaseApproval,
    workspace_approvals: value.workspaceApprovals,
    quorum_policy: value.quorumPolicy,
    deployment_layout_proof: value.layout,
    reserve_certification: value.reserve,
    manual_enablement: value.enablement,
    now_epoch: now,
  });
  return { ...value, protocol, protocolDigest, authorization };
}

function registerAuthority(store, authorization) {
  const signed = authorization.authorization;
  store.registerImpact(signed.impact_set);
  store.registerApproval(signed.platform_admin_approval);
  store.registerApproval(signed.release_authority_approval);
  signed.workspace_approvals.forEach((approval) => store.registerApproval(approval));
  store.registerLayout(signed.deployment_layout_proof);
  store.registerReserve(signed.reserve_certification);
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

function execute({ fixture, prepared, store, registry, protocol = null, protocolDigest = null, adapter = null, now = 1100, fault = null }) {
  return executeHostingerStorageSharedCanary({
    canary_authorization: prepared.authorization,
    protocol: protocol || prepared.protocol,
    protocol_digest: protocolDigest || prepared.protocolDigest,
    repository: prepared.repository,
    adapter: adapter || fixture.adapter,
    authority_store: store,
    enablement_registry: registry,
    now_epoch: now,
    fault,
  });
}

const fixture = createSyntheticExecutorFixture({
  run_id: 'shared-canary-run-1', operation_id: 'shared-canary-operation-1', plan_id: 'shared-canary-plan-1', target_id: 'shared-canary-target-1',
});
const prepared = authorize(fixture);
assert.equal(prepared.authorization.canary_ready, true);
assert.deepEqual(prepared.authorization.blockers, []);
assert.equal(prepared.authorization.authorization.immutable_plan.item_set_digest, prepared.authorization.authorization.protocol.item_set_digest);
assert.equal(prepared.authorization.authorization.impact_set.impact_set_hash, fixture.plan.impact_set_hash);
assert.equal(prepared.authorization.authorization.reserve_release_allowed, false);
const verified = verifyHostingerStorageSharedCanaryAuthorization({
  authorization: prepared.authorization.authorization,
  expected_digest: prepared.authorization.authorization_digest,
  now_epoch: 1100,
});
assert.equal(verified.valid, true);

const store = createMemoryHostingerStorageSharedCanaryAuthorityStore();
const registry = createMemoryHostingerStorageSharedCanaryEnablementRegistry();
registerAuthority(store, prepared.authorization);
registerEnablement(registry, fixture, prepared.authorization);
const applied = execute({ fixture, prepared, store, registry });
assert.equal(applied.outcome, 'applied');
assert.equal(applied.projection.target_scope, 'shared');
assert.equal(applied.projection.impacted_workspace_count, 2);
assert.equal(applied.projection.active_production_sha, productionSha);
assert.equal(applied.projection.reserve_released, false);
assert.equal(applied.projection.live_provider_mutated, false);
assert.equal(registry.exportState()[0].consumed, true);
assert.throws(
  () => execute({ fixture, prepared, store, registry, now: 1110 }),
  (error) => ['STORAGE_SHARED_CANARY_OPERATION_STATE_INVALID', 'STORAGE_SHARED_CANARY_ENABLEMENT_GENERATION_MISMATCH', 'STORAGE_SHARED_CANARY_ENABLEMENT_ALREADY_CONSUMED'].includes(error.code),
);

const missingApprovalFixture = createSyntheticExecutorFixture({ run_id: 'shared-missing-run', operation_id: 'shared-missing-operation', plan_id: 'shared-missing-plan', target_id: 'shared-missing-target' });
const missingApprovalInputs = inputs(missingApprovalFixture);
const missingApproval = authorize(missingApprovalFixture, { workspace_approvals: missingApprovalInputs.workspaceApprovals.slice(0, 1) }).authorization;
assert.equal(missingApproval.canary_ready, false);
assert(missingApproval.blockers.includes('STORAGE_SHARED_CANARY_IMPACT_APPROVALS_MISSING'));

const quorumFixture = createSyntheticExecutorFixture({ run_id: 'shared-quorum-run', operation_id: 'shared-quorum-operation', plan_id: 'shared-quorum-plan', target_id: 'shared-quorum-target' });
const quorumInputs = inputs(quorumFixture);
const quorum = authorize(quorumFixture, {
  workspace_approvals: quorumInputs.workspaceApprovals.slice(0, 1),
  quorum_policy: {
    mode: 'approved_quorum', policy_id: 'quorum-policy-1', policy_revision: 'quorum-r1', status: 'approved',
    minimum_approvals: 1, release_authority_approved: true, evidence_digest: h('9'),
  },
}).authorization;
assert.equal(quorum.canary_ready, true);

const invalidQuorum = authorize(quorumFixture, {
  workspace_approvals: quorumInputs.workspaceApprovals.slice(0, 1),
  quorum_policy: {
    mode: 'approved_quorum', policy_id: 'quorum-policy-1', policy_revision: 'quorum-r1', status: 'approved',
    minimum_approvals: 2, release_authority_approved: false, evidence_digest: h('9'),
  },
}).authorization;
assert.equal(invalidQuorum.canary_ready, false);
assert(invalidQuorum.blockers.includes('STORAGE_SHARED_CANARY_QUORUM_POLICY_INVALID'));

const incompleteImpactFixture = createSyntheticExecutorFixture({ run_id: 'shared-impact-run', operation_id: 'shared-impact-operation', plan_id: 'shared-impact-plan', target_id: 'shared-impact-target' });
const incompleteImpact = authorize(incompleteImpactFixture, { impact_set: { complete: false, unknown_count: 1 } }).authorization;
assert.equal(incompleteImpact.canary_ready, false);
assert(incompleteImpact.blockers.includes('STORAGE_SHARED_CANARY_IMPACT_SET_INCOMPLETE'));

const tenantScopeFixture = createSyntheticExecutorFixture({ run_id: 'shared-scope-run', operation_id: 'shared-scope-operation', plan_id: 'shared-scope-plan', target_id: 'shared-scope-target' });
const tenantScope = authorize(tenantScopeFixture, { operation: { target_scope: 'tenant' } }).authorization;
assert.equal(tenantScope.canary_ready, false);
assert(tenantScope.blockers.includes('STORAGE_SHARED_CANARY_SHARED_OR_PLATFORM_TARGET_REQUIRED'));

const releaseMismatchFixture = createSyntheticExecutorFixture({ run_id: 'shared-release-run', operation_id: 'shared-release-operation', plan_id: 'shared-release-plan', target_id: 'shared-release-target' });
const releaseMismatch = authorize(releaseMismatchFixture, { release_authority_approval: { active_production_sha: '2'.repeat(40) } }).authorization;
assert.equal(releaseMismatch.canary_ready, false);
assert(releaseMismatch.blockers.includes('STORAGE_SHARED_CANARY_RELEASE_AUTHORITY_REQUIRED'));

const layoutFixture = createSyntheticExecutorFixture({ run_id: 'shared-layout-run', operation_id: 'shared-layout-operation', plan_id: 'shared-layout-plan', target_id: 'shared-layout-target' });
const unsafeLayout = authorize(layoutFixture, { deployment_layout_proof: { active_root_excluded: false, rollback_set_retained: false } }).authorization;
assert.equal(unsafeLayout.canary_ready, false);
assert(unsafeLayout.blockers.includes('STORAGE_SHARED_CANARY_DEPLOYMENT_LAYOUT_PROOF_REQUIRED'));

const reserveFixture = createSyntheticExecutorFixture({ run_id: 'shared-reserve-run', operation_id: 'shared-reserve-operation', plan_id: 'shared-reserve-plan', target_id: 'shared-reserve-target' });
assert.throws(
  () => authorize(reserveFixture, { reserve_certification: { reserve_size_bytes: 1024 } }),
  (error) => error.code === 'STORAGE_SHARED_CANARY_INTEGER_INVALID',
);
const unsafeReserve = authorize(reserveFixture, { reserve_certification: { release_separate_authorization_required: false } }).authorization;
assert.equal(unsafeReserve.canary_ready, false);
assert(unsafeReserve.blockers.includes('STORAGE_SHARED_CANARY_RESERVE_CERTIFICATION_REQUIRED'));

const driftFixture = createSyntheticExecutorFixture({ run_id: 'shared-drift-run', operation_id: 'shared-drift-operation', plan_id: 'shared-drift-plan', target_id: 'shared-drift-target' });
const driftPrepared = authorize(driftFixture);
const driftStore = createMemoryHostingerStorageSharedCanaryAuthorityStore();
const driftRegistry = createMemoryHostingerStorageSharedCanaryEnablementRegistry();
registerAuthority(driftStore, driftPrepared.authorization);
registerEnablement(driftRegistry, driftFixture, driftPrepared.authorization);
const signedImpact = driftPrepared.authorization.authorization.impact_set;
driftStore.updateImpact({
  impact_set_id: signedImpact.impact_set_id,
  expected_evidence_digest: signedImpact.evidence_digest,
  record: { ...signedImpact, status: 'revoked', evidence_digest: h('8') },
});
assert.throws(
  () => execute({ fixture: driftFixture, prepared: driftPrepared, store: driftStore, registry: driftRegistry }),
  (error) => error.code === 'STORAGE_SHARED_CANARY_IMPACT_SET_CURRENT_STATE_INVALID',
);
assert.equal(driftRegistry.exportState()[0].consumed, false);
assert.equal(driftFixture.adapter.exportState().items[0].exists, true);

const casFixture = createSyntheticExecutorFixture({ run_id: 'shared-cas-run', operation_id: 'shared-cas-operation', plan_id: 'shared-cas-plan', target_id: 'shared-cas-target' });
const casPrepared = authorize(casFixture);
const casStore = createMemoryHostingerStorageSharedCanaryAuthorityStore();
registerAuthority(casStore, casPrepared.authorization);
const signedPlatform = casPrepared.authorization.authorization.platform_admin_approval;
assert.throws(
  () => casStore.updateApproval({
    approval_id: signedPlatform.approval_id,
    expected_evidence_digest: signedPlatform.evidence_digest,
    record: { ...signedPlatform, status: 'revoked' },
  }),
  (error) => error.code === 'STORAGE_SHARED_CANARY_AUTHORITY_EVIDENCE_NOT_ADVANCED',
);
casStore.updateApproval({
  approval_id: signedPlatform.approval_id,
  expected_evidence_digest: signedPlatform.evidence_digest,
  record: { ...signedPlatform, status: 'revoked', evidence_digest: h('7') },
});
assert.throws(
  () => casStore.updateApproval({
    approval_id: signedPlatform.approval_id,
    expected_evidence_digest: signedPlatform.evidence_digest,
    record: { ...signedPlatform, status: 'approved', evidence_digest: h('6') },
  }),
  (error) => error.code === 'STORAGE_SHARED_CANARY_AUTHORITY_EVIDENCE_CONFLICT',
);

const staleLeaseFixture = createSyntheticExecutorFixture({ run_id: 'shared-lease-run', operation_id: 'shared-lease-operation', plan_id: 'shared-lease-plan', target_id: 'shared-lease-target' });
const staleLeasePrepared = authorize(staleLeaseFixture);
const staleLeaseStore = createMemoryHostingerStorageSharedCanaryAuthorityStore();
const staleLeaseRegistry = createMemoryHostingerStorageSharedCanaryEnablementRegistry();
registerAuthority(staleLeaseStore, staleLeasePrepared.authorization);
registerEnablement(staleLeaseRegistry, staleLeaseFixture, staleLeasePrepared.authorization);
staleLeaseFixture.repository.renewLease({
  target_id: staleLeaseFixture.target_id,
  lease_id: staleLeaseFixture.lease.lease_id,
  operation_id: staleLeaseFixture.operation_id,
  holder_ref: staleLeaseFixture.lease.holder_ref,
  expected_generation: staleLeaseFixture.lease.generation,
  expires_at_epoch: 1700,
  evidence_digest: h('5'),
  now_epoch: 1050,
});
assert.throws(
  () => execute({ fixture: staleLeaseFixture, prepared: staleLeasePrepared, store: staleLeaseStore, registry: staleLeaseRegistry }),
  (error) => error.code === 'STORAGE_SHARED_CANARY_EXECUTOR_LEASE_INVALID',
);
assert.equal(staleLeaseRegistry.exportState()[0].consumed, false);

const tamperedFixture = createSyntheticExecutorFixture({ run_id: 'shared-tampered-run', operation_id: 'shared-tampered-operation', plan_id: 'shared-tampered-plan', target_id: 'shared-tampered-target' });
const tamperedPrepared = authorize(tamperedFixture);
const tamperedStore = createMemoryHostingerStorageSharedCanaryAuthorityStore();
const tamperedRegistry = createMemoryHostingerStorageSharedCanaryEnablementRegistry();
registerAuthority(tamperedStore, tamperedPrepared.authorization);
registerEnablement(tamperedRegistry, tamperedFixture, tamperedPrepared.authorization);
const tamperedProtocol = structuredClone(tamperedFixture.protocol.protocol);
tamperedProtocol.items[0].expected.inode = 9999;
assert.throws(
  () => execute({ fixture: tamperedFixture, prepared: tamperedPrepared, store: tamperedStore, registry: tamperedRegistry, protocol: tamperedProtocol }),
  (error) => error.code === 'STORAGE_EXECUTOR_PROTOCOL_TAMPERED',
);
assert.equal(tamperedRegistry.exportState()[0].consumed, false);

const unknownFixture = createSyntheticExecutorFixture({ run_id: 'shared-unknown-run', operation_id: 'shared-unknown-operation', plan_id: 'shared-unknown-plan', target_id: 'shared-unknown-target' });
const unknownPrepared = authorize(unknownFixture);
const unknownStore = createMemoryHostingerStorageSharedCanaryAuthorityStore();
const unknownRegistry = createMemoryHostingerStorageSharedCanaryEnablementRegistry();
registerAuthority(unknownStore, unknownPrepared.authorization);
registerEnablement(unknownRegistry, unknownFixture, unknownPrepared.authorization);
const unknown = execute({ fixture: unknownFixture, prepared: unknownPrepared, store: unknownStore, registry: unknownRegistry, fault: { phase: 'after_prepared', item_id: 'item-1' } });
assert.equal(unknown.outcome, 'unknown_outcome');
assert.equal(unknown.projection.read_before_retry_required, true);
assert.equal(unknownRegistry.exportState()[0].consumed, true);

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_shared_canary',
  admin_context_required: true,
  shared_or_platform_target_required: true,
  immutable_candidate_set_bound: true,
  resolved_impact_set_required: true,
  all_approvals_or_governed_quorum: true,
  platform_admin_and_release_authority_required: true,
  active_production_sha_excluded: true,
  rollback_set_retained: true,
  reserve_certified_but_not_released: true,
  current_authority_revalidated: true,
  authority_evidence_cas_advances: true,
  preflight_before_enablement_consumption: true,
  unknown_outcome_consumes_one_shot: true,
  synthetic_only: true,
  dispatch_allowed: false,
  live_provider_mutated: false,
  production_ready: false,
  secrets_included: false,
}));
