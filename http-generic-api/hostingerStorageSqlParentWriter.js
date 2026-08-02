import { createHash } from 'node:crypto';

export const HOSTINGER_STORAGE_SQL_PARENT_WRITER_VERSION = 'spec014-hostinger-storage-sql-parent-writer-v1';

const BRAND = Symbol.for('mad4b.spec014.hostinger-storage-sql-parent-writer');
const LOCK_NAME = 'spec014:hostinger-storage-parent-writer';
const SHA256_RE = /^[0-9a-f]{64}$/u;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const UINT_RE = /^(?:0|[1-9][0-9]{0,19})$/u;
const RUN_STATES = new Set(['executing', 'readback_pending', 'reconciling', 'unknown_outcome', 'completed', 'failed']);
const TERMINAL_RUN_STATES = new Set(['completed', 'failed']);
const RUN_TRANSITIONS = Object.freeze({
  executing: new Set(['readback_pending', 'unknown_outcome', 'failed']),
  readback_pending: new Set(['reconciling', 'completed', 'failed']),
  reconciling: new Set(['completed', 'unknown_outcome', 'failed']),
  unknown_outcome: new Set(['reconciling', 'failed']),
  completed: new Set(),
  failed: new Set(),
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

function text(value, max = 512) {
  return String(value ?? '').trim().slice(0, max);
}

function safeId(value, field, { nullable = false, max = 256 } = {}) {
  const normalized = text(value, max);
  if (!normalized && nullable) return null;
  if (!SAFE_ID_RE.test(normalized) || normalized.length > max) {
    throw fail(400, 'STORAGE_SQL_PARENT_IDENTIFIER_INVALID', 'A safe bounded identifier is required.', { field });
  }
  return normalized;
}

function hash(value, field, { nullable = false } = {}) {
  const normalized = text(value, 64).toLowerCase();
  if (!normalized && nullable) return null;
  if (!SHA256_RE.test(normalized)) {
    throw fail(400, 'STORAGE_SQL_PARENT_HASH_INVALID', 'A lowercase SHA-256 binding is required.', { field });
  }
  return normalized;
}

function integer(value, field, { minimum = 0 } = {}) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < minimum) {
    throw fail(400, 'STORAGE_SQL_PARENT_INTEGER_INVALID', 'A bounded integer is required.', { field, minimum });
  }
  return normalized;
}

function uint64(value, field, { nullable = false } = {}) {
  if ((value === null || value === undefined || value === '') && nullable) return null;
  const normalized = String(value);
  if (!UINT_RE.test(normalized) || BigInt(normalized) > 18446744073709551615n) {
    throw fail(400, 'STORAGE_SQL_PARENT_UINT64_INVALID', 'An unsigned BIGINT-compatible value is required.', { field });
  }
  return normalized;
}

function pathRef(value, field, { nullable = false } = {}) {
  const normalized = text(value, 512);
  if (!normalized && nullable) return null;
  if (!normalized || normalized.includes('\0') || normalized.startsWith('/') || normalized.startsWith('~')
    || normalized.split(/[\\/]/u).includes('..')) {
    throw fail(400, 'STORAGE_SQL_PARENT_PATH_REF_INVALID', 'Only bounded root-relative path references are allowed.', { field });
  }
  return normalized;
}

function boolean(value, field) {
  if (typeof value !== 'boolean') {
    throw fail(400, 'STORAGE_SQL_PARENT_BOOLEAN_INVALID', 'An explicit boolean binding is required.', { field });
  }
  return value;
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

function assertSecretFree(value, at = 'value', depth = 0, ancestors = new WeakSet()) {
  if (depth > 20 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSecretFree(entry, `${at}[${index}]`, depth + 1, ancestors));
    return;
  }
  if (typeof value !== 'object') return;
  if (ancestors.has(value)) throw fail(400, 'STORAGE_SQL_PARENT_CYCLE_FORBIDDEN', 'Parent writer inputs cannot contain cycles.', { path: at });
  ancestors.add(value);
  try {
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'secrets_included' && entry !== false) {
        throw fail(400, 'STORAGE_SQL_PARENT_SECRET_DECLARATION_INVALID', 'Secret declaration must remain false.', { path: `${at}.${key}` });
      }
      if (key !== 'secrets_included' && /(password|passwd|secret_value|private[_-]?key|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization_header|cookie_header|raw_provider_payload|raw_environment|file_content|absolute_path|shell_command)/i.test(key)) {
        throw fail(400, 'STORAGE_SQL_PARENT_SECRET_OR_UNSAFE_FIELD_REJECTED', 'Parent writer inputs cannot contain secret-bearing or free-form execution fields.', { path: `${at}.${key}` });
      }
      assertSecretFree(entry, `${at}.${key}`, depth + 1, ancestors);
    }
  } finally {
    ancestors.delete(value);
  }
}

function assertSchemaVerification(value) {
  assertSecretFree(value, 'schema_verification');
  const blockers = Array.isArray(value?.blockers) ? value.blockers : [];
  if (value?.ready !== true || value?.schema_verified !== true || blockers.length !== 0) {
    throw fail(409, 'STORAGE_SQL_PARENT_SCHEMA_VERIFICATION_REQUIRED', 'A current successful signed schema verification result is required.', { blockers });
  }
  if (value?.production_ready !== false || value?.authority_granted !== false
    || value?.migration_apply_authorized !== false || value?.provider_dispatch_allowed !== false) {
    throw fail(409, 'STORAGE_SQL_PARENT_SCHEMA_VERIFICATION_BOUNDARY_INVALID', 'Schema verification must not grant production, migration, authority, or provider capability.');
  }
  const evidence = value.evidence || {};
  const normalized = {
    evidence_digest: hash(value.evidence_digest, 'schema_verification.evidence_digest'),
    source_commit: safeId(evidence.source_commit, 'schema_verification.source_commit', { max: 64 }),
    deployed_runtime_sha: safeId(evidence.deployed_runtime_sha, 'schema_verification.deployed_runtime_sha', { max: 64 }),
    runtime_parity: boolean(evidence.runtime_parity, 'schema_verification.runtime_parity'),
    readback_cycle_id: safeId(evidence.readback_cycle_id, 'schema_verification.readback_cycle_id'),
    readback_digest: hash(evidence.readback_digest, 'schema_verification.readback_digest'),
    migration_evidence_digest: hash(evidence.migration_evidence_digest, 'schema_verification.migration_evidence_digest'),
    database_fingerprint: hash(evidence.database_fingerprint, 'schema_verification.database_fingerprint'),
    verified_at: safeId(evidence.verified_at, 'schema_verification.verified_at'),
    expires_at: safeId(evidence.expires_at, 'schema_verification.expires_at'),
    secrets_included: false,
  };
  if (normalized.runtime_parity !== true || normalized.source_commit !== normalized.deployed_runtime_sha) {
    throw fail(409, 'STORAGE_SQL_PARENT_RUNTIME_PARITY_REQUIRED', 'Schema verification must prove exact deployed runtime parity.');
  }
  if (Date.parse(normalized.expires_at) <= Date.now()) {
    throw fail(409, 'STORAGE_SQL_PARENT_SCHEMA_VERIFICATION_EXPIRED', 'Schema verification evidence has expired.');
  }
  return deepFreeze(normalized);
}

function parseJson(value, field) {
  if (Buffer.isBuffer(value)) value = value.toString('utf8');
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch {
      throw fail(409, 'STORAGE_SQL_PARENT_RECORD_JSON_INVALID', 'Stored parent record JSON is invalid.', { field });
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function same(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function normalizeBooleanRow(value) {
  return value === true || Number(value) === 1;
}

function normalizeNullableNumber(value) {
  return value === null || value === undefined ? null : String(value);
}

export function deriveHostingerStoragePlanItemId({ plan_id, item_id, item_hash } = {}) {
  const planId = safeId(plan_id, 'plan_id');
  const itemId = safeId(item_id, 'item_id');
  const itemHash = hash(item_hash, 'item_hash');
  const hex = createHash('sha256').update(`${planId}\0${itemId}\0${itemHash}`, 'utf8').digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function normalizePlanItem(item, planId) {
  assertSecretFree(item, 'plan_item');
  const runtimeItemId = safeId(item.item_id ?? item.itemId, 'plan_item.item_id', { max: 191 });
  const itemHash = hash(item.item_hash ?? item.itemHash, 'plan_item.item_hash');
  const expected = item.expected || {};
  const deviceSource = item.device_id_digest ?? item.deviceIdDigest ?? expected.device_id_digest ?? expected.deviceIdDigest;
  const normalized = {
    id: deriveHostingerStoragePlanItemId({ plan_id: planId, item_id: runtimeItemId, item_hash: itemHash }),
    runtime_item_id: runtimeItemId,
    plan_id: planId,
    ordinal: integer(item.ordinal, 'plan_item.ordinal', { minimum: 1 }),
    category: safeId(item.category, 'plan_item.category', { max: 64 }),
    path_ref: pathRef(item.path_ref ?? item.pathRef, 'plan_item.path_ref'),
    tenant_safe_relative_path: pathRef(item.tenant_safe_relative_path ?? item.tenantSafeRelativePath, 'plan_item.tenant_safe_relative_path', { nullable: true }),
    size_bytes: uint64(item.size_bytes ?? item.sizeBytes ?? expected.size_bytes ?? expected.sizeBytes, 'plan_item.size_bytes'),
    device_id_digest: deviceSource ? hash(deviceSource, 'plan_item.device_id_digest') : null,
    inode_value: uint64(item.inode_value ?? item.inodeValue ?? expected.inode, 'plan_item.inode_value', { nullable: true }),
    ctime_ns: uint64(item.ctime_ns ?? item.ctimeNs, 'plan_item.ctime_ns', { nullable: true }),
    mtime_ns: uint64(item.mtime_ns ?? item.mtimeNs, 'plan_item.mtime_ns', { nullable: true }),
    expected_file_type: safeId(item.expected_file_type ?? item.expectedFileType ?? expected.file_type ?? expected.fileType, 'plan_item.expected_file_type', { max: 32 }),
    eligibility_rule_key: safeId(item.eligibility_rule_key ?? item.eligibilityRuleKey, 'plan_item.eligibility_rule_key', { max: 128 }),
    eligibility_evidence_digest: hash(item.eligibility_evidence_digest ?? item.eligibilityEvidenceDigest, 'plan_item.eligibility_evidence_digest'),
    ownership_evidence_ref: safeId(item.ownership_evidence_ref ?? item.ownershipEvidenceRef, 'plan_item.ownership_evidence_ref', { max: 191 }),
    protected_classification: boolean(item.protected_classification ?? item.protectedClassification ?? false, 'plan_item.protected_classification'),
    item_hash: itemHash,
    planned_result_state: safeId(item.planned_result_state ?? item.plannedResultState ?? 'pending', 'plan_item.planned_result_state', { max: 32 }),
    secrets_included: false,
  };
  if (normalized.protected_classification) {
    throw fail(409, 'STORAGE_SQL_PARENT_PROTECTED_ITEM_FORBIDDEN', 'Protected items cannot be registered for cleanup execution.', { item_id: runtimeItemId });
  }
  if (normalized.planned_result_state !== 'pending') {
    throw fail(409, 'STORAGE_SQL_PARENT_ITEM_STATE_INVALID', 'New plan-item parents must begin pending.', { item_id: runtimeItemId });
  }
  return deepFreeze(normalized);
}

function planItemSqlRow(item) {
  return {
    id: item.id,
    plan_id: item.plan_id,
    ordinal: item.ordinal,
    category: item.category,
    path_ref: item.path_ref,
    tenant_safe_relative_path: item.tenant_safe_relative_path,
    size_bytes: item.size_bytes,
    device_id_digest: item.device_id_digest,
    inode_value: item.inode_value,
    ctime_ns: item.ctime_ns,
    mtime_ns: item.mtime_ns,
    expected_file_type: item.expected_file_type,
    eligibility_rule_key: item.eligibility_rule_key,
    eligibility_evidence_digest: item.eligibility_evidence_digest,
    ownership_evidence_ref: item.ownership_evidence_ref,
    protected_classification: false,
    item_hash: item.item_hash,
    planned_result_state: item.planned_result_state,
  };
}

function normalizeStoredPlanItem(row) {
  return {
    id: text(row.id, 36),
    plan_id: text(row.plan_id, 36),
    ordinal: Number(row.ordinal),
    category: text(row.category, 64),
    path_ref: text(row.path_ref, 512),
    tenant_safe_relative_path: row.tenant_safe_relative_path === null || row.tenant_safe_relative_path === undefined ? null : text(row.tenant_safe_relative_path, 512),
    size_bytes: String(row.size_bytes),
    device_id_digest: row.device_id_digest || null,
    inode_value: normalizeNullableNumber(row.inode_value),
    ctime_ns: normalizeNullableNumber(row.ctime_ns),
    mtime_ns: normalizeNullableNumber(row.mtime_ns),
    expected_file_type: text(row.expected_file_type, 32),
    eligibility_rule_key: text(row.eligibility_rule_key, 128),
    eligibility_evidence_digest: text(row.eligibility_evidence_digest, 64),
    ownership_evidence_ref: text(row.ownership_evidence_ref, 191),
    protected_classification: normalizeBooleanRow(row.protected_classification),
    item_hash: text(row.item_hash, 64),
    planned_result_state: text(row.planned_result_state, 32),
  };
}

function normalizeRun(record) {
  assertSecretFree(record, 'run');
  const normalized = {
    id: safeId(record.run_id ?? record.runId, 'run.run_id', { max: 36 }),
    operation_id: safeId(record.operation_id ?? record.operationId, 'run.operation_id', { max: 36 }),
    plan_id: safeId(record.plan_id ?? record.planId, 'run.plan_id', { max: 36 }),
    target_id: safeId(record.target_id ?? record.targetId, 'run.target_id', { max: 36 }),
    lease_id: safeId(record.lease_id ?? record.leaseId, 'run.lease_id', { max: 36 }),
    lease_generation: integer(record.lease_generation ?? record.leaseGeneration, 'run.lease_generation', { minimum: 1 }),
    lease_expires_at_epoch: integer(record.lease_expires_at_epoch ?? record.leaseExpiresAtEpoch, 'run.lease_expires_at_epoch', { minimum: 1 }),
    run_generation: integer(record.run_generation ?? record.runGeneration, 'run.run_generation', { minimum: 1 }),
    adapter_key: safeId(record.adapter_key ?? record.adapterKey, 'run.adapter_key', { max: 128 }),
    adapter_version: safeId(record.adapter_version ?? record.adapterVersion, 'run.adapter_version', { max: 64 }),
    worker_ref: safeId(record.worker_ref ?? record.workerRef, 'run.worker_ref', { max: 191 }),
    connector_ref: safeId(record.connector_ref ?? record.connectorRef, 'run.connector_ref', { max: 191 }),
    dispatch_certification_ref: safeId(record.dispatch_certification_ref ?? record.dispatchCertificationRef, 'run.dispatch_certification_ref', { max: 191 }),
    host_key_evidence_ref: safeId(record.host_key_evidence_ref ?? record.hostKeyEvidenceRef, 'run.host_key_evidence_ref', { max: 191 }),
    started_at_epoch: integer(record.started_at_epoch ?? record.startedAtEpoch, 'run.started_at_epoch', { minimum: 1 }),
    finished_at_epoch: null,
    state: text(record.state ?? 'executing', 32).toLowerCase(),
    deleted_count: 0,
    deleted_bytes: '0',
    skipped_count: 0,
    missing_count: 0,
    failed_count: 0,
    journal_digest: hash(record.journal_digest ?? record.journalDigest, 'run.journal_digest'),
    checkpoint_digest: hash(record.checkpoint_digest ?? record.checkpointDigest, 'run.checkpoint_digest'),
    before_snapshot_id: safeId(record.before_snapshot_id ?? record.beforeSnapshotId, 'run.before_snapshot_id', { max: 36 }),
    after_snapshot_id: null,
    provider_response_classification: safeId(record.provider_response_classification ?? record.providerResponseClassification, 'run.provider_response_classification', { max: 64 }),
    unknown_outcome: false,
    readback_status: 'pending',
    result_digest: null,
    secrets_included: false,
  };
  if (normalized.state !== 'executing') {
    throw fail(409, 'STORAGE_SQL_PARENT_RUN_INITIAL_STATE_INVALID', 'A new run parent must begin in executing state.');
  }
  if (normalized.lease_expires_at_epoch <= normalized.started_at_epoch) {
    throw fail(409, 'STORAGE_SQL_PARENT_LEASE_EXPIRED', 'Execution lease must remain valid when the run starts.');
  }
  return deepFreeze(normalized);
}

function runSqlRow(run) {
  return {
    id: run.id,
    operation_id: run.operation_id,
    plan_id: run.plan_id,
    run_generation: run.run_generation,
    adapter_key: run.adapter_key,
    adapter_version: run.adapter_version,
    worker_ref: run.worker_ref,
    connector_ref: run.connector_ref,
    dispatch_certification_ref: run.dispatch_certification_ref,
    host_key_evidence_ref: run.host_key_evidence_ref,
    started_at_epoch: run.started_at_epoch,
    finished_at_epoch: run.finished_at_epoch,
    state: run.state,
    deleted_count: run.deleted_count,
    deleted_bytes: run.deleted_bytes,
    skipped_count: run.skipped_count,
    missing_count: run.missing_count,
    failed_count: run.failed_count,
    journal_digest: run.journal_digest,
    checkpoint_digest: run.checkpoint_digest,
    before_snapshot_id: run.before_snapshot_id,
    after_snapshot_id: run.after_snapshot_id,
    provider_response_classification: run.provider_response_classification,
    unknown_outcome: run.unknown_outcome,
    readback_status: run.readback_status,
    result_digest: run.result_digest,
    secrets_included: false,
  };
}

function normalizeStoredRun(row) {
  return {
    id: text(row.id, 36),
    operation_id: text(row.operation_id, 36),
    plan_id: text(row.plan_id, 36),
    run_generation: Number(row.run_generation),
    adapter_key: text(row.adapter_key, 128),
    adapter_version: text(row.adapter_version, 64),
    worker_ref: text(row.worker_ref, 191),
    connector_ref: text(row.connector_ref, 191),
    dispatch_certification_ref: text(row.dispatch_certification_ref, 191),
    host_key_evidence_ref: text(row.host_key_evidence_ref, 191),
    started_at_epoch: Number(row.started_at_epoch),
    finished_at_epoch: row.finished_at_epoch === null || row.finished_at_epoch === undefined ? null : Number(row.finished_at_epoch),
    state: text(row.state, 32),
    deleted_count: Number(row.deleted_count),
    deleted_bytes: String(row.deleted_bytes),
    skipped_count: Number(row.skipped_count),
    missing_count: Number(row.missing_count),
    failed_count: Number(row.failed_count),
    journal_digest: text(row.journal_digest, 64),
    checkpoint_digest: text(row.checkpoint_digest, 64),
    before_snapshot_id: text(row.before_snapshot_id, 36),
    after_snapshot_id: row.after_snapshot_id || null,
    provider_response_classification: text(row.provider_response_classification, 64),
    unknown_outcome: normalizeBooleanRow(row.unknown_outcome),
    readback_status: text(row.readback_status, 32),
    result_digest: row.result_digest || null,
    secrets_included: false,
  };
}

async function execute(connection, sql, params = []) {
  const method = typeof connection.execute === 'function' ? 'execute' : 'query';
  if (typeof connection[method] !== 'function') {
    throw fail(500, 'STORAGE_SQL_PARENT_CONNECTION_INVALID', 'SQL connection must expose execute() or query().');
  }
  return connection[method](sql, params);
}

async function acquireLock(connection, timeoutSeconds) {
  const [rows] = await execute(connection, '/* spec014:parent:lock:acquire */ SELECT GET_LOCK(?, ?) AS acquired', [LOCK_NAME, timeoutSeconds]);
  if (Number(rows?.[0]?.acquired) !== 1) throw fail(409, 'STORAGE_SQL_PARENT_LOCK_UNAVAILABLE', 'Parent writer lock is unavailable.');
}

async function releaseLock(connection) {
  try { await execute(connection, '/* spec014:parent:lock:release */ SELECT RELEASE_LOCK(?) AS released', [LOCK_NAME]); } catch {
    // Connection release also releases the advisory lock. Never mask the primary result.
  }
}

function normalizeDriverError(error) {
  if (error?.code?.startsWith?.('STORAGE_')) return error;
  if (['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(error?.code)) {
    return fail(503, 'STORAGE_SQL_PARENT_SCHEMA_UNAVAILABLE', 'Execution parent schema is unavailable.', { mysql_code: error.code });
  }
  if (['ER_DUP_ENTRY', 'ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error?.code)) {
    return fail(409, 'STORAGE_SQL_PARENT_CONFLICT', 'Execution parent rows changed concurrently.', { mysql_code: error.code });
  }
  return error;
}

async function transaction(pool, timeoutSeconds, work) {
  if (!pool || typeof pool.getConnection !== 'function') {
    throw fail(500, 'STORAGE_SQL_PARENT_POOL_INVALID', 'A MySQL-compatible pool is required.');
  }
  const connection = await pool.getConnection();
  let began = false;
  let locked = false;
  try {
    if (typeof connection.beginTransaction !== 'function' || typeof connection.commit !== 'function' || typeof connection.rollback !== 'function') {
      throw fail(500, 'STORAGE_SQL_PARENT_CONNECTION_INVALID', 'Transactional SQL connection methods are required.');
    }
    await connection.beginTransaction();
    began = true;
    await acquireLock(connection, timeoutSeconds);
    locked = true;
    const result = await work(connection);
    await connection.commit();
    began = false;
    return result;
  } catch (error) {
    if (began) {
      try { await connection.rollback(); } catch { /* Never mask the primary error. */ }
    }
    throw normalizeDriverError(error);
  } finally {
    if (locked) await releaseLock(connection);
    if (typeof connection.release === 'function') connection.release();
  }
}

async function loadPlan(connection, planId) {
  const [rows] = await execute(connection, `/* spec014:parent:load-plan */
    SELECT id, operation_id, target_id, plan_hash, item_count, total_bytes, consumed, consumed_run_id, record_json
    FROM storage_cleanup_plans WHERE id=? FOR UPDATE`, [planId]);
  const row = rows?.[0];
  if (!row) throw fail(404, 'STORAGE_SQL_PARENT_PLAN_NOT_FOUND', 'Immutable plan row not found.', { plan_id: planId });
  const record = parseJson(row.record_json, 'storage_cleanup_plans.record_json');
  return {
    id: text(row.id || record.plan_id, 36),
    operation_id: text(row.operation_id || record.operation_id, 36),
    target_id: text(row.target_id || record.target_id, 36),
    plan_hash: text(row.plan_hash || record.plan_hash, 64).toLowerCase(),
    item_count: Number(row.item_count ?? record.item_count),
    total_bytes: String(row.total_bytes ?? record.total_bytes),
    consumed: normalizeBooleanRow(row.consumed ?? record.consumed),
    consumed_run_id: row.consumed_run_id ?? record.consumed_run_id ?? null,
  };
}

async function loadPlanItems(connection, planId) {
  const [rows] = await execute(connection, `/* spec014:parent:load-plan-items */
    SELECT id, plan_id, ordinal, category, path_ref, tenant_safe_relative_path, size_bytes,
      device_id_digest, inode_value, ctime_ns, mtime_ns, expected_file_type,
      eligibility_rule_key, eligibility_evidence_digest, ownership_evidence_ref,
      protected_classification, item_hash, planned_result_state
    FROM storage_cleanup_plan_items WHERE plan_id=? ORDER BY ordinal FOR UPDATE`, [planId]);
  return (Array.isArray(rows) ? rows : []).map(normalizeStoredPlanItem);
}

async function readbackPlanItems(connection, planId) {
  const [rows] = await execute(connection, `/* spec014:parent:readback-plan-items */
    SELECT id, plan_id, ordinal, category, path_ref, tenant_safe_relative_path, size_bytes,
      device_id_digest, inode_value, ctime_ns, mtime_ns, expected_file_type,
      eligibility_rule_key, eligibility_evidence_digest, ownership_evidence_ref,
      protected_classification, item_hash, planned_result_state
    FROM storage_cleanup_plan_items WHERE plan_id=? ORDER BY ordinal`, [planId]);
  return (Array.isArray(rows) ? rows : []).map(normalizeStoredPlanItem);
}

async function insertPlanItem(connection, item) {
  const row = planItemSqlRow(item);
  return execute(connection, `/* spec014:parent:insert-plan-item */ INSERT INTO storage_cleanup_plan_items (
      id, plan_id, ordinal, category, path_ref, tenant_safe_relative_path, size_bytes,
      device_id_digest, inode_value, ctime_ns, mtime_ns, expected_file_type,
      eligibility_rule_key, eligibility_evidence_digest, ownership_evidence_ref,
      protected_classification, item_hash, planned_result_state
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`, [
    row.id, row.plan_id, row.ordinal, row.category, row.path_ref, row.tenant_safe_relative_path, row.size_bytes,
    row.device_id_digest, row.inode_value, row.ctime_ns, row.mtime_ns, row.expected_file_type,
    row.eligibility_rule_key, row.eligibility_evidence_digest, row.ownership_evidence_ref,
    row.item_hash, row.planned_result_state,
  ]);
}

async function loadRun(connection, runId, { forUpdate = true } = {}) {
  const [rows] = await execute(connection, `/* spec014:parent:load-run */
    SELECT id, operation_id, plan_id, run_generation, adapter_key, adapter_version,
      worker_ref, connector_ref, dispatch_certification_ref, host_key_evidence_ref,
      started_at_epoch, finished_at_epoch, state, deleted_count, deleted_bytes,
      skipped_count, missing_count, failed_count, journal_digest, checkpoint_digest,
      before_snapshot_id, after_snapshot_id, provider_response_classification,
      unknown_outcome, readback_status, result_digest
    FROM storage_cleanup_runs WHERE id=?${forUpdate ? ' FOR UPDATE' : ''}`, [runId]);
  const candidates = Array.isArray(rows) ? rows : [];
if (candidates.length > 1) {
  throw fail(409, 'STORAGE_SQL_PARENT_RUN_AMBIGUOUS', 'Run identity resolved to multiple durable rows.', {
    run_id: runId,
    candidate_count: candidates.length,
  });
}
const [candidate] = candidates;
return candidate ? normalizeStoredRun(candidate) : null;
}

async function insertRun(connection, run) {
  const row = runSqlRow(run);
  return execute(connection, `/* spec014:parent:insert-run */ INSERT INTO storage_cleanup_runs (
      id, operation_id, plan_id, run_generation, adapter_key, adapter_version,
      worker_ref, connector_ref, dispatch_certification_ref, host_key_evidence_ref,
      started_at_epoch, finished_at_epoch, state, deleted_count, deleted_bytes,
      skipped_count, missing_count, failed_count, journal_digest, checkpoint_digest,
      before_snapshot_id, after_snapshot_id, provider_response_classification,
      unknown_outcome, readback_status, result_digest, secrets_included
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 0, 0, 0, 0, 0, ?, ?, ?, NULL, ?, 0, 'pending', NULL, 0)`, [
    row.id, row.operation_id, row.plan_id, row.run_generation, row.adapter_key, row.adapter_version,
    row.worker_ref, row.connector_ref, row.dispatch_certification_ref, row.host_key_evidence_ref,
    row.started_at_epoch, row.state, row.journal_digest, row.checkpoint_digest,
    row.before_snapshot_id, row.provider_response_classification,
  ]);
}

function normalizeFinalization(input, current) {
  assertSecretFree(input, 'run_finalization');
  const state = text(input.state, 32).toLowerCase();
  if (!RUN_STATES.has(state) || !RUN_TRANSITIONS[current.state]?.has(state)) {
    throw fail(409, 'STORAGE_SQL_PARENT_RUN_TRANSITION_INVALID', 'Run state transition is not allowed.', { current_state: current.state, next_state: state });
  }
  const normalized = {
    id: current.id,
    operation_id: current.operation_id,
    plan_id: current.plan_id,
    run_generation: current.run_generation,
    adapter_key: current.adapter_key,
    adapter_version: current.adapter_version,
    worker_ref: current.worker_ref,
    connector_ref: current.connector_ref,
    dispatch_certification_ref: current.dispatch_certification_ref,
    host_key_evidence_ref: current.host_key_evidence_ref,
    started_at_epoch: current.started_at_epoch,
    finished_at_epoch: integer(input.finished_at_epoch ?? input.finishedAtEpoch, 'run_finalization.finished_at_epoch', { minimum: current.started_at_epoch }),
    state,
    deleted_count: integer(input.deleted_count ?? input.deletedCount ?? 0, 'run_finalization.deleted_count'),
    deleted_bytes: uint64(input.deleted_bytes ?? input.deletedBytes ?? 0, 'run_finalization.deleted_bytes'),
    skipped_count: integer(input.skipped_count ?? input.skippedCount ?? 0, 'run_finalization.skipped_count'),
    missing_count: integer(input.missing_count ?? input.missingCount ?? 0, 'run_finalization.missing_count'),
    failed_count: integer(input.failed_count ?? input.failedCount ?? 0, 'run_finalization.failed_count'),
    journal_digest: hash(input.journal_digest ?? input.journalDigest, 'run_finalization.journal_digest'),
    checkpoint_digest: hash(input.checkpoint_digest ?? input.checkpointDigest, 'run_finalization.checkpoint_digest'),
    before_snapshot_id: current.before_snapshot_id,
    after_snapshot_id: safeId(input.after_snapshot_id ?? input.afterSnapshotId, 'run_finalization.after_snapshot_id', { max: 36, nullable: true }),
    provider_response_classification: safeId(input.provider_response_classification ?? input.providerResponseClassification, 'run_finalization.provider_response_classification', { max: 64 }),
    unknown_outcome: boolean(input.unknown_outcome ?? input.unknownOutcome ?? state === 'unknown_outcome', 'run_finalization.unknown_outcome'),
    readback_status: safeId(input.readback_status ?? input.readbackStatus, 'run_finalization.readback_status', { max: 32 }),
    result_digest: hash(input.result_digest ?? input.resultDigest, 'run_finalization.result_digest', { nullable: true }),
    secrets_included: false,
  };
  if (state === 'unknown_outcome' && normalized.unknown_outcome !== true) {
    throw fail(409, 'STORAGE_SQL_PARENT_UNKNOWN_OUTCOME_FLAG_REQUIRED', 'Unknown-outcome state requires the explicit flag.');
  }
  if (state !== 'unknown_outcome' && normalized.unknown_outcome === true) {
    throw fail(409, 'STORAGE_SQL_PARENT_UNKNOWN_OUTCOME_STATE_REQUIRED', 'Unknown-outcome flag is valid only for unknown-outcome state.');
  }
  if (TERMINAL_RUN_STATES.has(state) && !normalized.result_digest) {
    throw fail(409, 'STORAGE_SQL_PARENT_RESULT_DIGEST_REQUIRED', 'Terminal run state requires a result digest.');
  }
  return deepFreeze(normalized);
}

async function updateRun(connection, run, expectedCheckpointDigest) {
  const row = runSqlRow(run);
  const [result] = await execute(connection, `/* spec014:parent:update-run */ UPDATE storage_cleanup_runs SET
      finished_at_epoch=?, state=?, deleted_count=?, deleted_bytes=?, skipped_count=?, missing_count=?, failed_count=?,
      journal_digest=?, checkpoint_digest=?, after_snapshot_id=?, provider_response_classification=?,
      unknown_outcome=?, readback_status=?, result_digest=?
    WHERE id=? AND checkpoint_digest=?`, [
    row.finished_at_epoch, row.state, row.deleted_count, row.deleted_bytes, row.skipped_count, row.missing_count, row.failed_count,
    row.journal_digest, row.checkpoint_digest, row.after_snapshot_id, row.provider_response_classification,
    row.unknown_outcome ? 1 : 0, row.readback_status, row.result_digest, row.id, expectedCheckpointDigest,
  ]);
  if (Number(result?.affectedRows) !== 1) {
    throw fail(409, 'STORAGE_SQL_PARENT_RUN_CHECKPOINT_CONFLICT', 'Run checkpoint changed concurrently.', { run_id: row.id });
  }
}

async function requireSnapshot(connection, snapshotId, field) {
  if (!snapshotId) return;
  const [rows] = await execute(connection, '/* spec014:parent:load-snapshot */ SELECT id FROM storage_pressure_snapshots WHERE id=? FOR UPDATE', [snapshotId]);
  if (!rows?.[0]) throw fail(409, 'STORAGE_SQL_PARENT_SNAPSHOT_REQUIRED', 'Bound storage pressure snapshot is missing.', { field, snapshot_id: snapshotId });
}

export function createMySqlHostingerStorageSqlParentWriter({
  pool,
  schema_verification,
  lock_timeout_seconds = 5,
} = {}) {
  const verification = assertSchemaVerification(schema_verification);
  const lockTimeoutSeconds = integer(lock_timeout_seconds, 'lock_timeout_seconds');

  async function registerPlanItems({ plan_id, expected_plan_hash, items } = {}) {
    assertSecretFree({ plan_id, expected_plan_hash, items, secrets_included: false }, 'register_plan_items');
    const planId = safeId(plan_id, 'plan_id', { max: 36 });
    const expectedPlanHash = hash(expected_plan_hash, 'expected_plan_hash');
    if (!Array.isArray(items) || items.length < 1) {
      throw fail(400, 'STORAGE_SQL_PARENT_PLAN_ITEMS_REQUIRED', 'At least one canonical plan item is required.');
    }
    const normalized = items.map((item) => normalizePlanItem(item, planId)).sort((a, b) => a.ordinal - b.ordinal);
    const ordinals = normalized.map((item) => item.ordinal);
    if (ordinals.some((value, index) => value !== index + 1)) {
      throw fail(409, 'STORAGE_SQL_PARENT_PLAN_ITEM_ORDINAL_GAP', 'Plan-item ordinals must be contiguous from one.', { ordinals });
    }
    if (new Set(normalized.map((item) => item.runtime_item_id)).size !== normalized.length
      || new Set(normalized.map((item) => item.item_hash)).size !== normalized.length
      || new Set(normalized.map((item) => item.id)).size !== normalized.length) {
      throw fail(409, 'STORAGE_SQL_PARENT_PLAN_ITEM_DUPLICATE', 'Plan items must have unique runtime IDs, hashes, and derived parent IDs.');
    }
    const expectedRows = normalized.map(planItemSqlRow);
    const totalBytes = normalized.reduce((sum, item) => sum + BigInt(item.size_bytes), 0n).toString();

    return transaction(pool, lockTimeoutSeconds, async (connection) => {
      const plan = await loadPlan(connection, planId);
      if (plan.plan_hash !== expectedPlanHash) throw fail(409, 'STORAGE_SQL_PARENT_PLAN_HASH_MISMATCH', 'Plan hash changed before parent registration.');
      if (plan.item_count !== normalized.length || plan.total_bytes !== totalBytes) {
        throw fail(409, 'STORAGE_SQL_PARENT_PLAN_TOTALS_MISMATCH', 'Plan-item count or byte totals do not match the immutable plan.', {
          expected_item_count: plan.item_count,
          observed_item_count: normalized.length,
          expected_total_bytes: plan.total_bytes,
          observed_total_bytes: totalBytes,
        });
      }
      const existing = await loadPlanItems(connection, planId);
      if (existing.length) {
        if (!same(existing, expectedRows)) throw fail(409, 'STORAGE_SQL_PARENT_PLAN_ITEM_REPLAY_MISMATCH', 'Existing plan-item parents differ from the canonical plan.');
      } else {
        for (const item of normalized) await insertPlanItem(connection, item);
      }
      const readback = await readbackPlanItems(connection, planId);
      if (!same(readback, expectedRows)) throw fail(409, 'STORAGE_SQL_PARENT_PLAN_ITEM_READBACK_MISMATCH', 'Plan-item parent readback differs from the inserted canonical set.');
      const mapping = normalized.map((item) => ({ runtime_item_id: item.runtime_item_id, plan_item_id: item.id, item_hash: item.item_hash }));
      return deepFreeze({
        ok: true,
        created: existing.length === 0,
        replay: existing.length > 0,
        plan_id: planId,
        operation_id: plan.operation_id,
        target_id: plan.target_id,
        item_count: normalized.length,
        total_bytes: totalBytes,
        item_set_digest: digest(expectedRows),
        mapping,
        schema_verification_digest: verification.evidence_digest,
        production_ready: false,
        provider_dispatch_allowed: false,
        secrets_included: false,
      });
    });
  }

  async function startRun({ run } = {}) {
    assertSecretFree({ run, secrets_included: false }, 'start_run');
    const normalized = normalizeRun(run);
    return transaction(pool, lockTimeoutSeconds, async (connection) => {
      const existing = await loadRun(connection, normalized.id);
      if (existing) {
        if (!same(existing, runSqlRow(normalized))) throw fail(409, 'STORAGE_SQL_PARENT_RUN_REPLAY_MISMATCH', 'Existing run parent differs from the requested run envelope.');
        return deepFreeze({ ok: true, created: false, replay: true, run: existing, run_digest: digest(existing), production_ready: false, provider_dispatch_allowed: false, secrets_included: false });
      }
      const plan = await loadPlan(connection, normalized.plan_id);
      if (plan.operation_id !== normalized.operation_id || plan.target_id !== normalized.target_id) {
        throw fail(409, 'STORAGE_SQL_PARENT_RUN_PLAN_BINDING_MISMATCH', 'Run does not match the immutable plan operation or target.');
      }
      if (!plan.consumed || plan.consumed_run_id !== normalized.id) {
        throw fail(409, 'STORAGE_SQL_PARENT_PLAN_CONSUMPTION_REQUIRED', 'The immutable plan must be consumed by this exact run before parent creation.');
      }
      const planItems = await loadPlanItems(connection, normalized.plan_id);
      if (planItems.length !== plan.item_count) {
        throw fail(409, 'STORAGE_SQL_PARENT_PLAN_ITEM_SET_INCOMPLETE', 'All plan-item parents must exist before a run parent is created.', {
          expected_item_count: plan.item_count,
          observed_item_count: planItems.length,
        });
      }
      const [operationRows] = await execute(connection, `/* spec014:parent:load-operation */
        SELECT id, target_id, state FROM storage_cleanup_operations WHERE id=? FOR UPDATE`, [normalized.operation_id]);
      const operation = operationRows?.[0];
      if (!operation || text(operation.target_id, 36) !== normalized.target_id || text(operation.state, 64) !== 'executing') {
        throw fail(409, 'STORAGE_SQL_PARENT_OPERATION_EXECUTING_REQUIRED', 'Operation must exist, match the target, and be executing before run creation.');
      }
      const [leaseRows] = await execute(connection, `/* spec014:parent:load-lease */
        SELECT target_id, lease_id, operation_id, generation, status, expires_at_epoch
        FROM storage_execution_leases WHERE target_id=? FOR UPDATE`, [normalized.target_id]);
      const lease = leaseRows?.[0];
      if (!lease || text(lease.lease_id, 36) !== normalized.lease_id
        || text(lease.operation_id, 36) !== normalized.operation_id
        || Number(lease.generation) !== normalized.lease_generation
        || text(lease.status, 32) !== 'active'
        || Number(lease.expires_at_epoch) !== normalized.lease_expires_at_epoch
        || Number(lease.expires_at_epoch) <= normalized.started_at_epoch) {
        throw fail(409, 'STORAGE_SQL_PARENT_ACTIVE_LEASE_REQUIRED', 'Run creation requires the exact active unexpired execution lease.');
      }
      await requireSnapshot(connection, normalized.before_snapshot_id, 'before_snapshot_id');
      const [generationRows] = await execute(connection, `/* spec014:parent:load-run-generation */
        SELECT id, run_generation FROM storage_cleanup_runs
        WHERE operation_id=? ORDER BY run_generation DESC, id DESC LIMIT 1 FOR UPDATE`, [normalized.operation_id]);
      const latestGeneration = Number(generationRows?.[0]?.run_generation || 0);
      if (normalized.run_generation !== latestGeneration + 1) {
        throw fail(409, 'STORAGE_SQL_PARENT_RUN_GENERATION_CONFLICT', 'Run generation must advance monotonically by one.', {
          expected_generation: latestGeneration + 1,
          observed_generation: normalized.run_generation,
        });
      }
      await insertRun(connection, normalized);
      const readback = await loadRun(connection, normalized.id, { forUpdate: false });
      if (!readback || !same(readback, runSqlRow(normalized))) throw fail(409, 'STORAGE_SQL_PARENT_RUN_READBACK_MISMATCH', 'Run parent readback differs from the inserted envelope.');
      return deepFreeze({
        ok: true,
        created: true,
        replay: false,
        run: readback,
        run_digest: digest(readback),
        plan_item_count: planItems.length,
        schema_verification_digest: verification.evidence_digest,
        production_ready: false,
        provider_dispatch_allowed: false,
        secrets_included: false,
      });
    });
  }

  async function finalizeRun({ run_id, expected_checkpoint_digest, finalization } = {}) {
    assertSecretFree({ run_id, expected_checkpoint_digest, finalization, secrets_included: false }, 'finalize_run');
    const runId = safeId(run_id, 'run_id', { max: 36 });
    const expectedCheckpointDigest = hash(expected_checkpoint_digest, 'expected_checkpoint_digest');
    return transaction(pool, lockTimeoutSeconds, async (connection) => {
      const current = await loadRun(connection, runId);
      if (!current) throw fail(404, 'STORAGE_SQL_PARENT_RUN_NOT_FOUND', 'Run parent not found.', { run_id: runId });
      if (current.checkpoint_digest !== expectedCheckpointDigest) {
        throw fail(409, 'STORAGE_SQL_PARENT_RUN_CHECKPOINT_CONFLICT', 'Run checkpoint changed before finalization.', { run_id: runId });
      }
      const next = normalizeFinalization(finalization, current);
      const planItems = await loadPlanItems(connection, current.plan_id);
      const accountedItems = next.deleted_count + next.skipped_count + next.missing_count + next.failed_count;
      if (accountedItems > planItems.length || (TERMINAL_RUN_STATES.has(next.state) && accountedItems !== planItems.length)) {
        throw fail(409, 'STORAGE_SQL_PARENT_RUN_ACCOUNTING_MISMATCH', 'Run accounting must be bounded and terminal accounting must cover every plan item.', {
          plan_item_count: planItems.length,
          accounted_items: accountedItems,
        });
      }
      await requireSnapshot(connection, next.after_snapshot_id, 'after_snapshot_id');
      await updateRun(connection, next, expectedCheckpointDigest);
      const readback = await loadRun(connection, runId, { forUpdate: false });
      if (!readback || !same(readback, runSqlRow(next))) throw fail(409, 'STORAGE_SQL_PARENT_RUN_READBACK_MISMATCH', 'Final run readback differs from the requested transition.');
      return deepFreeze({
        ok: true,
        run: readback,
        run_digest: digest(readback),
        accounted_items: accountedItems,
        plan_item_count: planItems.length,
        schema_verification_digest: verification.evidence_digest,
        production_ready: false,
        provider_dispatch_allowed: false,
        secrets_included: false,
      });
    });
  }

  return deepFreeze({
    [BRAND]: true,
    writer_key: 'hostinger_storage_sql_parent_writer_v1',
    writer_version: HOSTINGER_STORAGE_SQL_PARENT_WRITER_VERSION,
    schema_verified: true,
    schema_verification_digest: verification.evidence_digest,
    database_fingerprint: verification.database_fingerprint,
    production_ready: false,
    runtime_mounted: false,
    provider_dispatch_allowed: false,
    migration_apply_authorized: false,
    registerPlanItems,
    startRun,
    finalizeRun,
    secrets_included: false,
  });
}

export function isCanonicalMySqlHostingerStorageSqlParentWriter(value) {
  return Boolean(value?.[BRAND] === true
    && value?.writer_key === 'hostinger_storage_sql_parent_writer_v1'
    && value?.writer_version === HOSTINGER_STORAGE_SQL_PARENT_WRITER_VERSION
    && value?.production_ready === false
    && value?.provider_dispatch_allowed === false);
}
