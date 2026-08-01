import { createHash } from 'node:crypto';
import { executeHostingerStorageSyntheticPlan } from './hostingerStorageSyntheticExecutor.js';
import { verifyHostingerStorageTenantCanaryAuthorization } from './hostingerStorageTenantCanaryPolicy.js';

export const HOSTINGER_STORAGE_TENANT_CANARY_VERSION = 'spec014-hostinger-storage-tenant-canary-v1';

const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;
const SHA256_RE = /^[0-9a-f]{64}$/i;

function fail(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = { ...details, secrets_included: false };
  return error;
}

function text(value, max = 512) {
  return String(value ?? '').trim().slice(0, max);
}

function safeId(value, field) {
  const normalized = text(value, 256);
  if (!SAFE_ID_RE.test(normalized)) throw fail(400, 'STORAGE_TENANT_CANARY_IDENTIFIER_INVALID', 'A safe bounded identifier is required.', { field });
  return normalized;
}

function hash(value, field) {
  const normalized = text(value, 64).toLowerCase();
  if (!SHA256_RE.test(normalized)) throw fail(400, 'STORAGE_TENANT_CANARY_HASH_INVALID', 'A SHA-256 binding is required.', { field });
  return normalized;
}

function epoch(value, field) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) throw fail(400, 'STORAGE_TENANT_CANARY_TIME_INVALID', 'A non-negative epoch timestamp is required.', { field });
  return normalized;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry);
  return value;
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

export function createMemoryHostingerStorageTenantCanaryEnablementRegistry() {
  const records = new Map();
  const registry = {
    adapter_key: 'memory_hostinger_storage_tenant_canary_enablement_v1',
    synthetic_only: true,
    production_ready: false,
    register(record) {
      const normalized = {
        enablement_id: safeId(record?.enablement_id, 'enablement.enablement_id'),
        authorization_digest: hash(record?.authorization_digest, 'enablement.authorization_digest'),
        operation_id: safeId(record?.operation_id, 'enablement.operation_id'),
        run_id: safeId(record?.run_id, 'enablement.run_id'),
        generation: Number(record?.generation),
        expires_at_epoch: epoch(record?.expires_at_epoch, 'enablement.expires_at_epoch'),
        consumed: false,
        consumed_by_run_id: null,
        consumed_at_epoch: null,
        secrets_included: false,
      };
      if (!Number.isSafeInteger(normalized.generation) || normalized.generation < 1) {
        throw fail(400, 'STORAGE_TENANT_CANARY_ENABLEMENT_GENERATION_INVALID', 'A positive generation is required.');
      }
      const existing = records.get(normalized.enablement_id);
      if (existing && digest(existing) !== digest(normalized)) {
        throw fail(409, 'STORAGE_TENANT_CANARY_ENABLEMENT_ID_CONFLICT', 'Enablement ID is bound to different evidence.');
      }
      if (!existing) records.set(normalized.enablement_id, deepFreeze(normalized));
      return clone(records.get(normalized.enablement_id));
    },
    read(enablementId) {
      return clone(records.get(safeId(enablementId, 'enablement_id')) || null);
    },
    consume({ enablement_id, authorization_digest, operation_id, run_id, expected_generation, now_epoch }) {
      const id = safeId(enablement_id, 'enablement_id');
      const current = records.get(id);
      if (!current) throw fail(404, 'STORAGE_TENANT_CANARY_ENABLEMENT_NOT_FOUND', 'Manual canary enablement record was not registered.');
      const now = epoch(now_epoch, 'now_epoch');
      if (current.authorization_digest !== hash(authorization_digest, 'authorization_digest')
        || current.operation_id !== safeId(operation_id, 'operation_id')
        || current.run_id !== safeId(run_id, 'run_id')) {
        throw fail(409, 'STORAGE_TENANT_CANARY_ENABLEMENT_BINDING_MISMATCH', 'Manual enablement is not bound to this authorization and run.');
      }
      if (Number(current.generation) !== Number(expected_generation)) {
        throw fail(409, 'STORAGE_TENANT_CANARY_ENABLEMENT_GENERATION_MISMATCH', 'Manual enablement generation changed.', { current_generation: current.generation });
      }
      if (current.consumed) throw fail(409, 'STORAGE_TENANT_CANARY_ENABLEMENT_ALREADY_CONSUMED', 'Manual canary enablement is one-shot and was already consumed.');
      if (current.expires_at_epoch <= now) throw fail(409, 'STORAGE_TENANT_CANARY_ENABLEMENT_EXPIRED', 'Manual canary enablement expired before consumption.');
      const next = deepFreeze({
        ...current,
        generation: current.generation + 1,
        consumed: true,
        consumed_by_run_id: current.run_id,
        consumed_at_epoch: now,
      });
      records.set(id, next);
      return clone(next);
    },
    exportState() {
      return clone([...records.values()].sort((left, right) => left.enablement_id.localeCompare(right.enablement_id)));
    },
  };
  return Object.freeze(registry);
}

function requireRegistry(registry) {
  if (!registry || registry.synthetic_only !== true || registry.production_ready !== false
    || typeof registry.read !== 'function' || typeof registry.consume !== 'function') {
    throw fail(409, 'STORAGE_TENANT_CANARY_ENABLEMENT_REGISTRY_INVALID', 'A non-production one-shot enablement registry is required.');
  }
}

function requireControlPlaneRepository(repository) {
  if (!repository || repository.production_ready === true || typeof repository.readAggregate !== 'function') {
    throw fail(409, 'STORAGE_TENANT_CANARY_CONTROL_PLANE_INVALID', 'Tenant canary requires the non-production governed control-plane repository.');
  }
}

export function executeHostingerStorageTenantCanary({
  canary_authorization,
  protocol,
  protocol_digest,
  repository,
  adapter,
  enablement_registry,
  fault = null,
  now_epoch = Math.floor(Date.now() / 1000),
} = {}) {
  const now = epoch(now_epoch, 'now_epoch');
  if (canary_authorization?.canary_ready !== true || !canary_authorization?.authorization) {
    throw fail(409, 'STORAGE_TENANT_CANARY_AUTHORIZATION_REQUIRED', 'A ready Tenant canary authorization is required.', { blockers: canary_authorization?.blockers || [] });
  }
  const verification = verifyHostingerStorageTenantCanaryAuthorization({
    authorization: canary_authorization.authorization,
    expected_digest: canary_authorization.authorization_digest,
    now_epoch: now,
  });
  if (!verification.valid) {
    throw fail(409, 'STORAGE_TENANT_CANARY_AUTHORIZATION_INVALID', 'Tenant canary authorization is stale or blocked.', { blockers: verification.blockers });
  }
  requireRegistry(enablement_registry);
  requireControlPlaneRepository(repository);

  const authorization = canary_authorization.authorization;
  const operationId = authorization.operation.operation_id;
  const aggregate = repository.readAggregate(operationId);
  if (!aggregate?.operation) throw fail(404, 'STORAGE_TENANT_CANARY_OPERATION_NOT_FOUND', 'Canary operation aggregate was not found.');
  const current = aggregate.operation;
  const mismatches = [];
  for (const field of ['tenant_id', 'workspace_id', 'resource_id', 'target_id', 'authority_context_hash', 'ownership_revision', 'policy_revision']) {
    if (current[field] !== authorization.operation[field]) mismatches.push(field);
  }
  if (current.context_mode !== 'tenant') mismatches.push('context_mode');
  if (protocol?.operation_id !== operationId) mismatches.push('protocol.operation_id');
  if (protocol?.target_id !== authorization.operation.target_id) mismatches.push('protocol.target_id');
  if (protocol?.plan_hash !== authorization.protocol.plan_hash) mismatches.push('protocol.plan_hash');
  if (protocol?.run_id !== authorization.protocol.run_id) mismatches.push('protocol.run_id');
  if (hash(protocol_digest, 'protocol_digest') !== authorization.protocol.protocol_digest) mismatches.push('protocol_digest');
  if (mismatches.length) {
    throw fail(409, 'STORAGE_TENANT_CANARY_CURRENT_BINDING_MISMATCH', 'Current Tenant canary context differs from the authorized context.', { mismatches });
  }

  const enablement = authorization.manual_enablement;
  const registered = enablement_registry.read(enablement.enablement_id);
  if (!registered) throw fail(404, 'STORAGE_TENANT_CANARY_ENABLEMENT_NOT_FOUND', 'Manual canary enablement was not registered.');
  enablement_registry.consume({
    enablement_id: enablement.enablement_id,
    authorization_digest: canary_authorization.authorization_digest,
    operation_id: operationId,
    run_id: authorization.protocol.run_id,
    expected_generation: enablement.generation,
    now_epoch: now,
  });

  const execution = executeHostingerStorageSyntheticPlan({
    protocol,
    protocol_digest,
    repository,
    adapter,
    fault,
    now_epoch: now,
  });
  const projection = {
    schema_version: 1,
    projection_key: 'hostinger_storage_tenant_canary_result_v1',
    canary_version: HOSTINGER_STORAGE_TENANT_CANARY_VERSION,
    tenant_id: authorization.operation.tenant_id,
    workspace_id: authorization.operation.workspace_id,
    resource_id: authorization.operation.resource_id,
    target_id: authorization.operation.target_id,
    operation_id: operationId,
    run_id: authorization.protocol.run_id,
    plan_id: authorization.protocol.plan_id,
    outcome: execution.outcome || execution.state || 'unknown_outcome',
    retry_allowed: execution.retry_allowed === true,
    read_before_retry_required: execution.read_before_retry_required === true,
    counts: execution.counts || null,
    authorization_digest: canary_authorization.authorization_digest,
    result_digest: execution.result_digest || null,
    manual_enablement_consumed: true,
    synthetic_only: true,
    tenant_exclusive: true,
    live_provider_mutated: false,
    dispatch_allowed: false,
    production_ready: false,
    secrets_included: false,
  };
  return deepFreeze({
    ok: true,
    outcome: projection.outcome,
    projection,
    projection_digest: digest(projection),
    dispatch_allowed: false,
    live_provider_mutated: false,
    production_ready: false,
    secrets_included: false,
  });
}
