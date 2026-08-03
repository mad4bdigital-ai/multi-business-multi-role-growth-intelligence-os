import { createHash } from 'node:crypto';

export const HOSTINGER_STORAGE_SQL_PERSISTENCE_ADAPTER_VERSION = 'spec014-hostinger-storage-sql-persistence-v1';

const LOCK_NAME = 'spec014:hostinger-storage-control-plane';
const SAFE_TABLES = Object.freeze({
  operations: 'storage_cleanup_operations',
  plans: 'storage_cleanup_plans',
  approvals: 'storage_cleanup_approvals',
  leases: 'storage_execution_leases',
  journals: 'storage_cleanup_run_items',
  reconciliations: 'storage_reconciliation_results',
});

function fail(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = { ...details, secrets_included: false };
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

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry);
  return value;
}

function assertSecretFree(value, path = 'value', depth = 0, ancestors = new WeakSet()) {
  if (depth > 20 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSecretFree(entry, `${path}[${index}]`, depth + 1, ancestors));
    return;
  }
  if (typeof value !== 'object') return;
  if (ancestors.has(value)) throw fail(400, 'STORAGE_SQL_STATE_CYCLE_FORBIDDEN', 'Durable storage state cannot contain cycles.', { path });
  ancestors.add(value);
  try {
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'secrets_included' && entry !== false) {
        throw fail(400, 'STORAGE_SQL_SECRET_DECLARATION_INVALID', 'Secret declaration must remain false.', { path: `${path}.${key}` });
      }
      if (key !== 'secrets_included' && /(password|passwd|secret_value|private[_-]?key|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization_header|cookie_header|raw_provider_payload|raw_environment|file_content)/i.test(key)) {
        throw fail(400, 'STORAGE_SQL_SECRET_FIELD_REJECTED', 'Durable storage state cannot contain secret-bearing fields.', { path: `${path}.${key}` });
      }
      assertSecretFree(entry, `${path}.${key}`, depth + 1, ancestors);
    }
  } finally {
    ancestors.delete(value);
  }
}

function emptyState() {
  return {
    schema_version: 1,
    operations: {},
    operation_idempotency: {},
    plans: {},
    approvals: {},
    leases: {},
    journals: {},
    reconciliations: {},
    secrets_included: false,
  };
}

function stateCore(state) {
  return {
    schema_version: state.schema_version,
    operations: state.operations,
    operation_idempotency: state.operation_idempotency,
    plans: state.plans,
    approvals: state.approvals,
    leases: state.leases,
    journals: state.journals,
    reconciliations: state.reconciliations,
    secrets_included: false,
  };
}

function assertState(state) {
  assertSecretFree(state, 'state');
  if (!state || state.schema_version !== 1 || state.secrets_included !== false) {
    throw fail(409, 'STORAGE_SQL_STATE_INVALID', 'Unexpected durable storage state contract.');
  }
  for (const key of ['operations', 'operation_idempotency', 'plans', 'approvals', 'leases', 'journals', 'reconciliations']) {
    if (!state[key] || typeof state[key] !== 'object' || Array.isArray(state[key])) {
      throw fail(409, 'STORAGE_SQL_STATE_INVALID', 'Durable storage state map is invalid.', { field: key });
    }
  }
}

function parseRecord(row, table) {
  let value = row.record_json;
  if (Buffer.isBuffer(value)) value = value.toString('utf8');
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch {
      throw fail(409, 'STORAGE_SQL_RECORD_JSON_INVALID', 'Durable storage record JSON is invalid.', { table });
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw fail(409, 'STORAGE_SQL_RECORD_JSON_INVALID', 'Durable storage record JSON is invalid.', { table });
  }
  assertSecretFree(value, `${table}.record_json`);
  if (value.record_digest !== row.record_digest) {
    throw fail(409, 'STORAGE_SQL_RECORD_DIGEST_MISMATCH', 'Durable storage record digest mismatch.', { table });
  }
  return clone(value);
}

function flattenApprovals(approvals) {
  return Object.values(approvals).flat();
}

function flattenJournals(journals) {
  return Object.values(journals).flat();
}

function mapBy(records, key) {
  return new Map(records.map((record) => [record[key], record]));
}

function versionsFor(rows, key) {
  return new Map(rows.map((row) => [String(row[key]), Number(row.row_version || 0)]));
}

function normalizeDriverError(error) {
  if (error?.code?.startsWith?.('STORAGE_')) return error;
  if (['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(error?.code)) {
    return fail(503, 'STORAGE_SQL_SCHEMA_UNAVAILABLE', 'Hostinger storage SQL schema is unavailable.', { mysql_code: error.code });
  }
  if (['ER_DUP_ENTRY', 'ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error?.code)) {
    return fail(409, 'STORAGE_SQL_CAS_CONFLICT', 'Durable storage SQL state changed concurrently.', { mysql_code: error.code });
  }
  return error;
}

async function execute(connection, sql, params = []) {
  const method = typeof connection.execute === 'function' ? 'execute' : 'query';
  if (typeof connection[method] !== 'function') {
    throw fail(500, 'STORAGE_SQL_CONNECTION_INVALID', 'SQL connection must expose execute() or query().');
  }
  return connection[method](sql, params);
}

async function acquireLock(connection, lockTimeoutSeconds) {
  const [rows] = await execute(connection, '/* spec014:lock:acquire */ SELECT GET_LOCK(?, ?) AS acquired', [LOCK_NAME, lockTimeoutSeconds]);
  if (Number(rows?.[0]?.acquired) !== 1) {
    throw fail(409, 'STORAGE_SQL_LOCK_UNAVAILABLE', 'Durable storage SQL writer lock is unavailable.');
  }
}

async function releaseLock(connection) {
  try {
    await execute(connection, '/* spec014:lock:release */ SELECT RELEASE_LOCK(?) AS released', [LOCK_NAME]);
  } catch {
    // Releasing the connection also releases the advisory lock. Never mask the primary result.
  }
}

async function loadState(connection, { forUpdate = false } = {}) {
  const suffix = forUpdate ? ' FOR UPDATE' : '';
  const queries = [
    ['operations', `/* spec014:load:operations */ SELECT id, idempotency_key, record_digest, record_json, row_version FROM ${SAFE_TABLES.operations}${suffix}`],
    ['plans', `/* spec014:load:plans */ SELECT id, record_digest, record_json, row_version FROM ${SAFE_TABLES.plans}${suffix}`],
    ['approvals', `/* spec014:load:approvals */ SELECT id, plan_id, record_digest, record_json, row_version FROM ${SAFE_TABLES.approvals}${suffix}`],
    ['leases', `/* spec014:load:leases */ SELECT id, target_id, record_digest, record_json, row_version FROM ${SAFE_TABLES.leases}${suffix}`],
    ['journals', `/* spec014:load:journals */ SELECT id, run_id, record_digest, record_json, row_version FROM ${SAFE_TABLES.journals}${suffix}`],
    ['reconciliations', `/* spec014:load:reconciliations */ SELECT id, record_digest, record_json, row_version FROM ${SAFE_TABLES.reconciliations}${suffix}`],
  ];
  const rowsByTable = {};
  for (const [name, sql] of queries) {
    const [rows] = await execute(connection, sql);
    rowsByTable[name] = Array.isArray(rows) ? rows : [];
  }

  const state = emptyState();
  for (const row of rowsByTable.operations) {
    const record = parseRecord(row, SAFE_TABLES.operations);
    state.operations[record.operation_id] = record;
    state.operation_idempotency[record.idempotency_key] = record.operation_id;
  }
  for (const row of rowsByTable.plans) {
    const record = parseRecord(row, SAFE_TABLES.plans);
    state.plans[record.plan_id] = record;
  }
  for (const row of rowsByTable.approvals) {
    const record = parseRecord(row, SAFE_TABLES.approvals);
    state.approvals[record.plan_id] ||= [];
    state.approvals[record.plan_id].push(record);
  }
  for (const rows of Object.values(state.approvals)) rows.sort((a, b) => a.approval_id.localeCompare(b.approval_id));
  for (const row of rowsByTable.leases) {
    const record = parseRecord(row, SAFE_TABLES.leases);
    state.leases[record.target_id] = record;
  }
  for (const row of rowsByTable.journals) {
    const record = parseRecord(row, SAFE_TABLES.journals);
    state.journals[record.run_id] ||= [];
    state.journals[record.run_id].push(record);
  }
  for (const rows of Object.values(state.journals)) rows.sort((a, b) => a.sequence - b.sequence);
  for (const row of rowsByTable.reconciliations) {
    const record = parseRecord(row, SAFE_TABLES.reconciliations);
    state.reconciliations[record.reconciliation_id] = record;
  }
  assertState(state);

  const transactionVersion = Object.values(rowsByTable)
    .flat()
    .reduce((sum, row) => sum + Number(row.row_version || 0), 0);
  const versions = {
    operations: versionsFor(rowsByTable.operations, 'id'),
    plans: versionsFor(rowsByTable.plans, 'id'),
    approvals: versionsFor(rowsByTable.approvals, 'id'),
    leases: versionsFor(rowsByTable.leases, 'target_id'),
    journals: versionsFor(rowsByTable.journals, 'id'),
    reconciliations: versionsFor(rowsByTable.reconciliations, 'id'),
  };
  return { state, transactionVersion, versions };
}

function assertNoDeletion(beforeMap, afterMap, table) {
  for (const key of beforeMap.keys()) {
    if (!afterMap.has(key)) {
      throw fail(409, 'STORAGE_SQL_DELETE_FORBIDDEN', 'Durable control-plane rows are append/update only.', { table, key });
    }
  }
}

async function insertRecord(connection, table, record) {
  const json = JSON.stringify(record);
  const common = [record.record_digest, json];
  if (table === 'operations') {
    return execute(connection, `/* spec014:insert:operations */ INSERT INTO ${SAFE_TABLES.operations} (id, idempotency_key, target_id, state, version, record_digest, record_json, row_version) VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON), 1)`, [record.operation_id, record.idempotency_key, record.target_id, record.state, record.version, ...common]);
  }
  if (table === 'plans') {
    return execute(connection, `/* spec014:insert:plans */ INSERT INTO ${SAFE_TABLES.plans} (id, operation_id, target_id, plan_hash, consumed, record_digest, record_json, row_version) VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON), 1)`, [record.plan_id, record.operation_id, record.target_id, record.plan_hash, record.consumed ? 1 : 0, ...common]);
  }
  if (table === 'approvals') {
    return execute(connection, `/* spec014:insert:approvals */ INSERT INTO ${SAFE_TABLES.approvals} (id, plan_id, approval_slot, decision, invalidated, record_digest, record_json, row_version) VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON), 1)`, [record.approval_id, record.plan_id, record.slot, record.decision, record.invalidated ? 1 : 0, ...common]);
  }
  if (table === 'leases') {
    return execute(connection, `/* spec014:insert:leases */ INSERT INTO ${SAFE_TABLES.leases} (id, target_id, lease_id, operation_id, generation, status, expires_at_epoch, record_digest, record_json, row_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), 1)`, [record.lease_id, record.target_id, record.lease_id, record.operation_id, record.generation, record.status, record.expires_at_epoch, ...common]);
  }
  if (table === 'journals') {
    return execute(connection, `/* spec014:insert:journals */ INSERT INTO ${SAFE_TABLES.journals} (id, operation_id, run_id, plan_id, item_id, sequence, phase, result, record_digest, record_json, row_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), 1)`, [record.event_id, record.operation_id, record.run_id, record.plan_id, record.item_id, record.sequence, record.phase, record.result, ...common]);
  }
  return execute(connection, `/* spec014:insert:reconciliations */ INSERT INTO ${SAFE_TABLES.reconciliations} (id, operation_id, run_id, outcome, retry_permission, record_digest, record_json, row_version) VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON), 1)`, [record.reconciliation_id, record.operation_id, record.run_id, record.outcome, record.retry_allowed ? 1 : 0, ...common]);
}

async function updateRecord(connection, table, record, expectedVersion) {
  const json = JSON.stringify(record);
  let result;
  if (table === 'operations') {
    [result] = await execute(connection, `/* spec014:update:operations */ UPDATE ${SAFE_TABLES.operations} SET target_id=?, state=?, version=?, record_digest=?, record_json=CAST(? AS JSON), row_version=row_version+1 WHERE id=? AND row_version=?`, [record.target_id, record.state, record.version, record.record_digest, json, record.operation_id, expectedVersion]);
  } else if (table === 'plans') {
    [result] = await execute(connection, `/* spec014:update:plans */ UPDATE ${SAFE_TABLES.plans} SET consumed=?, record_digest=?, record_json=CAST(? AS JSON), row_version=row_version+1 WHERE id=? AND row_version=?`, [record.consumed ? 1 : 0, record.record_digest, json, record.plan_id, expectedVersion]);
  } else if (table === 'approvals') {
    [result] = await execute(connection, `/* spec014:update:approvals */ UPDATE ${SAFE_TABLES.approvals} SET decision=?, invalidated=?, record_digest=?, record_json=CAST(? AS JSON), row_version=row_version+1 WHERE id=? AND row_version=?`, [record.decision, record.invalidated ? 1 : 0, record.record_digest, json, record.approval_id, expectedVersion]);
  } else if (table === 'leases') {
    [result] = await execute(connection, `/* spec014:update:leases */ UPDATE ${SAFE_TABLES.leases} SET lease_id=?, operation_id=?, generation=?, status=?, expires_at_epoch=?, record_digest=?, record_json=CAST(? AS JSON), row_version=row_version+1 WHERE target_id=? AND row_version=?`, [record.lease_id, record.operation_id, record.generation, record.status, record.expires_at_epoch, record.record_digest, json, record.target_id, expectedVersion]);
  } else if (table === 'journals') {
    throw fail(409, 'STORAGE_SQL_APPEND_ONLY_VIOLATION', 'Journal rows are append-only.', { event_id: record.event_id });
  } else {
    throw fail(409, 'STORAGE_SQL_APPEND_ONLY_VIOLATION', 'Reconciliation rows are append-only.', { reconciliation_id: record.reconciliation_id });
  }
  if (Number(result?.affectedRows) !== 1) {
    throw fail(409, 'STORAGE_SQL_CAS_CONFLICT', 'Durable storage row version changed.', { table });
  }
}

async function persistCollection(connection, table, beforeRecords, afterRecords, key, versions) {
  const before = mapBy(beforeRecords, key);
  const after = mapBy(afterRecords, key);
  assertNoDeletion(before, after, table);
  for (const [id, record] of after.entries()) {
    const prior = before.get(id);
    if (!prior) {
      await insertRecord(connection, table, record);
      continue;
    }
    if (prior.record_digest === record.record_digest) continue;
    await updateRecord(connection, table, record, versions.get(String(id)) || 0);
  }
}

async function persistState(connection, before, after, versions) {
  assertState(after);
  await persistCollection(connection, 'operations', Object.values(before.operations), Object.values(after.operations), 'operation_id', versions.operations);
  await persistCollection(connection, 'plans', Object.values(before.plans), Object.values(after.plans), 'plan_id', versions.plans);
  await persistCollection(connection, 'approvals', flattenApprovals(before.approvals), flattenApprovals(after.approvals), 'approval_id', versions.approvals);
  await persistCollection(connection, 'leases', Object.values(before.leases), Object.values(after.leases), 'target_id', versions.leases);
  await persistCollection(connection, 'journals', flattenJournals(before.journals), flattenJournals(after.journals), 'event_id', versions.journals);
  await persistCollection(connection, 'reconciliations', Object.values(before.reconciliations), Object.values(after.reconciliations), 'reconciliation_id', versions.reconciliations);
}

export function createMySqlHostingerStoragePersistenceAdapter({
  pool,
  schema_verified = false,
  lock_timeout_seconds = 5,
} = {}) {
  if (!pool || typeof pool.getConnection !== 'function') {
    throw fail(500, 'STORAGE_SQL_POOL_INVALID', 'A mysql2-compatible pool is required.');
  }
  if (!Number.isInteger(lock_timeout_seconds) || lock_timeout_seconds < 1 || lock_timeout_seconds > 30) {
    throw fail(500, 'STORAGE_SQL_LOCK_TIMEOUT_INVALID', 'SQL lock timeout must be between 1 and 30 seconds.');
  }

  async function withConnection(work) {
    const connection = await pool.getConnection();
    try {
      return await work(connection);
    } catch (error) {
      throw normalizeDriverError(error);
    } finally {
      connection.release?.();
    }
  }

  async function transaction(work) {
    if (typeof work !== 'function') throw fail(500, 'STORAGE_SQL_WORK_INVALID', 'Transaction work must be a function.');
    return withConnection(async (connection) => {
      await acquireLock(connection, lock_timeout_seconds);
      let begun = false;
      try {
        await connection.beginTransaction();
        begun = true;
        const loaded = await loadState(connection, { forUpdate: true });
        const before = clone(loaded.state);
        const draft = clone(loaded.state);
        const result = await work(draft, loaded.transactionVersion);
        assertState(draft);
        await persistState(connection, before, draft, loaded.versions);
        await connection.commit();
        begun = false;
        return clone(result);
      } catch (error) {
        if (begun) {
          try { await connection.rollback(); } catch { /* preserve primary error */ }
        }
        throw error;
      } finally {
        await releaseLock(connection);
      }
    });
  }

  async function read(reader) {
    if (typeof reader !== 'function') throw fail(500, 'STORAGE_SQL_READER_INVALID', 'SQL reader must be a function.');
    return withConnection(async (connection) => {
      const loaded = await loadState(connection);
      return clone(await reader(clone(loaded.state), loaded.transactionVersion));
    });
  }

  async function exportSnapshot() {
    return read((state, transactionVersion) => {
      const core = stateCore(state);
      return deepFreeze({
        schema_version: 1,
        snapshot_key: 'hostinger_storage_control_plane_snapshot_v1',
        transaction_version: transactionVersion,
        state: clone(core),
        state_digest: digest(core),
        durable_sql: true,
        production_ready: schema_verified === true,
        secrets_included: false,
      });
    });
  }

  return Object.freeze({
    adapter_version: HOSTINGER_STORAGE_SQL_PERSISTENCE_ADAPTER_VERSION,
    adapter_key: 'hostinger_storage_mysql_control_plane_v1',
    durable_sql: true,
    schema_verified: schema_verified === true,
    production_ready: schema_verified === true,
    transaction,
    read,
    export_snapshot: exportSnapshot,
  });
}

export const _testingHostingerStorageSqlPersistenceAdapter = Object.freeze({
  SAFE_TABLES,
  assertSecretFree,
  digest,
  emptyState,
  loadState,
  persistState,
});
