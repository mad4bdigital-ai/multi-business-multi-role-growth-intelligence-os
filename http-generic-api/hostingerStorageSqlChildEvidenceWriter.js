import { createHash } from 'node:crypto';
import { deriveHostingerStoragePlanItemId } from './hostingerStorageSqlParentWriter.js';

export const HOSTINGER_STORAGE_SQL_CHILD_EVIDENCE_WRITER_VERSION = 'spec014-hostinger-storage-sql-child-evidence-writer-v1';

const BRAND = Symbol.for('mad4b.spec014.hostinger-storage-sql-child-evidence-writer');
const LOCK_NAME = 'spec014:hostinger-storage-parent-writer';
const SHA256_RE = /^[0-9a-f]{64}$/u;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const RUN_STATES = new Set(['executing', 'readback_pending', 'reconciling', 'unknown_outcome']);
const PHASES = new Set(['prepared', 'result', 'readback']);
const OUTCOMES = new Set(['applied', 'partially_applied', 'not_applied', 'conflict', 'still_unknown']);

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

function text(value, max = 512) {
  return String(value ?? '').trim().slice(0, max);
}

function id(value, field, { nullable = false, max = 256 } = {}) {
  const result = text(value, max);
  if (!result && nullable) return null;
  if (!SAFE_ID_RE.test(result) || result.length > max) {
    throw fail(400, 'STORAGE_SQL_CHILD_IDENTIFIER_INVALID', 'A safe bounded identifier is required.', { field });
  }
  return result;
}

function hash(value, field, { nullable = false } = {}) {
  const result = text(value, 64).toLowerCase();
  if (!result && nullable) return null;
  if (!SHA256_RE.test(result)) throw fail(400, 'STORAGE_SQL_CHILD_HASH_INVALID', 'A lowercase SHA-256 binding is required.', { field });
  return result;
}

function integer(value, field, minimum = 0) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum) {
    throw fail(400, 'STORAGE_SQL_CHILD_INTEGER_INVALID', 'A bounded integer is required.', { field, minimum });
  }
  return result;
}

function bool(value, field) {
  if (typeof value !== 'boolean') throw fail(400, 'STORAGE_SQL_CHILD_BOOLEAN_INVALID', 'An explicit boolean binding is required.', { field });
  return value;
}

function assertSecretFree(value, path = 'value', depth = 0) {
  if (depth > 20 || value === null || value === undefined) return;
  if (Array.isArray(value)) return value.forEach((entry, index) => assertSecretFree(entry, `${path}[${index}]`, depth + 1));
  if (typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'secrets_included' && entry !== false) {
      throw fail(400, 'STORAGE_SQL_CHILD_SECRET_DECLARATION_INVALID', 'Secret declaration must remain false.', { path: `${path}.${key}` });
    }
    if (key !== 'secrets_included' && /(password|passwd|secret_value|private[_-]?key|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization_header|cookie_header|raw_provider_payload|raw_environment|file_content|absolute_path|shell_command)/i.test(key)) {
      throw fail(400, 'STORAGE_SQL_CHILD_SECRET_OR_UNSAFE_FIELD_REJECTED', 'Child evidence cannot contain secrets or free-form execution fields.', { path: `${path}.${key}` });
    }
    assertSecretFree(entry, `${path}.${key}`, depth + 1);
  }
}

function verification(value) {
  assertSecretFree(value, 'schema_verification');
  if (value?.ready !== true || value?.schema_verified !== true || (value?.blockers || []).length !== 0) {
    throw fail(409, 'STORAGE_SQL_CHILD_SCHEMA_VERIFICATION_REQUIRED', 'Successful signed schema verification is required.');
  }
  if (value.production_ready !== false || value.authority_granted !== false || value.migration_apply_authorized !== false || value.provider_dispatch_allowed !== false) {
    throw fail(409, 'STORAGE_SQL_CHILD_SCHEMA_VERIFICATION_BOUNDARY_INVALID', 'Schema verification cannot grant production, migration, authority, or provider capability.');
  }
  const evidence = value.evidence || {};
  const result = {
    evidence_digest: hash(value.evidence_digest, 'schema_verification.evidence_digest'),
    source_commit: id(evidence.source_commit, 'schema_verification.source_commit', { max: 64 }),
    deployed_runtime_sha: id(evidence.deployed_runtime_sha, 'schema_verification.deployed_runtime_sha', { max: 64 }),
    runtime_parity: bool(evidence.runtime_parity, 'schema_verification.runtime_parity'),
    database_fingerprint: hash(evidence.database_fingerprint, 'schema_verification.database_fingerprint'),
    readback_cycle_id: id(evidence.readback_cycle_id, 'schema_verification.readback_cycle_id'),
    expires_at: id(evidence.expires_at, 'schema_verification.expires_at'),
    secrets_included: false,
  };
  if (!result.runtime_parity || result.source_commit !== result.deployed_runtime_sha) {
    throw fail(409, 'STORAGE_SQL_CHILD_RUNTIME_PARITY_REQUIRED', 'Exact deployed runtime parity is required.');
  }
  if (Date.parse(result.expires_at) <= Date.now()) throw fail(409, 'STORAGE_SQL_CHILD_SCHEMA_VERIFICATION_EXPIRED', 'Schema verification expired.');
  return Object.freeze(result);
}

function journalId(runId, runtimeEventId, sequence) {
  const hex = createHash('sha256').update(`${runId}\0${runtimeEventId}\0${sequence}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-b${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function journal(record) {
  assertSecretFree(record, 'journal');
  const phase = text(record.phase, 32).toLowerCase();
  if (!PHASES.has(phase)) throw fail(400, 'STORAGE_SQL_CHILD_JOURNAL_PHASE_INVALID', 'Unsupported journal phase.', { phase });
  const runId = id(record.run_id ?? record.runId, 'journal.run_id', { max: 36 });
  const planId = id(record.plan_id ?? record.planId, 'journal.plan_id', { max: 36 });
  const itemId = id(record.item_id ?? record.itemId, 'journal.item_id', { max: 191 });
  const itemHash = hash(record.item_hash ?? record.itemHash, 'journal.item_hash');
  const runtimeEventId = id(record.event_id ?? record.eventId, 'journal.event_id', { max: 191 });
  const sequence = integer(record.sequence, 'journal.sequence', 1);
  const result = {
    id: journalId(runId, runtimeEventId, sequence),
    runtime_event_id: runtimeEventId,
    operation_id: id(record.operation_id ?? record.operationId, 'journal.operation_id', { max: 36 }),
    run_id: runId,
    plan_id: planId,
    item_id: itemId,
    item_hash: itemHash,
    plan_item_id: deriveHostingerStoragePlanItemId({ plan_id: planId, item_id: itemId, item_hash: itemHash }),
    sequence,
    phase,
    result: id(record.result, 'journal.result', { max: 64 }),
    prepared_at_epoch: record.prepared_at_epoch == null ? null : integer(record.prepared_at_epoch, 'journal.prepared_at_epoch'),
    observed_stat_digest: hash(record.observed_stat_digest ?? record.stat_digest, 'journal.observed_stat_digest', { nullable: true }),
    result_evidence_digest: hash(record.result_evidence_digest ?? record.evidence_digest, 'journal.result_evidence_digest', { nullable: true }),
    checkpoint_at_epoch: record.checkpoint_at_epoch == null ? null : integer(record.checkpoint_at_epoch, 'journal.checkpoint_at_epoch'),
    readback_state: id(record.readback_state, 'journal.readback_state', { nullable: true, max: 32 }),
    secrets_included: false,
  };
  if (phase === 'prepared' && result.prepared_at_epoch === null) throw fail(400, 'STORAGE_SQL_CHILD_PREPARED_TIME_REQUIRED', 'Prepared evidence requires a timestamp.');
  if (phase === 'result' && !result.result_evidence_digest) throw fail(400, 'STORAGE_SQL_CHILD_RESULT_EVIDENCE_REQUIRED', 'Result evidence digest is required.');
  if (phase === 'readback' && (!result.readback_state || !result.result_evidence_digest)) throw fail(400, 'STORAGE_SQL_CHILD_READBACK_EVIDENCE_REQUIRED', 'Readback state and evidence digest are required.');
  result.record_digest = digest(result);
  return Object.freeze(result);
}

function reconciliation(record) {
  assertSecretFree(record, 'reconciliation');
  const outcome = text(record.outcome, 32).toLowerCase();
  if (!OUTCOMES.has(outcome)) throw fail(400, 'STORAGE_SQL_CHILD_RECONCILIATION_OUTCOME_INVALID', 'Unsupported reconciliation outcome.', { outcome });
  const hashes = record.input_evidence_hashes || {};
  const entries = Object.entries(hashes).map(([key, value]) => [id(key, 'reconciliation.hash_key', { max: 128 }), hash(value, `reconciliation.${key}`)]);
  if (!entries.length) throw fail(400, 'STORAGE_SQL_CHILD_EVIDENCE_HASHES_REQUIRED', 'At least one evidence hash is required.');
  const accounting = record.item_accounting || {};
  const result = {
    id: id(record.reconciliation_id ?? record.reconciliationId, 'reconciliation.id', { max: 36 }),
    operation_id: id(record.operation_id ?? record.operationId, 'reconciliation.operation_id', { max: 36 }),
    run_id: id(record.run_id ?? record.runId, 'reconciliation.run_id', { max: 36 }),
    input_evidence_hashes: Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b))),
    item_accounting: {
      total: integer(accounting.total, 'reconciliation.total'),
      prepared: integer(accounting.prepared, 'reconciliation.prepared'),
      result: integer(accounting.result, 'reconciliation.result'),
      readback: integer(accounting.readback, 'reconciliation.readback'),
      conflict: integer(accounting.conflict ?? 0, 'reconciliation.conflict'),
      secrets_included: false,
    },
    outcome,
    retry_permission: bool(record.retry_permission ?? false, 'reconciliation.retry_permission'),
    reviewed_at_epoch: integer(record.reviewed_at_epoch, 'reconciliation.reviewed_at_epoch'),
    evidence_digest: hash(record.evidence_digest, 'reconciliation.evidence_digest'),
    secrets_included: false,
  };
  result.record_digest = digest(result);
  return Object.freeze(result);
}

function parse(value) {
  if (Buffer.isBuffer(value)) value = value.toString('utf8');
  if (typeof value === 'string') value = JSON.parse(value);
  return value;
}

function same(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

async function sql(connection, statement, params = []) {
  const method = typeof connection.execute === 'function' ? 'execute' : 'query';
  return connection[method](statement, params);
}

function driverError(error) {
  if (error?.code?.startsWith?.('STORAGE_')) return error;
  if (['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(error?.code)) return fail(503, 'STORAGE_SQL_CHILD_SCHEMA_UNAVAILABLE', 'Child-evidence schema is unavailable.', { mysql_code: error.code });
  if (['ER_DUP_ENTRY', 'ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error?.code)) return fail(409, 'STORAGE_SQL_CHILD_CONFLICT', 'Child evidence changed concurrently.', { mysql_code: error.code });
  return error;
}

async function transaction(pool, timeout, work) {
  const connection = await pool.getConnection();
  let locked = false;
  try {
    await connection.beginTransaction();
    const [rows] = await sql(connection, '/* spec014:child:lock:acquire */ SELECT GET_LOCK(?, ?) AS acquired', [LOCK_NAME, timeout]);
    if (Number(rows?.[0]?.acquired) !== 1) throw fail(409, 'STORAGE_SQL_CHILD_LOCK_UNAVAILABLE', 'Shared parent/child writer lock is unavailable.');
    locked = true;
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw driverError(error);
  } finally {
    if (locked) try { await sql(connection, '/* spec014:child:lock:release */ SELECT RELEASE_LOCK(?)', [LOCK_NAME]); } catch {}
    connection.release?.();
  }
}

async function parents(connection, child) {
  const [runRows] = await sql(connection, '/* spec014:child:load:run */ SELECT id, operation_id, plan_id, state FROM storage_cleanup_runs WHERE id=? FOR UPDATE', [child.run_id]);
  const run = runRows?.[0];
  if (!run) throw fail(409, 'STORAGE_SQL_CHILD_RUN_PARENT_REQUIRED', 'Run parent is required.', { run_id: child.run_id });
  if (run.operation_id !== child.operation_id || (child.plan_id && run.plan_id !== child.plan_id)) throw fail(409, 'STORAGE_SQL_CHILD_RUN_BINDING_MISMATCH', 'Run parent belongs to a different operation or plan.');
  if (!RUN_STATES.has(run.state)) throw fail(409, 'STORAGE_SQL_CHILD_RUN_NOT_APPENDABLE', 'Run state does not allow child evidence.', { state: run.state });
  return run;
}

async function journalRows(connection, runId) {
  const [rows] = await sql(connection, '/* spec014:child:load:journals */ SELECT id, plan_item_id, sequence, phase, record_digest, record_json, row_version FROM storage_cleanup_run_items WHERE run_id=? ORDER BY sequence, id FOR UPDATE', [runId]);
  if ((rows || []).some((row) => !row.plan_item_id)) throw fail(409, 'STORAGE_SQL_CHILD_LEGACY_UNBOUND_ROW_BLOCKS_APPEND', 'Legacy journal rows without plan-item parents block parent-aware appends.');
  return rows || [];
}

export function createHostingerStorageSqlChildEvidenceWriter({ pool, schema_verification, lock_timeout_seconds = 5 } = {}) {
  if (!pool || typeof pool.getConnection !== 'function') throw fail(500, 'STORAGE_SQL_CHILD_POOL_INVALID', 'A MySQL-compatible pool is required.');
  const verified = verification(schema_verification);
  const timeout = integer(lock_timeout_seconds, 'lock_timeout_seconds');
  const writer = {
    writer_key: 'hostinger_storage_sql_child_evidence_writer_v1',
    writer_version: HOSTINGER_STORAGE_SQL_CHILD_EVIDENCE_WRITER_VERSION,
    schema_verification: verified,
    schema_verified: true,
    production_ready: false,
    runtime_mounted: false,
    foreign_keys_enabled: false,
    provider_dispatch_allowed: false,
    async appendJournalEvent(input) {
      const row = journal(input);
      return transaction(pool, timeout, async (connection) => {
        await parents(connection, row);
        const [itemRows] = await sql(connection, '/* spec014:child:load:plan-item */ SELECT id, item_hash FROM storage_cleanup_plan_items WHERE id=? AND plan_id=? FOR UPDATE', [row.plan_item_id, row.plan_id]);
        if (!itemRows?.[0] || itemRows[0].item_hash !== row.item_hash) throw fail(409, 'STORAGE_SQL_CHILD_PLAN_ITEM_PARENT_REQUIRED', 'Deterministic plan-item parent is required.');
        const rows = await journalRows(connection, row.run_id);
        const existing = rows.find((item) => item.id === row.id);
        if (existing) {
          const stored = parse(existing.record_json);
          if (existing.record_digest !== row.record_digest || existing.row_version !== 1 || !same(stored, row)) throw fail(409, 'STORAGE_SQL_CHILD_JOURNAL_REPLAY_CONFLICT', 'Journal replay differs from durable evidence.');
          return { created: false, replay: true, journal: stored, secrets_included: false };
        }
        if (row.sequence !== rows.length + 1) throw fail(409, 'STORAGE_SQL_CHILD_JOURNAL_SEQUENCE_CONFLICT', 'Journal sequence must be contiguous.', { expected_sequence: rows.length + 1 });
        const itemRowsForParent = rows.filter((item) => item.plan_item_id === row.plan_item_id);
        if (row.phase === 'result' && !itemRowsForParent.some((item) => item.phase === 'prepared')) throw fail(409, 'STORAGE_SQL_CHILD_PREPARED_PARENT_EVIDENCE_REQUIRED', 'Prepared evidence must precede result evidence.');
        if (row.phase === 'readback' && !itemRowsForParent.some((item) => item.phase === 'result')) throw fail(409, 'STORAGE_SQL_CHILD_RESULT_PARENT_EVIDENCE_REQUIRED', 'Result evidence must precede readback evidence.');
        await sql(connection, '/* spec014:child:insert:journal */ INSERT INTO storage_cleanup_run_items (id,operation_id,run_id,plan_id,item_id,plan_item_id,sequence,phase,result,prepared_at_epoch,observed_stat_digest,result_evidence_digest,checkpoint_at_epoch,readback_state,record_digest,record_json,row_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CAST(? AS JSON),1)', [row.id,row.operation_id,row.run_id,row.plan_id,row.item_id,row.plan_item_id,row.sequence,row.phase,row.result,row.prepared_at_epoch,row.observed_stat_digest,row.result_evidence_digest,row.checkpoint_at_epoch,row.readback_state,row.record_digest,JSON.stringify(row)]);
        const [readback] = await sql(connection, '/* spec014:child:readback:journal */ SELECT record_digest,record_json,row_version FROM storage_cleanup_run_items WHERE id=?', [row.id]);
        const stored = parse(readback?.[0]?.record_json);
        if (!readback?.[0] || readback[0].record_digest !== row.record_digest || readback[0].row_version !== 1 || !same(stored, row)) throw fail(409, 'STORAGE_SQL_CHILD_JOURNAL_READBACK_MISMATCH', 'Journal readback mismatch.');
        return { created: true, replay: false, journal: stored, secrets_included: false };
      });
    },
    async appendReconciliation(input) {
      const row = reconciliation(input);
      return transaction(pool, timeout, async (connection) => {
        const run = await parents(connection, row);
        const [existingRows] = await sql(connection, '/* spec014:child:load:reconciliation */ SELECT record_digest,record_json,row_version FROM storage_reconciliation_results WHERE id=? FOR UPDATE', [row.id]);
        if (existingRows?.[0]) {
          const stored = parse(existingRows[0].record_json);
          if (existingRows[0].record_digest !== row.record_digest || existingRows[0].row_version !== 1 || !same(stored, row)) throw fail(409, 'STORAGE_SQL_CHILD_RECONCILIATION_REPLAY_CONFLICT', 'Reconciliation replay differs from durable evidence.');
          return { created: false, replay: true, reconciliation: stored, secrets_included: false };
        }
        const rows = await journalRows(connection, row.run_id);
        const [countRows] = await sql(connection, '/* spec014:child:count:plan-items */ SELECT COUNT(*) AS item_count FROM storage_cleanup_plan_items WHERE plan_id=?', [run.plan_id]);
        const total = Number(countRows?.[0]?.item_count || 0);
        const phases = new Map();
        for (const item of rows) {
          const set = phases.get(item.plan_item_id) || new Set();
          set.add(item.phase);
          phases.set(item.plan_item_id, set);
        }
        const observed = { total, prepared: [...phases.values()].filter((set) => set.has('prepared')).length, result: [...phases.values()].filter((set) => set.has('result')).length, readback: [...phases.values()].filter((set) => set.has('readback')).length };
        for (const field of Object.keys(observed)) if (row.item_accounting[field] !== observed[field]) throw fail(409, 'STORAGE_SQL_CHILD_RECONCILIATION_ACCOUNTING_MISMATCH', 'Reconciliation accounting differs from durable child rows.', { field, expected: row.item_accounting[field], observed: observed[field] });
        if (row.outcome === 'applied' && observed.readback !== total) throw fail(409, 'STORAGE_SQL_CHILD_COMPLETE_READBACK_REQUIRED', 'Applied reconciliation requires readback for every plan-item parent.');
        await sql(connection, '/* spec014:child:insert:reconciliation */ INSERT INTO storage_reconciliation_results (id,operation_id,run_id,input_evidence_hashes_json,item_accounting_json,outcome,retry_permission,reviewed_at_epoch,evidence_digest,record_digest,record_json,row_version) VALUES (?,?,?,CAST(? AS JSON),CAST(? AS JSON),?,?,?,?,?,CAST(? AS JSON),1)', [row.id,row.operation_id,row.run_id,JSON.stringify(row.input_evidence_hashes),JSON.stringify(row.item_accounting),row.outcome,row.retry_permission?1:0,row.reviewed_at_epoch,row.evidence_digest,row.record_digest,JSON.stringify(row)]);
        const [readback] = await sql(connection, '/* spec014:child:readback:reconciliation */ SELECT record_digest,record_json,row_version FROM storage_reconciliation_results WHERE id=?', [row.id]);
        const stored = parse(readback?.[0]?.record_json);
        if (!readback?.[0] || readback[0].record_digest !== row.record_digest || readback[0].row_version !== 1 || !same(stored, row)) throw fail(409, 'STORAGE_SQL_CHILD_RECONCILIATION_READBACK_MISMATCH', 'Reconciliation readback mismatch.');
        return { created: true, replay: false, reconciliation: stored, secrets_included: false };
      });
    },
  };
  Object.defineProperty(writer, BRAND, { value: true, enumerable: false });
  return Object.freeze(writer);
}

export function isCanonicalHostingerStorageSqlChildEvidenceWriter(value) {
  return value?.[BRAND] === true && value?.writer_version === HOSTINGER_STORAGE_SQL_CHILD_EVIDENCE_WRITER_VERSION && value?.schema_verified === true && value?.production_ready === false && value?.runtime_mounted === false && value?.foreign_keys_enabled === false && value?.provider_dispatch_allowed === false;
}
