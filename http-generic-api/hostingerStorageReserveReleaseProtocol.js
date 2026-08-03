import { createHash } from 'node:crypto';

export const HOSTINGER_STORAGE_RESERVE_RELEASE_PROTOCOL_VERSION = 'spec014-hostinger-storage-reserve-release-v1';

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
  if (!SAFE_ID_RE.test(normalized) || normalized.startsWith('/') || normalized.includes('..') || normalized.includes('\\')) {
    throw fail(400, 'STORAGE_RESERVE_IDENTIFIER_INVALID', 'A safe opaque identifier is required.', { field });
  }
  return normalized;
}

function hash(value, field) {
  const normalized = text(value, 64).toLowerCase();
  if (!SHA256_RE.test(normalized)) throw fail(400, 'STORAGE_RESERVE_HASH_INVALID', 'A lowercase SHA-256 binding is required.', { field });
  return normalized;
}

function integer(value, field) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) throw fail(400, 'STORAGE_RESERVE_INTEGER_INVALID', 'A non-negative safe integer is required.', { field });
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

export function buildHostingerStorageReserveReleaseIntent({
  operation_id,
  target_id,
  reserve_ref,
  reserve_fingerprint,
  active_incident_id,
  authority_context_hash,
  capability_envelope_id,
  execution_lease_id,
  typed_confirmation_digest,
} = {}) {
  const fingerprint = deepFreeze({
    size_bytes: integer(reserve_fingerprint?.size_bytes, 'reserve_fingerprint.size_bytes'),
    device: integer(reserve_fingerprint?.device, 'reserve_fingerprint.device'),
    inode: integer(reserve_fingerprint?.inode, 'reserve_fingerprint.inode'),
    ctime_epoch: integer(reserve_fingerprint?.ctime_epoch, 'reserve_fingerprint.ctime_epoch'),
    mtime_epoch: integer(reserve_fingerprint?.mtime_epoch, 'reserve_fingerprint.mtime_epoch'),
    file_type: text(reserve_fingerprint?.file_type, 32) || 'regular',
  });
  if (fingerprint.file_type !== 'regular' || fingerprint.size_bytes < 1048576) {
    throw fail(409, 'STORAGE_RESERVE_FINGERPRINT_INVALID', 'Emergency reserve must be a regular pre-provisioned file of at least 1 MiB.');
  }
  const core = {
    schema_version: 1,
    intent_key: 'hostinger_storage_reserve_release_intent_v1',
    protocol_version: HOSTINGER_STORAGE_RESERVE_RELEASE_PROTOCOL_VERSION,
    operation_id: safeId(operation_id, 'operation_id'),
    target_id: safeId(target_id, 'target_id'),
    reserve_ref: safeId(reserve_ref, 'reserve_ref'),
    reserve_fingerprint: fingerprint,
    reserve_fingerprint_digest: digest(fingerprint),
    active_incident_id: safeId(active_incident_id, 'active_incident_id'),
    authority_context_hash: hash(authority_context_hash, 'authority_context_hash'),
    capability_envelope_id: safeId(capability_envelope_id, 'capability_envelope_id'),
    execution_lease_id: safeId(execution_lease_id, 'execution_lease_id'),
    typed_confirmation_digest: hash(typed_confirmation_digest, 'typed_confirmation_digest'),
    no_allocation_before_unlink: true,
    no_lock_creation_before_unlink: true,
    no_journal_creation_before_unlink: true,
    no_temp_file_before_unlink: true,
    exact_unlink_only: true,
    automatic_retry_allowed: false,
    synthetic_only: true,
    production_ready: false,
    secrets_included: false,
  };
  return deepFreeze({
    ok: true,
    intent: core,
    intent_digest: digest(core),
    dispatch_allowed: false,
    secrets_included: false,
  });
}

export function executeHostingerStorageSyntheticReserveRelease({ intent, expected_intent_digest, adapter } = {}) {
  if (!intent || digest(intent) !== hash(expected_intent_digest, 'expected_intent_digest')) {
    throw fail(409, 'STORAGE_RESERVE_INTENT_TAMPERED', 'Reserve release intent digest mismatch.');
  }
  if (intent.intent_key !== 'hostinger_storage_reserve_release_intent_v1'
    || intent.protocol_version !== HOSTINGER_STORAGE_RESERVE_RELEASE_PROTOCOL_VERSION
    || intent.no_allocation_before_unlink !== true
    || intent.no_lock_creation_before_unlink !== true
    || intent.no_journal_creation_before_unlink !== true
    || intent.no_temp_file_before_unlink !== true
    || intent.exact_unlink_only !== true
    || intent.synthetic_only !== true
    || intent.production_ready !== false) {
    throw fail(409, 'STORAGE_RESERVE_INTENT_UNSAFE', 'Reserve release intent does not preserve allocation-free safety invariants.');
  }
  if (!adapter || adapter.synthetic_only !== true || adapter.production_ready !== false
    || adapter.allocation_operations !== 0 || typeof adapter.exactUnlinkReserve !== 'function') {
    throw fail(409, 'STORAGE_RESERVE_ADAPTER_INVALID', 'Allocation-free synthetic reserve adapter is required.');
  }
  const result = adapter.exactUnlinkReserve({
    operation_id: intent.operation_id,
    target_id: intent.target_id,
    reserve_ref: intent.reserve_ref,
    expected_fingerprint_digest: intent.reserve_fingerprint_digest,
    expected_fingerprint: intent.reserve_fingerprint,
  });
  if (adapter.allocation_operations !== 0 || result?.allocation_operations_before_unlink !== 0) {
    throw fail(409, 'STORAGE_RESERVE_PRE_UNLINK_ALLOCATION_DETECTED', 'Reserve release attempted allocation before exact unlink.');
  }
  const evidence = {
    schema_version: 1,
    evidence_key: 'hostinger_storage_reserve_release_evidence_v1',
    operation_id: intent.operation_id,
    target_id: intent.target_id,
    reserve_ref: intent.reserve_ref,
    reserve_fingerprint_digest: intent.reserve_fingerprint_digest,
    released: result?.released === true,
    released_bytes: integer(result?.released_bytes ?? 0, 'released_bytes'),
    allocation_operations_before_unlink: 0,
    first_adapter_operation: text(result?.first_adapter_operation, 64),
    synthetic_only: true,
    live_provider_mutated: false,
    secrets_included: false,
  };
  if (evidence.first_adapter_operation !== 'exact_unlink_reserve') {
    throw fail(409, 'STORAGE_RESERVE_UNLINK_NOT_FIRST_OPERATION', 'Exact reserve unlink must be the first adapter operation.');
  }
  return deepFreeze({
    ok: true,
    released: evidence.released,
    evidence,
    evidence_digest: digest(evidence),
    persistence_after_unlink_required: true,
    dispatch_allowed: false,
    secrets_included: false,
  });
}

export function createHostingerStorageSyntheticReserveAdapter({ reserve } = {}) {
  let current = {
    reserve_ref: safeId(reserve?.reserve_ref, 'reserve.reserve_ref'),
    fingerprint: {
      size_bytes: integer(reserve?.fingerprint?.size_bytes, 'reserve.fingerprint.size_bytes'),
      device: integer(reserve?.fingerprint?.device, 'reserve.fingerprint.device'),
      inode: integer(reserve?.fingerprint?.inode, 'reserve.fingerprint.inode'),
      ctime_epoch: integer(reserve?.fingerprint?.ctime_epoch, 'reserve.fingerprint.ctime_epoch'),
      mtime_epoch: integer(reserve?.fingerprint?.mtime_epoch, 'reserve.fingerprint.mtime_epoch'),
      file_type: text(reserve?.fingerprint?.file_type, 32) || 'regular',
    },
    exists: reserve?.exists !== false,
  };
  const calls = [];
  const adapter = {
    adapter_key: 'hostinger_storage_synthetic_reserve_adapter_v1',
    synthetic_only: true,
    production_ready: false,
    allocation_operations: 0,
    exactUnlinkReserve({ reserve_ref, expected_fingerprint_digest, expected_fingerprint } = {}) {
      calls.push('exact_unlink_reserve');
      if (!current.exists) return { released: false, released_bytes: 0, allocation_operations_before_unlink: 0, first_adapter_operation: calls[0] };
      if (safeId(reserve_ref, 'reserve_ref') !== current.reserve_ref
        || digest(current.fingerprint) !== hash(expected_fingerprint_digest, 'expected_fingerprint_digest')
        || digest(expected_fingerprint) !== digest(current.fingerprint)) {
        throw fail(409, 'STORAGE_RESERVE_FINGERPRINT_MISMATCH', 'Reserve fingerprint changed before exact unlink.');
      }
      current.exists = false;
      return {
        released: true,
        released_bytes: current.fingerprint.size_bytes,
        allocation_operations_before_unlink: 0,
        first_adapter_operation: calls[0],
      };
    },
    exportState() {
      return deepFreeze({ current: structuredClone(current), calls: [...calls], allocation_operations: adapter.allocation_operations, secrets_included: false });
    },
  };
  return Object.freeze(adapter);
}
