import { createHash } from 'node:crypto';

export const HOSTINGER_STORAGE_READ_ONLY_ADAPTER_VERSION = 'spec014-hostinger-read-only-adapter-v1';

const SHA256_HEX_RE = /^[0-9a-f]{64}$/i;
const SSH_FINGERPRINT_RE = /^SHA256:[A-Za-z0-9+/]{20,88}={0,2}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/;
const OPAQUE_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,510}$/;
const READ_ONLY_OPERATIONS = new Set([
  'target_probe',
  'quota_snapshot',
  'filesystem_inventory',
  'layout_inventory',
  'same_operation_readback',
]);
const FORBIDDEN_INPUT_KEYS = /(command|argv|shell|root_path|absolute_path|delete|unlink|apply|mutation|password|passwd|secret(?!s_included$)|token|credential|private[_-]?key|authorization|cookie|session|raw_provider_output|raw_environment)/i;

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

function lower(value, max = 191) {
  return text(value, max).toLowerCase();
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function assertSafeShape(value, at = 'input', depth = 0) {
  if (depth > 12 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeShape(item, `${at}[${index}]`, depth + 1));
    return;
  }
  if (typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (key !== 'secrets_included' && FORBIDDEN_INPUT_KEYS.test(key)) {
      throw fail(400, 'STORAGE_READ_ONLY_FORBIDDEN_INPUT_FIELD', 'Read-only adapter input contains a forbidden field.', { path: `${at}.${key}` });
    }
    assertSafeShape(item, `${at}.${key}`, depth + 1);
  }
}

function safeId(value, field) {
  const result = text(value, 191);
  if (!SAFE_ID_RE.test(result)) throw fail(400, 'STORAGE_READ_ONLY_IDENTIFIER_INVALID', 'A safe bounded identifier is required.', { field });
  return result;
}

function optionalId(value, field) {
  if (value === null || value === undefined || value === '') return null;
  return safeId(value, field);
}

function opaqueRef(value, field) {
  const result = text(value, 512);
  if (!OPAQUE_REF_RE.test(result) || result.startsWith('/') || result.includes('..') || /[\0\r\n]/.test(result)) {
    throw fail(400, 'STORAGE_READ_ONLY_REFERENCE_INVALID', 'A bounded opaque reference is required; raw filesystem paths are forbidden.', { field });
  }
  return result;
}

function fingerprint(value) {
  const result = text(value, 128);
  if (!SSH_FINGERPRINT_RE.test(result) && !SHA256_HEX_RE.test(result)) {
    throw fail(400, 'STORAGE_HOST_KEY_FINGERPRINT_REQUIRED', 'A pinned SHA-256 host-key fingerprint is required.', { field: 'host_key_fingerprint' });
  }
  return result;
}

function normalizeContext(context = {}) {
  const mode = lower(context.mode, 16);
  if (!['admin', 'tenant'].includes(mode)) throw fail(400, 'STORAGE_CONTEXT_REQUIRED', 'Explicit Admin or Tenant context is required.');
  const normalized = {
    mode,
    principal_id: safeId(context.principal_id, 'principal_id'),
    tenant_id: optionalId(context.tenant_id, 'tenant_id'),
    workspace_id: optionalId(context.workspace_id, 'workspace_id'),
    resource_id: optionalId(context.resource_id, 'resource_id'),
    authority_context_hash: lower(context.authority_context_hash, 64),
    secrets_included: false,
  };
  if (!SHA256_HEX_RE.test(normalized.authority_context_hash)) {
    throw fail(400, 'STORAGE_AUTHORITY_CONTEXT_HASH_MISMATCH', 'A valid authority context hash is required.');
  }
  if (mode === 'tenant' && (!normalized.tenant_id || !normalized.workspace_id || !normalized.resource_id)) {
    throw fail(400, 'STORAGE_CONTEXT_REQUIRED', 'Tenant context requires tenant, workspace, and resource identifiers.');
  }
  return Object.freeze(normalized);
}

function normalizeTarget(target = {}, context) {
  const normalized = {
    target_id: safeId(target.target_id, 'target_id'),
    hosting_account_id: safeId(target.hosting_account_id, 'hosting_account_id'),
    tenant_id: optionalId(target.tenant_id, 'target.tenant_id'),
    workspace_id: optionalId(target.workspace_id, 'target.workspace_id'),
    resource_id: safeId(target.resource_id, 'target.resource_id'),
    ownership_scope: lower(target.ownership_scope, 16),
    ownership_mode: lower(target.ownership_mode, 32),
    ownership_revision: safeId(target.ownership_revision, 'ownership_revision'),
    policy_revision: safeId(target.policy_revision, 'policy_revision'),
    root_ref: opaqueRef(target.root_ref, 'root_ref'),
    host_alias: safeId(target.host_alias, 'host_alias'),
    host_key_fingerprint: fingerprint(target.host_key_fingerprint),
    ssh_config_ref: opaqueRef(target.ssh_config_ref, 'ssh_config_ref'),
    known_hosts_ref: opaqueRef(target.known_hosts_ref, 'known_hosts_ref'),
    remote_program_ref: opaqueRef(target.remote_program_ref, 'remote_program_ref'),
    secrets_included: false,
  };
  if (!['platform', 'tenant', 'shared'].includes(normalized.ownership_scope)) {
    throw fail(400, 'STORAGE_TARGET_BINDING_STALE', 'Target ownership scope is invalid.');
  }
  if (context.mode === 'tenant') {
    if (normalized.ownership_scope !== 'tenant' || normalized.ownership_mode !== 'exclusive') {
      throw fail(403, 'STORAGE_SHARED_TARGET_TENANT_FORBIDDEN', 'Tenant read-only access requires an exclusively tenant-owned target.');
    }
    if (normalized.tenant_id !== context.tenant_id
      || normalized.workspace_id !== context.workspace_id
      || normalized.resource_id !== context.resource_id) {
      throw fail(403, 'STORAGE_TARGET_NOT_OWNED', 'Target binding does not match the selected Tenant context.');
    }
  }
  return Object.freeze(normalized);
}

function validatePolicy(policy = {}) {
  if (policy.provider !== 'hostinger'
    || policy.execution?.public_web_runtime_allowed !== false
    || policy.execution?.freeform_shell_allowed !== false
    || policy.execution?.host_key_fingerprint_required !== true
    || policy.execution?.automatic_apply_allowed !== false) {
    throw fail(500, 'STORAGE_READ_ONLY_POLICY_INVALID', 'Storage cleanup policy does not preserve read-only adapter invariants.');
  }
  return Object.freeze({
    warning_percent: Number(policy.measurement?.warning_percent),
    critical_percent: Number(policy.measurement?.critical_percent),
    emergency_percent: Number(policy.measurement?.emergency_percent),
    quota_source: policy.measurement?.authoritative_limits_source,
    freshness_minutes: Number(policy.measurement?.hpanel_usage_refresh_minutes),
    policy_fingerprint: digest(policy),
  });
}

export function buildHostingerStorageReadOnlyDescriptor({
  policy,
  context,
  target,
  operation,
  operation_id,
  requested_at,
  limits = {},
} = {}) {
  assertSafeShape({ context, target, limits }, 'request');
  const policyState = validatePolicy(policy);
  const normalizedContext = normalizeContext(context);
  const normalizedTarget = normalizeTarget(target, normalizedContext);
  const normalizedOperation = lower(operation, 64);
  if (!READ_ONLY_OPERATIONS.has(normalizedOperation)) {
    throw fail(403, 'STORAGE_READ_ONLY_OPERATION_FORBIDDEN', 'Only fixed read-only operations are accepted.', { operation: normalizedOperation || null });
  }
  const operationId = safeId(operation_id, 'operation_id');
  const timestamp = text(requested_at, 64);
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) throw fail(400, 'STORAGE_READ_ONLY_REQUEST_TIME_INVALID', 'requested_at must be an ISO timestamp.');
  const maxRecords = Math.min(Math.max(Number(limits.max_records || 10000), 1), 100000);
  const timeoutSeconds = Math.min(Math.max(Number(limits.timeout_seconds || 120), 5), 900);
  const stdinContract = Object.freeze({
    schema_version: 1,
    contract_key: 'hostinger_storage_read_only_request_v1',
    operation: normalizedOperation,
    operation_id: operationId,
    requested_at: new Date(timestamp).toISOString(),
    context: normalizedContext,
    target_binding: {
      target_id: normalizedTarget.target_id,
      hosting_account_id: normalizedTarget.hosting_account_id,
      tenant_id: normalizedTarget.tenant_id,
      workspace_id: normalizedTarget.workspace_id,
      resource_id: normalizedTarget.resource_id,
      ownership_scope: normalizedTarget.ownership_scope,
      ownership_mode: normalizedTarget.ownership_mode,
      ownership_revision: normalizedTarget.ownership_revision,
      policy_revision: normalizedTarget.policy_revision,
      root_ref: normalizedTarget.root_ref,
    },
    limits: { max_records: maxRecords, timeout_seconds: timeoutSeconds },
    secrets_included: false,
  });
  const argv = Object.freeze([
    '-F', normalizedTarget.ssh_config_ref,
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', 'IdentitiesOnly=yes',
    '-o', 'ForwardAgent=no',
    '-o', `UserKnownHostsFile=${normalizedTarget.known_hosts_ref}`,
    normalizedTarget.host_alias,
    normalizedTarget.remote_program_ref,
    '--read-only-contract-stdin',
  ]);
  const evidence = {
    adapter_version: HOSTINGER_STORAGE_READ_ONLY_ADAPTER_VERSION,
    operation: normalizedOperation,
    operation_id: operationId,
    authority_context_hash: normalizedContext.authority_context_hash,
    target_id: normalizedTarget.target_id,
    ownership_revision: normalizedTarget.ownership_revision,
    policy_revision: normalizedTarget.policy_revision,
    host_key_fingerprint: normalizedTarget.host_key_fingerprint,
    policy_fingerprint: policyState.policy_fingerprint,
    stdin_contract_digest: digest(stdinContract),
  };
  return Object.freeze({
    ok: true,
    descriptor_type: 'managed_hostinger_read_only_worker_request',
    adapter_version: HOSTINGER_STORAGE_READ_ONLY_ADAPTER_VERSION,
    operation: normalizedOperation,
    execution_class: 'managed_worker_only',
    executable: 'ssh',
    argv,
    shell: false,
    user_supplied_argv: false,
    stdin_mode: 'immutable_json_contract',
    stdin_contract: stdinContract,
    expected_output: 'bounded_json_evidence',
    timeout_seconds: timeoutSeconds,
    host_key_fingerprint: normalizedTarget.host_key_fingerprint,
    dispatch_allowed: false,
    authority_granted: false,
    mutates_target: false,
    automatic_retry_allowed: true,
    descriptor_fingerprint: digest(evidence),
    policy: policyState,
    blockers: ['STORAGE_DISPATCH_DISABLED'],
    secrets_included: false,
  });
}

export function evaluateHostingerQuotaEvidence({ policy, observed_at, source, disk = {}, inodes = {}, now = new Date().toISOString() } = {}) {
  assertSafeShape({ disk, inodes }, 'quota_evidence');
  const policyState = validatePolicy(policy);
  const observedAt = Date.parse(text(observed_at, 64));
  const nowAt = Date.parse(text(now, 64));
  if (!Number.isFinite(observedAt) || !Number.isFinite(nowAt)) {
    throw fail(400, 'STORAGE_QUOTA_EVIDENCE_REQUIRED', 'Valid quota evidence timestamps are required.');
  }
  if (source !== policyState.quota_source || source === 'df' || source === 'filesystem') {
    throw fail(409, 'STORAGE_QUOTA_EVIDENCE_REQUIRED', 'Hosting-plan quota must come from the configured hPanel evidence source.', { source: source || null });
  }
  const ageMinutes = Math.max(0, (nowAt - observedAt) / 60000);
  const fresh = ageMinutes <= policyState.freshness_minutes;
  const diskPercent = Number(disk.used_percent);
  const inodePercent = Number(inodes.used_percent);
  const classify = (value) => {
    if (!Number.isFinite(value)) return 'unknown';
    if (value >= policyState.emergency_percent) return 'emergency';
    if (value >= policyState.critical_percent) return 'critical';
    if (value >= policyState.warning_percent) return 'warning';
    return 'normal';
  };
  const byteState = classify(diskPercent);
  const inodeState = classify(inodePercent);
  const ranking = ['normal', 'warning', 'critical', 'emergency', 'unknown'];
  const effectiveState = ranking[Math.max(ranking.indexOf(byteState), ranking.indexOf(inodeState))];
  return Object.freeze({
    ok: true,
    source,
    observed_at: new Date(observedAt).toISOString(),
    age_minutes: Number(ageMinutes.toFixed(3)),
    fresh,
    byte_state: byteState,
    inode_state: inodeState,
    effective_state: effectiveState,
    blockers: fresh ? [] : ['STORAGE_QUOTA_EVIDENCE_STALE'],
    disk: {
      limit_bytes: Number.isFinite(Number(disk.limit_bytes)) ? Number(disk.limit_bytes) : null,
      used_bytes: Number.isFinite(Number(disk.used_bytes)) ? Number(disk.used_bytes) : null,
      used_percent: Number.isFinite(diskPercent) ? diskPercent : null,
    },
    inodes: {
      limit: Number.isFinite(Number(inodes.limit)) ? Number(inodes.limit) : null,
      used: Number.isFinite(Number(inodes.used)) ? Number(inodes.used) : null,
      used_percent: Number.isFinite(inodePercent) ? inodePercent : null,
    },
    secrets_included: false,
  });
}

export function projectHostingerStorageReadOnlyEvidence({ context, target, quota, inventory = {}, layout = {} } = {}) {
  assertSafeShape({ inventory, layout }, 'evidence');
  const normalizedContext = normalizeContext(context);
  const normalizedTarget = normalizeTarget(target, normalizedContext);
  if (!quota || quota.secrets_included !== false) throw fail(500, 'STORAGE_EVIDENCE_SCHEMA_INVALID', 'Validated secret-safe quota evidence is required.');
  const common = {
    target_id: normalizedTarget.target_id,
    resource_id: normalizedTarget.resource_id,
    ownership_scope: normalizedTarget.ownership_scope,
    quota: {
      observed_at: quota.observed_at,
      fresh: quota.fresh,
      byte_state: quota.byte_state,
      inode_state: quota.inode_state,
      effective_state: quota.effective_state,
      disk: quota.disk,
      inodes: quota.inodes,
    },
    inventory: {
      observed_at: text(inventory.observed_at, 64) || null,
      logical_usage_bytes: Number.isFinite(Number(inventory.logical_usage_bytes)) ? Number(inventory.logical_usage_bytes) : null,
      logical_inode_count: Number.isFinite(Number(inventory.logical_inode_count)) ? Number(inventory.logical_inode_count) : null,
      complete: inventory.complete === true,
    },
    layout: {
      certified: layout.certified === true,
      revision: optionalId(layout.revision, 'layout.revision'),
      active_deployment_ref: layout.active_deployment_ref ? opaqueRef(layout.active_deployment_ref, 'layout.active_deployment_ref') : null,
    },
    completeness: quota.fresh && inventory.complete === true && layout.certified === true ? 'complete' : 'partial',
    secrets_included: false,
  };
  if (normalizedContext.mode === 'tenant') {
    return Object.freeze({
      audience: 'tenant',
      tenant_id: normalizedContext.tenant_id,
      workspace_id: normalizedContext.workspace_id,
      ...common,
      layout: {
        certified: common.layout.certified,
        revision: common.layout.revision,
        active_deployment_ref: null,
      },
    });
  }
  return Object.freeze({
    audience: 'admin',
    hosting_account_id: normalizedTarget.hosting_account_id,
    tenant_id: normalizedTarget.tenant_id,
    workspace_id: normalizedTarget.workspace_id,
    host_alias: normalizedTarget.host_alias,
    root_ref: normalizedTarget.root_ref,
    ...common,
  });
}
