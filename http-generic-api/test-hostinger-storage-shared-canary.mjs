#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildHostingerStorageSharedCanaryAuthorization,
  verifyHostingerStorageSharedCanaryAuthorization,
  createMemoryHostingerStorageSharedCanaryAuthorityStore,
  createMemoryHostingerStorageSharedCanaryEnablementRegistry,
  executeHostingerStorageSharedCanary,
} from './hostingerStorageSharedCanary.js';
import {
  createHostingerStorageControlPlaneRepository,
  createMemoryHostingerStoragePersistenceAdapter,
} from './hostingerStorageControlPlaneRepository.js';
import { createSyntheticExecutorFixture, digest, h } from './test-hostinger-storage-executor-fixtures.mjs';

const productionSha = '1'.repeat(40);

function createRepositoryFromSnapshot(snapshot) {
  const persistence = createMemoryHostingerStoragePersistenceAdapter({ snapshot });
  return createHostingerStorageControlPlaneRepository({ adapter: persistence });
}

function createAdminRepository(fixture) {
  const snapshot = structuredClone(fixture.repository.exportSnapshot());
  const operation = snapshot.state.operations[fixture.operation_id];
  if (!operation) throw new Error('Shared test operation missing from snapshot.');
  delete operation.record_digest;
  operation.context_mode = 'admin';
  operation.record_digest = digest(operation);
  snapshot.state_digest = digest(snapshot.state);
  return createRepositoryFromSnapshot(snapshot);
}

function createPlanStatusRepository(repository, status) {
  const snapshot = structuredClone(repository.exportSnapshot());
  for (const plan of Object.values(snapshot.state.plans || {})) {
    delete plan.record_digest;
    plan.status = status;
    plan.record_digest = digest(plan);
  }
  snapshot.state_digest = digest(snapshot.state);
  return createRepositoryFromSnapshot(snapshot);
}

function protocolItemSetDigest(fixture) {
  return digest(fixture.protocol.protocol.items.map((item) => ({
    item_id: item.item_id,
    ordinal: item.ordinal,
    category: item.category,
    path_ref: item.path_ref,
    item_hash: item.item_hash,
    relative_path_digest: item.relative_path_digest,
    size_bytes: item.expected.size_bytes,
    device: item.expected.device,
    inode: item.expected.inode,
    ctime_epoch: item.expected.ctime_epoch,
    mtime_epoch: item.expected.mtime_epoch,
    file_type: item.expected.file_type,
  })));
}

function buildInputs(fixture, overrides = {}) {
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
  const commonApproval = {
    status: 'approved',
    target_id: fixture.target_id,
    plan_hash: fixture.planHash,
    impact_set_hash: impactSet.impact_set_hash,
    authority_context_hash: operation.authority_context_hash,
    decided_at_epoch: 1050,
    expires_at_epoch: 1450,
  };
  const platformApproval = {
    ...commonApproval,
    approval_id: `platform-${fixture.operation_id}`,
    slot: 'platform_admin',
    role: 'platform_admin',
    evidence_digest: h('b'),
    ...(overrides.platform_admin_approval || {}),
  };
  const releaseApproval = {
    ...commonApproval,
    approval_id: `release-${fixture.operation_id}`,
    slot: 'release_authority',
    role: 'release_authority',
    active_production_sha: productionSha,
    evidence_digest: h('c'),
    ...(overrides.release_authority_approval || {}),
  };
  const defaultWorkspaceApprovals = impactSet.workspace_ids.map((workspaceId, index) => ({
    ...commonApproval,
    approval_id: `workspace-${index + 1}-${fixture.operation_id}`,
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
    plan_hash: fixture.planHash,
    candidate_set_hash: fixture.candidateSetHash,
    item_set_digest: protocolItemSetDigest(fixture),
    evidence_digest: h('d'),
    ...(overrides.deployment_layout_proof || {}),
  };
  const reserve = {
    certification_id: `reserve-${fixture.operation_id}`,
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
    enablement_id: `enablement-${fixture.operation_id}`,
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

function governedQuorum(fixture, input, overrides = {}) {
  return {
    mode: 'approved_quorum',
    policy_id: `quorum-${fixture.operation_id}`,
    policy_revision: 'quorum-r1',
    status: 'approved',
    target_id: fixture.target_id,
    plan_hash: fixture.planHash,
    impact_set_hash: input.impactSet.impact_set_hash,
    authority_context_hash: input.operation.authority_context_hash,
    minimum_approvals: 1,
    release_authority_approved: true,
    approved_by_role: 'release_authority',
    decided_at_epoch: 1055,
    expires_at_epoch: 1450,
    evidence_digest: h('9'),
    ...overrides,
  };
}

function prepare(fixture, overrides = {}, now = 1100) {
  const input = buildInputs(fixture, overrides);
  const protocol = overrides.protocol || fixture.protocol.protocol;
  const protocolDigest = overrides.protocol_digest || fixture.protocol.protocol_digest;
  const authorization = buildHostingerStorageSharedCanaryAuthorization({
    operation: input.operation,
    protocol,
    protocol_digest: protocolDigest,
    immutable_plan: fixture.plan,
    impact_set: input.impactSet,
    platform_admin_approval: input.platformApproval,
    release_authority_approval: input.releaseApproval,
    workspace_approvals: input.workspaceApprovals,
    quorum_policy: input.quorumPolicy,
    quorum_authority_store: overrides.quorum_authority_store,
    deployment_layout_proof: input.layout,
    reserve_certification: input.reserve,
    manual_enablement: input.enablement,
    now_epoch: now,
  });
  return { ...input, protocol, protocolDigest, authorization };
}

function register(store, registry, fixture, prepared) {
  const signed = prepared.authorization.authorization;
  store.registerImpact(signed.impact_set);
  [signed.platform_admin_approval, signed.release_authority_approval, ...signed.workspace_approvals]
    .forEach((approval) => store.registerApproval(approval));
  if (signed.quorum_policy.mode === 'approved_quorum') store.registerQuorum(signed.quorum_policy);
  store.registerLayout(signed.deployment_layout_proof);
  store.registerReserve(signed.reserve_certification);
  registry.register({
    enablement_id: signed.manual_enablement.enablement_id,
    authorization_digest: prepared.authorization.authorization_digest,
    operation_id: fixture.operation_id,
    run_id: fixture.run_id,
    generation: signed.manual_enablement.generation,
    expires_at_epoch: signed.manual_enablement.expires_at_epoch,
  });
}

function execute(fixture, prepared, store, registry, overrides = {}) {
  return executeHostingerStorageSharedCanary({
    canary_authorization: prepared.authorization,
    protocol: overrides.protocol || prepared.protocol,
    protocol_digest: overrides.protocol_digest || prepared.protocolDigest,
    repository: overrides.repository || prepared.repository,
    adapter: overrides.adapter || fixture.adapter,
    authority_store: store,
    enablement_registry: registry,
    fault: overrides.fault || null,
    now_epoch: overrides.now || 1100,
  });
}

function fixtureFor(name) {
  return createSyntheticExecutorFixture({
    run_id: `${name}-run`, operation_id: `${name}-operation`, plan_id: `${name}-plan`, target_id: `${name}-target`,
  });
}

const successFixture = fixtureFor('shared-success');
const success = prepare(successFixture);
assert.equal(success.authorization.canary_ready, true);
assert.equal(verifyHostingerStorageSharedCanaryAuthorization({ authorization: success.authorization.authorization, expected_digest: success.authorization.authorization_digest, now_epoch: 1100 }).valid, true);
const successStore = createMemoryHostingerStorageSharedCanaryAuthorityStore();
const successRegistry = createMemoryHostingerStorageSharedCanaryEnablementRegistry();
register(successStore, successRegistry, successFixture, success);
const applied = execute(successFixture, success, successStore, successRegistry);
assert.equal(applied.outcome, 'applied');
assert.equal(applied.projection.impacted_workspace_count, 2);
assert.equal(applied.projection.active_production_sha, productionSha);
assert.equal(applied.projection.reserve_released, false);
assert.equal(successRegistry.exportState()[0].consumed, true);

const missingFixture = fixtureFor('shared-missing');
const missingInput = buildInputs(missingFixture);
const missing = prepare(missingFixture, { workspace_approvals: missingInput.workspaceApprovals.slice(0, 1) });
assert(missing.authorization.blockers.includes('STORAGE_SHARED_CANARY_IMPACT_APPROVALS_MISSING'));
const wrongSlot = prepare(missingFixture, { workspace_approvals: missingInput.workspaceApprovals.map((approval, index) => index === 0 ? { ...approval, slot: 'unrelated_slot' } : approval) });
assert.equal(wrongSlot.authorization.canary_ready, false);
assert(wrongSlot.authorization.blockers.includes('STORAGE_SHARED_CANARY_WORKSPACE_APPROVAL_SLOT_INVALID'));

const quorumFixture = fixtureFor('shared-quorum');
const quorumInput = buildInputs(quorumFixture);
const quorumStore = createMemoryHostingerStorageSharedCanaryAuthorityStore();
const quorumPolicy = governedQuorum(quorumFixture, quorumInput);
quorumStore.registerQuorum(quorumPolicy);
const validQuorum = prepare(quorumFixture, {
  workspace_approvals: quorumInput.workspaceApprovals.slice(0, 1),
  quorum_policy: quorumPolicy,
  quorum_authority_store: quorumStore,
});
assert.equal(validQuorum.authorization.canary_ready, true);
const quorumRegistry = createMemoryHostingerStorageSharedCanaryEnablementRegistry();
register(quorumStore, quorumRegistry, quorumFixture, validQuorum);
const quorumApplied = execute(quorumFixture, validQuorum, quorumStore, quorumRegistry);
assert.equal(quorumApplied.outcome, 'applied');

const absentQuorumStore = prepare(quorumFixture, { workspace_approvals: quorumInput.workspaceApprovals.slice(0, 1), quorum_policy: quorumPolicy });
assert.equal(absentQuorumStore.authorization.canary_ready, false);
assert(absentQuorumStore.authorization.blockers.includes('STORAGE_SHARED_CANARY_QUORUM_AUTHORITY_REQUIRED'));

const invalidQuorumStore = createMemoryHostingerStorageSharedCanaryAuthorityStore();
const invalidQuorumPolicy = governedQuorum(quorumFixture, quorumInput, { release_authority_approved: false, minimum_approvals: 2 });
invalidQuorumStore.registerQuorum(invalidQuorumPolicy);
const invalidQuorum = prepare(quorumFixture, {
  workspace_approvals: quorumInput.workspaceApprovals.slice(0, 1),
  quorum_policy: invalidQuorumPolicy,
  quorum_authority_store: invalidQuorumStore,
});
assert(invalidQuorum.authorization.blockers.includes('STORAGE_SHARED_CANARY_QUORUM_POLICY_INVALID'));

for (const [name, overrides, blocker] of [
  ['impact', { impact_set: { complete: false, unknown_count: 1 } }, 'STORAGE_SHARED_CANARY_IMPACT_SET_INCOMPLETE'],
  ['scope', { operation: { target_scope: 'tenant' } }, 'STORAGE_SHARED_CANARY_SHARED_OR_PLATFORM_TARGET_REQUIRED'],
  ['release', { release_authority_approval: { active_production_sha: '2'.repeat(40) } }, 'STORAGE_SHARED_CANARY_RELEASE_AUTHORITY_REQUIRED'],
  ['layout', { deployment_layout_proof: { active_root_excluded: false, rollback_set_retained: false } }, 'STORAGE_SHARED_CANARY_DEPLOYMENT_LAYOUT_PROOF_REQUIRED'],
  ['layout-binding', { deployment_layout_proof: { plan_hash: h('8'), candidate_set_hash: h('7'), item_set_digest: h('6') } }, 'STORAGE_SHARED_CANARY_LAYOUT_PLAN_BINDING_MISMATCH'],
  ['reserve', { reserve_certification: { release_separate_authorization_required: false } }, 'STORAGE_SHARED_CANARY_RESERVE_CERTIFICATION_REQUIRED'],
]) {
  const rejected = prepare(fixtureFor(`shared-${name}`), overrides);
  assert(rejected.authorization.blockers.includes(blocker));
}
assert.throws(() => prepare(fixtureFor('shared-small-reserve'), { reserve_certification: { reserve_size_bytes: 1024 } }), (error) => error.code === 'STORAGE_SHARED_CANARY_INTEGER_INVALID');

const driftFixture = fixtureFor('shared-drift');
const drift = prepare(driftFixture);
const driftStore = createMemoryHostingerStorageSharedCanaryAuthorityStore();
const driftRegistry = createMemoryHostingerStorageSharedCanaryEnablementRegistry();
register(driftStore, driftRegistry, driftFixture, drift);
const signedImpact = drift.authorization.authorization.impact_set;
driftStore.updateImpact({ impact_set_id: signedImpact.impact_set_id, expected_evidence_digest: signedImpact.evidence_digest, record: { ...signedImpact, status: 'revoked', evidence_digest: h('8') } });
assert.throws(() => execute(driftFixture, drift, driftStore, driftRegistry), (error) => error.code === 'STORAGE_SHARED_CANARY_IMPACT_SET_CURRENT_STATE_INVALID');
assert.equal(driftRegistry.exportState()[0].consumed, false);

const quorumDriftFixture = fixtureFor('shared-quorum-drift');
const quorumDriftInput = buildInputs(quorumDriftFixture);
const quorumDriftStore = createMemoryHostingerStorageSharedCanaryAuthorityStore();
const quorumDriftPolicy = governedQuorum(quorumDriftFixture, quorumDriftInput);
quorumDriftStore.registerQuorum(quorumDriftPolicy);
const quorumDrift = prepare(quorumDriftFixture, {
  workspace_approvals: quorumDriftInput.workspaceApprovals.slice(0, 1),
  quorum_policy: quorumDriftPolicy,
  quorum_authority_store: quorumDriftStore,
});
const quorumDriftRegistry = createMemoryHostingerStorageSharedCanaryEnablementRegistry();
register(quorumDriftStore, quorumDriftRegistry, quorumDriftFixture, quorumDrift);
quorumDriftStore.updateQuorum({ policy_id: quorumDriftPolicy.policy_id, expected_evidence_digest: quorumDriftPolicy.evidence_digest, record: { ...quorumDriftPolicy, status: 'revoked', evidence_digest: h('8') } });
assert.throws(() => execute(quorumDriftFixture, quorumDrift, quorumDriftStore, quorumDriftRegistry), (error) => error.code === 'STORAGE_SHARED_CANARY_QUORUM_CURRENT_STATE_INVALID');
assert.equal(quorumDriftRegistry.exportState()[0].consumed, false);

const casFixture = fixtureFor('shared-cas');
const cas = prepare(casFixture);
const casStore = createMemoryHostingerStorageSharedCanaryAuthorityStore();
const casRegistry = createMemoryHostingerStorageSharedCanaryEnablementRegistry();
register(casStore, casRegistry, casFixture, cas);
const signedPlatform = cas.authorization.authorization.platform_admin_approval;
assert.throws(() => casStore.updateApproval({ approval_id: signedPlatform.approval_id, expected_evidence_digest: signedPlatform.evidence_digest, record: { ...signedPlatform, status: 'revoked' } }), (error) => error.code === 'STORAGE_SHARED_CANARY_AUTHORITY_EVIDENCE_NOT_ADVANCED');
casStore.updateApproval({ approval_id: signedPlatform.approval_id, expected_evidence_digest: signedPlatform.evidence_digest, record: { ...signedPlatform, status: 'revoked', evidence_digest: h('7') } });
assert.throws(() => casStore.updateApproval({ approval_id: signedPlatform.approval_id, expected_evidence_digest: signedPlatform.evidence_digest, record: { ...signedPlatform, status: 'approved', evidence_digest: h('6') } }), (error) => error.code === 'STORAGE_SHARED_CANARY_AUTHORITY_EVIDENCE_CONFLICT');

const leaseFixture = fixtureFor('shared-lease');
const lease = prepare(leaseFixture);
const leaseStore = createMemoryHostingerStorageSharedCanaryAuthorityStore();
const leaseRegistry = createMemoryHostingerStorageSharedCanaryEnablementRegistry();
register(leaseStore, leaseRegistry, leaseFixture, lease);
lease.repository.renewLease({ target_id: leaseFixture.target_id, lease_id: leaseFixture.lease.lease_id, operation_id: leaseFixture.operation_id, holder_ref: leaseFixture.lease.holder_ref, expected_generation: leaseFixture.lease.generation, expires_at_epoch: 1700, evidence_digest: h('5'), now_epoch: 1050 });
assert.throws(() => execute(leaseFixture, lease, leaseStore, leaseRegistry), (error) => error.code === 'STORAGE_SHARED_CANARY_EXECUTOR_LEASE_INVALID');
assert.equal(leaseRegistry.exportState()[0].consumed, false);

const revokedPlanFixture = fixtureFor('shared-revoked-plan');
const revokedPlan = prepare(revokedPlanFixture);
const revokedPlanStore = createMemoryHostingerStorageSharedCanaryAuthorityStore();
const revokedPlanRegistry = createMemoryHostingerStorageSharedCanaryEnablementRegistry();
register(revokedPlanStore, revokedPlanRegistry, revokedPlanFixture, revokedPlan);
const revokedRepository = createPlanStatusRepository(revokedPlan.repository, 'revoked');
assert.throws(
  () => execute(revokedPlanFixture, revokedPlan, revokedPlanStore, revokedPlanRegistry, { repository: revokedRepository }),
  (error) => error.code === 'STORAGE_SHARED_CANARY_EXECUTOR_PLAN_INVALID' && error.details?.mismatches?.includes('status'),
);
assert.equal(revokedPlanRegistry.exportState()[0].consumed, false);
assert.equal(revokedPlanFixture.adapter.exportState().items[0].exists, true);

const tamperedFixture = fixtureFor('shared-tampered');
const tampered = prepare(tamperedFixture);
const tamperedStore = createMemoryHostingerStorageSharedCanaryAuthorityStore();
const tamperedRegistry = createMemoryHostingerStorageSharedCanaryEnablementRegistry();
register(tamperedStore, tamperedRegistry, tamperedFixture, tampered);
const tamperedProtocol = structuredClone(tampered.protocol);
tamperedProtocol.items[0].expected.inode = 9999;
assert.throws(() => execute(tamperedFixture, tampered, tamperedStore, tamperedRegistry, { protocol: tamperedProtocol }), (error) => error.code === 'STORAGE_EXECUTOR_PROTOCOL_TAMPERED');
assert.equal(tamperedRegistry.exportState()[0].consumed, false);

function assertUnconsumedAndUnchanged(fixture, registry) {
  assert.equal(registry.exportState()[0].consumed, false);
  assert.equal(fixture.adapter.exportState().items[0].exists, true);
}

const forgedRepositoryFixture = fixtureFor('shared-forged-repository');
const forgedRepositoryPrepared = prepare(forgedRepositoryFixture);
const forgedRepositoryStore = createMemoryHostingerStorageSharedCanaryAuthorityStore();
const forgedRepositoryRegistry = createMemoryHostingerStorageSharedCanaryEnablementRegistry();
register(forgedRepositoryStore, forgedRepositoryRegistry, forgedRepositoryFixture, forgedRepositoryPrepared);
let forgedRepositoryReadCalled = false;
const genuineRepository = forgedRepositoryPrepared.repository;
const forgedRepository = Object.freeze({
  repository_version: genuineRepository.repository_version,
  adapter_key: genuineRepository.adapter_key,
  production_ready: false,
  readAggregate(...args) { forgedRepositoryReadCalled = true; return genuineRepository.readAggregate(...args); },
  transitionOperation: (...args) => genuineRepository.transitionOperation(...args),
  consumePlan: (...args) => genuineRepository.consumePlan(...args),
  appendJournalEvent: (...args) => genuineRepository.appendJournalEvent(...args),
  recordReconciliation: (...args) => genuineRepository.recordReconciliation(...args),
});
assert.throws(
  () => execute(forgedRepositoryFixture, forgedRepositoryPrepared, forgedRepositoryStore, forgedRepositoryRegistry, { repository: forgedRepository }),
  (error) => error.code === 'STORAGE_SHARED_CANARY_CONTROL_PLANE_INVALID'
    && error.details?.repository_provenance === 'canonical_factory_owned_required',
);
assert.equal(forgedRepositoryReadCalled, false);
assertUnconsumedAndUnchanged(forgedRepositoryFixture, forgedRepositoryRegistry);

const forgedAdapterFixture = fixtureFor('shared-forged-adapter');
const forgedAdapterPrepared = prepare(forgedAdapterFixture);
const forgedAdapterStore = createMemoryHostingerStorageSharedCanaryAuthorityStore();
const forgedAdapterRegistry = createMemoryHostingerStorageSharedCanaryEnablementRegistry();
register(forgedAdapterStore, forgedAdapterRegistry, forgedAdapterFixture, forgedAdapterPrepared);
let forgedAdapterCalled = false;
const genuineAdapter = forgedAdapterFixture.adapter;
const forgedAdapter = Object.freeze({
  ...genuineAdapter,
  mutateExact(...args) { forgedAdapterCalled = true; return genuineAdapter.mutateExact(...args); },
  readbackItem(...args) { forgedAdapterCalled = true; return genuineAdapter.readbackItem(...args); },
  readMutationReceipt(...args) { forgedAdapterCalled = true; return genuineAdapter.readMutationReceipt(...args); },
});
assert.throws(
  () => execute(forgedAdapterFixture, forgedAdapterPrepared, forgedAdapterStore, forgedAdapterRegistry, { adapter: forgedAdapter }),
  (error) => error.code === 'STORAGE_SHARED_CANARY_EXECUTOR_ADAPTER_INVALID'
    && error.details?.adapter_provenance === 'canonical_factory_owned_required',
);
assert.equal(forgedAdapterCalled, false);
assertUnconsumedAndUnchanged(forgedAdapterFixture, forgedAdapterRegistry);

const forgedStoreFixture = fixtureFor('shared-forged-store');
const forgedStorePrepared = prepare(forgedStoreFixture);
const genuineStore = createMemoryHostingerStorageSharedCanaryAuthorityStore();
const forgedStoreRegistry = createMemoryHostingerStorageSharedCanaryEnablementRegistry();
register(genuineStore, forgedStoreRegistry, forgedStoreFixture, forgedStorePrepared);
let forgedStoreReadCalled = false;
const forgedStore = Object.freeze({
  ...genuineStore,
  readImpact(...args) { forgedStoreReadCalled = true; return genuineStore.readImpact(...args); },
  readApproval(...args) { forgedStoreReadCalled = true; return genuineStore.readApproval(...args); },
  readLayout(...args) { forgedStoreReadCalled = true; return genuineStore.readLayout(...args); },
  readReserve(...args) { forgedStoreReadCalled = true; return genuineStore.readReserve(...args); },
  readQuorum(...args) { forgedStoreReadCalled = true; return genuineStore.readQuorum(...args); },
});
assert.throws(
  () => execute(forgedStoreFixture, forgedStorePrepared, forgedStore, forgedStoreRegistry),
  (error) => error.code === 'STORAGE_SHARED_CANARY_AUTHORITY_STORE_INVALID'
    && error.details?.authority_store_provenance === 'shared_factory_owned_required',
);
assert.equal(forgedStoreReadCalled, false);
assertUnconsumedAndUnchanged(forgedStoreFixture, forgedStoreRegistry);

const forgedRegistryFixture = fixtureFor('shared-forged-registry');
const forgedRegistryPrepared = prepare(forgedRegistryFixture);
const forgedRegistryStore = createMemoryHostingerStorageSharedCanaryAuthorityStore();
const genuineRegistry = createMemoryHostingerStorageSharedCanaryEnablementRegistry();
register(forgedRegistryStore, genuineRegistry, forgedRegistryFixture, forgedRegistryPrepared);
let forgedRegistryReadCalled = false;
let forgedRegistryConsumeCalled = false;
const forgedRegistry = Object.freeze({
  ...genuineRegistry,
  read(...args) { forgedRegistryReadCalled = true; return genuineRegistry.read(...args); },
  consume(...args) { forgedRegistryConsumeCalled = true; return genuineRegistry.consume(...args); },
});
assert.throws(
  () => execute(forgedRegistryFixture, forgedRegistryPrepared, forgedRegistryStore, forgedRegistry),
  (error) => error.code === 'STORAGE_SHARED_CANARY_ENABLEMENT_REGISTRY_INVALID'
    && error.details?.enablement_registry_provenance === 'shared_factory_owned_required',
);
assert.equal(forgedRegistryReadCalled, false);
assert.equal(forgedRegistryConsumeCalled, false);
assertUnconsumedAndUnchanged(forgedRegistryFixture, genuineRegistry);

const captureOnceFixture = fixtureFor('shared-capture-once');
const captureOncePrepared = prepare(captureOnceFixture);
const captureOnceStore = createMemoryHostingerStorageSharedCanaryAuthorityStore();
const captureOnceRegistry = createMemoryHostingerStorageSharedCanaryEnablementRegistry();
register(captureOnceStore, captureOnceRegistry, captureOnceFixture, captureOncePrepared);
const dependencyReads = { repository: 0, adapter: 0, authority_store: 0, enablement_registry: 0 };
const captureOnceInput = {
  canary_authorization: captureOncePrepared.authorization,
  protocol: captureOncePrepared.protocol,
  protocol_digest: captureOncePrepared.protocolDigest,
  fault: null,
  now_epoch: 1100,
};
const poisonedDependency = Object.freeze({});
Object.defineProperties(captureOnceInput, {
  repository: { enumerable: true, get() { dependencyReads.repository += 1; return dependencyReads.repository === 1 ? captureOncePrepared.repository : poisonedDependency; } },
  adapter: { enumerable: true, get() { dependencyReads.adapter += 1; return dependencyReads.adapter === 1 ? captureOnceFixture.adapter : poisonedDependency; } },
  authority_store: { enumerable: true, get() { dependencyReads.authority_store += 1; return dependencyReads.authority_store === 1 ? captureOnceStore : poisonedDependency; } },
  enablement_registry: { enumerable: true, get() { dependencyReads.enablement_registry += 1; return dependencyReads.enablement_registry === 1 ? captureOnceRegistry : poisonedDependency; } },
});
const captureOnceResult = executeHostingerStorageSharedCanary(captureOnceInput);
assert.equal(captureOnceResult.ok, true);
assert.deepEqual(dependencyReads, { repository: 1, adapter: 1, authority_store: 1, enablement_registry: 1 });
assert.equal(captureOnceRegistry.exportState()[0].consumed, true);

const unknownFixture = fixtureFor('shared-unknown');
const unknown = prepare(unknownFixture);
const unknownStore = createMemoryHostingerStorageSharedCanaryAuthorityStore();
const unknownRegistry = createMemoryHostingerStorageSharedCanaryEnablementRegistry();
register(unknownStore, unknownRegistry, unknownFixture, unknown);
const uncertain = execute(unknownFixture, unknown, unknownStore, unknownRegistry, { fault: { phase: 'after_prepared', item_id: 'item-1' } });
assert.equal(uncertain.outcome, 'unknown_outcome');
assert.equal(uncertain.projection.read_before_retry_required, true);
assert.equal(unknownRegistry.exportState()[0].consumed, true);

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_shared_canary',
  admin_context_required: true,
  workspace_approval_slots_bound: true,
  governed_quorum_read_at_build_and_execution: true,
  layout_proof_bound_to_plan_and_candidates: true,
  plan_status_checked_before_enablement_consumption: true,
  immutable_candidate_set_bound: true,
  resolved_impact_set_required: true,
  platform_admin_and_release_authority_required: true,
  active_production_sha_excluded: true,
  rollback_set_retained: true,
  reserve_certified_but_not_released: true,
  current_authority_revalidated: true,
  repository_factory_provenance_required: true,
  adapter_factory_provenance_required: true,
  authority_store_factory_provenance_required: true,
  enablement_registry_factory_provenance_required: true,
  forged_dependency_callbacks_not_invoked: true,
  dependency_getters_captured_once: true,
  authority_evidence_cas_advances: true,
  preflight_before_enablement_consumption: true,
  unknown_outcome_consumes_one_shot: true,
  synthetic_only: true,
  dispatch_allowed: false,
  live_provider_mutated: false,
  production_ready: false,
  secrets_included: false,
}));
