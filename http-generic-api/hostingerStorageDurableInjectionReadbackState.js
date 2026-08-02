import { createHash } from 'node:crypto';
import { HOSTINGER_STORAGE_AUTHORIZED_DEPENDENCY_INJECTION_VERSION } from './hostingerStorageAuthorizedDependencyInjection.js';

export const HOSTINGER_STORAGE_DURABLE_INJECTION_READBACK_STATE_VERSION =
  'spec014-hostinger-storage-durable-injection-readback-state-v1';

const BRAND = Symbol.for('mad4b.spec014.hostinger-storage-durable-injection-readback-state');
const LOCK_NAME = 'spec014:hostinger-storage-injection-readback-state';
const ROUTE_PATH = '/tenant/storage-operations/apply-plan';
const DEPENDENCY_KEY = 'tenantStorageRuntime';
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/+/-]{0,255}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const ALLOWED_OPTIONS = new Set(['pool', 'schema_verification', 'lock_timeout_seconds']);

export const HOSTINGER_STORAGE_DURABLE_INJECTION_READBACK_SCHEMA_CONTRACT = Object.freeze({
  contract_key: 'hostinger_storage_durable_injection_readback_state_schema_v1',
  tables: Object.freeze([
    'storage_mount_injection_states',
    'storage_mount_injection_events',
  ]),
  exact_receipt_and_readback_binding: true,
  one_active_state_per_injection: true,
  rollback_generation_cas: true,
  immutable_event_records: true,
  runtime_object_persisted: false,
  secrets_included: false,
});

function fail(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = Object.freeze({ ...details, secrets_included: false });
  return error;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

export const HOSTINGER_STORAGE_DURABLE_INJECTION_READBACK_SCHEMA_DIGEST = digest(
  HOSTINGER_STORAGE_DURABLE_INJECTION_READBACK_SCHEMA_CONTRACT,
);

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function text(value, max = 512) {
  return String(value ?? '').trim().slice(0, max);
}

function identifier(value, field, max = 256) {
  const normalized = text(value, max);
  if (!SAFE_ID_RE.test(normalized) || normalized.length > max) {
    throw fail(400, 'STORAGE_DURABLE_INJECTION_STATE_IDENTIFIER_INVALID', 'A safe bounded identifier is required.', { field });
  }
  return normalized;
}

function hash(value, field) {
  const normalized = text(value, 64).toLowerCase();
  if (!SHA256_RE.test(normalized)) {
    throw fail(400, 'STORAGE_DURABLE_INJECTION_STATE_HASH_INVALID', 'A lowercase SHA-256 binding is required.', { field });
  }
  return normalized;
}

function integer(value, field, minimum = 0) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < minimum) {
    throw fail(400, 'STORAGE_DURABLE_INJECTION_STATE_INTEGER_INVALID', 'A bounded integer is required.', { field, minimum });
  }
  return normalized;
}

function assertDataOnly(value, path = 'value', active = new WeakSet(), depth = 0) {
  if (depth > 24) {
    throw fail(400, 'STORAGE_DURABLE_INJECTION_STATE_DATA_TOO_DEEP', 'Durable injection state exceeded the supported depth.', { path });
  }
  if (value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value)) return;
  if (typeof value !== 'object') {
    throw fail(400, 'STORAGE_DURABLE_INJECTION_STATE_DATA_INVALID', 'Durable injection state must contain data values only.', { path });
  }
  if (active.has(value)) {
    throw fail(400, 'STORAGE_DURABLE_INJECTION_STATE_DATA_CYCLE', 'Durable injection state must not contain cycles.', { path });
  }
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw fail(400, 'STORAGE_DURABLE_INJECTION_STATE_DATA_INVALID', 'Durable injection state must use plain data objects.', { path });
  }
  active.add(value);
  try {
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) {
        throw fail(400, 'STORAGE_DURABLE_INJECTION_STATE_ACCESSOR_REJECTED', 'Durable injection state cannot contain accessor properties.', { path: `${path}.${key}` });
      }
      if (key === 'secrets_included' && descriptor.value !== false) {
        throw fail(400, 'STORAGE_DURABLE_INJECTION_STATE_SECRET_DECLARATION_INVALID', 'Secret declaration must remain false.', { path: `${path}.${key}` });
      }
      if (key !== 'secrets_included'
        && /(password|passwd|secret_value|private[_-]?key|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization_header|cookie_header|raw_provider_payload|raw_environment|file_content|absolute_path|shell_command|credential_material|tenantStorageRuntime)/i.test(key)) {
        throw fail(400, 'STORAGE_DURABLE_INJECTION_STATE_SECRET_OR_RUNTIME_FIELD_REJECTED', 'Durable injection state cannot contain secrets, runtime objects, or free-form execution fields.', { path: `${path}.${key}` });
      }
      assertDataOnly(descriptor.value, `${path}.${key}`, active, depth + 1);
    }
  } finally {
    active.delete(value);
  }
}

function snapshot(value, path) {
  assertDataOnly(value, path);
  return clone(value);
}

function assertExactFields(value, allowed, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw fail(400, 'STORAGE_DURABLE_INJECTION_STATE_INPUT_INVALID', 'A plain input object is required.', { path });
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const unsupported = Object.keys(descriptors).filter((key) => !allowed.has(key));
  if (unsupported.length) {
    throw fail(400, 'STORAGE_DURABLE_INJECTION_STATE_FIELD_FORBIDDEN', 'Unsupported durable injection state fields are forbidden.', {
      path,
      unsupported_fields: unsupported.sort(),
    });
  }
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) {
      throw fail(400, 'STORAGE_DURABLE_INJECTION_STATE_ACCESSOR_REJECTED', 'Durable injection state inputs must use owned data fields.', { path: `${path}.${key}` });
    }
  }
}

function verifyDigestBoundRecord(value, digestField, path, code) {
  const record = snapshot(value, path);
  const suppliedDigest = hash(record?.[digestField], `${path}.${digestField}`);
  delete record[digestField];
  if (digest(record) !== suppliedDigest) {
    throw fail(409, code, 'Durable injection evidence digest verification failed.', { path });
  }
  return { record, suppliedDigest };
}

function verifyInjectionReceipt(value) {
  const { record, suppliedDigest } = verifyDigestBoundRecord(
    value,
    'injection_receipt_digest',
    'injection_receipt',
    'STORAGE_DURABLE_INJECTION_RECEIPT_DIGEST_MISMATCH',
  );
  const normalized = {
    ...record,
    injection_id: identifier(record.injection_id, 'injection_receipt.injection_id', 191),
    injection_generation: integer(record.injection_generation, 'injection_receipt.injection_generation', 1),
    injected_at_epoch: integer(record.injected_at_epoch, 'injection_receipt.injected_at_epoch', 1),
    mount_bundle_digest: hash(record.mount_bundle_digest, 'injection_receipt.mount_bundle_digest'),
    authorization_id: identifier(record.authorization_id, 'injection_receipt.authorization_id', 64),
    authorization_generation: integer(record.authorization_generation, 'injection_receipt.authorization_generation', 1),
    authorization_consumption_digest: hash(record.authorization_consumption_digest, 'injection_receipt.authorization_consumption_digest'),
    dependency_manifest_digest: hash(record.dependency_manifest_digest, 'injection_receipt.dependency_manifest_digest'),
    expected_runtime_sha: hash(record.expected_runtime_sha, 'injection_receipt.expected_runtime_sha'),
    source_commit: hash(record.source_commit, 'injection_receipt.source_commit'),
    database_fingerprint: hash(record.database_fingerprint, 'injection_receipt.database_fingerprint'),
    schema_verification_digest: hash(record.schema_verification_digest, 'injection_receipt.schema_verification_digest'),
    readback_cycle_id: identifier(record.readback_cycle_id, 'injection_receipt.readback_cycle_id', 191),
    rollback_plan_digest: hash(record.rollback_plan_digest, 'injection_receipt.rollback_plan_digest'),
    route_dependency_snapshot_digest: hash(record.route_dependency_snapshot_digest, 'injection_receipt.route_dependency_snapshot_digest'),
    injection_receipt_digest: suppliedDigest,
  };
  if (normalized.contract !== 'spec014.hostinger-storage-authorized-dependency-injection-receipt.v1'
    || normalized.version !== HOSTINGER_STORAGE_AUTHORIZED_DEPENDENCY_INJECTION_VERSION
    || normalized.route_path !== ROUTE_PATH
    || normalized.dependency_key !== DEPENDENCY_KEY
    || normalized.injection_generation !== 1
    || normalized.dependency_snapshot_created !== true
    || normalized.dependency_injected !== true
    || normalized.mount_performed !== true
    || normalized.runtime_mounted !== true
    || normalized.route_mounted !== true
    || normalized.worker_mounted !== false
    || normalized.live_server_modified !== false
    || normalized.live_route_registration_performed !== false
    || normalized.provider_dispatch_allowed !== false
    || normalized.production_ready !== false
    || normalized.automatic_retry_allowed !== false
    || normalized.reconciliation_state !== 'dependency_injected_pending_exact_readback'
    || normalized.secrets_included !== false) {
    throw fail(409, 'STORAGE_DURABLE_INJECTION_RECEIPT_INVALID', 'Injection receipt failed the durable contract boundary.');
  }
  return deepFreeze(normalized);
}

function verifyMountReadback(value) {
  const { record, suppliedDigest } = verifyDigestBoundRecord(
    value,
    'mount_readback_digest',
    'mount_readback',
    'STORAGE_DURABLE_INJECTION_READBACK_DIGEST_MISMATCH',
  );
  const normalized = {
    ...record,
    injection_id: identifier(record.injection_id, 'mount_readback.injection_id', 191),
    injection_generation: integer(record.injection_generation, 'mount_readback.injection_generation', 1),
    injection_receipt_digest: hash(record.injection_receipt_digest, 'mount_readback.injection_receipt_digest'),
    mount_bundle_digest: hash(record.mount_bundle_digest, 'mount_readback.mount_bundle_digest'),
    route_dependency_snapshot_digest: hash(record.route_dependency_snapshot_digest, 'mount_readback.route_dependency_snapshot_digest'),
    expected_runtime_sha: hash(record.expected_runtime_sha, 'mount_readback.expected_runtime_sha'),
    source_commit: hash(record.source_commit, 'mount_readback.source_commit'),
    database_fingerprint: hash(record.database_fingerprint, 'mount_readback.database_fingerprint'),
    schema_verification_digest: hash(record.schema_verification_digest, 'mount_readback.schema_verification_digest'),
    readback_cycle_id: identifier(record.readback_cycle_id, 'mount_readback.readback_cycle_id', 191),
    mount_readback_digest: suppliedDigest,
  };
  if (normalized.contract !== 'spec014.hostinger-storage-authorized-mount-readback.v1'
    || normalized.version !== HOSTINGER_STORAGE_AUTHORIZED_DEPENDENCY_INJECTION_VERSION
    || normalized.route_path !== ROUTE_PATH
    || normalized.dependency_key !== DEPENDENCY_KEY
    || normalized.injection_generation !== 1
    || normalized.readback_verified !== true
    || normalized.dependency_descriptor_verified !== true
    || normalized.exact_runtime_object_identity !== true
    || normalized.route_dependency_snapshot_frozen !== true
    || normalized.runtime_identity_verified !== true
    || normalized.dependency_injected !== true
    || normalized.mount_performed !== true
    || normalized.runtime_mounted !== true
    || normalized.route_mounted !== true
    || normalized.worker_mounted !== false
    || normalized.live_server_modified !== false
    || normalized.live_route_registration_performed !== false
    || normalized.provider_dispatch_allowed !== false
    || normalized.production_ready !== false
    || normalized.automatic_retry_allowed !== false
    || normalized.reconciliation_state !== 'dependency_injection_readback_verified'
    || normalized.secrets_included !== false) {
    throw fail(409, 'STORAGE_DURABLE_INJECTION_READBACK_INVALID', 'Mount readback failed the durable contract boundary.');
  }
  return deepFreeze(normalized);
}

function verifyRollbackReceipt(value) {
  const { record, suppliedDigest } = verifyDigestBoundRecord(
    value,
    'rollback_receipt_digest',
    'rollback_receipt',
    'STORAGE_DURABLE_INJECTION_ROLLBACK_DIGEST_MISMATCH',
  );
  const normalized = {
    ...record,
    injection_id: identifier(record.injection_id, 'rollback_receipt.injection_id', 191),
    injection_generation: integer(record.injection_generation, 'rollback_receipt.injection_generation', 1),
    injection_receipt_digest: hash(record.injection_receipt_digest, 'rollback_receipt.injection_receipt_digest'),
    mount_readback_digest: hash(record.mount_readback_digest, 'rollback_receipt.mount_readback_digest'),
    mount_bundle_digest: hash(record.mount_bundle_digest, 'rollback_receipt.mount_bundle_digest'),
    rollback_plan_digest: hash(record.rollback_plan_digest, 'rollback_receipt.rollback_plan_digest'),
    rollback_reason_code: identifier(record.rollback_reason_code, 'rollback_receipt.rollback_reason_code', 128),
    rolled_back_at_epoch: integer(record.rolled_back_at_epoch, 'rollback_receipt.rolled_back_at_epoch', 1),
    rollback_receipt_digest: suppliedDigest,
  };
  if (normalized.contract !== 'spec014.hostinger-storage-authorized-dependency-injection-rollback.v1'
    || normalized.version !== HOSTINGER_STORAGE_AUTHORIZED_DEPENDENCY_INJECTION_VERSION
    || normalized.dependency_injected !== false
    || normalized.mount_performed !== false
    || normalized.runtime_mounted !== false
    || normalized.route_mounted !== false
    || normalized.worker_mounted !== false
    || normalized.live_server_modified !== false
    || normalized.live_route_registration_performed !== false
    || normalized.provider_dispatch_allowed !== false
    || normalized.production_ready !== false
    || normalized.automatic_retry_allowed !== false
    || normalized.fail_closed_route_restored !== true
    || normalized.reconciliation_state !== 'dependency_injection_rolled_back'
    || normalized.secrets_included !== false) {
    throw fail(409, 'STORAGE_DURABLE_INJECTION_ROLLBACK_INVALID', 'Rollback receipt failed the durable contract boundary.');
  }
  return deepFreeze(normalized);
}

function assertReceiptReadbackParity(receipt, readback) {
  const fields = [
    'injection_id',
    'injection_generation',
    'mount_bundle_digest',
    'route_dependency_snapshot_digest',
    'expected_runtime_sha',
    'source_commit',
    'database_fingerprint',
    'schema_verification_digest',
    'readback_cycle_id',
  ];
  const mismatches = fields.filter((field) => receipt[field] !== readback[field]);
  if (readback.injection_receipt_digest !== receipt.injection_receipt_digest) {
    mismatches.push('injection_receipt_digest');
  }
  if (mismatches.length) {
    throw fail(409, 'STORAGE_DURABLE_INJECTION_RECEIPT_READBACK_MISMATCH', 'Injection receipt and mount readback are not bound to the same runtime snapshot.', {
      mismatches: [...new Set(mismatches)].sort(),
    });
  }
}

function stateCore(receipt, readback) {
  return {
    contract: 'spec014.hostinger-storage-durable-injection-readback-state.v1',
    version: HOSTINGER_STORAGE_DURABLE_INJECTION_READBACK_STATE_VERSION,
    injection_id: receipt.injection_id,
    generation: 1,
    status: 'readback_verified',
    active: true,
    mount_bundle_digest: receipt.mount_bundle_digest,
    authorization_id: receipt.authorization_id,
    authorization_generation: receipt.authorization_generation,
    authorization_consumption_digest: receipt.authorization_consumption_digest,
    dependency_manifest_digest: receipt.dependency_manifest_digest,
    expected_runtime_sha: receipt.expected_runtime_sha,
    source_commit: receipt.source_commit,
    database_fingerprint: receipt.database_fingerprint,
    schema_verification_digest: receipt.schema_verification_digest,
    readback_cycle_id: receipt.readback_cycle_id,
    rollback_plan_digest: receipt.rollback_plan_digest,
    route_dependency_snapshot_digest: receipt.route_dependency_snapshot_digest,
    injection_receipt_digest: receipt.injection_receipt_digest,
    mount_readback_digest: readback.mount_readback_digest,
    rollback_receipt_digest: null,
    persisted_at_epoch: receipt.injected_at_epoch,
    rolled_back_at_epoch: null,
    injection_receipt: clone(receipt),
    mount_readback: clone(readback),
    rollback_receipt: null,
    runtime_object_persisted: false,
    resume_allowed: true,
    provider_dispatch_allowed: false,
    production_ready: false,
    automatic_retry_allowed: false,
    secrets_included: false,
  };
}

function createInitialState(receipt, readback) {
  assertReceiptReadbackParity(receipt, readback);
  const core = stateCore(receipt, readback);
  return deepFreeze({ ...core, state_digest: digest(core) });
}

function createRolledBackState(current, rollback) {
  const mismatches = [];
  if (rollback.injection_id !== current.injection_id) mismatches.push('injection_id');
  if (rollback.injection_generation !== current.injection_receipt.injection_generation) mismatches.push('injection_generation');
  if (rollback.injection_receipt_digest !== current.injection_receipt_digest) mismatches.push('injection_receipt_digest');
  if (rollback.mount_readback_digest !== current.mount_readback_digest) mismatches.push('mount_readback_digest');
  if (rollback.mount_bundle_digest !== current.mount_bundle_digest) mismatches.push('mount_bundle_digest');
  if (rollback.rollback_plan_digest !== current.rollback_plan_digest) mismatches.push('rollback_plan_digest');
  if (mismatches.length) {
    throw fail(409, 'STORAGE_DURABLE_INJECTION_ROLLBACK_BINDING_MISMATCH', 'Rollback receipt is not bound to the active durable injection state.', {
      mismatches: [...new Set(mismatches)].sort(),
    });
  }
  const core = {
    ...clone(current),
    generation: current.generation + 1,
    status: 'rolled_back',
    active: false,
    rollback_receipt_digest: rollback.rollback_receipt_digest,
    rolled_back_at_epoch: rollback.rolled_back_at_epoch,
    rollback_receipt: clone(rollback),
    resume_allowed: false,
    runtime_object_persisted: false,
    provider_dispatch_allowed: false,
    production_ready: false,
    automatic_retry_allowed: false,
    secrets_included: false,
  };
  delete core.state_digest;
  return deepFreeze({ ...core, state_digest: digest(core) });
}

function same(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function deterministicEventId(injectionId, generation, eventType) {
  const hex = createHash('sha256').update(`${injectionId}\0${generation}\0${eventType}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-b${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function createEvent(state, eventType, eventEpoch) {
  const core = {
    contract: 'spec014.hostinger-storage-durable-injection-event.v1',
    version: HOSTINGER_STORAGE_DURABLE_INJECTION_READBACK_STATE_VERSION,
    event_id: deterministicEventId(state.injection_id, state.generation, eventType),
    injection_id: state.injection_id,
    event_type: eventType,
    state_generation: state.generation,
    state_digest: state.state_digest,
    injection_receipt_digest: state.injection_receipt_digest,
    mount_readback_digest: state.mount_readback_digest,
    rollback_receipt_digest: state.rollback_receipt_digest,
    event_at_epoch: eventEpoch,
    provider_dispatch_allowed: false,
    production_ready: false,
    automatic_retry_allowed: false,
    secrets_included: false,
  };
  return deepFreeze({ ...core, event_digest: digest(core) });
}

function normalizeStoredState(row) {
  let value = row?.record_json;
  if (Buffer.isBuffer(value)) value = value.toString('utf8');
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch {
      throw fail(409, 'STORAGE_DURABLE_INJECTION_STATE_JSON_INVALID', 'Durable injection state JSON is invalid.');
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw fail(409, 'STORAGE_DURABLE_INJECTION_STATE_JSON_INVALID', 'Durable injection state JSON is invalid.');
  }
  assertDataOnly(value, 'storage_mount_injection_states.record_json');
  const supplied = hash(value.state_digest, 'state.state_digest');
  const core = clone(value);
  delete core.state_digest;
  if (digest(core) !== supplied || row.record_digest !== supplied) {
    throw fail(409, 'STORAGE_DURABLE_INJECTION_STATE_DIGEST_MISMATCH', 'Durable injection state digest mismatch.');
  }
  const receipt = verifyInjectionReceipt(value.injection_receipt);
  const readback = verifyMountReadback(value.mount_readback);
  assertReceiptReadbackParity(receipt, readback);
  if (value.injection_id !== receipt.injection_id
    || value.injection_receipt_digest !== receipt.injection_receipt_digest
    || value.mount_readback_digest !== readback.mount_readback_digest
    || value.mount_bundle_digest !== receipt.mount_bundle_digest
    || value.route_dependency_snapshot_digest !== receipt.route_dependency_snapshot_digest
    || value.runtime_object_persisted !== false
    || value.provider_dispatch_allowed !== false
    || value.production_ready !== false
    || value.automatic_retry_allowed !== false
    || value.secrets_included !== false) {
    throw fail(409, 'STORAGE_DURABLE_INJECTION_STATE_BINDING_MISMATCH', 'Durable injection state does not match its embedded evidence.');
  }
  if (value.status === 'readback_verified') {
    if (value.generation !== 1 || value.active !== true || value.resume_allowed !== true
      || value.rollback_receipt !== null || value.rollback_receipt_digest !== null) {
      throw fail(409, 'STORAGE_DURABLE_INJECTION_STATE_ACTIVE_INVALID', 'Active durable injection state is malformed.');
    }
  } else if (value.status === 'rolled_back') {
    const rollback = verifyRollbackReceipt(value.rollback_receipt);
    if (value.generation !== 2 || value.active !== false || value.resume_allowed !== false
      || value.rollback_receipt_digest !== rollback.rollback_receipt_digest) {
      throw fail(409, 'STORAGE_DURABLE_INJECTION_STATE_ROLLBACK_INVALID', 'Rolled-back durable injection state is malformed.');
    }
  } else {
    throw fail(409, 'STORAGE_DURABLE_INJECTION_STATE_STATUS_INVALID', 'Durable injection state status is unsupported.');
  }
  return deepFreeze(clone(value));
}

function normalizeStoredEvent(row) {
  let value = row?.record_json;
  if (Buffer.isBuffer(value)) value = value.toString('utf8');
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch {
      throw fail(409, 'STORAGE_DURABLE_INJECTION_EVENT_JSON_INVALID', 'Durable injection event JSON is invalid.');
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw fail(409, 'STORAGE_DURABLE_INJECTION_EVENT_JSON_INVALID', 'Durable injection event JSON is invalid.');
  }
  assertDataOnly(value, 'storage_mount_injection_events.record_json');
  const supplied = hash(value.event_digest, 'event.event_digest');
  const core = clone(value);
  delete core.event_digest;
  if (digest(core) !== supplied || row.record_digest !== supplied) {
    throw fail(409, 'STORAGE_DURABLE_INJECTION_EVENT_DIGEST_MISMATCH', 'Durable injection event digest mismatch.');
  }
  return deepFreeze(clone(value));
}

function assertSchemaVerification(value) {
  assertDataOnly(value, 'schema_verification');
  if (value?.ready !== true || value?.schema_verified !== true || (value?.blockers || []).length !== 0) {
    throw fail(409, 'STORAGE_DURABLE_INJECTION_SCHEMA_VERIFICATION_REQUIRED', 'Successful signed durable injection-state schema verification is required.');
  }
  if (value.production_ready !== false || value.authority_granted !== false
    || value.migration_apply_authorized !== false || value.provider_dispatch_allowed !== false) {
    throw fail(409, 'STORAGE_DURABLE_INJECTION_SCHEMA_BOUNDARY_INVALID', 'Schema verification cannot grant production, migration, authority, or provider capability.');
  }
  const evidence = value.evidence || {};
  const schema = evidence.durable_injection_readback_schema || {};
  const expectedTables = [...HOSTINGER_STORAGE_DURABLE_INJECTION_READBACK_SCHEMA_CONTRACT.tables].sort();
  const observedTables = Array.isArray(schema.tables) ? [...schema.tables].sort() : [];
  if (schema.contract_key !== HOSTINGER_STORAGE_DURABLE_INJECTION_READBACK_SCHEMA_CONTRACT.contract_key
    || schema.contract_digest !== HOSTINGER_STORAGE_DURABLE_INJECTION_READBACK_SCHEMA_DIGEST
    || JSON.stringify(observedTables) !== JSON.stringify(expectedTables)) {
    throw fail(409, 'STORAGE_DURABLE_INJECTION_SCHEMA_CONTRACT_MISMATCH', 'Signed schema verification does not bind the exact durable injection-state schema contract.');
  }
  const verified = {
    evidence_digest: hash(value.evidence_digest, 'schema_verification.evidence_digest'),
    source_commit: hash(evidence.source_commit, 'schema_verification.source_commit'),
    deployed_runtime_sha: hash(evidence.deployed_runtime_sha, 'schema_verification.deployed_runtime_sha'),
    runtime_parity: evidence.runtime_parity === true,
    database_fingerprint: hash(evidence.database_fingerprint, 'schema_verification.database_fingerprint'),
    readback_cycle_id: identifier(evidence.readback_cycle_id, 'schema_verification.readback_cycle_id', 191),
    expires_at: text(evidence.expires_at, 64),
    schema_contract_digest: schema.contract_digest,
    secrets_included: false,
  };
  if (!verified.runtime_parity || verified.source_commit !== verified.deployed_runtime_sha) {
    throw fail(409, 'STORAGE_DURABLE_INJECTION_SCHEMA_RUNTIME_PARITY_REQUIRED', 'Exact deployed runtime parity is required.');
  }
  if (Date.parse(verified.expires_at) <= Date.now()) {
    throw fail(409, 'STORAGE_DURABLE_INJECTION_SCHEMA_VERIFICATION_EXPIRED', 'Durable injection-state schema verification expired.');
  }
  return deepFreeze(verified);
}

async function execute(connection, statement, params = []) {
  const method = typeof connection?.execute === 'function' ? 'execute' : 'query';
  if (typeof connection?.[method] !== 'function') {
    throw fail(500, 'STORAGE_DURABLE_INJECTION_CONNECTION_INVALID', 'SQL connection must expose execute() or query().');
  }
  return connection[method](statement, params);
}

function normalizeDriverError(error) {
  if (error?.code?.startsWith?.('STORAGE_')) return error;
  if (['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(error?.code)) {
    return fail(503, 'STORAGE_DURABLE_INJECTION_SCHEMA_UNAVAILABLE', 'Durable injection-state schema is unavailable.', { mysql_code: error.code });
  }
  if (['ER_DUP_ENTRY', 'ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error?.code)) {
    return fail(409, 'STORAGE_DURABLE_INJECTION_CONFLICT', 'Durable injection state changed concurrently.', { mysql_code: error.code });
  }
  return error;
}

async function transaction(pool, timeoutSeconds, work) {
  const connection = await pool.getConnection();
  let began = false;
  let locked = false;
  try {
    await connection.beginTransaction();
    began = true;
    const [rows] = await execute(connection, '/* spec014:durable-injection:lock:acquire */ SELECT GET_LOCK(?, ?) AS acquired', [LOCK_NAME, timeoutSeconds]);
    if (Number(rows?.[0]?.acquired) !== 1) {
      throw fail(409, 'STORAGE_DURABLE_INJECTION_LOCK_UNAVAILABLE', 'Durable injection-state lock is unavailable.');
    }
    locked = true;
    const result = await work(connection);
    await connection.commit();
    began = false;
    return result;
  } catch (error) {
    if (began) {
      try { await connection.rollback(); } catch { /* Preserve primary error. */ }
    }
    throw normalizeDriverError(error);
  } finally {
    if (locked) {
      try { await execute(connection, '/* spec014:durable-injection:lock:release */ SELECT RELEASE_LOCK(?) AS released', [LOCK_NAME]); } catch { /* Connection release also releases lock. */ }
    }
    connection.release?.();
  }
}

async function withConnection(pool, work) {
  const connection = await pool.getConnection();
  try {
    return await work(connection);
  } catch (error) {
    throw normalizeDriverError(error);
  } finally {
    connection.release?.();
  }
}

async function loadState(connection, injectionId, { forUpdate = false } = {}) {
  const [rows] = await execute(connection, `/* spec014:durable-injection:load-state */ SELECT record_digest, record_json, row_version FROM storage_mount_injection_states WHERE id=?${forUpdate ? ' FOR UPDATE' : ''}`, [injectionId]);
  const bounded = Array.isArray(rows) ? rows : [];
  if (bounded.length > 1) {
    throw fail(409, 'STORAGE_DURABLE_INJECTION_STATE_AMBIGUOUS', 'Injection identity resolved to multiple durable rows.', { injection_id: injectionId });
  }
  if (bounded.length === 0) return null;
  return { state: normalizeStoredState(bounded[0]), row_version: Number(bounded[0].row_version) };
}

async function loadEvents(connection, injectionId) {
  const [rows] = await execute(connection, '/* spec014:durable-injection:load-events */ SELECT record_digest, record_json FROM storage_mount_injection_events WHERE injection_id=? ORDER BY state_generation ASC', [injectionId]);
  const bounded = Array.isArray(rows) ? rows : [];
  if (bounded.length > 2) {
    throw fail(409, 'STORAGE_DURABLE_INJECTION_EVENTS_AMBIGUOUS', 'Injection state contains more lifecycle events than allowed.', { injection_id: injectionId });
  }
  return deepFreeze(bounded.map(normalizeStoredEvent));
}

async function insertState(connection, state) {
  return execute(connection, `/* spec014:durable-injection:insert-state */ INSERT INTO storage_mount_injection_states (
    id, mount_bundle_digest, injection_receipt_digest, mount_readback_digest,
    rollback_receipt_digest, status, active, generation, record_digest, record_json,
    row_version, secrets_included
  ) VALUES (?, ?, ?, ?, NULL, 'readback_verified', 1, 1, ?, CAST(? AS JSON), 1, 0)`, [
    state.injection_id, state.mount_bundle_digest, state.injection_receipt_digest,
    state.mount_readback_digest, state.state_digest, JSON.stringify(state),
  ]);
}

async function updateRolledBack(connection, state, expectedGeneration, expectedVersion) {
  const [result] = await execute(connection, `/* spec014:durable-injection:update-rollback */ UPDATE storage_mount_injection_states SET
    rollback_receipt_digest=?, status='rolled_back', active=0, generation=?,
    record_digest=?, record_json=CAST(? AS JSON), row_version=row_version+1
    WHERE id=? AND active=1 AND generation=? AND row_version=?`, [
    state.rollback_receipt_digest, state.generation, state.state_digest, JSON.stringify(state),
    state.injection_id, expectedGeneration, expectedVersion,
  ]);
  if (Number(result?.affectedRows) !== 1) {
    throw fail(409, 'STORAGE_DURABLE_INJECTION_CAS_CONFLICT', 'Injection generation, active state, or row version changed concurrently.', { injection_id: state.injection_id });
  }
}

async function insertEvent(connection, event) {
  return execute(connection, `/* spec014:durable-injection:insert-event */ INSERT INTO storage_mount_injection_events (
    id, injection_id, event_type, state_generation, record_digest, record_json, secrets_included
  ) VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), 0)`, [
    event.event_id, event.injection_id, event.event_type, event.state_generation,
    event.event_digest, JSON.stringify(event),
  ]);
}

export function createHostingerStorageDurableInjectionReadbackState(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw fail(500, 'STORAGE_DURABLE_INJECTION_OPTIONS_INVALID', 'Durable injection-state options must be an object.');
  }
  const unsupported = Object.keys(options).filter((key) => !ALLOWED_OPTIONS.has(key));
  if (unsupported.length) {
    throw fail(409, 'STORAGE_DURABLE_INJECTION_OVERRIDE_FORBIDDEN', 'Only pool, signed schema verification, and bounded lock timeout may be supplied.', { unsupported_options: unsupported.sort() });
  }
  const { pool, schema_verification, lock_timeout_seconds = 5 } = options;
  if (!pool || typeof pool.getConnection !== 'function') {
    throw fail(500, 'STORAGE_DURABLE_INJECTION_POOL_INVALID', 'A MySQL-compatible pool is required.');
  }
  const timeout = integer(lock_timeout_seconds, 'lock_timeout_seconds', 1);
  if (timeout > 30) {
    throw fail(500, 'STORAGE_DURABLE_INJECTION_LOCK_TIMEOUT_INVALID', 'Lock timeout must not exceed 30 seconds.');
  }
  const verification = assertSchemaVerification(schema_verification);

  async function persistVerifiedMount(input = {}) {
    const allowed = new Set(['injection_receipt', 'mount_readback', 'expected_mount_bundle_digest']);
    assertExactFields(input, allowed, 'persist_verified_mount');
    const receipt = verifyInjectionReceipt(input.injection_receipt);
    const readback = verifyMountReadback(input.mount_readback);
    assertReceiptReadbackParity(receipt, readback);
    const expectedBundle = hash(input.expected_mount_bundle_digest, 'expected_mount_bundle_digest');
    if (receipt.mount_bundle_digest !== expectedBundle) {
      throw fail(409, 'STORAGE_DURABLE_INJECTION_MOUNT_BUNDLE_MISMATCH', 'Verified mount evidence does not match the expected bundle digest.');
    }
    const state = createInitialState(receipt, readback);
    const event = createEvent(state, 'readback_verified', receipt.injected_at_epoch);
    return transaction(pool, timeout, async (connection) => {
      const current = await loadState(connection, state.injection_id, { forUpdate: true });
      if (current) {
        if (!same(current.state, state)) {
          throw fail(409, 'STORAGE_DURABLE_INJECTION_ID_CONFLICT', 'Injection ID is already bound to different durable evidence.', { injection_id: state.injection_id });
        }
        const events = await loadEvents(connection, state.injection_id);
        if (events.length !== 1 || !same(events[0], event)) {
          throw fail(409, 'STORAGE_DURABLE_INJECTION_EVENT_STATE_MISMATCH', 'Durable injection state and immutable event history disagree.', { injection_id: state.injection_id });
        }
        return deepFreeze({ created: false, replay: true, state: current.state, row_version: current.row_version, schema_verification_digest: verification.evidence_digest, secrets_included: false });
      }
      const eventsBefore = await loadEvents(connection, state.injection_id);
      if (eventsBefore.length !== 0) {
        throw fail(409, 'STORAGE_DURABLE_INJECTION_ORPHAN_EVENT_CONFLICT', 'Injection events exist without their current state row.', { injection_id: state.injection_id });
      }
      await insertState(connection, state);
      await insertEvent(connection, event);
      const readbackState = await loadState(connection, state.injection_id);
      const readbackEvents = await loadEvents(connection, state.injection_id);
      if (!readbackState || readbackState.row_version !== 1 || !same(readbackState.state, state)
        || readbackEvents.length !== 1 || !same(readbackEvents[0], event)) {
        throw fail(409, 'STORAGE_DURABLE_INJECTION_INSERT_READBACK_MISMATCH', 'Inserted durable injection state failed exact same-transaction readback.', { injection_id: state.injection_id });
      }
      return deepFreeze({ created: true, replay: false, state: readbackState.state, row_version: 1, schema_verification_digest: verification.evidence_digest, secrets_included: false });
    });
  }

  async function read(rawId) {
    const injectionId = identifier(rawId, 'injection_id', 191);
    return withConnection(pool, async (connection) => {
      const current = await loadState(connection, injectionId);
      return current ? deepFreeze(clone(current.state)) : null;
    });
  }

  async function readEvents(rawId) {
    const injectionId = identifier(rawId, 'injection_id', 191);
    return withConnection(pool, async (connection) => loadEvents(connection, injectionId));
  }

  async function readRecoverySnapshot(rawId) {
    const injectionId = identifier(rawId, 'injection_id', 191);
    return withConnection(pool, async (connection) => {
      const current = await loadState(connection, injectionId);
      if (!current) return null;
      const state = current.state;
      return deepFreeze({
        contract: 'spec014.hostinger-storage-durable-injection-recovery-snapshot.v1',
        version: HOSTINGER_STORAGE_DURABLE_INJECTION_READBACK_STATE_VERSION,
        injection_id: state.injection_id,
        generation: state.generation,
        status: state.status,
        active: state.active,
        resume_allowed: state.resume_allowed,
        mount_bundle_digest: state.mount_bundle_digest,
        injection_receipt_digest: state.injection_receipt_digest,
        mount_readback_digest: state.mount_readback_digest,
        rollback_receipt_digest: state.rollback_receipt_digest,
        injection_receipt: state.resume_allowed ? clone(state.injection_receipt) : null,
        mount_readback: state.resume_allowed ? clone(state.mount_readback) : null,
        runtime_object_persisted: false,
        provider_dispatch_allowed: false,
        production_ready: false,
        automatic_retry_allowed: false,
        secrets_included: false,
      });
    });
  }

  async function recordRollback(input = {}) {
    const allowed = new Set(['rollback_receipt', 'expected_generation', 'expected_row_version']);
    assertExactFields(input, allowed, 'record_rollback');
    const rollback = verifyRollbackReceipt(input.rollback_receipt);
    const expectedGeneration = integer(input.expected_generation, 'expected_generation', 1);
    const expectedVersion = integer(input.expected_row_version, 'expected_row_version', 1);
    return transaction(pool, timeout, async (connection) => {
      const current = await loadState(connection, rollback.injection_id, { forUpdate: true });
      if (!current) {
        throw fail(404, 'STORAGE_DURABLE_INJECTION_NOT_FOUND', 'Durable injection state was not found.', { injection_id: rollback.injection_id });
      }
      if (current.state.status === 'rolled_back') {
        if (current.state.rollback_receipt_digest === rollback.rollback_receipt_digest
          && same(current.state.rollback_receipt, rollback)) {
          return deepFreeze({ updated: false, replay: true, state: current.state, row_version: current.row_version, schema_verification_digest: verification.evidence_digest, secrets_included: false });
        }
        throw fail(409, 'STORAGE_DURABLE_INJECTION_ROLLBACK_CONFLICT', 'Injection state was already rolled back with different evidence.', { injection_id: rollback.injection_id });
      }
      if (current.state.generation !== expectedGeneration || current.row_version !== expectedVersion) {
        throw fail(409, 'STORAGE_DURABLE_INJECTION_GENERATION_MISMATCH', 'Injection generation or row version changed before rollback.', {
          injection_id: rollback.injection_id,
          current_generation: current.state.generation,
          current_row_version: current.row_version,
        });
      }
      const next = createRolledBackState(current.state, rollback);
      const event = createEvent(next, 'rolled_back', rollback.rolled_back_at_epoch);
      await updateRolledBack(connection, next, expectedGeneration, expectedVersion);
      await insertEvent(connection, event);
      const readbackState = await loadState(connection, next.injection_id);
      const events = await loadEvents(connection, next.injection_id);
      if (!readbackState || readbackState.row_version !== expectedVersion + 1 || !same(readbackState.state, next)
        || events.length !== 2 || !same(events[1], event)) {
        throw fail(409, 'STORAGE_DURABLE_INJECTION_ROLLBACK_READBACK_MISMATCH', 'Rolled-back injection state failed exact same-transaction readback.', { injection_id: next.injection_id });
      }
      return deepFreeze({ updated: true, replay: false, state: readbackState.state, row_version: expectedVersion + 1, schema_verification_digest: verification.evidence_digest, secrets_included: false });
    });
  }

  const repository = {
    repository_key: 'hostinger_storage_durable_injection_readback_state_v1',
    repository_version: HOSTINGER_STORAGE_DURABLE_INJECTION_READBACK_STATE_VERSION,
    schema_contract: HOSTINGER_STORAGE_DURABLE_INJECTION_READBACK_SCHEMA_CONTRACT,
    schema_contract_digest: HOSTINGER_STORAGE_DURABLE_INJECTION_READBACK_SCHEMA_DIGEST,
    signed_schema_verification_digest: verification.evidence_digest,
    runtime_object_persisted: false,
    provider_dispatch_allowed: false,
    production_ready: false,
    automatic_retry_allowed: false,
    persistVerifiedMount,
    read,
    readEvents,
    readRecoverySnapshot,
    recordRollback,
    secrets_included: false,
  };
  Object.defineProperty(repository, BRAND, { value: true, enumerable: false });
  return Object.freeze(repository);
}

export function isCanonicalHostingerStorageDurableInjectionReadbackState(value) {
  return Boolean(value?.[BRAND] === true
    && Object.isFrozen(value)
    && value.repository_key === 'hostinger_storage_durable_injection_readback_state_v1'
    && value.repository_version === HOSTINGER_STORAGE_DURABLE_INJECTION_READBACK_STATE_VERSION
    && value.schema_contract_digest === HOSTINGER_STORAGE_DURABLE_INJECTION_READBACK_SCHEMA_DIGEST
    && value.runtime_object_persisted === false
    && value.provider_dispatch_allowed === false
    && value.production_ready === false
    && value.automatic_retry_allowed === false
    && typeof value.persistVerifiedMount === 'function'
    && typeof value.read === 'function'
    && typeof value.readEvents === 'function'
    && typeof value.readRecoverySnapshot === 'function'
    && typeof value.recordRollback === 'function'
    && value.secrets_included === false);
}
