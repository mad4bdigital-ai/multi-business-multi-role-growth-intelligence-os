import { createHash } from 'node:crypto';

export const HOSTINGER_STORAGE_DURABLE_TENANT_ENABLEMENT_REGISTRY_VERSION = 'spec014-hostinger-storage-durable-tenant-enablement-registry-v1';

const BRAND = Symbol.for('mad4b.spec014.hostinger-storage-durable-tenant-enablement-registry');
const LOCK_NAME = 'spec014:hostinger-storage-tenant-enablement';
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const ALLOWED_OPTIONS = new Set(['pool', 'schema_verification', 'lock_timeout_seconds']);

export const HOSTINGER_STORAGE_DURABLE_TENANT_ENABLEMENT_SCHEMA_CONTRACT = Object.freeze({
  contract_key: 'hostinger_storage_durable_tenant_enablement_registry_schema_v1',
  tables: Object.freeze([
    'storage_tenant_enablement_records',
    'storage_tenant_enablement_consumptions',
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

export const HOSTINGER_STORAGE_DURABLE_TENANT_ENABLEMENT_SCHEMA_DIGEST = digest(
  HOSTINGER_STORAGE_DURABLE_TENANT_ENABLEMENT_SCHEMA_CONTRACT,
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
    throw fail(400, 'STORAGE_DURABLE_ENABLEMENT_IDENTIFIER_INVALID', 'A safe bounded identifier is required.', { field });
  }
  return normalized;
}

function hash(value, field) {
  const normalized = text(value, 64).toLowerCase();
  if (!SHA256_RE.test(normalized)) {
    throw fail(400, 'STORAGE_DURABLE_ENABLEMENT_HASH_INVALID', 'A lowercase SHA-256 binding is required.', { field });
  }
  return normalized;
}

function integer(value, field, minimum = 0) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < minimum) {
    throw fail(400, 'STORAGE_DURABLE_ENABLEMENT_INTEGER_INVALID', 'A bounded integer is required.', { field, minimum });
  }
  return normalized;
}

function assertDataOnly(value, path = 'value', active = new WeakSet(), depth = 0) {
  if (depth > 20) throw fail(400, 'STORAGE_DURABLE_ENABLEMENT_DATA_TOO_DEEP', 'Enablement input exceeded the supported depth.', { path });
  if (value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value)) return;
  if (typeof value !== 'object') throw fail(400, 'STORAGE_DURABLE_ENABLEMENT_DATA_INVALID', 'Enablement inputs must contain data values only.', { path });
  if (active.has(value)) throw fail(400, 'STORAGE_DURABLE_ENABLEMENT_DATA_CYCLE', 'Enablement inputs must not contain cycles.', { path });
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw fail(400, 'STORAGE_DURABLE_ENABLEMENT_DATA_INVALID', 'Enablement inputs must use plain data objects.', { path });
  }
  active.add(value);
  try {
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) {
        throw fail(400, 'STORAGE_DURABLE_ENABLEMENT_ACCESSOR_REJECTED', 'Enablement inputs must not contain accessor properties.', { path: `${path}.${key}` });
      }
      if (key === 'secrets_included' && descriptor.value !== false) {
        throw fail(400, 'STORAGE_DURABLE_ENABLEMENT_SECRET_DECLARATION_INVALID', 'Secret declaration must remain false.', { path: `${path}.${key}` });
      }
      if (key !== 'secrets_included' && /(password|passwd|secret_value|private[_-]?key|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization_header|cookie_header|raw_provider_payload|raw_environment|file_content|absolute_path|shell_command)/i.test(key)) {
        throw fail(400, 'STORAGE_DURABLE_ENABLEMENT_SECRET_OR_UNSAFE_FIELD_REJECTED', 'Enablement inputs cannot contain secrets or free-form execution fields.', { path: `${path}.${key}` });
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

function normalizeRegistration(input = {}) {
  const record = snapshot(input, 'enablement');
  if (record.consumed === true || record.consumed_by_run_id != null || record.consumed_at_epoch != null) {
    throw fail(409, 'STORAGE_DURABLE_ENABLEMENT_INITIAL_STATE_INVALID', 'New one-shot enablement must begin unconsumed.');
  }
  const normalized = {
    enablement_id: identifier(record.enablement_id, 'enablement.enablement_id', 36),
    authorization_digest: hash(record.authorization_digest, 'enablement.authorization_digest'),
    operation_id: identifier(record.operation_id, 'enablement.operation_id', 36),
    run_id: identifier(record.run_id, 'enablement.run_id', 36),
    generation: integer(record.generation, 'enablement.generation', 1),
    expires_at_epoch: integer(record.expires_at_epoch, 'enablement.expires_at_epoch', 1),
    consumed: false,
    consumed_by_run_id: null,
    consumed_at_epoch: null,
    secrets_included: false,
  };
  normalized.record_digest = digest(normalized);
  return deepFreeze(normalized);
}

function normalizeStoredRecord(row) {
  let value = row?.record_json;
  if (Buffer.isBuffer(value)) value = value.toString('utf8');
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch {
      throw fail(409, 'STORAGE_DURABLE_ENABLEMENT_RECORD_JSON_INVALID', 'Durable enablement record JSON is invalid.');
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw fail(409, 'STORAGE_DURABLE_ENABLEMENT_RECORD_JSON_INVALID', 'Durable enablement record JSON is invalid.');
  }
  assertDataOnly(value, 'storage_tenant_enablement_records.record_json');
  if (value.record_digest !== row.record_digest) {
    throw fail(409, 'STORAGE_DURABLE_ENABLEMENT_RECORD_DIGEST_MISMATCH', 'Durable enablement record digest mismatch.');
  }
  return deepFreeze(clone(value));
}

function normalizeStoredConsumption(row) {
  let value = row?.record_json;
  if (Buffer.isBuffer(value)) value = value.toString('utf8');
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch {
      throw fail(409, 'STORAGE_DURABLE_ENABLEMENT_CONSUMPTION_JSON_INVALID', 'Durable enablement consumption JSON is invalid.');
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw fail(409, 'STORAGE_DURABLE_ENABLEMENT_CONSUMPTION_JSON_INVALID', 'Durable enablement consumption JSON is invalid.');
  }
  assertDataOnly(value, 'storage_tenant_enablement_consumptions.record_json');
  if (value.record_digest !== row.record_digest) {
    throw fail(409, 'STORAGE_DURABLE_ENABLEMENT_CONSUMPTION_DIGEST_MISMATCH', 'Durable consumption receipt digest mismatch.');
  }
  return deepFreeze(clone(value));
}

function same(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function consumptionId(enablementId, registeredGeneration, consumedGeneration) {
  const hex = createHash('sha256')
    .update(`${enablementId}\0${registeredGeneration}\0${consumedGeneration}`)
    .digest('hex')
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-b${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function assertSchemaVerification(value) {
  assertDataOnly(value, 'schema_verification');
  if (value?.ready !== true || value?.schema_verified !== true || (value?.blockers || []).length !== 0) {
    throw fail(409, 'STORAGE_DURABLE_ENABLEMENT_SCHEMA_VERIFICATION_REQUIRED', 'Successful signed enablement-registry schema verification is required.');
  }
  if (value.production_ready !== false || value.authority_granted !== false
    || value.migration_apply_authorized !== false || value.provider_dispatch_allowed !== false) {
    throw fail(409, 'STORAGE_DURABLE_ENABLEMENT_SCHEMA_BOUNDARY_INVALID', 'Schema verification cannot grant production, migration, authority, or provider capability.');
  }
  const evidence = value.evidence || {};
  const schema = evidence.enablement_registry_schema || {};
  const expectedTables = [...HOSTINGER_STORAGE_DURABLE_TENANT_ENABLEMENT_SCHEMA_CONTRACT.tables].sort();
  const observedTables = Array.isArray(schema.tables) ? [...schema.tables].sort() : [];
  if (schema.contract_key !== HOSTINGER_STORAGE_DURABLE_TENANT_ENABLEMENT_SCHEMA_CONTRACT.contract_key
    || schema.contract_digest !== HOSTINGER_STORAGE_DURABLE_TENANT_ENABLEMENT_SCHEMA_DIGEST
    || JSON.stringify(observedTables) !== JSON.stringify(expectedTables)) {
    throw fail(409, 'STORAGE_DURABLE_ENABLEMENT_SCHEMA_CONTRACT_MISMATCH', 'Signed schema verification does not bind the exact enablement-registry schema contract.');
  }
  const verified = {
    evidence_digest: hash(value.evidence_digest, 'schema_verification.evidence_digest'),
    source_commit: identifier(evidence.source_commit, 'schema_verification.source_commit', 64),
    deployed_runtime_sha: identifier(evidence.deployed_runtime_sha, 'schema_verification.deployed_runtime_sha', 64),
    runtime_parity: evidence.runtime_parity === true,
    database_fingerprint: hash(evidence.database_fingerprint, 'schema_verification.database_fingerprint'),
    readback_cycle_id: identifier(evidence.readback_cycle_id, 'schema_verification.readback_cycle_id', 191),
    expires_at: identifier(evidence.expires_at, 'schema_verification.expires_at', 64),
    schema_contract_digest: schema.contract_digest,
    secrets_included: false,
  };
  if (!verified.runtime_parity || verified.source_commit !== verified.deployed_runtime_sha) {
    throw fail(409, 'STORAGE_DURABLE_ENABLEMENT_RUNTIME_PARITY_REQUIRED', 'Exact deployed runtime parity is required.');
  }
  if (Date.parse(verified.expires_at) <= Date.now()) {
    throw fail(409, 'STORAGE_DURABLE_ENABLEMENT_SCHEMA_VERIFICATION_EXPIRED', 'Enablement-registry schema verification expired.');
  }
  return deepFreeze(verified);
}

async function execute(connection, statement, params = []) {
  const method = typeof connection?.execute === 'function' ? 'execute' : 'query';
  if (typeof connection?.[method] !== 'function') {
    throw fail(500, 'STORAGE_DURABLE_ENABLEMENT_CONNECTION_INVALID', 'SQL connection must expose execute() or query().');
  }
  return connection[method](statement, params);
}

function normalizeDriverError(error) {
  if (error?.code?.startsWith?.('STORAGE_')) return error;
  if (['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(error?.code)) {
    return fail(503, 'STORAGE_DURABLE_ENABLEMENT_SCHEMA_UNAVAILABLE', 'Durable Tenant enablement schema is unavailable.', { mysql_code: error.code });
  }
  if (['ER_DUP_ENTRY', 'ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error?.code)) {
    return fail(409, 'STORAGE_DURABLE_ENABLEMENT_CONFLICT', 'Durable Tenant enablement state changed concurrently.', { mysql_code: error.code });
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
    const [rows] = await execute(connection, '/* spec014:enablement:lock:acquire */ SELECT GET_LOCK(?, ?) AS acquired', [LOCK_NAME, timeoutSeconds]);
    if (Number(rows?.[0]?.acquired) !== 1) {
      throw fail(409, 'STORAGE_DURABLE_ENABLEMENT_LOCK_UNAVAILABLE', 'Durable Tenant enablement lock is unavailable.');
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
      try { await execute(connection, '/* spec014:enablement:lock:release */ SELECT RELEASE_LOCK(?) AS released', [LOCK_NAME]); } catch { /* Connection release also releases the lock. */ }
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

async function loadRecord(connection, enablementId, { forUpdate = false } = {}) {
  const [rows] = await execute(connection, `/* spec014:enablement:load-record */ SELECT record_digest, record_json, row_version FROM storage_tenant_enablement_records WHERE id=?${forUpdate ? ' FOR UPDATE' : ''}`, [enablementId]);
  if ((rows || []).length > 1) {
    throw fail(409, 'STORAGE_DURABLE_ENABLEMENT_ROW_AMBIGUOUS', 'Enablement identity resolved to multiple durable rows.', { enablement_id: enablementId });
  }
  return rows?.[0] ? { record: normalizeStoredRecord(rows[0]), row_version: Number(rows[0].row_version) } : null;
}

async function loadConsumption(connection, enablementId, { forUpdate = false } = {}) {
  const [rows] = await execute(connection, `/* spec014:enablement:load-consumption */ SELECT record_digest, record_json FROM storage_tenant_enablement_consumptions WHERE enablement_id=?${forUpdate ? ' FOR UPDATE' : ''}`, [enablementId]);
  if ((rows || []).length > 1) {
    throw fail(409, 'STORAGE_DURABLE_ENABLEMENT_CONSUMPTION_AMBIGUOUS', 'Enablement resolved to multiple consumption receipts.', { enablement_id: enablementId });
  }
  return rows?.[0] ? normalizeStoredConsumption(rows[0]) : null;
}

async function insertRecord(connection, record) {
  return execute(connection, `/* spec014:enablement:insert-record */ INSERT INTO storage_tenant_enablement_records (
    id, authorization_digest, operation_id, run_id, generation, expires_at_epoch, consumed,
    consumed_by_run_id, consumed_at_epoch, record_digest, record_json, row_version, secrets_included
  ) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, CAST(? AS JSON), 1, 0)`, [
    record.enablement_id, record.authorization_digest, record.operation_id, record.run_id,
    record.generation, record.expires_at_epoch, record.record_digest, JSON.stringify(record),
  ]);
}

async function updateConsumed(connection, record, expectedGeneration, expectedVersion) {
  const [result] = await execute(connection, `/* spec014:enablement:update-consumed */ UPDATE storage_tenant_enablement_records SET
    generation=?, consumed=1, consumed_by_run_id=?, consumed_at_epoch=?, record_digest=?,
    record_json=CAST(? AS JSON), row_version=row_version+1
    WHERE id=? AND generation=? AND consumed=0 AND row_version=?`, [
    record.generation, record.consumed_by_run_id, record.consumed_at_epoch,
    record.record_digest, JSON.stringify(record), record.enablement_id, expectedGeneration, expectedVersion,
  ]);
  if (Number(result?.affectedRows) !== 1) {
    throw fail(409, 'STORAGE_DURABLE_ENABLEMENT_CAS_CONFLICT', 'Enablement generation, consumed state, or row version changed concurrently.', { enablement_id: record.enablement_id });
  }
}

async function insertConsumption(connection, receipt) {
  return execute(connection, `/* spec014:enablement:insert-consumption */ INSERT INTO storage_tenant_enablement_consumptions (
    id, enablement_id, authorization_digest, operation_id, run_id, registered_generation,
    consumed_generation, consumed_at_epoch, record_digest, record_json, secrets_included
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), 0)`, [
    receipt.consumption_id, receipt.enablement_id, receipt.authorization_digest,
    receipt.operation_id, receipt.run_id, receipt.registered_generation,
    receipt.consumed_generation, receipt.consumed_at_epoch, receipt.record_digest,
    JSON.stringify(receipt),
  ]);
}

export function createHostingerStorageDurableTenantEnablementRegistry(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw fail(500, 'STORAGE_DURABLE_ENABLEMENT_OPTIONS_INVALID', 'Enablement-registry options must be an object.');
  }
  const unsupported = Object.keys(options).filter((key) => !ALLOWED_OPTIONS.has(key));
  if (unsupported.length) {
    throw fail(409, 'STORAGE_DURABLE_ENABLEMENT_OVERRIDE_FORBIDDEN', 'Only pool, signed schema verification, and bounded lock timeout may be supplied.', { unsupported_options: unsupported.sort() });
  }
  const { pool, schema_verification, lock_timeout_seconds = 5 } = options;
  if (!pool || typeof pool.getConnection !== 'function') {
    throw fail(500, 'STORAGE_DURABLE_ENABLEMENT_POOL_INVALID', 'A MySQL-compatible pool is required.');
  }
  const timeout = integer(lock_timeout_seconds, 'lock_timeout_seconds', 1);
  if (timeout > 30) throw fail(500, 'STORAGE_DURABLE_ENABLEMENT_LOCK_TIMEOUT_INVALID', 'Lock timeout must not exceed 30 seconds.');
  const verification = assertSchemaVerification(schema_verification);

  async function register(input = {}) {
    const record = normalizeRegistration(input);
    return transaction(pool, timeout, async (connection) => {
      const current = await loadRecord(connection, record.enablement_id, { forUpdate: true });
      if (current) {
        if (!same(current.record, record)) {
          throw fail(409, 'STORAGE_DURABLE_ENABLEMENT_ID_CONFLICT', 'Enablement ID is already bound to different evidence.', { enablement_id: record.enablement_id });
        }
        if (await loadConsumption(connection, record.enablement_id, { forUpdate: true })) {
          throw fail(409, 'STORAGE_DURABLE_ENABLEMENT_REPLAY_CONSUMPTION_CONFLICT', 'An unconsumed registration cannot replay after an immutable consumption receipt exists.', { enablement_id: record.enablement_id });
        }
        return deepFreeze({ created: false, replay: true, enablement: current.record, row_version: current.row_version, schema_verification_digest: verification.evidence_digest, secrets_included: false });
      }
      if (await loadConsumption(connection, record.enablement_id, { forUpdate: true })) {
        throw fail(409, 'STORAGE_DURABLE_ENABLEMENT_ORPHAN_CONSUMPTION_CONFLICT', 'A consumption receipt exists without its current enablement row.', { enablement_id: record.enablement_id });
      }
      await insertRecord(connection, record);
      const readback = await loadRecord(connection, record.enablement_id);
      if (!readback || !same(readback.record, record) || readback.row_version !== 1) {
        throw fail(409, 'STORAGE_DURABLE_ENABLEMENT_READBACK_MISMATCH', 'Inserted enablement failed exact readback.', { enablement_id: record.enablement_id });
      }
      return deepFreeze({ created: true, replay: false, enablement: readback.record, row_version: 1, schema_verification_digest: verification.evidence_digest, secrets_included: false });
    });
  }

  async function read(rawId) {
    const enablementId = identifier(rawId, 'enablement_id', 36);
    return withConnection(pool, async (connection) => {
      const current = await loadRecord(connection, enablementId);
      return current ? deepFreeze(clone(current.record)) : null;
    });
  }

  async function readConsumption(rawId) {
    const enablementId = identifier(rawId, 'enablement_id', 36);
    return withConnection(pool, async (connection) => {
      const receipt = await loadConsumption(connection, enablementId);
      return receipt ? deepFreeze(clone(receipt)) : null;
    });
  }

  async function consume(input = {}) {
    const copy = snapshot(input, 'consume');
    const enablementId = identifier(copy.enablement_id, 'enablement_id', 36);
    const authorizationDigest = hash(copy.authorization_digest, 'authorization_digest');
    const operationId = identifier(copy.operation_id, 'operation_id', 36);
    const runId = identifier(copy.run_id, 'run_id', 36);
    const expectedGeneration = integer(copy.expected_generation, 'expected_generation', 1);
    const now = integer(copy.now_epoch, 'now_epoch');
    return transaction(pool, timeout, async (connection) => {
      const current = await loadRecord(connection, enablementId, { forUpdate: true });
      if (!current) throw fail(404, 'STORAGE_DURABLE_ENABLEMENT_NOT_FOUND', 'Manual enablement record was not registered.', { enablement_id: enablementId });
      const existingReceipt = await loadConsumption(connection, enablementId, { forUpdate: true });
      if (current.record.authorization_digest !== authorizationDigest
        || current.record.operation_id !== operationId
        || current.record.run_id !== runId) {
        throw fail(409, 'STORAGE_DURABLE_ENABLEMENT_BINDING_MISMATCH', 'Enablement is not bound to this authorization, operation, and run.', { enablement_id: enablementId });
      }
      if (current.record.generation !== expectedGeneration) {
        throw fail(409, 'STORAGE_DURABLE_ENABLEMENT_GENERATION_MISMATCH', 'Enablement generation changed.', { enablement_id: enablementId, current_generation: current.record.generation });
      }
      if (current.record.consumed || existingReceipt) {
        if (!current.record.consumed || !existingReceipt) {
          throw fail(409, 'STORAGE_DURABLE_ENABLEMENT_CONSUMPTION_STATE_MISMATCH', 'Current enablement state and immutable receipt disagree.', { enablement_id: enablementId });
        }
        throw fail(409, 'STORAGE_DURABLE_ENABLEMENT_ALREADY_CONSUMED', 'Manual enablement is one-shot and was already consumed.', {
          enablement_id: enablementId,
          consumed_generation: current.record.generation,
          consumed_at_epoch: current.record.consumed_at_epoch,
        });
      }
      if (current.record.expires_at_epoch <= now) {
        throw fail(409, 'STORAGE_DURABLE_ENABLEMENT_EXPIRED', 'Manual enablement expired before consumption.', { enablement_id: enablementId });
      }
      const next = {
        ...current.record,
        generation: current.record.generation + 1,
        consumed: true,
        consumed_by_run_id: current.record.run_id,
        consumed_at_epoch: now,
        secrets_included: false,
      };
      next.record_digest = digest(next);
      const frozenNext = deepFreeze(next);
      const receipt = {
        consumption_id: consumptionId(enablementId, current.record.generation, frozenNext.generation),
        enablement_id: enablementId,
        authorization_digest: authorizationDigest,
        operation_id: operationId,
        run_id: runId,
        registered_generation: current.record.generation,
        consumed_generation: frozenNext.generation,
        consumed_at_epoch: now,
        secrets_included: false,
      };
      receipt.record_digest = digest(receipt);
      const frozenReceipt = deepFreeze(receipt);
      await updateConsumed(connection, frozenNext, expectedGeneration, current.row_version);
      await insertConsumption(connection, frozenReceipt);
      const readback = await loadRecord(connection, enablementId);
      const receiptReadback = await loadConsumption(connection, enablementId);
      if (!readback || !same(readback.record, frozenNext) || readback.row_version !== current.row_version + 1
        || !receiptReadback || !same(receiptReadback, frozenReceipt)) {
        throw fail(409, 'STORAGE_DURABLE_ENABLEMENT_READBACK_MISMATCH', 'Consumed enablement and immutable receipt failed exact readback.', { enablement_id: enablementId });
      }
      return deepFreeze({
        consumed: true,
        enablement: readback.record,
        consumption: receiptReadback,
        previous_generation: expectedGeneration,
        current_generation: frozenNext.generation,
        row_version: readback.row_version,
        automatic_retry_allowed: false,
        schema_verification_digest: verification.evidence_digest,
        secrets_included: false,
      });
    });
  }

  async function exportState() {
    return withConnection(pool, async (connection) => {
      const [recordRows] = await execute(connection, '/* spec014:enablement:export-records */ SELECT record_digest, record_json, row_version FROM storage_tenant_enablement_records ORDER BY id');
      const [receiptRows] = await execute(connection, '/* spec014:enablement:export-consumptions */ SELECT record_digest, record_json FROM storage_tenant_enablement_consumptions ORDER BY enablement_id');
      const state = {
        schema_version: 1,
        snapshot_key: 'hostinger_storage_durable_tenant_enablement_snapshot_v1',
        enablements: (recordRows || []).map(normalizeStoredRecord),
        consumptions: (receiptRows || []).map(normalizeStoredConsumption),
        schema_contract_digest: verification.schema_contract_digest,
        database_fingerprint: verification.database_fingerprint,
        automatic_retry_allowed: false,
        runtime_mounted: false,
        production_ready: false,
        secrets_included: false,
      };
      return deepFreeze({ ...state, snapshot_digest: digest(state) });
    });
  }

  const registry = {
    adapter_key: 'hostinger_storage_mysql_tenant_enablement_v1',
    registry_version: HOSTINGER_STORAGE_DURABLE_TENANT_ENABLEMENT_REGISTRY_VERSION,
    durable_sql: true,
    async_only: true,
    one_shot: true,
    generation_cas: true,
    schema_verified: true,
    schema_verification_digest: verification.evidence_digest,
    schema_contract_digest: verification.schema_contract_digest,
    database_fingerprint: verification.database_fingerprint,
    legacy_tenant_canary_compatible: false,
    automatic_retry_allowed: false,
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

export function isCanonicalHostingerStorageDurableTenantEnablementRegistry(value) {
  return Boolean(value?.[BRAND] === true
    && value?.adapter_key === 'hostinger_storage_mysql_tenant_enablement_v1'
    && value?.registry_version === HOSTINGER_STORAGE_DURABLE_TENANT_ENABLEMENT_REGISTRY_VERSION
    && value?.durable_sql === true
    && value?.async_only === true
    && value?.one_shot === true
    && value?.generation_cas === true
    && value?.schema_verified === true
    && value?.legacy_tenant_canary_compatible === false
    && value?.automatic_retry_allowed === false
    && value?.runtime_mounted === false
    && value?.route_mounted === false
    && value?.worker_mounted === false
    && value?.provider_dispatch_allowed === false
    && value?.production_ready === false
    && Object.isFrozen(value));
}
