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
  digest,
  h,
} from './test-hostinger-storage-executor-fixtures.mjs';

const EXPECTED_SHA = 'abcdef1234567';
const OPERATION_KEY = 'hostinger.storage.apply_plan.synthetic';
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

function createTenantFixture(options = {}) {
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

function createScenario(suffix) {
  const fixture = createTenantFixture({
    run_id: `tenant-runtime-run-${suffix}`,
    operation_id: `tenant-runtime-operation-${suffix}`,
    plan_id: `tenant-runtime-plan-${suffix}`,
    target_id: `tenant-runtime-target-${suffix}`,
  });
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
    contextRevision: `context-revision-${suffix}`,
    principalType: 'tenant_user',
    principalRef: 'user-1',
    effectiveSubjectRef: 'user-1',
    tenantRef: operation.tenant_id,
    workspaceRef: operation.workspace_id,
    brandRef: 'brand-1',
    resourceType: 'hostinger_storage_target',
    resourceRef: operation.resource_id,
    connectionRef: `synthetic-connection-${suffix}`,
    authorityPathRef: `authority-path-${suffix}`,
    capabilityKey: OPERATION_KEY,
    authorityRevision: operation.ownership_revision,
    capabilityRevision: operation.policy_revision,
    registryRevision: `registry-revision-${suffix}`,
    credentialReadinessRevision: `credential-revision-${suffix}`,
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
    decisionRef: `governance-decision-${suffix}`,
    decisionRevision: `governance-revision-${suffix}`,
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
      revision: `${key}-revision-${suffix}`,
      evidenceRef: `${key}-evidence-${suffix}`,
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
      currentDependencies: [],
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

function createRuntime(scenarios, counters, telemetry) {
  const capsuleService = [...scenarios.values()][0].capsuleService;
  return createHostingerStorageTenantRuntime({
    capsuleService,
    async resolveExecutionContext({ operationId }) {
      counters.context += 1;
      const scenario = scenarios.get(operationId);
      if (!scenario) throw Object.assign(new Error('Operation not found.'), { status: 404, code: 'storage_operation_not_found' });
      return scenario.context;
    },
    async loadExecutionPackage({ operationId }) {
      counters.package += 1;
      const scenario = scenarios.get(operationId);
      if (!scenario) throw Object.assign(new Error('Operation not found.'), { status: 404, code: 'storage_operation_not_found' });
      return scenario.executionPackage;
    },
    async emitTelemetry(event) {
      telemetry.push(event);
    },
  });
}

async function startApp(runtime) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = {
      mode: 'user_jwt',
      user_id: String(req.headers['x-test-user'] || 'user-1'),
      tenant_id: String(req.headers['x-test-tenant'] || 'tenant-1'),
      is_admin: req.headers['x-test-admin'] === 'true',
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

async function postJson(url, body, headers = {}) {
  const response = await fetch(`${url}/tenant/storage-operations/apply-plan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

const appliedScenario = createScenario('applied');
const mismatchScenario = createScenario('sha-mismatch');
const scenarios = new Map([
  [appliedScenario.operation.operation_id, appliedScenario],
  [mismatchScenario.operation.operation_id, mismatchScenario],
]);
const counters = { context: 0, package: 0 };
const telemetry = [];
const runtime = createRuntime(scenarios, counters, telemetry);
const app = await startApp(runtime);

try {
  const applied = await postJson(app.url, {
    operation_id: appliedScenario.operation.operation_id,
    expected_sha: EXPECTED_SHA,
  });
  assert.equal(applied.status, 200);
  assert.equal(applied.body.ok, true);
  assert.equal(applied.body.outcome, 'applied');
  assert.equal(applied.body.readback.tenant_id, 'tenant-1');
  assert.equal(applied.body.readback.workspace_id, 'workspace-1');
  assert.equal(applied.body.readback.resource_id, 'resource-1');
  assert.equal(applied.body.readback.synthetic_only, true);
  assert.equal(applied.body.readback.tenant_exclusive, true);
  assert.equal(applied.body.readback.manual_enablement_consumed, true);
  assert.equal(applied.body.readback.live_provider_mutated, false);
  assert.equal(applied.body.readback.provider_dispatch_allowed, false);
  assert.equal(applied.body.readback.production_ready, false);
  assert.equal(appliedScenario.executionPackage.enablementRegistry.exportState()[0].consumed, true);
  const serialized = JSON.stringify(applied.body);
  for (const forbidden of ['path_ref', 'root_ref', 'protocol_digest', 'canary_authorization', 'capsule', 'private_key', 'credential']) {
    assert.equal(serialized.includes(forbidden), false, `response leaked ${forbidden}`);
  }

  const beforeInjection = { ...counters };
  const injection = await postJson(app.url, {
    operation_id: mismatchScenario.operation.operation_id,
    expected_sha: EXPECTED_SHA,
    capsule: { tenantRef: 'tenant-other' },
  });
  assert.equal(injection.status, 400);
  assert.equal(injection.body.error.code, 'storage_tenant_request_field_forbidden');
  assert.deepEqual(counters, beforeInjection);
  assert.equal(mismatchScenario.executionPackage.enablementRegistry.exportState()[0].consumed, false);

  const shaMismatch = await postJson(app.url, {
    operation_id: mismatchScenario.operation.operation_id,
    expected_sha: 'abcdef9999999',
  });
  assert.equal(shaMismatch.status, 409);
  assert.equal(shaMismatch.body.error.code, 'execution_capsule_mutation_dispatch_expected_sha_mismatch');
  assert.equal(mismatchScenario.executionPackage.enablementRegistry.exportState()[0].consumed, false);
  assert.equal(mismatchScenario.fixture.adapter.exportState().items[0].exists, true);

  const crossTenant = await postJson(app.url, {
    operation_id: mismatchScenario.operation.operation_id,
    expected_sha: EXPECTED_SHA,
  }, { 'x-test-tenant': 'tenant-other' });
  assert.equal(crossTenant.status, 409);
  assert.equal(crossTenant.body.error.code, 'STORAGE_TENANT_RUNTIME_CONTEXT_BINDING_MISMATCH');
  assert.equal(mismatchScenario.executionPackage.enablementRegistry.exportState()[0].consumed, false);

  const admin = await postJson(app.url, {
    operation_id: mismatchScenario.operation.operation_id,
    expected_sha: EXPECTED_SHA,
  }, { 'x-test-admin': 'true' });
  assert.equal(admin.status, 401);
  assert.equal(admin.body.error.code, 'tenant_user_jwt_required');

  assert(telemetry.some((event) => event.dispatchSucceeded === true));
  assert(telemetry.some((event) => event.dispatchSucceeded === false));
} finally {
  app.server.close();
  await once(app.server, 'close');
}

const unavailableApp = await startApp(null);
try {
  const unavailable = await postJson(unavailableApp.url, {
    operation_id: 'tenant-runtime-operation-unavailable',
    expected_sha: EXPECTED_SHA,
  });
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.body.error.code, 'storage_tenant_runtime_unavailable');
} finally {
  unavailableApp.server.close();
  await once(unavailableApp.server, 'close');
}

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_tenant_runtime_route',
  mounted_route: 'POST /tenant/storage-operations/apply-plan',
  context_kernel_mutation_gate: true,
  effective_authority_dynamic_evidence: true,
  one_shot_enablement_consumed_after_all_checks: true,
  request_authority_injection_rejected_before_resolution: true,
  expected_sha_mismatch_rejected_before_canary_dispatch: true,
  cross_tenant_context_rejected: true,
  tenant_safe_readback: true,
  provider_dispatch_allowed: false,
  production_ready: false,
  secrets_included: false,
}));
