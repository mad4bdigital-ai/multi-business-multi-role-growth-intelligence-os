import { createHash } from 'node:crypto';
import { verifyHostingerStorageSeparateMountAuthorization } from './hostingerStorageSeparateMountAuthorization.js';

export const HOSTINGER_STORAGE_DURABLE_MOUNT_AUTHORIZATION_REGISTRY_VERSION =
  'spec014-hostinger-storage-durable-mount-authorization-registry-v1';

const BRAND = Symbol.for('mad4b.spec014.hostinger-storage-durable-mount-authorization-registry');
const LOCK_NAME = 'spec014:hostinger-storage-mount-authorization';
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/+/-]{0,255}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const ALLOWED_OPTIONS = new Set(['pool', 'schema_verification', 'lock_timeout_seconds']);

export const HOSTINGER_STORAGE_DURABLE_MOUNT_AUTHORIZATION_SCHEMA_CONTRACT = Object.freeze({
  contract_key: 'hostinger_storage_durable_mount_authorization_registry_schema_v1',
  tables: Object.freeze([
    'storage_mount_authorization_records',
    'storage_mount_authorization_consumptions',
  ]),
  one_shot_consumption: true,
  generation_cas: true,
  immutable_consumption_receipt: true,
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

export const HOSTINGER_STORAGE_DURABLE_MOUNT_AUTHORIZATION_SCHEMA_DIGEST = digest(
  HOSTINGER_STORAGE_DURABLE_MOUNT_AUTHORIZATION_SCHEMA_CONTRACT,
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
    throw fail(400, 'STORAGE_DURABLE_MOUNT_AUTH_IDENTIFIER_INVALID', 'A safe bounded identifier is required.', { field });
  }
  return normalized;
}

function hash(value, field) {
  const normalized = text(value, 64).toLowerCase();
  if (!SHA256_RE.test(normalized)) {
    throw fail(400, 'STORAGE_DURABLE_MOUNT_AUTH_HASH_INVALID', 'A lowercase SHA-256 binding is required.', { field });
  }
  return normalized;
}

function integer(value, field, minimum = 0) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < minimum) {
    throw fail(400, 'STORAGE_DURABLE_MOUNT_AUTH_INTEGER_INVALID', 'A bounded integer is required.', { field, minimum });
  }
  return normalized;
}

function assertDataOnly(value, path = 'value', active = new WeakSet(), depth = 0) {
  if (depth > 24) {
    throw fail(400, 'STORAGE_DURABLE_MOUNT_AUTH_DATA_TOO_DEEP', 'Mount authorization input exceeded the supported depth.', { path });
  }
  if (value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value)) return;
  if (typeof value !== 'object') {
    throw fail(400, 'STORAGE_DURABLE_MOUNT_AUTH_DATA_INVALID', 'Mount authorization inputs must contain data values only.', { path });
  }
  if (active.has(value)) {
    throw fail(400, 'STORAGE_DURABLE_MOUNT_AUTH_DATA_CYCLE', 'Mount authorization inputs must not contain cycles.', { path });
  }
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw fail(400, 'STORAGE_DURABLE_MOUNT_AUTH_DATA_INVALID', 'Mount authorization inputs must use plain data objects.', { path });
  }
  active.add(value);
  try {
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) {
        throw fail(400, 'STORAGE_DURABLE_MOUNT_AUTH_ACCESSOR_REJECTED', 'Mount authorization inputs must not contain accessor properties.', { path: `${path}.${key}` });
      }
      if (key === 'secrets_included' && descriptor.value !== false) {
        throw fail(400, 'STORAGE_DURABLE_MOUNT_AUTH_SECRET_DECLARATION_INVALID', 'Secret declaration must remain false.', { path: `${path}.${key}` });
      }
      if (key !== 'secrets_included'
        && /(password|passwd|secret_value|private[_-]?key|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization_header|cookie_header|raw_provider_payload|raw_environment|file_content|absolute_path|shell_command|credential_material)/i.test(key)) {
        throw fail(400, 'STORAGE_DURABLE_MOUNT_AUTH_SECRET_OR_UNSAFE_FIELD_REJECTED', 'Mount authorization inputs cannot contain secrets or free-form execution fields.', { path: `${path}.${key}` });
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

function epochSeconds(value, field) {
  const epoch = Date.parse(text(value, 64));
  if (!Number.isFinite(epoch)) {
    throw fail(400, 'STORAGE_DURABLE_MOUNT_AUTH_TIME_INVALID', 'A valid timestamp is required.', { field });
  }
  return Math.floor(epoch / 1000);
}

function normalizeRegistration(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw fail(400, 'STORAGE_DURABLE_MOUNT_AUTH_REGISTRATION_INVALID', 'A mount authorization registration object is required.');
  }
  const nowEpoch = integer(input.now_epoch, 'registration.now_epoch');
  const packet = input.authorization_packet;
  const expectedDigest = hash(input.expected_digest || packet?.authorization_digest, 'registration.expected_digest');
  try {
    const verification = verifyHostingerStorageSeparateMountAuthorization({
      packet,
      expected_digest: expectedDigest,
      now: nowEpoch * 1000,
    });
    if (verification.valid !== true || verification.ready_for_authorized_mount_execution !== true) {
      throw fail(409, 'STORAGE_DURABLE_MOUNT_AUTH_PACKET_NOT_READY', 'A ready separate mount authorization is required.');
    }
  } catch (error) {
    if (error?.code === 'STORAGE_DURABLE_MOUNT_AUTH_PACKET_NOT_READY') throw error;
    throw fail(409, 'STORAGE_DURABLE_MOUNT_AUTH_PACKET_INVALID', 'Separate mount authorization verification failed.', {
      cause_code: error?.code || 'unknown',
    });
  }

  const expected = packet.expected || {};
  const evidence = packet.evidence || {};
  const route = evidence.route || {};
  const authorization = evidence.authorization || {};
  const expiresAtEpoch = epochSeconds(evidence.expires_at, 'authorization_packet.evidence.expires_at');
  if (expiresAtEpoch <= nowEpoch) {
    throw fail(409, 'STORAGE_DURABLE_MOUNT_AUTH_PACKET_EXPIRED', 'Separate mount authorization expired before durable registration.');
  }

  const normalized = {
    authorization_id: identifier(expected.authorization_id, 'authorization.authorization_id', 64),
    authorization_digest: expectedDigest,
    authorization_revision: identifier(expected.authorization_revision, 'authorization.authorization_revision', 128),
    issuer_principal_id: identifier(expected.issuer_principal_id, 'authorization.issuer_principal_id', 191),
    source_commit: hash(expected.source_commit, 'authorization.source_commit'),
    deployed_runtime_sha: hash(expected.deployed_runtime_sha, 'authorization.deployed_runtime_sha'),
    database_fingerprint: hash(expected.database_fingerprint, 'authorization.database_fingerprint'),
    schema_verification_digest: hash(expected.schema_verification_digest, 'authorization.schema_verification_digest'),
    readback_cycle_id: identifier(expected.readback_cycle_id, 'authorization.readback_cycle_id', 191),
    bridge_readiness_digest: hash(expected.bridge_readiness_digest, 'authorization.bridge_readiness_digest'),
    fixed_dispatch_certification_digest: hash(expected.fixed_dispatch_certification_digest, 'authorization.fixed_dispatch_certification_digest'),
    worker_certification_digest: hash(expected.worker_certification_digest, 'authorization.worker_certification_digest'),
    authorization_bundle_hash: hash(expected.authorization_bundle_hash, 'authorization.authorization_bundle_hash'),
    target_id: identifier(expected.target_id, 'authorization.target_id', 191),
    operation_id: identifier(expected.operation_id, 'authorization.operation_id', 191),
    plan_id: identifier(expected.plan_id, 'authorization.plan_id', 191),
    plan_hash: hash(expected.plan_hash, 'authorization.plan_hash'),
    execution_lease_id: identifier(expected.execution_lease_id, 'authorization.execution_lease_id', 191),
    lease_generation: integer(expected.lease_generation, 'authorization.lease_generation', 1),
    approval_set_hash: hash(expected.approval_set_hash, 'authorization.approval_set_hash'),
    capability_envelope_digest: hash(expected.capability_envelope_digest, 'authorization.capability_envelope_digest'),
    mount_policy_fingerprint: hash(expected.mount_policy_fingerprint, 'authorization.mount_policy_fingerprint'),
    rollback_plan_digest: hash(expected.rollback_plan_digest, 'authorization.rollback_plan_digest'),
    route_path: text(route.path, 128),
    dependency_key: identifier(route.dependency_key, 'authorization.dependency_key', 128),
    authorization_status: identifier(authorization.status, 'authorization.status', 32),
    authorization_mode: identifier(authorization.mode, 'authorization.mode', 64),
    generation: integer(expected.mount_generation, 'authorization.mount_generation', 1),
    expires_at_epoch: expiresAtEpoch,
    consumed: false,
    consumed_by_executor_id: null,
    mount_attempt_id: null,
    consumed_at_epoch: null,
    secrets_included: false,
  };
  if (normalized.source_commit !== normalized.deployed_runtime_sha) {
    throw fail(409, 'STORAGE_DURABLE_MOUNT_AUTH_RUNTIME_PARITY_REQUIRED', 'Exact source and deployed runtime parity is required.');
  }
  if (normalized.route_path !== '/tenant/storage-operations/apply-plan'
    || normalized.dependency_key !== 'tenantStorageRuntime'
    || normalized.authorization_status !== 'approved'
    || normalized.authorization_mode !== 'single_use_mount') {
    throw fail(409, 'STORAGE_DURABLE_MOUNT_AUTH_BINDING_INVALID', 'Mount authorization route or policy binding is invalid.');
  }
  normalized.record_digest = digest(normalized);
  return deepFreeze(normalized);
}

function normalizeStoredRecord(row) {
  let value = row?.record_json;
  if (Buffer.isBuffer(value)) value = value.toString('utf8');
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch {
      throw fail(409, 'STORAGE_DURABLE_MOUNT_AUTH_RECORD_JSON_INVALID', 'Durable mount authorization record JSON is invalid.');
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw fail(409, 'STORAGE_DURABLE_MOUNT_AUTH_RECORD_JSON_INVALID', 'Durable mount authorization record JSON is invalid.');
  }
  assertDataOnly(value, 'storage_mount_authorization_records.record_json');
  if (value.record_digest !== row.record_digest) {
    throw fail(409, 'STORAGE_DURABLE_MOUNT_AUTH_RECORD_DIGEST_MISMATCH', 'Durable mount authorization record digest mismatch.');
  }
  return deepFreeze(clone(value));
}

function normalizeStoredConsumption(row) {
  let value = row?.record_json;
  if (Buffer.isBuffer(value)) value = value.toString('utf8');
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch {
      throw fail(409, 'STORAGE_DURABLE_MOUNT_AUTH_CONSUMPTION_JSON_INVALID', 'Durable mount authorization consumption JSON is invalid.');
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw fail(409, 'STORAGE_DURABLE_MOUNT_AUTH_CONSUMPTION_JSON_INVALID', 'Durable mount authorization consumption JSON is invalid.');
  }
  assertDataOnly(value, 'storage_mount_authorization_consumptions.record_json');
  if (value.record_digest !== row.record_digest) {
    throw fail(409, 'STORAGE_DURABLE_MOUNT_AUTH_CONSUMPTION_DIGEST_MISMATCH', 'Durable mount authorization consumption digest mismatch.');
  }
  return deepFreeze(clone(value));
}

function same(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function consumptionId(authorizationId, registeredGeneration, consumedGeneration) {
  const hex = createHash('sha256')
    .update(`${authorizationId}\0${registeredGeneration}\0${consumedGeneration}`)
    .digest('hex')
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-b${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function assertSchemaVerification(value) {
  assertDataOnly(value, 'schema_verification');
  if (value?.ready !== true || value?.schema_verified !== true || (value?.blockers || []).length !== 0) {
    throw fail(409, 'STORAGE_DURABLE_MOUNT_AUTH_SCHEMA_VERIFICATION_REQUIRED', 'Successful signed mount-authorization registry schema verification is required.');
  }
  if (value.production_ready !== false || value.authority_granted !== false
    || value.migration_apply_authorized !== false || value.provider_dispatch_allowed !== false) {
    throw fail(409, 'STORAGE_DURABLE_MOUNT_AUTH_SCHEMA_BOUNDARY_INVALID', 'Schema verification cannot grant production, migration, authority, or provider capability.');
  }
  const evidence = value.evidence || {};
  const schema = evidence.mount_authorization_registry_schema || {};
  const expectedTables = [...HOSTINGER_STORAGE_DURABLE_MOUNT_AUTHORIZATION_SCHEMA_CONTRACT.tables].sort();
  const observedTables = Array.isArray(schema.tables) ? [...schema.tables].sort() : [];
  if (schema.contract_key !== HOSTINGER_STORAGE_DURABLE_MOUNT_AUTHORIZATION_SCHEMA_CONTRACT.contract_key
    || schema.contract_digest !== HOSTINGER_STORAGE_DURABLE_MOUNT_AUTHORIZATION_SCHEMA_DIGEST
    || JSON.stringify(observedTables) !== JSON.stringify(expectedTables)) {
    throw fail(409, 'STORAGE_DURABLE_MOUNT_AUTH_SCHEMA_CONTRACT_MISMATCH', 'Signed schema verification does not bind the exact mount-authorization registry schema contract.');
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
    throw fail(409, 'STORAGE_DURABLE_MOUNT_AUTH_SCHEMA_RUNTIME_PARITY_REQUIRED', 'Exact deployed runtime parity is required.');
  }
  if (Date.parse(verified.expires_at) <= Date.now()) {
    throw fail(409, 'STORAGE_DURABLE_MOUNT_AUTH_SCHEMA_VERIFICATION_EXPIRED', 'Mount-authorization registry schema verification expired.');
  }
  return deepFreeze(verified);
}

async function execute(connection, statement, params = []) {
  const method = typeof connection?.execute === 'function' ? 'execute' : 'query';
  if (typeof connection?.[method] !== 'function') {
    throw fail(500, 'STORAGE_DURABLE_MOUNT_AUTH_CONNECTION_INVALID', 'SQL connection must expose execute() or query().');
  }
  return connection[method](statement, params);
}

function normalizeDriverError(error) {
  if (error?.code?.startsWith?.('STORAGE_')) return error;
  if (['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(error?.code)) {
    return fail(503, 'STORAGE_DURABLE_MOUNT_AUTH_SCHEMA_UNAVAILABLE', 'Durable mount authorization schema is unavailable.', { mysql_code: error.code });
  }
  if (['ER_DUP_ENTRY', 'ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error?.code)) {
    return fail(409, 'STORAGE_DURABLE_MOUNT_AUTH_CONFLICT', 'Durable mount authorization state changed concurrently.', { mysql_code: error.code });
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
    const [rows] = await execute(connection, '/* spec014:mount-auth:lock:acquire */ SELECT GET_LOCK(?, ?) AS acquired', [LOCK_NAME, timeoutSeconds]);
    if (Number(rows?.[0]?.acquired) !== 1) {
      throw fail(409, 'STORAGE_DURABLE_MOUNT_AUTH_LOCK_UNAVAILABLE', 'Durable mount authorization lock is unavailable.');
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
      try { await execute(connection, '/* spec014:mount-auth:lock:release */ SELECT RELEASE_LOCK(?) AS released', [LOCK_NAME]); } catch { /* Connection release also releases the lock. */ }
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

async function loadRecord(connection, authorizationId, { forUpdate = false } = {}) {
  const [rows] = await execute(connection, `/* spec014:mount-auth:load-record */ SELECT record_digest, record_json, row_version FROM storage_mount_authorization_records WHERE id=?${forUpdate ? ' FOR UPDATE' : ''}`, [authorizationId]);
  const boundedRows = Array.isArray(rows) ? rows : [];
  if (boundedRows.length > 1) {
    throw fail(409, 'STORAGE_DURABLE_MOUNT_AUTH_ROW_AMBIGUOUS', 'Mount authorization identity resolved to multiple durable rows.', { authorization_id: authorizationId });
  }
  if (boundedRows.length === 0) return null;
  const [row] = boundedRows;
  return { record: normalizeStoredRecord(row), row_version: Number(row.row_version) };
}

async function loadConsumption(connection, authorizationId, { forUpdate = false } = {}) {
  const [rows] = await execute(connection, `/* spec014:mount-auth:load-consumption */ SELECT record_digest, record_json FROM storage_mount_authorization_consumptions WHERE authorization_id=?${forUpdate ? ' FOR UPDATE' : ''}`, [authorizationId]);
  const boundedRows = Array.isArray(rows) ? rows : [];
  if (boundedRows.length > 1) {
    throw fail(409, 'STORAGE_DURABLE_MOUNT_AUTH_CONSUMPTION_AMBIGUOUS', 'Mount authorization resolved to multiple consumption receipts.', { authorization_id: authorizationId });
  }
  if (boundedRows.length === 0) return null;
  return normalizeStoredConsumption(boundedRows[0]);
}

async function insertRecord(connection, record) {
  return execute(connection, `/* spec014:mount-auth:insert-record */ INSERT INTO storage_mount_authorization_records (
    id, authorization_digest, authorization_revision, issuer_principal_id, source_commit,
    deployed_runtime_sha, database_fingerprint, schema_verification_digest, readback_cycle_id,
    authorization_bundle_hash, target_id, operation_id, plan_id, plan_hash, execution_lease_id,
    lease_generation, generation, expires_at_epoch, consumed, consumed_by_executor_id,
    mount_attempt_id, consumed_at_epoch, record_digest, record_json, row_version, secrets_included
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, ?, CAST(? AS JSON), 1, 0)`, [
    record.authorization_id, record.authorization_digest, record.authorization_revision,
    record.issuer_principal_id, record.source_commit, record.deployed_runtime_sha,
    record.database_fingerprint, record.schema_verification_digest, record.readback_cycle_id,
    record.authorization_bundle_hash, record.target_id, record.operation_id, record.plan_id,
    record.plan_hash, record.execution_lease_id, record.lease_generation, record.generation,
    record.expires_at_epoch, record.record_digest, JSON.stringify(record),
  ]);
}

async function updateConsumed(connection, record, expectedGeneration, expectedVersion) {
  const [result] = await execute(connection, `/* spec014:mount-auth:update-consumed */ UPDATE storage_mount_authorization_records SET
    generation=?, consumed=1, consumed_by_executor_id=?, mount_attempt_id=?, consumed_at_epoch=?,
    record_digest=?, record_json=CAST(? AS JSON), row_version=row_version+1
    WHERE id=? AND generation=? AND consumed=0 AND row_version=?`, [
    record.generation, record.consumed_by_executor_id, record.mount_attempt_id,
    record.consumed_at_epoch, record.record_digest, JSON.stringify(record),
    record.authorization_id, expectedGeneration, expectedVersion,
  ]);
  if (Number(result?.affectedRows) !== 1) {
    throw fail(409, 'STORAGE_DURABLE_MOUNT_AUTH_CAS_CONFLICT', 'Mount authorization generation, consumed state, or row version changed concurrently.', { authorization_id: record.authorization_id });
  }
}

async function insertConsumption(connection, receipt) {
  return execute(connection, `/* spec014:mount-auth:insert-consumption */ INSERT INTO storage_mount_authorization_consumptions (
    id, authorization_id, authorization_digest, executor_id, mount_attempt_id, operation_id,
    plan_id, registered_generation, consumed_generation, consumed_at_epoch,
    record_digest, record_json, secrets_included
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), 0)`, [
    receipt.consumption_id, receipt.authorization_id, receipt.authorization_digest,
    receipt.executor_id, receipt.mount_attempt_id, receipt.operation_id, receipt.plan_id,
    receipt.registered_generation, receipt.consumed_generation, receipt.consumed_at_epoch,
    receipt.record_digest, JSON.stringify(receipt),
  ]);
}

export function createHostingerStorageDurableMountAuthorizationRegistry(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw fail(500, 'STORAGE_DURABLE_MOUNT_AUTH_OPTIONS_INVALID', 'Mount-authorization registry options must be an object.');
  }
  const unsupported = Object.keys(options).filter((key) => !ALLOWED_OPTIONS.has(key));
  if (unsupported.length) {
    throw fail(409, 'STORAGE_DURABLE_MOUNT_AUTH_OVERRIDE_FORBIDDEN', 'Only pool, signed schema verification, and bounded lock timeout may be supplied.', { unsupported_options: unsupported.sort() });
  }
  const { pool, schema_verification, lock_timeout_seconds = 5 } = options;
  if (!pool || typeof pool.getConnection !== 'function') {
    throw fail(500, 'STORAGE_DURABLE_MOUNT_AUTH_POOL_INVALID', 'A MySQL-compatible pool is required.');
  }
  const timeout = integer(lock_timeout_seconds, 'lock_timeout_seconds', 1);
  if (timeout > 30) {
    throw fail(500, 'STORAGE_DURABLE_MOUNT_AUTH_LOCK_TIMEOUT_INVALID', 'Lock timeout must not exceed 30 seconds.');
  }
  const verification = assertSchemaVerification(schema_verification);

  async function register(input = {}) {
    const record = normalizeRegistration(input);
    return transaction(pool, timeout, async (connection) => {
      const current = await loadRecord(connection, record.authorization_id, { forUpdate: true });
      if (current) {
        if (!same(current.record, record)) {
          throw fail(409, 'STORAGE_DURABLE_MOUNT_AUTH_ID_CONFLICT', 'Authorization ID is already bound to different evidence.', { authorization_id: record.authorization_id });
        }
        if (await loadConsumption(connection, record.authorization_id, { forUpdate: true })) {
          throw fail(409, 'STORAGE_DURABLE_MOUNT_AUTH_REPLAY_CONSUMPTION_CONFLICT', 'An unconsumed registration cannot replay after an immutable consumption receipt exists.', { authorization_id: record.authorization_id });
        }
        return deepFreeze({
          created: false,
          replay: true,
          authorization: current.record,
          row_version: current.row_version,
          schema_verification_digest: verification.evidence_digest,
          secrets_included: false,
        });
      }
      if (await loadConsumption(connection, record.authorization_id, { forUpdate: true })) {
        throw fail(409, 'STORAGE_DURABLE_MOUNT_AUTH_ORPHAN_CONSUMPTION_CONFLICT', 'A consumption receipt exists without its current authorization row.', { authorization_id: record.authorization_id });
      }
      await insertRecord(connection, record);
      const readback = await loadRecord(connection, record.authorization_id);
      if (!readback || !same(readback.record, record) || readback.row_version !== 1) {
        throw fail(409, 'STORAGE_DURABLE_MOUNT_AUTH_READBACK_MISMATCH', 'Inserted mount authorization failed exact readback.', { authorization_id: record.authorization_id });
      }
      return deepFreeze({
        created: true,
        replay: false,
        authorization: readback.record,
        row_version: 1,
        schema_verification_digest: verification.evidence_digest,
        secrets_included: false,
      });
    });
  }

  async function read(rawId) {
    const authorizationId = identifier(rawId, 'authorization_id', 64);
    return withConnection(pool, async (connection) => {
      const current = await loadRecord(connection, authorizationId);
      return current ? deepFreeze(clone(current.record)) : null;
    });
  }

  async function readConsumption(rawId) {
    const authorizationId = identifier(rawId, 'authorization_id', 64);
    return withConnection(pool, async (connection) => {
      const receipt = await loadConsumption(connection, authorizationId);
      return receipt ? deepFreeze(clone(receipt)) : null;
    });
  }

  async function consume(input = {}) {
    const copy = snapshot(input, 'consume');
    const authorizationId = identifier(copy.authorization_id, 'authorization_id', 64);
    const authorizationDigest = hash(copy.authorization_digest, 'authorization_digest');
    const executorId = identifier(copy.executor_id, 'executor_id', 191);
    const mountAttemptId = identifier(copy.mount_attempt_id, 'mount_attempt_id', 191);
    const operationId = identifier(copy.operation_id, 'operation_id', 191);
    const planId = identifier(copy.plan_id, 'plan_id', 191);
    const expectedRuntimeSha = hash(copy.expected_runtime_sha, 'expected_runtime_sha');
    const expectedGeneration = integer(copy.expected_generation, 'expected_generation', 1);
    const now = integer(copy.now_epoch, 'now_epoch');

    return transaction(pool, timeout, async (connection) => {
      const current = await loadRecord(connection, authorizationId, { forUpdate: true });
      if (!current) {
        throw fail(404, 'STORAGE_DURABLE_MOUNT_AUTH_NOT_FOUND', 'Mount authorization was not registered.', { authorization_id: authorizationId });
      }
      const existingReceipt = await loadConsumption(connection, authorizationId, { forUpdate: true });
      if (current.record.authorization_digest !== authorizationDigest
        || current.record.operation_id !== operationId
        || current.record.plan_id !== planId
        || current.record.deployed_runtime_sha !== expectedRuntimeSha) {
        throw fail(409, 'STORAGE_DURABLE_MOUNT_AUTH_BINDING_MISMATCH', 'Mount authorization is not bound to this digest, operation, plan, and runtime.', { authorization_id: authorizationId });
      }
      if (current.record.generation !== expectedGeneration) {
        throw fail(409, 'STORAGE_DURABLE_MOUNT_AUTH_GENERATION_MISMATCH', 'Mount authorization generation changed.', {
          authorization_id: authorizationId,
          current_generation: current.record.generation,
        });
      }
      if (current.record.consumed || existingReceipt) {
        if (!current.record.consumed || !existingReceipt) {
          throw fail(409, 'STORAGE_DURABLE_MOUNT_AUTH_CONSUMPTION_STATE_MISMATCH', 'Current authorization state and immutable receipt disagree.', { authorization_id: authorizationId });
        }
        throw fail(409, 'STORAGE_DURABLE_MOUNT_AUTH_ALREADY_CONSUMED', 'Mount authorization is one-shot and was already consumed.', {
          authorization_id: authorizationId,
          consumed_generation: current.record.generation,
          consumed_at_epoch: current.record.consumed_at_epoch,
        });
      }
      if (current.record.expires_at_epoch <= now) {
        throw fail(409, 'STORAGE_DURABLE_MOUNT_AUTH_EXPIRED', 'Mount authorization expired before consumption.', { authorization_id: authorizationId });
      }

      const next = {
        ...current.record,
        generation: current.record.generation + 1,
        consumed: true,
        consumed_by_executor_id: executorId,
        mount_attempt_id: mountAttemptId,
        consumed_at_epoch: now,
        secrets_included: false,
      };
      next.record_digest = digest(next);
      const frozenNext = deepFreeze(next);
      const receipt = {
        consumption_id: consumptionId(authorizationId, current.record.generation, frozenNext.generation),
        authorization_id: authorizationId,
        authorization_digest: authorizationDigest,
        executor_id: executorId,
        mount_attempt_id: mountAttemptId,
        operation_id: operationId,
        plan_id: planId,
        expected_runtime_sha: expectedRuntimeSha,
        registered_generation: current.record.generation,
        consumed_generation: frozenNext.generation,
        consumed_at_epoch: now,
        automatic_retry_allowed: false,
        secrets_included: false,
      };
      receipt.record_digest = digest(receipt);
      const frozenReceipt = deepFreeze(receipt);

      await updateConsumed(connection, frozenNext, expectedGeneration, current.row_version);
      await insertConsumption(connection, frozenReceipt);
      const readback = await loadRecord(connection, authorizationId);
      const receiptReadback = await loadConsumption(connection, authorizationId);
      if (!readback || !same(readback.record, frozenNext) || readback.row_version !== current.row_version + 1
        || !receiptReadback || !same(receiptReadback, frozenReceipt)) {
        throw fail(409, 'STORAGE_DURABLE_MOUNT_AUTH_READBACK_MISMATCH', 'Consumed mount authorization and immutable receipt failed exact readback.', { authorization_id: authorizationId });
      }

      return deepFreeze({
        consumed: true,
        authorization: readback.record,
        consumption: receiptReadback,
        previous_generation: expectedGeneration,
        current_generation: frozenNext.generation,
        row_version: readback.row_version,
        authorized_mount_execution_may_begin: true,
        mount_performed: false,
        dependency_injected: false,
        automatic_retry_allowed: false,
        schema_verification_digest: verification.evidence_digest,
        secrets_included: false,
      });
    });
  }

  async function exportState() {
    return withConnection(pool, async (connection) => {
      const [recordRows] = await execute(connection, '/* spec014:mount-auth:export-records */ SELECT record_digest, record_json, row_version FROM storage_mount_authorization_records ORDER BY id');
      const [receiptRows] = await execute(connection, '/* spec014:mount-auth:export-consumptions */ SELECT record_digest, record_json FROM storage_mount_authorization_consumptions ORDER BY authorization_id');
      const state = {
        schema_version: 1,
        snapshot_key: 'hostinger_storage_durable_mount_authorization_snapshot_v1',
        authorizations: (recordRows || []).map(normalizeStoredRecord),
        consumptions: (receiptRows || []).map(normalizeStoredConsumption),
        schema_contract_digest: verification.schema_contract_digest,
        database_fingerprint: verification.database_fingerprint,
        automatic_retry_allowed: false,
        runtime_mounted: false,
        route_mounted: false,
        worker_mounted: false,
        provider_dispatch_allowed: false,
        production_ready: false,
        secrets_included: false,
      };
      return deepFreeze({ ...state, snapshot_digest: digest(state) });
    });
  }

  const registry = {
    adapter_key: 'hostinger_storage_mysql_mount_authorization_v1',
    registry_version: HOSTINGER_STORAGE_DURABLE_MOUNT_AUTHORIZATION_REGISTRY_VERSION,
    durable_sql: true,
    async_only: true,
    one_shot: true,
    generation_cas: true,
    immutable_consumption_receipt: true,
    schema_verified: true,
    schema_verification_digest: verification.evidence_digest,
    schema_contract_digest: verification.schema_contract_digest,
    database_fingerprint: verification.database_fingerprint,
    automatic_retry_allowed: false,
    mount_execution_allowed: false,
    runtime_mounted: false,
    route_mounted: false,
    worker_mounted: false,
    provider_dispatch_allowed: false,
    migration_apply_authorized: false,
    production_ready: false,
    register,
    read,
    readConsumption,
    consume,
    exportState,
    secrets_included: false,
  };
  Object.defineProperty(registry, BRAND, { value: true, enumerable: false });
  return Object.freeze(registry);
}

export function isCanonicalHostingerStorageDurableMountAuthorizationRegistry(value) {
  return Boolean(value?.[BRAND] === true
    && value?.adapter_key === 'hostinger_storage_mysql_mount_authorization_v1'
    && value?.registry_version === HOSTINGER_STORAGE_DURABLE_MOUNT_AUTHORIZATION_REGISTRY_VERSION
    && value?.durable_sql === true
    && value?.async_only === true
    && value?.one_shot === true
    && value?.generation_cas === true
    && value?.immutable_consumption_receipt === true
    && value?.schema_verified === true
    && value?.automatic_retry_allowed === false
    && value?.mount_execution_allowed === false
    && value?.runtime_mounted === false
    && value?.route_mounted === false
    && value?.worker_mounted === false
    && value?.provider_dispatch_allowed === false
    && value?.production_ready === false
    && Object.isFrozen(value));
}
