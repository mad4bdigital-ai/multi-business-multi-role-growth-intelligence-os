import { createHash } from 'node:crypto';

export const HOSTINGER_STORAGE_SQL_RUN_READER_VERSION = 'spec014-hostinger-storage-sql-run-reader-v1';

const BRAND = Symbol.for('mad4b.spec014.hostinger-storage-sql-run-reader');
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const UINT64_RE = /^(?:0|[1-9][0-9]{0,19})$/u;
const ALLOWED_OPTIONS = new Set(['pool', 'schema_verification']);

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

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function text(value, max = 512) {
  return String(value ?? '').trim().slice(0, max);
}

function identifier(value, field, { nullable = false, max = 256 } = {}) {
  const normalized = text(value, max);
  if (!normalized && nullable) return null;
  if (!SAFE_ID_RE.test(normalized) || normalized.length > max) {
    throw fail(400, 'STORAGE_SQL_RUN_READER_IDENTIFIER_INVALID', 'A safe bounded identifier is required.', { field });
  }
  return normalized;
}

function hash(value, field, { nullable = false } = {}) {
  const normalized = text(value, 64).toLowerCase();
  if (!normalized && nullable) return null;
  if (!SHA256_RE.test(normalized)) {
    throw fail(400, 'STORAGE_SQL_RUN_READER_HASH_INVALID', 'A lowercase SHA-256 binding is required.', { field });
  }
  return normalized;
}

function integer(value, field, minimum = 0) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < minimum) {
    throw fail(409, 'STORAGE_SQL_RUN_READER_INTEGER_INVALID', 'A bounded integer is required.', { field, minimum });
  }
  return normalized;
}

function uint64(value, field, { nullable = false } = {}) {
  if ((value === null || value === undefined || value === '') && nullable) return null;
  const normalized = String(value ?? '');
  if (!UINT64_RE.test(normalized) || BigInt(normalized) > 18446744073709551615n) {
    throw fail(409, 'STORAGE_SQL_RUN_READER_UINT64_INVALID', 'An unsigned BIGINT-compatible value is required.', { field });
  }
  return normalized;
}

function bool(value) {
  return value === true || value === 1 || value === '1';
}

function pathRef(value, field, { nullable = false } = {}) {
  const normalized = text(value, 512);
  if (!normalized && nullable) return null;
  if (!normalized || normalized.includes('\0') || normalized.startsWith('/') || normalized.startsWith('~')
    || normalized.split(/[\\/]/u).includes('..')) {
    throw fail(409, 'STORAGE_SQL_RUN_READER_PATH_REF_INVALID', 'Stored plan-item path reference is not a bounded root-relative reference.', { field });
  }
  return normalized;
}

function assertSecretFree(value, path = 'value', depth = 0) {
  if (depth > 20 || value === null || value === undefined) return;
  if (Array.isArray(value)) return value.forEach((entry, index) => assertSecretFree(entry, `${path}[${index}]`, depth + 1));
  if (typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'secrets_included' && entry !== false) {
      throw fail(400, 'STORAGE_SQL_RUN_READER_SECRET_DECLARATION_INVALID', 'Secret declaration must remain false.', { path: `${path}.${key}` });
    }
    if (key !== 'secrets_included' && /(password|passwd|secret_value|private[_-]?key|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization_header|cookie_header|raw_provider_payload|raw_environment|file_content|absolute_path|shell_command)/i.test(key)) {
      throw fail(400, 'STORAGE_SQL_RUN_READER_SECRET_OR_UNSAFE_FIELD_REJECTED', 'Run-reader inputs cannot contain secrets or free-form execution fields.', { path: `${path}.${key}` });
    }
    assertSecretFree(entry, `${path}.${key}`, depth + 1);
  }
}

function normalizeVerification(value) {
  assertSecretFree(value, 'schema_verification');
  if (value?.ready !== true || value?.schema_verified !== true || (value?.blockers || []).length !== 0) {
    throw fail(409, 'STORAGE_SQL_RUN_READER_SCHEMA_VERIFICATION_REQUIRED', 'Successful signed schema verification is required.');
  }
  if (value.production_ready !== false || value.authority_granted !== false
    || value.migration_apply_authorized !== false || value.provider_dispatch_allowed !== false) {
    throw fail(409, 'STORAGE_SQL_RUN_READER_SCHEMA_BOUNDARY_INVALID', 'Schema verification cannot grant production, authority, migration, or provider capability.');
  }
  const evidence = value.evidence || {};
  const normalized = {
    evidence_digest: hash(value.evidence_digest, 'schema_verification.evidence_digest'),
    source_commit: identifier(evidence.source_commit, 'schema_verification.source_commit', { max: 64 }),
    deployed_runtime_sha: identifier(evidence.deployed_runtime_sha, 'schema_verification.deployed_runtime_sha', { max: 64 }),
    runtime_parity: evidence.runtime_parity === true,
    database_fingerprint: hash(evidence.database_fingerprint, 'schema_verification.database_fingerprint'),
    readback_cycle_id: identifier(evidence.readback_cycle_id, 'schema_verification.readback_cycle_id'),
    expires_at: identifier(evidence.expires_at, 'schema_verification.expires_at', { max: 64 }),
    secrets_included: false,
  };
  if (!normalized.runtime_parity || normalized.source_commit !== normalized.deployed_runtime_sha) {
    throw fail(409, 'STORAGE_SQL_RUN_READER_RUNTIME_PARITY_REQUIRED', 'Exact deployed runtime parity is required.');
  }
  if (!Number.isFinite(Date.parse(normalized.expires_at)) || Date.parse(normalized.expires_at) <= Date.now()) {
    throw fail(409, 'STORAGE_SQL_RUN_READER_SCHEMA_VERIFICATION_EXPIRED', 'Schema verification expired or is invalid.');
  }
  return deepFreeze(normalized);
}

async function execute(connection, statement, params = []) {
  const method = typeof connection?.execute === 'function' ? 'execute' : 'query';
  if (typeof connection?.[method] !== 'function') {
    throw fail(500, 'STORAGE_SQL_RUN_READER_CONNECTION_INVALID', 'SQL connection must expose execute() or query().');
  }
  return connection[method](statement, params);
}

function normalizeDriverError(error) {
  if (error?.code?.startsWith?.('STORAGE_')) return error;
  if (['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(error?.code)) {
    return fail(503, 'STORAGE_SQL_RUN_READER_SCHEMA_UNAVAILABLE', 'Durable run schema is unavailable.', { mysql_code: error.code });
  }
  if (['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error?.code)) {
    return fail(409, 'STORAGE_SQL_RUN_READER_CONFLICT', 'Durable execution-parent read conflicted with a concurrent transaction.', { mysql_code: error.code });
  }
  return error;
}

function normalizeRun(row) {
  const run = {
    run_id: identifier(row.id, 'run.id', { max: 36 }),
    operation_id: identifier(row.operation_id, 'run.operation_id', { max: 36 }),
    plan_id: identifier(row.plan_id, 'run.plan_id', { max: 36 }),
    run_generation: integer(row.run_generation, 'run.run_generation', 1),
    adapter_key: identifier(row.adapter_key, 'run.adapter_key', { max: 128 }),
    adapter_version: identifier(row.adapter_version, 'run.adapter_version', { max: 64 }),
    worker_ref: identifier(row.worker_ref, 'run.worker_ref', { max: 191 }),
    connector_ref: identifier(row.connector_ref, 'run.connector_ref', { max: 191 }),
    dispatch_certification_ref: identifier(row.dispatch_certification_ref, 'run.dispatch_certification_ref', { max: 191 }),
    host_key_evidence_ref: identifier(row.host_key_evidence_ref, 'run.host_key_evidence_ref', { max: 191 }),
    started_at_epoch: integer(row.started_at_epoch, 'run.started_at_epoch'),
    finished_at_epoch: row.finished_at_epoch == null ? null : integer(row.finished_at_epoch, 'run.finished_at_epoch'),
    state: identifier(row.state, 'run.state', { max: 32 }),
    deleted_count: integer(row.deleted_count, 'run.deleted_count'),
    deleted_bytes: uint64(row.deleted_bytes ?? '0', 'run.deleted_bytes'),
    skipped_count: integer(row.skipped_count, 'run.skipped_count'),
    missing_count: integer(row.missing_count, 'run.missing_count'),
    failed_count: integer(row.failed_count, 'run.failed_count'),
    journal_digest: hash(row.journal_digest, 'run.journal_digest'),
    checkpoint_digest: hash(row.checkpoint_digest, 'run.checkpoint_digest'),
    before_snapshot_id: identifier(row.before_snapshot_id, 'run.before_snapshot_id', { nullable: true, max: 36 }),
    after_snapshot_id: identifier(row.after_snapshot_id, 'run.after_snapshot_id', { nullable: true, max: 36 }),
    provider_response_classification: identifier(row.provider_response_classification, 'run.provider_response_classification', { max: 64 }),
    unknown_outcome: bool(row.unknown_outcome),
    readback_status: identifier(row.readback_status, 'run.readback_status', { max: 32 }),
    result_digest: hash(row.result_digest, 'run.result_digest', { nullable: true }),
    secrets_included: false,
  };
  run.record_digest = digest(run);
  return deepFreeze(run);
}

function normalizePlanItem(row) {
  const item = {
    id: identifier(row.id, 'plan_item.id', { max: 36 }),
    plan_id: identifier(row.plan_id, 'plan_item.plan_id', { max: 36 }),
    ordinal: integer(row.ordinal, 'plan_item.ordinal', 1),
    category: identifier(row.category, 'plan_item.category', { max: 64 }),
    path_ref: pathRef(row.path_ref, 'plan_item.path_ref'),
    tenant_safe_relative_path: pathRef(row.tenant_safe_relative_path, 'plan_item.tenant_safe_relative_path', { nullable: true }),
    size_bytes: uint64(row.size_bytes, 'plan_item.size_bytes'),
    device_id_digest: hash(row.device_id_digest, 'plan_item.device_id_digest', { nullable: true }),
    inode_value: uint64(row.inode_value, 'plan_item.inode_value', { nullable: true }),
    ctime_ns: uint64(row.ctime_ns, 'plan_item.ctime_ns', { nullable: true }),
    mtime_ns: uint64(row.mtime_ns, 'plan_item.mtime_ns', { nullable: true }),
    expected_file_type: identifier(row.expected_file_type, 'plan_item.expected_file_type', { max: 32 }),
    eligibility_rule_key: identifier(row.eligibility_rule_key, 'plan_item.eligibility_rule_key', { max: 128 }),
    eligibility_evidence_digest: hash(row.eligibility_evidence_digest, 'plan_item.eligibility_evidence_digest'),
    ownership_evidence_ref: identifier(row.ownership_evidence_ref, 'plan_item.ownership_evidence_ref', { max: 191 }),
    protected_classification: bool(row.protected_classification),
    item_hash: hash(row.item_hash, 'plan_item.item_hash'),
    planned_result_state: identifier(row.planned_result_state, 'plan_item.planned_result_state', { max: 32 }),
    secrets_included: false,
  };
  if (item.protected_classification || item.planned_result_state !== 'pending') {
    throw fail(409, 'STORAGE_SQL_RUN_READER_PLAN_ITEM_STATE_INVALID', 'Durable plan-item parent is protected or not in the immutable pending state.', {
      plan_item_id: item.id,
      protected_classification: item.protected_classification,
      planned_result_state: item.planned_result_state,
    });
  }
  item.record_digest = digest(item);
  return deepFreeze(item);
}

export function createHostingerStorageSqlRunReader(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw fail(500, 'STORAGE_SQL_RUN_READER_OPTIONS_INVALID', 'Run-reader options must be an object.');
  }
  const unsupported = Object.keys(options).filter((key) => !ALLOWED_OPTIONS.has(key));
  if (unsupported.length) {
    throw fail(409, 'STORAGE_SQL_RUN_READER_OVERRIDE_FORBIDDEN', 'Only the pool and signed schema verification may be supplied.', { unsupported_options: unsupported.sort() });
  }
  const { pool, schema_verification } = options;
  if (!pool || typeof pool.getConnection !== 'function') {
    throw fail(500, 'STORAGE_SQL_RUN_READER_POOL_INVALID', 'A MySQL-compatible pool is required.');
  }
  const verification = normalizeVerification(schema_verification);

  async function readRun(input = {}) {
    assertSecretFree(input, 'read_run');
    const runId = identifier(input.run_id ?? input.runId, 'run_id', { max: 36 });
    const connection = await pool.getConnection();
    try {
      const [rows] = await execute(connection, `/* spec014:run-reader:read */ SELECT
        id, operation_id, plan_id, run_generation, adapter_key, adapter_version,
        worker_ref, connector_ref, dispatch_certification_ref, host_key_evidence_ref,
        started_at_epoch, finished_at_epoch, state, deleted_count, deleted_bytes,
        skipped_count, missing_count, failed_count, journal_digest, checkpoint_digest,
        before_snapshot_id, after_snapshot_id, provider_response_classification,
        unknown_outcome, readback_status, result_digest
        FROM storage_cleanup_runs WHERE id=?`, [runId]);
      if ((rows || []).length > 1) {
        throw fail(409, 'STORAGE_SQL_RUN_READER_ROW_AMBIGUOUS', 'Run identity resolved to multiple durable rows.', { run_id: runId });
      }
      const run = rows?.[0] ? normalizeRun(rows[0]) : null;
      return deepFreeze({
        found: run !== null,
        run,
        run_digest: run?.record_digest || null,
        schema_verification_digest: verification.evidence_digest,
        database_fingerprint: verification.database_fingerprint,
        runtime_mounted: false,
        provider_dispatch_allowed: false,
        production_ready: false,
        secrets_included: false,
      });
    } catch (error) {
      throw normalizeDriverError(error);
    } finally {
      connection.release?.();
    }
  }

  async function readPlanItems(input = {}) {
    assertSecretFree(input, 'read_plan_items');
    const planId = identifier(input.plan_id ?? input.planId, 'plan_id', { max: 36 });
    const connection = await pool.getConnection();
    try {
      const [rows] = await execute(connection, `/* spec014:run-reader:read-plan-items */ SELECT
        id, plan_id, ordinal, category, path_ref, tenant_safe_relative_path, size_bytes,
        device_id_digest, inode_value, ctime_ns, mtime_ns, expected_file_type,
        eligibility_rule_key, eligibility_evidence_digest, ownership_evidence_ref,
        protected_classification, item_hash, planned_result_state
        FROM storage_cleanup_plan_items WHERE plan_id=? ORDER BY ordinal, id`, [planId]);
      const items = (Array.isArray(rows) ? rows : []).map(normalizePlanItem);
      const ids = new Set();
      for (const [index, item] of items.entries()) {
        if (item.plan_id !== planId) {
          throw fail(409, 'STORAGE_SQL_RUN_READER_PLAN_ITEM_BINDING_MISMATCH', 'Plan-item parent belongs to another plan.', { plan_item_id: item.id });
        }
        if (ids.has(item.id)) {
          throw fail(409, 'STORAGE_SQL_RUN_READER_PLAN_ITEM_AMBIGUOUS', 'Plan-item identity resolved more than once.', { plan_item_id: item.id });
        }
        ids.add(item.id);
        if (item.ordinal !== index + 1) {
          throw fail(409, 'STORAGE_SQL_RUN_READER_PLAN_ITEM_ORDINAL_GAP', 'Plan-item ordinals must be contiguous from one.', {
            plan_id: planId,
            observed_ordinal: item.ordinal,
            expected_ordinal: index + 1,
          });
        }
      }
      const itemSetCore = items.map((item) => ({
        id: item.id,
        plan_id: item.plan_id,
        ordinal: item.ordinal,
        item_hash: item.item_hash,
        size_bytes: item.size_bytes,
        secrets_included: false,
      }));
      return deepFreeze({
        found: items.length > 0,
        plan_id: planId,
        items,
        item_count: items.length,
        item_set_digest: digest(itemSetCore),
        schema_verification_digest: verification.evidence_digest,
        database_fingerprint: verification.database_fingerprint,
        runtime_mounted: false,
        provider_dispatch_allowed: false,
        production_ready: false,
        secrets_included: false,
      });
    } catch (error) {
      throw normalizeDriverError(error);
    } finally {
      connection.release?.();
    }
  }

  const reader = {
    reader_key: 'hostinger_storage_sql_run_reader_v1',
    reader_version: HOSTINGER_STORAGE_SQL_RUN_READER_VERSION,
    schema_verified: true,
    schema_verification_digest: verification.evidence_digest,
    database_fingerprint: verification.database_fingerprint,
    runtime_mounted: false,
    route_mounted: false,
    worker_mounted: false,
    provider_dispatch_allowed: false,
    production_ready: false,
    readRun,
    readPlanItems,
    secrets_included: false,
  };
  Object.defineProperty(reader, BRAND, { value: true, enumerable: false });
  return Object.freeze(reader);
}

export function isCanonicalHostingerStorageSqlRunReader(value) {
  return Boolean(value?.[BRAND] === true
    && value?.reader_key === 'hostinger_storage_sql_run_reader_v1'
    && value?.reader_version === HOSTINGER_STORAGE_SQL_RUN_READER_VERSION
    && value?.schema_verified === true
    && value?.runtime_mounted === false
    && value?.route_mounted === false
    && value?.worker_mounted === false
    && value?.provider_dispatch_allowed === false
    && value?.production_ready === false
    && typeof value?.readRun === 'function'
    && typeof value?.readPlanItems === 'function'
    && Object.isFrozen(value));
}
