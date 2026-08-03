import { createHash } from 'node:crypto';

export const HOSTINGER_STORAGE_DEFERRED_CHILD_FK_READINESS_VERSION = 'spec014-hostinger-storage-deferred-child-fk-readiness-v1';

export const HOSTINGER_STORAGE_DEFERRED_CHILD_FK_CANDIDATE = Object.freeze({
  filename: '.github/contracts/spec014/deferred-schema/deferred-child-parent-foreign-keys.sql',
  checksum_sha256: '492a25d0b0202d133936fd73675e5c0f9c3ca8fafaef39ef0312e7e9c263e8d8',
  statement_count: 3,
  constraints: Object.freeze([
    Object.freeze({ name: 'fk_storage_cleanup_run_items_run', child_table: 'storage_cleanup_run_items', child_column: 'run_id', parent_table: 'storage_cleanup_runs', parent_column: 'id' }),
    Object.freeze({ name: 'fk_storage_cleanup_run_items_plan_item', child_table: 'storage_cleanup_run_items', child_column: 'plan_item_id', parent_table: 'storage_cleanup_plan_items', parent_column: 'id' }),
    Object.freeze({ name: 'fk_storage_reconciliation_results_run', child_table: 'storage_reconciliation_results', child_column: 'run_id', parent_table: 'storage_cleanup_runs', parent_column: 'id' }),
  ]),
});

export const HOSTINGER_STORAGE_DEFERRED_CHILD_FK_READBACK = Object.freeze({
  filename: '.github/contracts/spec014/deferred-schema/deferred-child-parent-fk-readback.sql',
  checksum_sha256: '699e1750f4aa4864a29745fc054a461c32f0296006068893cce210347c3cfc1e',
});

const SHA256_RE = /^[0-9a-f]{64}$/u;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const ZERO_METRICS = Object.freeze({
  journal_null_plan_item_id_count: 'LEGACY_NULL_PLAN_ITEM_ID_PRESENT',
  journal_orphan_run_count: 'JOURNAL_RUN_ORPHAN_PRESENT',
  journal_orphan_plan_item_count: 'JOURNAL_PLAN_ITEM_ORPHAN_PRESENT',
  journal_operation_mismatch_count: 'JOURNAL_OPERATION_PARENT_MISMATCH',
  journal_plan_mismatch_count: 'JOURNAL_PLAN_PARENT_MISMATCH',
  journal_duplicate_runtime_sequence_count: 'JOURNAL_RUNTIME_SEQUENCE_DUPLICATE',
  journal_duplicate_parent_sequence_count: 'JOURNAL_PARENT_SEQUENCE_DUPLICATE',
  journal_row_version_violation_count: 'JOURNAL_APPEND_ONLY_ROW_VERSION_VIOLATION',
  reconciliation_orphan_run_count: 'RECONCILIATION_RUN_ORPHAN_PRESENT',
  reconciliation_operation_mismatch_count: 'RECONCILIATION_OPERATION_PARENT_MISMATCH',
  reconciliation_row_version_violation_count: 'RECONCILIATION_APPEND_ONLY_ROW_VERSION_VIOLATION',
});
const TOTAL_METRICS = Object.freeze([
  'plan_items_total',
  'runs_total',
  'journal_rows_total',
  'reconciliation_rows_total',
]);

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

function identifier(value, field) {
  const result = text(value, 256);
  if (!SAFE_ID_RE.test(result)) throw fail(400, 'STORAGE_DEFERRED_FK_IDENTIFIER_INVALID', 'A safe bounded identifier is required.', { field });
  return result;
}

function hash(value, field) {
  const result = text(value, 64).toLowerCase();
  if (!SHA256_RE.test(result)) throw fail(400, 'STORAGE_DEFERRED_FK_HASH_INVALID', 'A lowercase SHA-256 binding is required.', { field });
  return result;
}

function integer(value, field) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw fail(400, 'STORAGE_DEFERRED_FK_INTEGER_INVALID', 'A non-negative bounded integer is required.', { field });
  return result;
}

function timestamp(value, field) {
  const result = text(value, 64);
  const epoch = Date.parse(result);
  if (!Number.isFinite(epoch)) throw fail(400, 'STORAGE_DEFERRED_FK_TIME_INVALID', 'A valid timestamp is required.', { field });
  return { value: result, epoch };
}

function assertSecretFree(value, path = 'value', depth = 0) {
  if (depth > 20 || value === null || value === undefined) return;
  if (Array.isArray(value)) return value.forEach((entry, index) => assertSecretFree(entry, `${path}[${index}]`, depth + 1));
  if (typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'secrets_included' && entry !== false) throw fail(400, 'STORAGE_DEFERRED_FK_SECRET_DECLARATION_INVALID', 'Secret declaration must remain false.', { path: `${path}.${key}` });
    if (key !== 'secrets_included' && /(password|passwd|secret_value|private[_-]?key|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization_header|cookie_header|raw_provider_payload|raw_environment|file_content|absolute_path|shell_command)/i.test(key)) {
      throw fail(400, 'STORAGE_DEFERRED_FK_SECRET_OR_UNSAFE_FIELD_REJECTED', 'Readiness evidence cannot contain secrets or free-form execution fields.', { path: `${path}.${key}` });
    }
    assertSecretFree(entry, `${path}.${key}`, depth + 1);
  }
}

function metricBlockers(metrics, { packet = false } = {}) {
  const blockers = [];
  for (const [metric, code] of Object.entries(ZERO_METRICS)) {
    const value = Number(metrics?.[metric]);
    if (!Number.isSafeInteger(value) || value < 0) {
      if (packet) throw fail(409, 'STORAGE_DEFERRED_FK_PACKET_TAMPERED', 'Readiness packet contains invalid metric values.', { metric });
      throw fail(400, 'STORAGE_DEFERRED_FK_INTEGER_INVALID', 'A non-negative bounded integer is required.', { field: `readback.metrics.${metric}` });
    }
    if (value !== 0) blockers.push(code);
  }
  return blockers.sort();
}

function normalizeSchemaVerification(value, nowEpoch) {
  assertSecretFree(value, 'schema_verification');
  if (value?.ready !== true || value?.schema_verified !== true || (value?.blockers || []).length !== 0) {
    throw fail(409, 'STORAGE_DEFERRED_FK_SCHEMA_VERIFICATION_REQUIRED', 'Current successful signed schema verification is required.');
  }
  if (value.production_ready !== false || value.authority_granted !== false || value.migration_apply_authorized !== false || value.provider_dispatch_allowed !== false) {
    throw fail(409, 'STORAGE_DEFERRED_FK_SCHEMA_BOUNDARY_INVALID', 'Schema verification cannot grant production, authority, migration, or provider capability.');
  }
  const evidence = value.evidence || {};
  const expires = timestamp(evidence.expires_at, 'schema_verification.expires_at');
  const result = {
    evidence_digest: hash(value.evidence_digest, 'schema_verification.evidence_digest'),
    source_commit: hash(evidence.source_commit, 'schema_verification.source_commit'),
    deployed_runtime_sha: hash(evidence.deployed_runtime_sha, 'schema_verification.deployed_runtime_sha'),
    runtime_parity: evidence.runtime_parity === true,
    database_fingerprint: hash(evidence.database_fingerprint, 'schema_verification.database_fingerprint'),
    readback_cycle_id: identifier(evidence.readback_cycle_id, 'schema_verification.readback_cycle_id'),
    expires_at: expires.value,
    secrets_included: false,
  };
  if (!result.runtime_parity || result.source_commit !== result.deployed_runtime_sha) throw fail(409, 'STORAGE_DEFERRED_FK_RUNTIME_PARITY_REQUIRED', 'Exact deployed runtime parity is required.');
  if (expires.epoch <= nowEpoch) throw fail(409, 'STORAGE_DEFERRED_FK_SCHEMA_VERIFICATION_EXPIRED', 'Schema verification has expired.');
  return Object.freeze(result);
}

function normalizeCandidate(value) {
  assertSecretFree(value, 'candidate');
  const normalized = {
    filename: text(value?.filename, 256),
    checksum_sha256: hash(value?.checksum_sha256, 'candidate.checksum_sha256'),
    statement_count: integer(value?.statement_count, 'candidate.statement_count'),
    constraints: Array.isArray(value?.constraints) ? value.constraints.map((row) => ({
      name: identifier(row.name, 'candidate.constraint.name'),
      child_table: identifier(row.child_table, 'candidate.constraint.child_table'),
      child_column: identifier(row.child_column, 'candidate.constraint.child_column'),
      parent_table: identifier(row.parent_table, 'candidate.constraint.parent_table'),
      parent_column: identifier(row.parent_column, 'candidate.constraint.parent_column'),
    })) : [],
    secrets_included: false,
  };
  if (normalized.filename !== HOSTINGER_STORAGE_DEFERRED_CHILD_FK_CANDIDATE.filename
    || normalized.checksum_sha256 !== HOSTINGER_STORAGE_DEFERRED_CHILD_FK_CANDIDATE.checksum_sha256
    || normalized.statement_count !== HOSTINGER_STORAGE_DEFERRED_CHILD_FK_CANDIDATE.statement_count
    || JSON.stringify(normalized.constraints) !== JSON.stringify(HOSTINGER_STORAGE_DEFERRED_CHILD_FK_CANDIDATE.constraints)) {
    throw fail(409, 'STORAGE_DEFERRED_FK_CANDIDATE_DRIFT', 'Deferred foreign-key candidate differs from the reviewed contract.');
  }
  return Object.freeze(normalized);
}

function normalizeReadback(value, schema, nowEpoch) {
  assertSecretFree(value, 'readback');
  if (value?.contract !== 'spec014.hostinger-storage-deferred-child-fk-readback.v1'
    || value?.read_only !== true || value?.external_writes !== 0 || value?.provider_calls !== 0
    || value?.secrets_included !== false) {
    throw fail(409, 'STORAGE_DEFERRED_FK_READBACK_CONTRACT_INVALID', 'Unexpected or unsafe deferred-FK readback contract.');
  }
  const observed = timestamp(value.observed_at, 'readback.observed_at');
  const expires = timestamp(value.expires_at, 'readback.expires_at');
  const normalized = {
    contract: value.contract,
    source_commit: hash(value.source_commit, 'readback.source_commit'),
    deployed_runtime_sha: hash(value.deployed_runtime_sha, 'readback.deployed_runtime_sha'),
    database_fingerprint: hash(value.database_fingerprint, 'readback.database_fingerprint'),
    readback_cycle_id: identifier(value.readback_cycle_id, 'readback.readback_cycle_id'),
    readback_sql_checksum_sha256: hash(value.readback_sql_checksum_sha256, 'readback.readback_sql_checksum_sha256'),
    observed_at: observed.value,
    expires_at: expires.value,
    metrics: {},
    read_only: true,
    external_writes: 0,
    provider_calls: 0,
    secrets_included: false,
  };
  if (normalized.source_commit !== schema.source_commit || normalized.deployed_runtime_sha !== schema.deployed_runtime_sha
    || normalized.database_fingerprint !== schema.database_fingerprint || normalized.readback_cycle_id !== schema.readback_cycle_id) {
    throw fail(409, 'STORAGE_DEFERRED_FK_READBACK_BINDING_MISMATCH', 'Readback belongs to a different runtime, database, or verification cycle.');
  }
  if (normalized.readback_sql_checksum_sha256 !== HOSTINGER_STORAGE_DEFERRED_CHILD_FK_READBACK.checksum_sha256) {
    throw fail(409, 'STORAGE_DEFERRED_FK_READBACK_SQL_DRIFT', 'Readback SQL checksum differs from the reviewed query.');
  }
  if (observed.epoch > nowEpoch || expires.epoch <= nowEpoch || expires.epoch <= observed.epoch) {
    throw fail(409, 'STORAGE_DEFERRED_FK_READBACK_FRESHNESS_INVALID', 'Readback freshness window is invalid.');
  }
  for (const key of [...TOTAL_METRICS, ...Object.keys(ZERO_METRICS)]) normalized.metrics[key] = integer(value.metrics?.[key], `readback.metrics.${key}`);
  return Object.freeze({ ...normalized, metrics: Object.freeze(normalized.metrics) });
}

export function buildHostingerStorageDeferredChildFkReadiness({ schema_verification, candidate, readback, now = Date.now() } = {}) {
  const nowEpoch = Number(now);
  if (!Number.isFinite(nowEpoch)) throw fail(400, 'STORAGE_DEFERRED_FK_NOW_INVALID', 'A valid evaluation time is required.');
  const schema = normalizeSchemaVerification(schema_verification, nowEpoch);
  const normalizedCandidate = normalizeCandidate(candidate);
  const normalizedReadback = normalizeReadback(readback, schema, nowEpoch);
  const blockers = metricBlockers(normalizedReadback.metrics);
  const core = {
    contract: 'spec014.hostinger-storage-deferred-child-fk-readiness.v1',
    version: HOSTINGER_STORAGE_DEFERRED_CHILD_FK_READINESS_VERSION,
    candidate: normalizedCandidate,
    schema_verification: schema,
    readback: normalizedReadback,
    blockers,
    ready_for_separate_authorization: blockers.length === 0,
    authorization_created: false,
    migration_apply_authorized: false,
    foreign_keys_enabled: false,
    live_database_access_performed_by_evaluator: false,
    runtime_mounted: false,
    provider_dispatch_allowed: false,
    production_ready: false,
    secrets_included: false,
  };
  return Object.freeze({ ...core, readiness_digest: digest(core) });
}

export function verifyHostingerStorageDeferredChildFkReadiness({ packet, expected_digest } = {}) {
  assertSecretFree(packet, 'packet');
  if (packet?.contract !== 'spec014.hostinger-storage-deferred-child-fk-readiness.v1'
    || packet?.version !== HOSTINGER_STORAGE_DEFERRED_CHILD_FK_READINESS_VERSION
    || packet?.authorization_created !== false || packet?.migration_apply_authorized !== false
    || packet?.foreign_keys_enabled !== false || packet?.live_database_access_performed_by_evaluator !== false
    || packet?.runtime_mounted !== false || packet?.provider_dispatch_allowed !== false
    || packet?.production_ready !== false || packet?.secrets_included !== false) {
    throw fail(409, 'STORAGE_DEFERRED_FK_PACKET_BOUNDARY_INVALID', 'Unexpected or unsafe readiness packet.');
  }
  if (!Array.isArray(packet.blockers)) throw fail(409, 'STORAGE_DEFERRED_FK_PACKET_TAMPERED', 'Readiness packet blockers are invalid.');
  const derivedBlockers = metricBlockers(packet.readback?.metrics, { packet: true });
  const suppliedBlockers = [...new Set(packet.blockers.map((value) => text(value, 128)))].sort();
  if (JSON.stringify(derivedBlockers) !== JSON.stringify(suppliedBlockers)
    || packet.ready_for_separate_authorization !== (derivedBlockers.length === 0)) {
    throw fail(409, 'STORAGE_DEFERRED_FK_PACKET_TAMPERED', 'Readiness packet metrics, blockers, and decision are inconsistent.');
  }
  const { readiness_digest: supplied, ...core } = packet;
  const observed = digest(core);
  if (supplied !== observed || expected_digest && hash(expected_digest, 'expected_digest') !== observed) {
    throw fail(409, 'STORAGE_DEFERRED_FK_PACKET_TAMPERED', 'Deferred-FK readiness packet digest mismatch.');
  }
  return Object.freeze({
    ok: true,
    valid: true,
    ready_for_separate_authorization: packet.ready_for_separate_authorization === true && packet.blockers.length === 0,
    observed_digest: observed,
    authorization_created: false,
    migration_apply_authorized: false,
    foreign_keys_enabled: false,
    production_ready: false,
    secrets_included: false,
  });
}
