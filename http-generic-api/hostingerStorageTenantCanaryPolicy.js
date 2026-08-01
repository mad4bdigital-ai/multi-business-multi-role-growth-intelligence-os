import { createHash } from 'node:crypto';

export const HOSTINGER_STORAGE_TENANT_CANARY_POLICY_VERSION = 'spec014-hostinger-storage-tenant-canary-policy-v1';

const EXPECTED_SYNTHETIC_PROTOCOL_VERSION = 'spec014-hostinger-storage-executor-v1';
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
  if (!SAFE_ID_RE.test(normalized)) {
    throw fail(400, 'STORAGE_TENANT_CANARY_IDENTIFIER_INVALID', 'A safe bounded identifier is required.', { field });
  }
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
  if (!SHA256_RE.test(normalized)) {
    throw fail(400, 'STORAGE_TENANT_CANARY_HASH_INVALID', 'A SHA-256 binding is required.', { field });
  }
  return normalized;
}

function epoch(value, field) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw fail(400, 'STORAGE_TENANT_CANARY_TIME_INVALID', 'A non-negative epoch timestamp is required.', { field });
  }
  return normalized;
}

function positiveInteger(value, field) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    throw fail(400, 'STORAGE_TENANT_CANARY_LIMIT_INVALID', 'A positive integer limit is required.', { field });
  }
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

function unique(values = []) {
  return [...new Set(values.filter(Boolean))].sort();
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry);
  return value;
}

function assertSecretFree(value, path = 'value', depth = 0, ancestors = new WeakSet()) {
  if (depth > 16 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSecretFree(entry, `${path}[${index}]`, depth + 1, ancestors));
    return;
  }
  if (typeof value !== 'object') return;
  if (ancestors.has(value)) throw fail(400, 'STORAGE_TENANT_CANARY_SECRET_FIELD_REJECTED', 'Cyclic canary input is forbidden.', { path });
  ancestors.add(value);
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'secrets_included' && entry !== false) {
      throw fail(400, 'STORAGE_TENANT_CANARY_SECRET_FIELD_REJECTED', 'Secret declaration must remain false.', { path: `${path}.${key}` });
    }
    if (key !== 'secrets_included' && /(password|passwd|secret|private[_-]?key|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization_header|raw_authorization|cookie|session_cookie|raw_provider_payload|absolute_path|shell_command|file_content)/i.test(key)) {
      throw fail(400, 'STORAGE_TENANT_CANARY_SECRET_FIELD_REJECTED', 'Canary inputs must not contain secret-bearing or free-form execution fields.', { path: `${path}.${key}` });
    }
    assertSecretFree(entry, `${path}.${key}`, depth + 1, ancestors);
  }
  ancestors.delete(value);
}

function normalizeOperation(operation = {}) {
  return {
    operation_id: safeId(operation.operation_id, 'operation.operation_id'),
    operation_key: safeId(operation.operation_key, 'operation.operation_key'),
    tenant_id: safeId(operation.tenant_id, 'operation.tenant_id'),
    workspace_id: safeId(operation.workspace_id, 'operation.workspace_id'),
    resource_id: safeId(operation.resource_id, 'operation.resource_id'),
    target_id: safeId(operation.target_id, 'operation.target_id'),
    context_mode: safeId(operation.context_mode, 'operation.context_mode'),
    authority_context_hash: hash(operation.authority_context_hash, 'operation.authority_context_hash'),
    ownership_revision: safeId(operation.ownership_revision, 'operation.ownership_revision'),
    policy_revision: safeId(operation.policy_revision, 'operation.policy_revision'),
  };
}

function normalizeProtocol(protocol = {}) {
  const items = Array.isArray(protocol.items) ? protocol.items : [];
  let totalBytes = 0;
  for (const [index, item] of items.entries()) {
    const size = Number(item?.expected?.size_bytes);
    if (!Number.isSafeInteger(size) || size < 0 || !Number.isSafeInteger(totalBytes + size)) {
      throw fail(400, 'STORAGE_TENANT_CANARY_PROTOCOL_SIZE_INVALID', 'Synthetic item sizes must be bounded non-negative integers.', { index });
    }
    totalBytes += size;
  }
  return {
    protocol_key: safeId(protocol.protocol_key, 'protocol.protocol_key'),
    protocol_version: safeId(protocol.protocol_version, 'protocol.protocol_version'),
    run_id: safeId(protocol.run_id, 'protocol.run_id'),
    operation_id: safeId(protocol.operation_id, 'protocol.operation_id'),
    plan_id: safeId(protocol.plan_id, 'protocol.plan_id'),
    target_id: safeId(protocol.target_id, 'protocol.target_id'),
    plan_hash: hash(protocol.plan_hash, 'protocol.plan_hash'),
    candidate_set_hash: hash(protocol.candidate_set_hash, 'protocol.candidate_set_hash'),
    authorization_bundle_hash: hash(protocol.authorization_bundle_hash, 'protocol.authorization_bundle_hash'),
    synthetic_only: protocol.synthetic_only === true,
    production_ready: protocol.production_ready === true,
    provider_dispatch_allowed: protocol.provider_dispatch_allowed === true,
    automatic_retry_allowed: protocol.automatic_retry_allowed === true,
    item_count: items.length,
    total_bytes: totalBytes,
    path_refs: items.map((item, index) => safeRef(item?.path_ref, `protocol.items[${index}].path_ref`)),
  };
}

function normalizeAllowlist(entry = {}) {
  return {
    allowlist_id: safeId(entry.allowlist_id, 'allowlist.allowlist_id'),
    revision: safeId(entry.revision, 'allowlist.revision'),
    status: safeId(entry.status, 'allowlist.status'),
    environment: safeId(entry.environment, 'allowlist.environment'),
    target_scope: safeId(entry.target_scope, 'allowlist.target_scope'),
    tenant_id: safeId(entry.tenant_id, 'allowlist.tenant_id'),
    workspace_id: safeId(entry.workspace_id, 'allowlist.workspace_id'),
    resource_id: safeId(entry.resource_id, 'allowlist.resource_id'),
    target_id: safeId(entry.target_id, 'allowlist.target_id'),
    root_ref: safeRef(entry.root_ref, 'allowlist.root_ref'),
    path_ref_prefix: safeRef(entry.path_ref_prefix, 'allowlist.path_ref_prefix'),
    shared_target: entry.shared_target === true,
    platform_target: entry.platform_target === true,
    valid_from_epoch: epoch(entry.valid_from_epoch, 'allowlist.valid_from_epoch'),
    expires_at_epoch: epoch(entry.expires_at_epoch, 'allowlist.expires_at_epoch'),
    max_items: positiveInteger(entry.max_items, 'allowlist.max_items'),
    max_bytes: positiveInteger(entry.max_bytes, 'allowlist.max_bytes'),
    evidence_digest: hash(entry.evidence_digest, 'allowlist.evidence_digest'),
  };
}

function normalizeApproval(approval = {}) {
  return {
    approval_id: safeId(approval.approval_id, 'approval.approval_id'),
    slot: safeId(approval.slot, 'approval.slot'),
    status: safeId(approval.status, 'approval.status'),
    tenant_id: safeId(approval.tenant_id, 'approval.tenant_id'),
    workspace_id: safeId(approval.workspace_id, 'approval.workspace_id'),
    operation_id: safeId(approval.operation_id, 'approval.operation_id'),
    target_id: safeId(approval.target_id, 'approval.target_id'),
    plan_hash: hash(approval.plan_hash, 'approval.plan_hash'),
    authority_context_hash: hash(approval.authority_context_hash, 'approval.authority_context_hash'),
    approver_role: safeId(approval.approver_role, 'approval.approver_role'),
    approved_at_epoch: epoch(approval.approved_at_epoch, 'approval.approved_at_epoch'),
    expires_at_epoch: epoch(approval.expires_at_epoch, 'approval.expires_at_epoch'),
    evidence_digest: hash(approval.evidence_digest, 'approval.evidence_digest'),
  };
}

function normalizeEnablement(enablement = {}) {
  return {
    enablement_id: safeId(enablement.enablement_id, 'enablement.enablement_id'),
    mode: safeId(enablement.mode, 'enablement.mode'),
    status: safeId(enablement.status, 'enablement.status'),
    tenant_id: safeId(enablement.tenant_id, 'enablement.tenant_id'),
    workspace_id: safeId(enablement.workspace_id, 'enablement.workspace_id'),
    resource_id: safeId(enablement.resource_id, 'enablement.resource_id'),
    operation_id: safeId(enablement.operation_id, 'enablement.operation_id'),
    target_id: safeId(enablement.target_id, 'enablement.target_id'),
    plan_hash: hash(enablement.plan_hash, 'enablement.plan_hash'),
    allowlist_revision: safeId(enablement.allowlist_revision, 'enablement.allowlist_revision'),
    approved_by_role: safeId(enablement.approved_by_role, 'enablement.approved_by_role'),
    enabled_at_epoch: epoch(enablement.enabled_at_epoch, 'enablement.enabled_at_epoch'),
    expires_at_epoch: epoch(enablement.expires_at_epoch, 'enablement.expires_at_epoch'),
    generation: positiveInteger(enablement.generation, 'enablement.generation'),
    consumed: enablement.consumed === true,
    evidence_digest: hash(enablement.evidence_digest, 'enablement.evidence_digest'),
  };
}

export function buildHostingerStorageTenantCanaryAuthorization({
  operation,
  protocol,
  protocol_digest,
  allowlist_entry,
  workspace_owner_approval,
  manual_enablement,
  now_epoch = Math.floor(Date.now() / 1000),
} = {}) {
  assertSecretFree({ operation, protocol, allowlist_entry, workspace_owner_approval, manual_enablement }, 'tenant_canary');
  const now = epoch(now_epoch, 'now_epoch');
  const normalizedOperation = normalizeOperation(operation);
  const normalizedProtocol = normalizeProtocol(protocol);
  const allowlist = normalizeAllowlist(allowlist_entry);
  const approval = normalizeApproval(workspace_owner_approval);
  const enablement = normalizeEnablement(manual_enablement);
  const blockers = [];

  if (normalizedOperation.context_mode !== 'tenant') blockers.push('STORAGE_TENANT_CANARY_CONTEXT_REQUIRED');
  if (normalizedOperation.operation_key !== 'hostinger_storage_apply_plan') blockers.push('STORAGE_TENANT_CANARY_OPERATION_KEY_INVALID');
  if (normalizedProtocol.protocol_key !== 'hostinger_storage_synthetic_execution_protocol_v1') blockers.push('STORAGE_TENANT_CANARY_SYNTHETIC_PROTOCOL_REQUIRED');
  if (normalizedProtocol.protocol_version !== EXPECTED_SYNTHETIC_PROTOCOL_VERSION) blockers.push('STORAGE_TENANT_CANARY_PROTOCOL_VERSION_INVALID');
  if (normalizedProtocol.item_count < 1) blockers.push('STORAGE_TENANT_CANARY_ITEMS_REQUIRED');
  if (!normalizedProtocol.synthetic_only || normalizedProtocol.production_ready || normalizedProtocol.provider_dispatch_allowed || normalizedProtocol.automatic_retry_allowed) {
    blockers.push('STORAGE_TENANT_CANARY_UNSAFE_PROTOCOL');
  }
  if (hash(protocol_digest, 'protocol_digest') !== digest(protocol)) blockers.push('STORAGE_TENANT_CANARY_PROTOCOL_DIGEST_MISMATCH');
  if (normalizedProtocol.operation_id !== normalizedOperation.operation_id) blockers.push('STORAGE_TENANT_CANARY_OPERATION_MISMATCH');
  if (normalizedProtocol.target_id !== normalizedOperation.target_id) blockers.push('STORAGE_TENANT_CANARY_TARGET_MISMATCH');

  if (allowlist.status !== 'active') blockers.push('STORAGE_TENANT_CANARY_ALLOWLIST_INACTIVE');
  if (allowlist.environment !== 'synthetic_non_production') blockers.push('STORAGE_TENANT_CANARY_NON_PRODUCTION_REQUIRED');
  if (allowlist.target_scope !== 'tenant_exclusive' || allowlist.shared_target || allowlist.platform_target) blockers.push('STORAGE_TENANT_CANARY_TENANT_EXCLUSIVE_TARGET_REQUIRED');
  if (allowlist.valid_from_epoch > now || allowlist.expires_at_epoch <= now) blockers.push('STORAGE_TENANT_CANARY_ALLOWLIST_EXPIRED');
  if (!allowlist.path_ref_prefix.endsWith('/')) blockers.push('STORAGE_TENANT_CANARY_PATH_PREFIX_BOUNDARY_REQUIRED');
  for (const field of ['tenant_id', 'workspace_id', 'resource_id', 'target_id']) {
    if (allowlist[field] !== normalizedOperation[field]) blockers.push(`STORAGE_TENANT_CANARY_ALLOWLIST_${field.toUpperCase()}_MISMATCH`);
  }
  if (normalizedProtocol.item_count > allowlist.max_items) blockers.push('STORAGE_TENANT_CANARY_ITEM_LIMIT_EXCEEDED');
  if (normalizedProtocol.total_bytes > allowlist.max_bytes) blockers.push('STORAGE_TENANT_CANARY_BYTE_LIMIT_EXCEEDED');
  if (!normalizedProtocol.path_refs.every((pathRef) => pathRef.startsWith(allowlist.path_ref_prefix))) blockers.push('STORAGE_TENANT_CANARY_PATH_PREFIX_MISMATCH');

  const expectedSlot = `workspace_owner:${normalizedOperation.workspace_id}`;
  if (approval.status !== 'approved' || approval.slot !== expectedSlot || approval.approver_role !== 'workspace_owner') blockers.push('STORAGE_TENANT_CANARY_WORKSPACE_OWNER_APPROVAL_REQUIRED');
  if (approval.approved_at_epoch > now || approval.expires_at_epoch <= now) blockers.push('STORAGE_TENANT_CANARY_APPROVAL_EXPIRED');
  if (approval.tenant_id !== normalizedOperation.tenant_id || approval.workspace_id !== normalizedOperation.workspace_id
    || approval.operation_id !== normalizedOperation.operation_id || approval.target_id !== normalizedOperation.target_id
    || approval.plan_hash !== normalizedProtocol.plan_hash || approval.authority_context_hash !== normalizedOperation.authority_context_hash) {
    blockers.push('STORAGE_TENANT_CANARY_APPROVAL_BINDING_MISMATCH');
  }

  if (enablement.mode !== 'manual_one_shot' || enablement.status !== 'enabled' || enablement.approved_by_role !== 'workspace_owner' || enablement.consumed) {
    blockers.push('STORAGE_TENANT_CANARY_MANUAL_ENABLEMENT_REQUIRED');
  }
  if (enablement.enabled_at_epoch > now || enablement.expires_at_epoch <= now) blockers.push('STORAGE_TENANT_CANARY_ENABLEMENT_EXPIRED');
  if (enablement.allowlist_revision !== allowlist.revision) blockers.push('STORAGE_TENANT_CANARY_ENABLEMENT_ALLOWLIST_MISMATCH');
  for (const field of ['tenant_id', 'workspace_id', 'resource_id', 'operation_id', 'target_id']) {
    const expected = field === 'operation_id' ? normalizedOperation.operation_id : normalizedOperation[field];
    if (enablement[field] !== expected) blockers.push(`STORAGE_TENANT_CANARY_ENABLEMENT_${field.toUpperCase()}_MISMATCH`);
  }
  if (enablement.plan_hash !== normalizedProtocol.plan_hash) blockers.push('STORAGE_TENANT_CANARY_ENABLEMENT_PLAN_MISMATCH');

  const core = {
    schema_version: 1,
    authorization_key: 'hostinger_storage_tenant_canary_authorization_v1',
    policy_version: HOSTINGER_STORAGE_TENANT_CANARY_POLICY_VERSION,
    operation: normalizedOperation,
    protocol: {
      protocol_version: normalizedProtocol.protocol_version,
      run_id: normalizedProtocol.run_id,
      operation_id: normalizedProtocol.operation_id,
      plan_id: normalizedProtocol.plan_id,
      target_id: normalizedProtocol.target_id,
      plan_hash: normalizedProtocol.plan_hash,
      candidate_set_hash: normalizedProtocol.candidate_set_hash,
      authorization_bundle_hash: normalizedProtocol.authorization_bundle_hash,
      protocol_digest: hash(protocol_digest, 'protocol_digest'),
      item_count: normalizedProtocol.item_count,
      total_bytes: normalizedProtocol.total_bytes,
    },
    allowlist,
    workspace_owner_approval: approval,
    manual_enablement: enablement,
    evaluated_at_epoch: now,
    blockers: unique(blockers),
    synthetic_only: true,
    live_provider_allowed: false,
    production_ready: false,
    dispatch_allowed: false,
    secrets_included: false,
  };
  const authorizationDigest = digest(core);
  return deepFreeze({
    ok: true,
    canary_ready: core.blockers.length === 0,
    authorization: core,
    authorization_digest: authorizationDigest,
    dispatch_allowed: false,
    live_provider_allowed: false,
    production_ready: false,
    blockers: core.blockers,
    secrets_included: false,
  });
}

export function verifyHostingerStorageTenantCanaryAuthorization({ authorization, expected_digest, now_epoch = Math.floor(Date.now() / 1000) } = {}) {
  assertSecretFree(authorization, 'tenant_canary_authorization');
  const now = epoch(now_epoch, 'now_epoch');
  if (authorization?.authorization_key !== 'hostinger_storage_tenant_canary_authorization_v1'
    || authorization?.policy_version !== HOSTINGER_STORAGE_TENANT_CANARY_POLICY_VERSION
    || authorization?.protocol?.protocol_version !== EXPECTED_SYNTHETIC_PROTOCOL_VERSION
    || authorization?.synthetic_only !== true
    || authorization?.live_provider_allowed !== false
    || authorization?.production_ready !== false
    || authorization?.dispatch_allowed !== false) {
    throw fail(409, 'STORAGE_TENANT_CANARY_AUTHORIZATION_IDENTITY_INVALID', 'Unexpected or unsafe Tenant canary authorization identity.');
  }
  const observed = digest(authorization);
  if (observed !== hash(expected_digest, 'expected_digest')) {
    throw fail(409, 'STORAGE_TENANT_CANARY_AUTHORIZATION_TAMPERED', 'Tenant canary authorization digest mismatch.');
  }
  const blockers = [...(authorization.blockers || [])];
  if (authorization.allowlist?.expires_at_epoch <= now) blockers.push('STORAGE_TENANT_CANARY_ALLOWLIST_EXPIRED');
  if (authorization.workspace_owner_approval?.expires_at_epoch <= now) blockers.push('STORAGE_TENANT_CANARY_APPROVAL_EXPIRED');
  if (authorization.manual_enablement?.expires_at_epoch <= now) blockers.push('STORAGE_TENANT_CANARY_ENABLEMENT_EXPIRED');
  return deepFreeze({
    ok: true,
    valid: blockers.length === 0,
    observed_digest: observed,
    blockers: unique(blockers),
    dispatch_allowed: false,
    live_provider_allowed: false,
    secrets_included: false,
  });
}
