#!/usr/bin/env node
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';

import { createExecutionCapsule } from './contextKernel/domain/executionCapsule.js';
import { createExecutionCapsuleService } from './contextKernel/application/executionCapsuleService.js';
import { buildHostingerStorageTenantCanaryAuthorization } from './hostingerStorageTenantCanaryPolicy.js';
import {
  createHostingerStorageTenantCanaryControlPlaneRepository,
  createHostingerStorageTenantCanarySyntheticAdapter,
  createMemoryHostingerStorageTenantCanaryAuthorityStore,
  createMemoryHostingerStorageTenantCanaryEnablementRegistry,
} from './hostingerStorageTenantCanary.js';
import { createHostingerStorageTenantRuntime } from './hostingerStorageTenantRuntime.js';
import { buildHostingerStorageTenantRoutes } from './routes/hostingerStorageTenantRoutes.js';
import {
  createSyntheticExecutorFixture as createBaseSyntheticExecutorFixture,
  h,
} from './test-hostinger-storage-executor-fixtures.mjs';

const EXPECTED_SHA = 'abcdef1234567';
const OPERATION_KEY = 'hostinger.storage.apply_plan.synthetic';
const JOURNEY_ID = 'tenant-storage-request-to-reconciled-readback';
const REQUIRED_DYNAMIC_EVIDENCE = Object.freeze([
  'approval',
  'capability_envelope',
  'effective_authority',
  'resource_version',
  'provider_version',
  'connection_status',
  'expected_sha',
]);
const EVIDENCE_STATUSES = Object.freeze({
  approval: 'approved',
  capability_envelope: 'active',
  effective_authority: 'active',
  resource_version: 'current',
  provider_version: 'current',
  connection_status: 'active',
  expected_sha: 'matched',
});

function createTenantFixture() {
  const fixture = createBaseSyntheticExecutorFixture({
    run_id: 'mvp-shared-state-run',
    operation_id: 'mvp-shared-state-operation',
    plan_id: 'mvp-shared-state-plan',
    target_id: 'mvp-shared-state-target',
  });
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
    repository: createHostingerStorageTenantCanaryControlPlaneRepository({
      snapshot: fixture.repository.exportSnapshot(),
    }),
    adapter: createHostingerStorageTenantCanarySyntheticAdapter({ items }),
  };
}

function authorizeFixture(fixture, nowEpoch = 1100) {
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
  };
  const approval = {
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
  };
  const authorization = buildHostingerStorageTenantCanaryAuthorization({
    operation,
    protocol: fixture.protocol.protocol,
    protocol_digest: fixture.protocol.protocol_digest,
    immutable_plan: fixture.plan,
    allowlist_entry: allowlist,
    workspace_owner_approval: approval,
    manual_enablement: enablement,
    now_epoch: nowEpoch,
  });
  assert.equal(authorization.canary_ready, true);
  return { operation, authorization };
}

function createScenario() {
  const fixture = createTenantFixture();
  const nowEpoch = 1100;
  const { operation, authorization } = authorizeFixture(fixture, nowEpoch);
  const authorityStore = createMemoryHostingerStorageTenantCanaryAuthorityStore();
  authorityStore.registerAllowlist(authorization.authorization.allowlist);
  authorityStore.registerApproval(authorization.authorization.workspace_owner_approval);
  const enablementRegistry = createMemoryHostingerStorageTenantCanaryEnablementRegistry();
  const enablement = authorization.authorization.manual_enablement;
  enablementRegistry.register({
    enablement_id: enablement.enablement_id,
    authorization_digest: authorization.authorization_digest,
    operation_id: operation.operation_id,
    run_id: fixture.run_id,
    generation: enablement.generation,
    expires_at_epoch: enablement.expires_at_epoch,
  });

  const validationDate = new Date();
  const issuedAt = new Date(validationDate.getTime() - 60_000).toISOString();
  const expiresAt = new Date(validationDate.getTime() + 600_000).toISOString();
  const capsule = createExecutionCapsule({
    contextHash: operation.authority_context_hash,
    contextRevision: 'context-revision-mvp-shared-state',
    principalType: 'tenant_user',
    principalRef: 'user-1',
    effectiveSubjectRef: 'user-1',
    tenantRef: operation.tenant_id,
    workspaceRef: operation.workspace_id,
    brandRef: 'brand-1',
    resourceType: 'hostinger_storage_target',
    resourceRef: operation.resource_id,
    connectionRef: 'synthetic-connection-mvp-shared-state',
    authorityPathRef: 'authority-path-mvp-shared-state',
    capabilityKey: OPERATION_KEY,
    authorityRevision: operation.ownership_revision,
    capabilityRevision: operation.policy_revision,
    registryRevision: 'registry-revision-mvp-shared-state',
    credentialReadinessRevision: 'credential-revision-mvp-shared-state',
    issuedAt,
    expiresAt,
    invalidationDependencies: [],
  });
  const currentContext = Object.freeze({
    contextHash: capsule.contextHash,
    contextRevision: capsule.contextRevision,
    principal: {
      principalType: capsule.principalType,
      principalRef: capsule.principalRef,
    },
    effectiveSubject: { subjectRef: capsule.effectiveSubjectRef },
    tenantRef: capsule.tenantRef,
    workspaceRef: capsule.workspaceRef,
    brandRef: capsule.brandRef,
    resourceType: capsule.resourceType,
    resourceRef: capsule.resourceRef,
    connectionRef: capsule.connectionRef,
  });
  const operationContract = Object.freeze({
    operationKey: OPERATION_KEY,
    operationKind: 'mutation',
    riskClass: 'synthetic_tenant_storage_mutation',
    mutationRequired: true,
    reversible: true,
    rollbackOperationKey: 'hostinger.storage.restore_plan.synthetic',
    requiredDynamicEvidence: REQUIRED_DYNAMIC_EVIDENCE,
  });
  const governanceDecision = Object.freeze({
    decisionRef: 'governance-decision-mvp-shared-state',
    decisionRevision: 'governance-revision-mvp-shared-state',
    operationKey: OPERATION_KEY,
    contextHash: capsule.contextHash,
    status: 'allowed',
    dispatchAllowed: true,
    mutationAllowed: true,
  });
  const dynamicEvidence = {};
  for (const key of REQUIRED_DYNAMIC_EVIDENCE) {
    dynamicEvidence[key] = {
      status: EVIDENCE_STATUSES[key],
      revision: `${key}-revision-mvp-shared-state`,
      evidenceRef: `${key}-evidence-mvp-shared-state`,
      operationKey: OPERATION_KEY,
      contextHash: capsule.contextHash,
      tenantRef: capsule.tenantRef,
      workspaceRef: capsule.workspaceRef,
      resourceRef: capsule.resourceRef,
      connectionRef: capsule.connectionRef,
    };
  }
  dynamicEvidence.expected_sha.expectedSha = EXPECTED_SHA;
  dynamicEvidence.expected_sha.actualSha = EXPECTED_SHA;

  return {
    fixture,
    operation,
    capsuleService: createExecutionCapsuleService({ clock: () => validationDate }),
    context: {
      capsule,
      governanceDecision,
      currentContext,
      currentDependencies: capsule.invalidationDependencies.map((dependency) => ({ ...dependency })),
      dynamicEvidence,
      now: validationDate.toISOString(),
    },
    executionPackage: {
      operationContract,
      canaryAuthorization: authorization,
      protocol: fixture.protocol.protocol,
      protocolDigest: fixture.protocol.protocol_digest,
      repository: fixture.repository,
      adapter: fixture.adapter,
      authorityStore,
      enablementRegistry,
      nowEpoch,
    },
  };
}

function createRuntime(scenario) {
  return createHostingerStorageTenantRuntime({
    capsuleService: scenario.capsuleService,
    async resolveExecutionContext({ operationId }) {
      assert.equal(operationId, scenario.operation.operation_id);
      return scenario.context;
    },
    async loadExecutionPackage({ operationId }) {
      assert.equal(operationId, scenario.operation.operation_id);
      return scenario.executionPackage;
    },
    async emitTelemetry() {},
  });
}

async function startApp(runtime) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = {
      mode: 'user_jwt',
      user_id: 'user-1',
      tenant_id: 'tenant-1',
      is_admin: false,
    };
    next();
  });
  app.use(buildHostingerStorageTenantRoutes({ tenantStorageRuntime: runtime }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
  };
}

async function postJson(url, body) {
  const response = await fetch(`${url}/tenant/storage-operations/apply-plan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

const scenario = createScenario();
const repository = scenario.executionPackage.repository;
const beforeAggregate = repository.readAggregate(scenario.operation.operation_id);
assert(beforeAggregate);
const beforePlan = beforeAggregate.plans.find(
  (row) => row.plan_id === scenario.fixture.plan.plan_id,
);
assert(beforePlan);
const immutablePlanBindingBefore = {
  plan_hash: beforePlan.plan_hash,
  candidate_set_hash: beforePlan.candidate_set_hash,
  impact_set_hash: beforePlan.impact_set_hash,
  immutable_envelope_digest: beforePlan.immutable_envelope_digest,
};
const approvalDigestsBefore = beforeAggregate.approvals.map((row) => row.record_digest);

const app = await startApp(createRuntime(scenario));
let applied;
try {
  applied = await postJson(app.url, {
    operation_id: scenario.operation.operation_id,
    expected_sha: EXPECTED_SHA,
  });
} finally {
  app.server.close();
  await once(app.server, 'close');
}

assert.equal(applied.status, 200);
assert.equal(applied.body.ok, true);
assert.equal(applied.body.outcome, 'applied');
assert.equal(scenario.executionPackage.enablementRegistry.exportState()[0].consumed, true);

const afterAggregate = repository.readAggregate(scenario.operation.operation_id);
assert(afterAggregate);
assert.equal(afterAggregate.operation.operation_id, scenario.operation.operation_id);
assert.equal(afterAggregate.operation.state, 'completed');
assert(afterAggregate.transaction_version > beforeAggregate.transaction_version);

const afterPlan = afterAggregate.plans.find(
  (row) => row.plan_id === scenario.fixture.plan.plan_id,
);
assert(afterPlan);
assert.equal(afterPlan.consumed, true);
assert.equal(afterPlan.consumed_run_id, scenario.fixture.run_id);
assert.deepEqual({
  plan_hash: afterPlan.plan_hash,
  candidate_set_hash: afterPlan.candidate_set_hash,
  impact_set_hash: afterPlan.impact_set_hash,
  immutable_envelope_digest: afterPlan.immutable_envelope_digest,
}, immutablePlanBindingBefore);
assert.deepEqual(
  afterAggregate.approvals.map((row) => row.record_digest),
  approvalDigestsBefore,
);

assert.deepEqual(
  afterAggregate.journals.map((row) => row.phase),
  ['prepared', 'result', 'readback'],
);
assert(afterAggregate.journals.every((row) => (
  row.operation_id === scenario.operation.operation_id
  && row.run_id === scenario.fixture.run_id
  && row.plan_id === scenario.fixture.plan.plan_id
)));

assert.equal(afterAggregate.reconciliations.length, 1);
const reconciliation = afterAggregate.reconciliations[0];
assert.equal(reconciliation.operation_id, scenario.operation.operation_id);
assert.equal(reconciliation.run_id, scenario.fixture.run_id);
assert.equal(reconciliation.outcome, applied.body.outcome);
assert.equal(reconciliation.result_digest, applied.body.readback.result_digest);

assert.equal(applied.body.readback.operation_id, scenario.operation.operation_id);
assert.equal(applied.body.readback.run_id, scenario.fixture.run_id);
assert.equal(applied.body.readback.plan_id, scenario.fixture.plan.plan_id);
assert.equal(applied.body.readback.outcome, reconciliation.outcome);
assert.equal(applied.body.readback.result_digest, reconciliation.result_digest);
assert.equal(applied.body.readback.provider_dispatch_allowed, false);
assert.equal(applied.body.readback.production_ready, false);

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_mvp_shared_operation_state',
  journey_id: JOURNEY_ID,
  mounted_route: 'POST /tenant/storage-operations/apply-plan',
  shared_operation_state: true,
  same_repository_identity_preserved: true,
  same_repository_operation_completed: true,
  same_repository_immutable_plan_consumed: true,
  same_repository_immutable_plan_bindings_preserved: true,
  same_repository_append_only_approvals_preserved: true,
  same_repository_prepared_result_readback_journal: true,
  same_repository_reconciliation_recorded: true,
  same_repository_tenant_readback_bound: true,
  one_shot_enablement_consumed: true,
  direct_mounted_route_execution: true,
  source_text_rewriting_used: false,
  temporary_test_file_created: false,
  synthetic_only: true,
  live_provider_mutated: false,
  provider_dispatch_allowed: false,
  production_ready: false,
  secrets_included: false,
}));
