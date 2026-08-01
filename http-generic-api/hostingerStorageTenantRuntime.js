import { createExecutionCapsuleService } from './contextKernel/application/executionCapsuleService.js';
import { createExecutionCapsuleMutationDispatchGate } from './contextKernel/integration/executionCapsuleMutationDispatchGate.js';
import { executeHostingerStorageTenantCanary } from './hostingerStorageTenantCanary.js';

export const HOSTINGER_STORAGE_TENANT_RUNTIME_VERSION = 'spec014-hostinger-storage-tenant-runtime-v1';

const TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const SHA_RE = /^(?:[0-9a-f]{7,64}|sha256-[0-9a-f]{32,128})$/u;
const REQUIRED_CONTEXT_FIELDS = Object.freeze([
  'capsule',
  'governanceDecision',
  'currentContext',
  'currentDependencies',
  'dynamicEvidence',
  'now',
]);
const REQUIRED_PACKAGE_FIELDS = Object.freeze([
  'operationContract',
  'canaryAuthorization',
  'protocol',
  'protocolDigest',
  'repository',
  'adapter',
  'authorityStore',
  'enablementRegistry',
  'nowEpoch',
]);

function fail(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = Object.freeze({ ...details, secrets_included: false });
  return error;
}

function token(value, field) {
  const normalized = String(value ?? '').trim();
  if (!TOKEN_RE.test(normalized)) {
    throw fail(400, 'STORAGE_TENANT_RUNTIME_IDENTIFIER_INVALID', 'A bounded identifier is required.', { field });
  }
  return normalized;
}

function sha(value, field) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!SHA_RE.test(normalized)) {
    throw fail(400, 'STORAGE_TENANT_RUNTIME_EXPECTED_SHA_INVALID', 'A bounded expected SHA is required.', { field });
  }
  return normalized;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function assertDataOnly(value, path = 'value', active = new WeakSet(), depth = 0) {
  if (depth > 16) throw fail(400, 'STORAGE_TENANT_RUNTIME_DATA_TOO_DEEP', 'Runtime data exceeded the supported depth.', { path });
  if (value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value)) return;
  if (typeof value !== 'object') throw fail(400, 'STORAGE_TENANT_RUNTIME_DATA_INVALID', 'Runtime evidence must contain data values only.', { path });
  if (active.has(value)) throw fail(400, 'STORAGE_TENANT_RUNTIME_DATA_CYCLE', 'Runtime evidence must not contain cycles.', { path });
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw fail(400, 'STORAGE_TENANT_RUNTIME_DATA_INVALID', 'Runtime evidence must use plain data objects.', { path });
  }
  active.add(value);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) {
        throw fail(400, 'STORAGE_TENANT_RUNTIME_ACCESSOR_REJECTED', 'Runtime evidence must not contain accessor properties.', { path: `${path}.${key}` });
      }
      assertDataOnly(descriptor.value, `${path}.${key}`, active, depth + 1);
    }
  } finally {
    active.delete(value);
  }
}

function snapshotData(value, path) {
  assertDataOnly(value, path);
  return deepFreeze(structuredClone(value));
}

function captureOwnedFields(value, fields, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw fail(503, 'STORAGE_TENANT_RUNTIME_DEPENDENCY_INVALID', 'A governed runtime dependency returned an invalid object.', { path });
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const captured = {};
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) {
      throw fail(503, 'STORAGE_TENANT_RUNTIME_DEPENDENCY_INVALID', 'A governed runtime dependency must return owned data properties.', { path: `${path}.${field}` });
    }
    captured[field] = descriptor.value;
  }
  return Object.freeze(captured);
}

function assertPackageBinding({ tenantId, operationId, context, executionPackage }) {
  const authorization = executionPackage.canaryAuthorization?.authorization;
  const operation = authorization?.operation;
  if (executionPackage.canaryAuthorization?.canary_ready !== true || !operation) {
    throw fail(409, 'STORAGE_TENANT_RUNTIME_CANARY_AUTHORIZATION_REQUIRED', 'A ready Tenant canary authorization is required.');
  }
  const mismatches = [];
  if (operation.tenant_id !== tenantId) mismatches.push('tenant_id');
  if (operation.operation_id !== operationId) mismatches.push('operation_id');
  if (context.capsule?.tenantRef !== tenantId) mismatches.push('capsule.tenantRef');
  if (context.capsule?.workspaceRef !== operation.workspace_id) mismatches.push('capsule.workspaceRef');
  if (context.capsule?.resourceRef !== operation.resource_id) mismatches.push('capsule.resourceRef');
  if (context.capsule?.contextHash !== operation.authority_context_hash) mismatches.push('capsule.contextHash');
  if (executionPackage.protocol?.operation_id !== operationId) mismatches.push('protocol.operation_id');
  if (executionPackage.protocol?.target_id !== operation.target_id) mismatches.push('protocol.target_id');
  if (mismatches.length) {
    throw fail(409, 'STORAGE_TENANT_RUNTIME_CONTEXT_BINDING_MISMATCH', 'Resolved Context Kernel evidence does not match the Tenant storage operation.', { mismatches: [...new Set(mismatches)].sort() });
  }
}

function projectTenantReadback(result) {
  const projection = result?.projection;
  if (!projection || projection.secrets_included !== false) {
    throw fail(500, 'STORAGE_TENANT_RUNTIME_READBACK_INVALID', 'Tenant-safe execution readback is required.');
  }
  const readback = {
    schema_version: 1,
    readback_key: 'hostinger_storage_tenant_runtime_readback_v1',
    tenant_id: projection.tenant_id,
    workspace_id: projection.workspace_id,
    resource_id: projection.resource_id,
    target_id: projection.target_id,
    operation_id: projection.operation_id,
    run_id: projection.run_id,
    plan_id: projection.plan_id,
    outcome: projection.outcome,
    retry_allowed: projection.retry_allowed === true,
    read_before_retry_required: projection.read_before_retry_required === true,
    counts: projection.counts || null,
    authorization_digest: projection.authorization_digest,
    result_digest: projection.result_digest || null,
    projection_digest: result.projection_digest,
    manual_enablement_consumed: projection.manual_enablement_consumed === true,
    synthetic_only: true,
    tenant_exclusive: true,
    live_provider_mutated: false,
    provider_dispatch_allowed: false,
    production_ready: false,
    secrets_included: false,
  };
  return deepFreeze(readback);
}

export function createHostingerStorageTenantRuntime({
  capsuleService = createExecutionCapsuleService(),
  resolveExecutionContext,
  loadExecutionPackage,
  emitTelemetry = async () => {},
} = {}) {
  if (!capsuleService || typeof capsuleService.validate !== 'function') {
    throw new TypeError('capsuleService.validate must be a function.');
  }
  if (typeof resolveExecutionContext !== 'function') {
    throw new TypeError('resolveExecutionContext must be a function.');
  }
  if (typeof loadExecutionPackage !== 'function') {
    throw new TypeError('loadExecutionPackage must be a function.');
  }
  if (typeof emitTelemetry !== 'function') throw new TypeError('emitTelemetry must be a function.');

  return Object.freeze({
    runtime_version: HOSTINGER_STORAGE_TENANT_RUNTIME_VERSION,
    synthetic_only: true,
    provider_dispatch_allowed: false,
    production_ready: false,
    async execute({ tenantId, userId, operationId, expectedSha } = {}) {
      const tenant = token(tenantId, 'tenantId');
      const user = token(userId, 'userId');
      const operation = token(operationId, 'operationId');
      const expected = sha(expectedSha, 'expectedSha');

      const contextRaw = await resolveExecutionContext({
        tenantId: tenant,
        userId: user,
        operationId: operation,
      });
      const contextFields = captureOwnedFields(contextRaw, REQUIRED_CONTEXT_FIELDS, 'resolvedContext');
      const context = Object.freeze({
        capsule: contextFields.capsule,
        governanceDecision: snapshotData(contextFields.governanceDecision, 'resolvedContext.governanceDecision'),
        currentContext: snapshotData(contextFields.currentContext, 'resolvedContext.currentContext'),
        currentDependencies: snapshotData(contextFields.currentDependencies, 'resolvedContext.currentDependencies'),
        dynamicEvidence: snapshotData(contextFields.dynamicEvidence, 'resolvedContext.dynamicEvidence'),
        now: snapshotData(contextFields.now, 'resolvedContext.now'),
      });

      const packageRaw = await loadExecutionPackage({
        tenantId: tenant,
        userId: user,
        operationId: operation,
      });
      const packageFields = captureOwnedFields(packageRaw, REQUIRED_PACKAGE_FIELDS, 'executionPackage');
      const executionPackage = Object.freeze({
        operationContract: snapshotData(packageFields.operationContract, 'executionPackage.operationContract'),
        canaryAuthorization: snapshotData(packageFields.canaryAuthorization, 'executionPackage.canaryAuthorization'),
        protocol: snapshotData(packageFields.protocol, 'executionPackage.protocol'),
        protocolDigest: String(packageFields.protocolDigest ?? '').trim().toLowerCase(),
        repository: packageFields.repository,
        adapter: packageFields.adapter,
        authorityStore: packageFields.authorityStore,
        enablementRegistry: packageFields.enablementRegistry,
        nowEpoch: Number(packageFields.nowEpoch),
      });
      if (!Number.isSafeInteger(executionPackage.nowEpoch) || executionPackage.nowEpoch < 0) {
        throw fail(503, 'STORAGE_TENANT_RUNTIME_TIME_INVALID', 'The governed execution package must include a non-negative epoch timestamp.');
      }
      assertPackageBinding({ tenantId: tenant, operationId: operation, context, executionPackage });

      const gate = createExecutionCapsuleMutationDispatchGate({
        enabled: true,
        capsuleService,
        dynamicEvidenceProvider: async ({ capsule, operationContract, dispatchInput }) => {
          if (capsule.capsuleHash !== context.capsule?.capsuleHash
            || operationContract.operationKey !== executionPackage.operationContract.operationKey
            || dispatchInput.operationId !== operation) {
            throw fail(409, 'STORAGE_TENANT_RUNTIME_CONTEXT_RERESOLUTION_REQUIRED', 'Runtime inputs changed after Context Kernel resolution.');
          }
          return {
            currentContext: context.currentContext,
            currentDependencies: context.currentDependencies,
            items: context.dynamicEvidence,
            now: context.now,
          };
        },
        dispatchMutationOperation: async (envelope) => {
          const executionContext = envelope.executionContext;
          const authorizationOperation = executionPackage.canaryAuthorization.authorization.operation;
          if (executionContext.tenantRef !== authorizationOperation.tenant_id
            || executionContext.workspaceRef !== authorizationOperation.workspace_id
            || executionContext.resourceRef !== authorizationOperation.resource_id
            || envelope.dispatchInput.operationId !== authorizationOperation.operation_id) {
            throw fail(409, 'STORAGE_TENANT_RUNTIME_DISPATCH_BINDING_MISMATCH', 'Mutation dispatch envelope no longer matches the Tenant canary authorization.');
          }
          return executeHostingerStorageTenantCanary({
            canary_authorization: executionPackage.canaryAuthorization,
            protocol: executionPackage.protocol,
            protocol_digest: executionPackage.protocolDigest,
            repository: executionPackage.repository,
            adapter: executionPackage.adapter,
            authority_store: executionPackage.authorityStore,
            enablement_registry: executionPackage.enablementRegistry,
            now_epoch: executionPackage.nowEpoch,
          });
        },
        emitTelemetry,
      });

      const result = await gate.dispatch({
        capsule: context.capsule,
        operationContract: executionPackage.operationContract,
        governanceDecision: context.governanceDecision,
        dispatchInput: Object.freeze({ operationId: operation, expectedSha: expected }),
      });
      const readback = projectTenantReadback(result);
      return deepFreeze({
        ok: true,
        runtime_version: HOSTINGER_STORAGE_TENANT_RUNTIME_VERSION,
        operation_id: operation,
        outcome: readback.outcome,
        readback,
        synthetic_only: true,
        provider_dispatch_allowed: false,
        production_ready: false,
        secrets_included: false,
      });
    },
  });
}
