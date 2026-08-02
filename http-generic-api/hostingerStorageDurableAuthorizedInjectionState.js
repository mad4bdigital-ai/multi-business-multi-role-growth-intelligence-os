import { createHash } from 'node:crypto';
import { HOSTINGER_STORAGE_AUTHORIZED_DEPENDENCY_INJECTION_VERSION } from './hostingerStorageAuthorizedDependencyInjection.js';

export const HOSTINGER_STORAGE_DURABLE_AUTHORIZED_INJECTION_STATE_VERSION =
  'spec014-hostinger-storage-durable-authorized-injection-state-v1';

const BRAND = Symbol.for('mad4b.spec014.hostinger-storage-durable-authorized-injection-state');
const LOCK_NAME = 'spec014:hostinger-storage-authorized-injection-state';
const ROUTE_PATH = '/tenant/storage-operations/apply-plan';
const DEPENDENCY_KEY = 'tenantStorageRuntime';
const SHA256_RE = /^[0-9a-f]{64}$/u;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/+/-]{0,255}$/u;
const ALLOWED_OPTIONS = new Set(['pool', 'schema_verification', 'lock_timeout_seconds']);

export const HOSTINGER_STORAGE_DURABLE_AUTHORIZED_INJECTION_SCHEMA_CONTRACT = Object.freeze({
  contract_key: 'hostinger_storage_durable_authorized_injection_state_schema_v1',
  tables: Object.freeze([
    'storage_authorized_injection_states',
    'storage_authorized_injection_rollbacks',
  ]),
  one_active_state_per_injection: true,
  exact_receipt_readback_binding: true,
  immutable_rollback_receipt: true,
  row_version_cas: true,
  runtime_material_persisted: false,
  secrets_included: false,
});

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

export const HOSTINGER_STORAGE_DURABLE_AUTHORIZED_INJECTION_SCHEMA_DIGEST = digest(
  HOSTINGER_STORAGE_DURABLE_AUTHORIZED_INJECTION_SCHEMA_CONTRACT,
);

function fail(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = Object.freeze({ ...details, secrets_included: false });
  return error;
}

function text(value, max = 512) {
  return String(value ?? '').trim().slice(0, max);
}

function identifier(value, field, max = 256) {
  const normalized = text(value, max);
  if (!SAFE_ID_RE.test(normalized) || normalized.length > max) {
    throw fail(400, 'STORAGE_DURABLE_INJECTION_IDENTIFIER_INVALID', 'A safe bounded identifier is required.', { field });
  }
  return normalized;
}

function hash(value, field) {
  const normalized = text(value, 64).toLowerCase();
  if (!SHA256_RE.test(normalized)) {
    throw fail(400, 'STORAGE_DURABLE_INJECTION_HASH_INVALID', 'A lowercase SHA-256 binding is required.', { field });
  }
  return normalized;
}

function integer(value, field, minimum = 0) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < minimum) {
    throw fail(400, 'STORAGE_DURABLE_INJECTION_INTEGER_INVALID', 'A bounded integer is required.', { field, minimum });
  }
  return normalized;
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function assertDataOnly(value, path = 'value', active = new WeakSet(), depth = 0) {
  if (depth > 24) {
    throw fail(400, 'STORAGE_DURABLE_INJECTION_DATA_TOO_DEEP', 'Durable injection evidence exceeded the supported depth.', { path });
  }
  if (value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value)) return;
  if (typeof value !== 'object') {
    throw fail(400, 'STORAGE_DURABLE_INJECTION_DATA_INVALID', 'Durable injection evidence must contain data values only.', { path });
  }
  if (active.has(value)) {
    throw fail(400, 'STORAGE_DURABLE_INJECTION_DATA_CYCLE', 'Durable injection evidence must not contain cycles.', { path });
  }
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw fail(400, 'STORAGE_DURABLE_INJECTION_DATA_INVALID', 'Durable injection evidence must use plain data objects.', { path });
  }
  active.add(value);
  try {
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) {
        throw fail(400, 'STORAGE_DURABLE_INJECTION_ACCESSOR_REJECTED', 'Durable injection evidence must use owned data fields.', { path: `${path}.${key}` });
      }
      if (key === 'secrets_included' && descriptor.value !== false) {
        throw fail(400, 'STORAGE_DURABLE_INJECTION_SECRET_DECLARATION_INVALID', 'Secret declaration must remain false.', { path: `${path}.${key}` });
      }
      if (key !== 'secrets_included'
        && /(password|passwd|secret_value|private[_-]?key|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization_header|cookie_header|raw_provider_payload|raw_environment|file_content|absolute_path|shell_command|credential_material|tenantStorageRuntime)/i.test(key)) {
        throw fail(400, 'STORAGE_DURABLE_INJECTION_SECRET_OR_RUNTIME_FIELD_REJECTED', 'Durable injection evidence cannot contain secrets, runtime material, or execution fields.', { path: `${path}.${key}` });
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

function verifyDigestBoundObject(value, digestField, expectedContract, path) {
  const copy = snapshot(value, path);
  const suppliedDigest = hash(copy?.[digestField], `${path}.${digestField}`);
  delete copy[digestField];
  if (digest(copy) !== suppliedDigest || copy.contract !== expectedContract) {
    throw fail(409, 'STORAGE_DURABLE_INJECTION_EVIDENCE_INVALID', 'Persisted injection evidence failed exact digest or contract verification.', { path });
  }
  return deepFreeze({ ...copy, [digestField]: suppliedDigest });
}

function verifyReceipt(value) {
  const receipt = verifyDigestBoundObject(
    value,
    'injection_receipt_digest',
    'spec014.hostinger-storage-authorized-dependency-injection-receipt.v1',
    'injection_receipt',
  );
  if (receipt.version !== HOSTINGER_STORAGE_AUTHORIZED_DEPENDENCY_INJECTION_VERSION
    || receipt.route_path !== ROUTE_PATH
    || receipt.dependency_key !== DEPENDENCY_KEY
    || receipt.injection_generation !== 1
    || !Number.isSafeInteger(receipt.injected_at_epoch)
    || receipt.injected_at_epoch < 1
    || receipt.dependency_snapshot_created !== true
    || receipt.dependency_injected !== true
    || receipt.mount_performed !== true
    || receipt.runtime_mounted !== true
    || receipt.route_mounted !== true
    || receipt.worker_mounted !== false
    || receipt.live_server_modified !== false
    || receipt.live_route_registration_performed !== false
    || receipt.provider_dispatch_allowed !== false
    || receipt.production_ready !== false
    || receipt.automatic_retry_allowed !== false
    || receipt.reconciliation_state !== 'dependency_injected_pending_exact_readback'
    || receipt.secrets_included !== false) {
    throw fail(409, 'STORAGE_DURABLE_INJECTION_RECEIPT_INVALID', 'Injection receipt does not satisfy the durable state contract.');
  }
  return receipt;
}

function verifyReadback(value) {
  const readback = verifyDigestBoundObject(
    value,
    'mount_readback_digest',
    'spec014.hostinger-storage-authorized-mount-readback.v1',
    'mount_readback',
  );
  if (readback.version !== HOSTINGER_STORAGE_AUTHORIZED_DEPENDENCY_INJECTION_VERSION
    || readback.route_path !== ROUTE_PATH
    || readback.dependency_key !== DEPENDENCY_KEY
    || readback.injection_generation !== 1
    || readback.readback_verified !== true
    || readback.dependency_descriptor_verified !== true
    || readback.exact_runtime_object_identity !== true
    || readback.route_dependency_snapshot_frozen !== true
    || readback.runtime_identity_verified !== true
    || readback.dependency_injected !== true
    || readback.mount_performed !== true
    || readback.runtime_mounted !== true
    || readback.route_mounted !== true
    || readback.worker_mounted !== false
    || readback.live_server_modified !== false
    || readback.live_route_registration_performed !== false
    || readback.provider_dispatch_allowed !== false
    || readback.production_ready !== false
    || readback.automatic_retry_allowed !== false
    || readback.reconciliation_state !== 'dependency_injection_readback_verified'
    || readback.secrets_included !== false) {
    throw fail(409, 'STORAGE_DURABLE_INJECTION_READBACK_INVALID', 'Mount readback does not satisfy the durable state contract.');
  }
  return readback;
}

function verifyRollback(value) {
  const rollback = verifyDigestBoundObject(
    value,
    'rollback_receipt_digest',
    'spec014.hostinger-storage-authorized-dependency-injection-rollback.v1',
    'rollback_receipt',
  );
  if (rollback.version !== HOSTINGER_STORAGE_AUTHORIZED_DEPENDENCY_INJECTION_VERSION
    || rollback.injection_generation !== 1
    || !Number.isSafeInteger(rollback.rolled_back_at_epoch)
    || rollback.rolled_back_at_epoch < 1
    || rollback.dependency_injected !== false
    || rollback.mount_performed !== false
    || rollback.runtime_mounted !== false
    || rollback.route_mounted !== false
    || rollback.worker_mounted !== false
    || rollback.live_server_modified !== false
    || rollback.live_route_registration_performed !== false
    || rollback.provider_dispatch_allowed !== false
    || rollback.production_ready !== false
    || rollback.automatic_retry_allowed !== false
    || rollback.fail_closed_route_restored !== true
    || rollback.reconciliation_state !== 'dependency_injection_rolled_back'
    || rollback.secrets_included !== false) {
    throw fail(409, 'STORAGE_DURABLE_INJECTION_ROLLBACK_INVALID', 'Rollback receipt does not satisfy the durable state contract.');
  }
  return rollback;
}

function verifyReceiptReadbackPair(receipt, readback) {
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
  const mismatches = [];
  if (readback.injection_receipt_digest !== receipt.injection_receipt_digest) mismatches.push('injection_receipt_digest');
  for (const field of fields) {
    if (readback[field] !== receipt[field]) mismatches.push(field);
  }
  if (mismatches.length) {
    throw fail(409, 'STORAGE_DURABLE_INJECTION_RECEIPT_READBACK_MISMATCH', 'Injection receipt and mount readback are not one exact durable state.', { mismatches: [...new Set(mismatches)].sort() });
  }
}

function assertSchemaVerification(value) {
  assertDataOnly(value, 'schema_verification');
  if (value?.ready !== true || value?.schema_verified !== true || !Array.isArray(value?.blockers) || value.blockers.length !== 0) {
    throw fail(409, 'STORAGE_DURABLE_INJECTION_SCHEMA_VERIFICATION_REQUIRED', 'Successful schema verification with zero blockers is required.');
  }
  if (value.production_ready !== false || value.authority_granted !== false
    || value.migration_apply_authorized !== false || value.provider_dispatch_allowed !== false) {
    throw fail(409, 'STORAGE_DURABLE_INJECTION_SCHEMA_BOUNDARY_INVALID', 'Schema verification cannot grant production, migration, authority, or provider capability.');
  }
  const evidence = value.evidence || {};
  const schema = evidence.authorized_injection_state_schema || {};
  const expectedTables = [...HOSTINGER_STORAGE_DURABLE_AUTHORIZED_INJECTION_SCHEMA_CONTRACT.tables].sort();
  const observedTables = Array.isArray(schema.tables) ? [...schema.tables].sort() : [];
  if (schema.contract_key !== HOSTINGER_STORAGE_DURABLE_AUTHORIZED_INJECTION_SCHEMA_CONTRACT.contract_key
    || schema.contract_digest !== HOSTINGER_STORAGE_DURABLE_AUTHORIZED_INJECTION_SCHEMA_DIGEST
    || JSON.stringify(observedTables) !== JSON.stringify(expectedTables)) {
    throw fail(409, 'STORAGE_DURABLE_INJECTION_SCHEMA_CONTRACT_MISMATCH', 'Schema verification does not bind the exact durable injection-state schema contract.');
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
    throw fail(409, 'STORAGE_DURABLE_INJECTION_RUNTIME_PARITY_REQUIRED', 'Exact source and deployed-runtime parity is required.');
  }
  if (!Number.isFinite(Date.parse(verified.expires_at)) || Date.parse(verified.expires_at) <= Date.now()) {
    throw fail(409, 'STORAGE_DURABLE_INJECTION_SCHEMA_VERIFICATION_EXPIRED', 'Schema verification expired or is invalid.');
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

function parseStored(row, kind) {
  let value = row?.record_json;
  if (Buffer.isBuffer(value)) value = value.toString('utf8');
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch {
      throw fail(409, 'STORAGE_DURABLE_INJECTION_RECORD_JSON_INVALID', 'Durable injection record JSON is invalid.', { kind });
    }
  }
  assertDataOnly(value, `${kind}.record_json`);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw fail(409, 'STORAGE_DURABLE_INJECTION_RECORD_DIGEST_MISMATCH', 'Durable injection record digest mismatch.', { kind });
  }
  const embeddedDigest = text(value.record_digest, 64).toLowerCase();
  const columnDigest = text(row?.record_digest, 64).toLowerCase();
  const core = clone(value);
  delete core.record_digest;
  if (!SHA256_RE.test(embeddedDigest)
    || !SHA256_RE.test(columnDigest)
    || embeddedDigest !== columnDigest
    || digest(core) !== columnDigest) {
    throw fail(409, 'STORAGE_DURABLE_INJECTION_RECORD_DIGEST_MISMATCH', 'Durable injection record digest mismatch.', { kind });
  }
  return deepFreeze(clone(value));
}

async function loadState(connection, injectionId, { forUpdate = false } = {}) {
  const [rows] = await execute(connection, `/* spec014:durable-injection:load-state */ SELECT record_digest, record_json, row_version FROM storage_authorized_injection_states WHERE injection_id=?${forUpdate ? ' FOR UPDATE' : ''}`, [injectionId]);
  const bounded = Array.isArray(rows) ? rows : [];
  if (bounded.length > 1) {
    throw fail(409, 'STORAGE_DURABLE_INJECTION_STATE_AMBIGUOUS', 'Injection identity resolved to multiple durable state rows.', { injection_id: injectionId });
  }
  if (bounded.length === 0) return null;
  return { record: parseStored(bounded[0], 'state'), row_version: Number(bounded[0].row_version) };
}

async function loadRollback(connection, injectionId, { forUpdate = false } = {}) {
  const [rows] = await execute(connection, `/* spec014:durable-injection:load-rollback */ SELECT record_digest, record_json FROM storage_authorized_injection_rollbacks WHERE injection_id=?${forUpdate ? ' FOR UPDATE' : ''}`, [injectionId]);
  const bounded = Array.isArray(rows) ? rows : [];
  if (bounded.length > 1) {
    throw fail(409, 'STORAGE_DURABLE_INJECTION_ROLLBACK_AMBIGUOUS', 'Injection identity resolved to multiple rollback rows.', { injection_id: injectionId });
  }
  if (bounded.length === 0) return null;
  return parseStored(bounded[0], 'rollback');
}

function same(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function stateRecord(receipt, readback, nowEpoch) {
  const core = {
    contract: 'spec014.hostinger-storage-durable-authorized-injection-state.v1',
    version: HOSTINGER_STORAGE_DURABLE_AUTHORIZED_INJECTION_STATE_VERSION,
    injection_id: receipt.injection_id,
    injection_generation: receipt.injection_generation,
    injection_receipt_digest: receipt.injection_receipt_digest,
    mount_readback_digest: readback.mount_readback_digest,
    mount_bundle_digest: receipt.mount_bundle_digest,
    authorization_id: receipt.authorization_id,
    authorization_generation: receipt.authorization_generation,
    authorization_consumption_digest: receipt.authorization_consumption_digest,
    dependency_manifest_digest: receipt.dependency_manifest_digest,
    route_dependency_snapshot_digest: receipt.route_dependency_snapshot_digest,
    expected_runtime_sha: receipt.expected_runtime_sha,
    source_commit: receipt.source_commit,
    database_fingerprint: receipt.database_fingerprint,
    schema_verification_digest: receipt.schema_verification_digest,
    readback_cycle_id: receipt.readback_cycle_id,
    rollback_plan_digest: receipt.rollback_plan_digest,
    registered_at_epoch: nowEpoch,
    active: true,
    durable_state_registered: true,
    runtime_material_persisted: false,
    live_database_access_performed_by_factory: false,
    worker_mounted: false,
    provider_dispatch_allowed: false,
    production_ready: false,
    automatic_retry_allowed: false,
    secrets_included: false,
    injection_receipt: receipt,
    mount_readback: readback,
  };
  return deepFreeze({ ...core, record_digest: digest(core) });
}

export function createHostingerStorageDurableAuthorizedInjectionStateRegistry(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw fail(500, 'STORAGE_DURABLE_INJECTION_OPTIONS_INVALID', 'Durable injection-state options must be an object.');
  }
  const unsupported = Object.keys(options).filter((key) => !ALLOWED_OPTIONS.has(key));
  if (unsupported.length) {
    throw fail(409, 'STORAGE_DURABLE_INJECTION_OVERRIDE_FORBIDDEN', 'Only pool, schema verification, and bounded lock timeout may be supplied.', { unsupported_options: unsupported.sort() });
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

  async function registerVerifiedInjection(input = {}) {
    const allowed = new Set(['injection_receipt', 'mount_readback', 'now_epoch']);
    const unsupportedFields = Object.keys(input || {}).filter((key) => !allowed.has(key));
    if (unsupportedFields.length) {
      throw fail(400, 'STORAGE_DURABLE_INJECTION_FIELD_FORBIDDEN', 'Unsupported durable injection registration fields are forbidden.', { unsupported_fields: unsupportedFields.sort() });
    }
    const receipt = verifyReceipt(input.injection_receipt);
    const readback = verifyReadback(input.mount_readback);
    verifyReceiptReadbackPair(receipt, readback);
    const nowEpoch = integer(input.now_epoch, 'now_epoch', 1);
    const record = stateRecord(receipt, readback, nowEpoch);

    return transaction(pool, timeout, async (connection) => {
      const current = await loadState(connection, record.injection_id, { forUpdate: true });
      const rollback = await loadRollback(connection, record.injection_id, { forUpdate: true });
      if (rollback) {
        throw fail(409, 'STORAGE_DURABLE_INJECTION_ROLLED_BACK_REPLAY_REJECTED', 'A rolled-back injection cannot be registered as active again.', { injection_id: record.injection_id });
      }
      if (current) {
        if (!same(current.record, record)) {
          throw fail(409, 'STORAGE_DURABLE_INJECTION_ID_CONFLICT', 'Injection ID is already bound to different durable evidence.', { injection_id: record.injection_id });
        }
        return deepFreeze({ created: false, replay: true, state: current.record, row_version: current.row_version, secrets_included: false });
      }
      await execute(connection, `/* spec014:durable-injection:insert-state */ INSERT INTO storage_authorized_injection_states (
        injection_id, injection_receipt_digest, mount_readback_digest, mount_bundle_digest,
        active, generation, record_digest, record_json, row_version, secrets_included
      ) VALUES (?, ?, ?, ?, 1, ?, ?, CAST(? AS JSON), 1, 0)`, [
        record.injection_id, record.injection_receipt_digest, record.mount_readback_digest,
        record.mount_bundle_digest, record.injection_generation, record.record_digest, JSON.stringify(record),
      ]);
      const readbackState = await loadState(connection, record.injection_id);
      if (!readbackState || !same(readbackState.record, record) || readbackState.row_version !== 1) {
        throw fail(409, 'STORAGE_DURABLE_INJECTION_INSERT_READBACK_MISMATCH', 'Inserted durable injection state failed exact readback.', { injection_id: record.injection_id });
      }
      return deepFreeze({ created: true, replay: false, state: readbackState.record, row_version: 1, secrets_included: false });
    });
  }

  async function readVerifiedInjection(rawId) {
    const injectionId = identifier(rawId, 'injection_id', 191);
    return withConnection(pool, async (connection) => {
      const current = await loadState(connection, injectionId);
      return current ? deepFreeze(clone(current.record)) : null;
    });
  }

  async function recordRollback(input = {}) {
    const allowed = new Set(['rollback_receipt', 'expected_mount_readback_digest', 'now_epoch']);
    const unsupportedFields = Object.keys(input || {}).filter((key) => !allowed.has(key));
    if (unsupportedFields.length) {
      throw fail(400, 'STORAGE_DURABLE_INJECTION_FIELD_FORBIDDEN', 'Unsupported durable rollback fields are forbidden.', { unsupported_fields: unsupportedFields.sort() });
    }
    const rollback = verifyRollback(input.rollback_receipt);
    const expectedReadbackDigest = hash(input.expected_mount_readback_digest, 'expected_mount_readback_digest');
    integer(input.now_epoch, 'now_epoch', 1);

    return transaction(pool, timeout, async (connection) => {
      const current = await loadState(connection, rollback.injection_id, { forUpdate: true });
      const existingRollback = await loadRollback(connection, rollback.injection_id, { forUpdate: true });
      if (!current || current.record.active !== true
        || current.record.mount_readback_digest !== expectedReadbackDigest
        || rollback.mount_readback_digest !== expectedReadbackDigest
        || rollback.injection_receipt_digest !== current.record.injection_receipt_digest
        || rollback.mount_bundle_digest !== current.record.mount_bundle_digest
        || rollback.injection_generation !== current.record.injection_generation) {
        throw fail(409, 'STORAGE_DURABLE_INJECTION_ROLLBACK_BINDING_MISMATCH', 'Rollback does not match the exact active durable injection state.', { injection_id: rollback.injection_id });
      }
      if (existingRollback) {
        throw fail(409, 'STORAGE_DURABLE_INJECTION_ROLLBACK_REPLAY_REJECTED', 'Rollback receipt is immutable and cannot be recorded twice.', { injection_id: rollback.injection_id });
      }
      const rollbackRecordCore = {
        contract: 'spec014.hostinger-storage-durable-authorized-injection-rollback.v1',
        version: HOSTINGER_STORAGE_DURABLE_AUTHORIZED_INJECTION_STATE_VERSION,
        injection_id: rollback.injection_id,
        injection_generation: rollback.injection_generation,
        injection_receipt_digest: rollback.injection_receipt_digest,
        mount_readback_digest: rollback.mount_readback_digest,
        mount_bundle_digest: rollback.mount_bundle_digest,
        rollback_receipt_digest: rollback.rollback_receipt_digest,
        active: false,
        fail_closed_route_restored: true,
        runtime_material_persisted: false,
        worker_mounted: false,
        provider_dispatch_allowed: false,
        production_ready: false,
        automatic_retry_allowed: false,
        secrets_included: false,
        rollback_receipt: rollback,
      };
      const rollbackRecord = deepFreeze({ ...rollbackRecordCore, record_digest: digest(rollbackRecordCore) });
      const nextCore = {
        ...current.record,
        active: false,
        durable_state_registered: true,
        rollback_receipt_digest: rollback.rollback_receipt_digest,
        fail_closed_route_restored: true,
      };
      delete nextCore.record_digest;
      const next = deepFreeze({ ...nextCore, record_digest: digest(nextCore) });
      const [updateResult] = await execute(connection, `/* spec014:durable-injection:update-rolled-back */ UPDATE storage_authorized_injection_states SET
        active=0, generation=generation+1, record_digest=?, record_json=CAST(? AS JSON), row_version=row_version+1
        WHERE injection_id=? AND active=1 AND row_version=?`, [
        next.record_digest, JSON.stringify(next), rollback.injection_id, current.row_version,
      ]);
      if (Number(updateResult?.affectedRows) !== 1) {
        throw fail(409, 'STORAGE_DURABLE_INJECTION_CAS_CONFLICT', 'Durable injection state changed concurrently.', { injection_id: rollback.injection_id });
      }
      await execute(connection, `/* spec014:durable-injection:insert-rollback */ INSERT INTO storage_authorized_injection_rollbacks (
        id, injection_id, rollback_receipt_digest, record_digest, record_json, secrets_included
      ) VALUES (?, ?, ?, ?, CAST(? AS JSON), 0)`, [
        rollback.rollback_receipt_digest.slice(0, 36), rollback.injection_id,
        rollback.rollback_receipt_digest, rollbackRecord.record_digest, JSON.stringify(rollbackRecord),
      ]);
      const stateReadback = await loadState(connection, rollback.injection_id);
      const rollbackReadback = await loadRollback(connection, rollback.injection_id);
      if (!stateReadback || !same(stateReadback.record, next) || stateReadback.row_version !== current.row_version + 1
        || !rollbackReadback || !same(rollbackReadback, rollbackRecord)) {
        throw fail(409, 'STORAGE_DURABLE_INJECTION_ROLLBACK_READBACK_MISMATCH', 'Durable rollback failed exact same-transaction readback.', { injection_id: rollback.injection_id });
      }
      return deepFreeze({ rolled_back: true, state: stateReadback.record, rollback: rollbackReadback, row_version: stateReadback.row_version, secrets_included: false });
    });
  }

  async function readRollback(rawId) {
    const injectionId = identifier(rawId, 'injection_id', 191);
    return withConnection(pool, async (connection) => {
      const rollback = await loadRollback(connection, injectionId);
      return rollback ? deepFreeze(clone(rollback)) : null;
    });
  }

  const registry = {
    registry_key: 'hostinger_storage_durable_authorized_injection_state_v1',
    registry_version: HOSTINGER_STORAGE_DURABLE_AUTHORIZED_INJECTION_STATE_VERSION,
    schema_verified: true,
    schema_verification_digest: verification.evidence_digest,
    schema_contract_digest: verification.schema_contract_digest,
    database_fingerprint: verification.database_fingerprint,
    source_commit: verification.source_commit,
    deployed_runtime_sha: verification.deployed_runtime_sha,
    durable_sql: true,
    async_only: true,
    runtime_material_persisted: false,
    live_database_access_performed_by_factory: false,
    migration_apply_authorized: false,
    worker_mounted: false,
    provider_dispatch_allowed: false,
    production_ready: false,
    automatic_retry_allowed: false,
    registerVerifiedInjection,
    readVerifiedInjection,
    recordRollback,
    readRollback,
    secrets_included: false,
  };
  Object.defineProperty(registry, BRAND, { value: true, enumerable: false });
  return Object.freeze(registry);
}

export function isCanonicalHostingerStorageDurableAuthorizedInjectionStateRegistry(value) {
  return Boolean(value?.[BRAND] === true
    && Object.isFrozen(value)
    && value.registry_key === 'hostinger_storage_durable_authorized_injection_state_v1'
    && value.registry_version === HOSTINGER_STORAGE_DURABLE_AUTHORIZED_INJECTION_STATE_VERSION
    && value.schema_verified === true
    && value.durable_sql === true
    && value.async_only === true
    && value.runtime_material_persisted === false
    && value.live_database_access_performed_by_factory === false
    && value.migration_apply_authorized === false
    && value.worker_mounted === false
    && value.provider_dispatch_allowed === false
    && value.production_ready === false
    && value.automatic_retry_allowed === false
    && typeof value.registerVerifiedInjection === 'function'
    && typeof value.readVerifiedInjection === 'function'
    && typeof value.recordRollback === 'function'
    && typeof value.readRollback === 'function');
}
