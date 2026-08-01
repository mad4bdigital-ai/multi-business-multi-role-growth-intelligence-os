import { createHash } from 'node:crypto';
import { executeHostingerStorageSyntheticPlan } from './hostingerStorageSyntheticExecutor.js';
import { verifyHostingerStorageTenantCanaryAuthorization } from './hostingerStorageTenantCanaryPolicy.js';

export const HOSTINGER_STORAGE_TENANT_CANARY_VERSION = 'spec014-hostinger-storage-tenant-canary-v1';

const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;
const SAFE_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,510}$/;
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

function safeRef(value, field) {
  const normalized = text(value, 512);
  if (!SAFE_REF_RE.test(normalized) || normalized.startsWith('/') || normalized.includes('..') || /[\\\0\r\n]/u.test(normalized)) {
    throw fail(400, 'STORAGE_TENANT_CANARY_REFERENCE_INVALID', 'A bounded opaque reference is required.', { field });
  }
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

function normalizeCurrentAllowlist(record = {}) {
  return {
    allowlist_id: safeId(record.allowlist_id, 'allowlist.allowlist_id'),
    revision: safeId(record.revision, 'allowlist.revision'),
    status: safeId(record.status, 'allowlist.status'),
    environment: safeId(record.environment, 'allowlist.environment'),
    target_scope: safeId(record.target_scope, 'allowlist.target_scope'),
    tenant_id: safeId(record.tenant_id, 'allowlist.tenant_id'),
    workspace_id: safeId(record.workspace_id, 'allowlist.workspace_id'),
    resource_id: safeId(record.resource_id, 'allowlist.resource_id'),
    target_id: safeId(record.target_id, 'allowlist.target_id'),
    root_ref: safeRef(record.root_ref, 'allowlist.root_ref'),
    path_ref_prefix: safeRef(record.path_ref_prefix, 'allowlist.path_ref_prefix'),
    shared_target: record.shared_target === true,
    platform_target: record.platform_target === true,
    valid_from_epoch: epoch(record.valid_from_epoch, 'allowlist.valid_from_epoch'),
    expires_at_epoch: epoch(record.expires_at_epoch, 'allowlist.expires_at_epoch'),
    max_items: Number(record.max_items),
    max_bytes: Number(record.max_bytes),
    evidence_digest: hash(record.evidence_digest, 'allowlist.evidence_digest'),
    secrets_included: false,
  };
}

function normalizeCurrentApproval(record = {}) {
  return {
    approval_id: safeId(record.approval_id, 'approval.approval_id'),
    slot: safeId(record.slot, 'approval.slot'),
    status: safeId(record.status, 'approval.status'),
    tenant_id: safeId(record.tenant_id, 'approval.tenant_id'),
    workspace_id: safeId(record.workspace_id, 'approval.workspace_id'),
    operation_id: safeId(record.operation_id, 'approval.operation_id'),
    target_id: safeId(record.target_id, 'approval.target_id'),
    plan_hash: hash(record.plan_hash, 'approval.plan_hash'),
    authority_context_hash: hash(record.authority_context_hash, 'approval.authority_context_hash'),
    approver_role: safeId(record.approver_role, 'approval.approver_role'),
    approved_at_epoch: epoch(record.approved_at_epoch, 'approval.approved_at_epoch'),
    expires_at_epoch: epoch(record.expires_at_epoch, 'approval.expires_at_epoch'),
    evidence_digest: hash(record.evidence_digest, 'approval.evidence_digest'),
    secrets_included: false,
  };
}

export function createMemoryHostingerStorageTenantCanaryAuthorityStore() {
  const allowlists = new Map();
  const approvals = new Map();
  const store = {
    adapter_key: 'memory_hostinger_storage_tenant_canary_authority_v1',
    synthetic_only: true,
    production_ready: false,
    registerAllowlist(record) {
      const normalized = deepFreeze(normalizeCurrentAllowlist(record));
      const existing = allowlists.get(normalized.allowlist_id);
      if (existing && digest(existing) !== digest(normalized)) {
        throw fail(409, 'STORAGE_TENANT_CANARY_ALLOWLIST_ID_CONFLICT', 'Allowlist ID is already bound to different authority evidence.');
      }
      if (!existing) allowlists.set(normalized.allowlist_id, normalized);
      return clone(allowlists.get(normalized.allowlist_id));
    },
    updateAllowlist({ allowlist_id, expected_revision, record } = {}) {
      const id = safeId(allowlist_id, 'allowlist_id');
      const current = allowlists.get(id);
      if (!current) throw fail(404, 'STORAGE_TENANT_CANARY_ALLOWLIST_NOT_FOUND', 'Authoritative allowlist record was not found.');
      if (current.revision !== safeId(expected_revision, 'expected_revision')) {
        throw fail(409, 'STORAGE_TENANT_CANARY_ALLOWLIST_REVISION_CONFLICT', 'Allowlist revision changed before update.', { current_revision: current.revision });
      }
      const normalized = deepFreeze(normalizeCurrentAllowlist({ ...record, allowlist_id: id }));
      allowlists.set(id, normalized);
      return clone(normalized);
    },
    readAllowlist(allowlistId) {
      return clone(allowlists.get(safeId(allowlistId, 'allowlist_id')) || null);
    },
    registerApproval(record) {
      const normalized = deepFreeze(normalizeCurrentApproval(record));
      const existing = approvals.get(normalized.approval_id);
      if (existing && digest(existing) !== digest(normalized)) {
        throw fail(409, 'STORAGE_TENANT_CANARY_APPROVAL_ID_CONFLICT', 'Approval ID is already bound to different authority evidence.');
      }
      if (!existing) approvals.set(normalized.approval_id, normalized);
      return clone(approvals.get(normalized.approval_id));
    },
    updateApproval({ approval_id, expected_evidence_digest, record } = {}) {
      const id = safeId(approval_id, 'approval_id');
      const current = approvals.get(id);
      if (!current) throw fail(404, 'STORAGE_TENANT_CANARY_APPROVAL_NOT_FOUND', 'Authoritative approval record was not found.');
      if (current.evidence_digest !== hash(expected_evidence_digest, 'expected_evidence_digest')) {
        throw fail(409, 'STORAGE_TENANT_CANARY_APPROVAL_EVIDENCE_CONFLICT', 'Approval evidence changed before update.');
      }
      const normalized = deepFreeze(normalizeCurrentApproval({ ...record, approval_id: id }));
      approvals.set(id, normalized);
      return clone(normalized);
    },
    readApproval(approvalId) {
      return clone(approvals.get(safeId(approvalId, 'approval_id')) || null);
    },
    exportState() {
      return clone({
        allowlists: [...allowlists.values()].sort((left, right) => left.allowlist_id.localeCompare(right.allowlist_id)),
        approvals: [...approvals.values()].sort((left, right) => left.approval_id.localeCompare(right.approval_id)),
      });
    },
  };
  return Object.freeze(store);
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

function requireAuthorityStore(store) {
  if (!store || store.synthetic_only !== true || store.production_ready !== false
    || typeof store.readAllowlist !== 'function' || typeof store.readApproval !== 'function') {
    throw fail(409, 'STORAGE_TENANT_CANARY_AUTHORITY_STORE_INVALID', 'A non-production authoritative canary store is required.');
  }
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

function revalidateCurrentAuthority({ authorization, authorityStore, now }) {
  const signedAllowlist = authorization.allowlist;
  const currentAllowlist = authorityStore.readAllowlist(signedAllowlist.allowlist_id);
  if (!currentAllowlist) throw fail(404, 'STORAGE_TENANT_CANARY_ALLOWLIST_NOT_FOUND', 'Current authoritative allowlist was not found.');
  const allowlistMismatches = [];
  for (const field of ['revision', 'environment', 'target_scope', 'tenant_id', 'workspace_id', 'resource_id', 'target_id', 'root_ref', 'path_ref_prefix', 'max_items', 'max_bytes', 'evidence_digest']) {
    if (currentAllowlist[field] !== signedAllowlist[field]) allowlistMismatches.push(field);
  }
  if (currentAllowlist.status !== 'active') allowlistMismatches.push('status');
  if (currentAllowlist.shared_target !== false) allowlistMismatches.push('shared_target');
  if (currentAllowlist.platform_target !== false) allowlistMismatches.push('platform_target');
  if (currentAllowlist.valid_from_epoch > now || currentAllowlist.expires_at_epoch <= now) allowlistMismatches.push('time_window');
  if (allowlistMismatches.length) {
    throw fail(409, 'STORAGE_TENANT_CANARY_ALLOWLIST_CURRENT_STATE_INVALID', 'Current allowlist no longer matches the authorized Tenant-exclusive scope.', { mismatches: [...new Set(allowlistMismatches)].sort() });
  }

  const signedApproval = authorization.workspace_owner_approval;
  const currentApproval = authorityStore.readApproval(signedApproval.approval_id);
  if (!currentApproval) throw fail(404, 'STORAGE_TENANT_CANARY_APPROVAL_NOT_FOUND', 'Current authoritative Workspace Owner approval was not found.');
  const approvalMismatches = [];
  for (const field of ['slot', 'tenant_id', 'workspace_id', 'operation_id', 'target_id', 'plan_hash', 'authority_context_hash', 'approver_role', 'approved_at_epoch', 'evidence_digest']) {
    if (currentApproval[field] !== signedApproval[field]) approvalMismatches.push(field);
  }
  if (currentApproval.status !== 'approved') approvalMismatches.push('status');
  if (currentApproval.expires_at_epoch <= now) approvalMismatches.push('expires_at_epoch');
  if (approvalMismatches.length) {
    throw fail(409, 'STORAGE_TENANT_CANARY_APPROVAL_CURRENT_STATE_INVALID', 'Current Workspace Owner approval no longer authorizes this canary.', { mismatches: [...new Set(approvalMismatches)].sort() });
  }
  return { allowlist: currentAllowlist, approval: currentApproval };
}

export function executeHostingerStorageTenantCanary({
  canary_authorization,
  protocol,
  protocol_digest,
  repository,
  adapter,
  authority_store,
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
  requireAuthorityStore(authority_store);
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
  if (protocol?.protocol_version !== authorization.protocol.protocol_version) mismatches.push('protocol.protocol_version');
  if (protocol?.operation_id !== operationId) mismatches.push('protocol.operation_id');
  if (protocol?.target_id !== authorization.operation.target_id) mismatches.push('protocol.target_id');
  if (protocol?.plan_hash !== authorization.protocol.plan_hash) mismatches.push('protocol.plan_hash');
  if (protocol?.run_id !== authorization.protocol.run_id) mismatches.push('protocol.run_id');
  if (hash(protocol_digest, 'protocol_digest') !== authorization.protocol.protocol_digest) mismatches.push('protocol_digest');
  if (mismatches.length) {
    throw fail(409, 'STORAGE_TENANT_CANARY_CURRENT_BINDING_MISMATCH', 'Current Tenant canary context differs from the authorized context.', { mismatches });
  }

  revalidateCurrentAuthority({ authorization, authorityStore: authority_store, now });

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
