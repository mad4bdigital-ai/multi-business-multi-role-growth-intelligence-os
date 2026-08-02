import {
  HOSTINGER_STORAGE_CONTROL_PLANE_REPOSITORY_VERSION,
  HOSTINGER_STORAGE_SQL_PERSISTENCE_ADAPTER_VERSION,
  createHostingerStorageControlPlaneRepository,
  createMySqlHostingerStoragePersistenceAdapter,
  isCanonicalHostingerStorageControlPlaneRepository,
  isCanonicalMySqlHostingerStoragePersistenceAdapter,
} from './hostingerStorageControlPlaneRepository.js';
import {
  HOSTINGER_STORAGE_SQL_PARENT_WRITER_VERSION,
  createMySqlHostingerStorageSqlParentWriter,
  isCanonicalMySqlHostingerStorageSqlParentWriter,
} from './hostingerStorageSqlParentWriter.js';
import {
  HOSTINGER_STORAGE_SQL_CHILD_EVIDENCE_WRITER_VERSION,
  createHostingerStorageSqlChildEvidenceWriter,
  isCanonicalHostingerStorageSqlChildEvidenceWriter,
} from './hostingerStorageSqlChildEvidenceWriter.js';
import {
  HOSTINGER_STORAGE_SQL_RUN_READER_VERSION,
  createHostingerStorageSqlRunReader,
  isCanonicalHostingerStorageSqlRunReader,
} from './hostingerStorageSqlRunReader.js';

export const HOSTINGER_STORAGE_VERIFIED_SQL_RUNTIME_COMPOSITION_VERSION = 'spec014-hostinger-storage-verified-sql-runtime-composition-v1';

const BRAND = Symbol.for('mad4b.spec014.hostinger-storage-verified-sql-runtime-composition');
const SHA256_RE = /^[0-9a-f]{64}$/u;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const ALLOWED_OPTIONS = new Set(['pool', 'schema_verification', 'lock_timeout_seconds']);

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

function hash(value, field) {
  const result = text(value, 64).toLowerCase();
  if (!SHA256_RE.test(result)) {
    throw fail(400, 'STORAGE_VERIFIED_SQL_COMPOSITION_HASH_INVALID', 'A lowercase SHA-256 binding is required.', { field });
  }
  return result;
}

function identifier(value, field, max = 256) {
  const result = text(value, max);
  if (!SAFE_ID_RE.test(result) || result.length > max) {
    throw fail(400, 'STORAGE_VERIFIED_SQL_COMPOSITION_IDENTIFIER_INVALID', 'A safe bounded identifier is required.', { field });
  }
  return result;
}

function assertSecretFree(value, path = 'schema_verification', depth = 0) {
  if (depth > 20 || value === null || value === undefined) return;
  if (Array.isArray(value)) return value.forEach((entry, index) => assertSecretFree(entry, `${path}[${index}]`, depth + 1));
  if (typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'secrets_included' && entry !== false) {
      throw fail(400, 'STORAGE_VERIFIED_SQL_COMPOSITION_SECRET_DECLARATION_INVALID', 'Secret declaration must remain false.', { path: `${path}.${key}` });
    }
    if (key !== 'secrets_included' && /(password|passwd|secret_value|private[_-]?key|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization_header|cookie_header|raw_provider_payload|raw_environment|file_content|absolute_path|shell_command)/i.test(key)) {
      throw fail(400, 'STORAGE_VERIFIED_SQL_COMPOSITION_SECRET_OR_UNSAFE_FIELD_REJECTED', 'Composition evidence cannot contain secrets or free-form execution fields.', { path: `${path}.${key}` });
    }
    assertSecretFree(entry, `${path}.${key}`, depth + 1);
  }
}

function normalizeVerification(value) {
  assertSecretFree(value);
  if (value?.ready !== true || value?.schema_verified !== true || !Array.isArray(value?.blockers) || value.blockers.length !== 0) {
    throw fail(409, 'STORAGE_VERIFIED_SQL_COMPOSITION_SCHEMA_VERIFICATION_REQUIRED', 'Current successful signed schema verification with zero blockers is required.');
  }
  if (value.production_ready !== false || value.authority_granted !== false
    || value.migration_apply_authorized !== false || value.provider_dispatch_allowed !== false) {
    throw fail(409, 'STORAGE_VERIFIED_SQL_COMPOSITION_SCHEMA_BOUNDARY_INVALID', 'Schema verification cannot grant production, authority, migration, or provider capability.');
  }
  const evidence = value.evidence || {};
  const normalized = Object.freeze({
    evidence_digest: hash(value.evidence_digest, 'schema_verification.evidence_digest'),
    source_commit: identifier(evidence.source_commit, 'schema_verification.source_commit', 64),
    deployed_runtime_sha: identifier(evidence.deployed_runtime_sha, 'schema_verification.deployed_runtime_sha', 64),
    database_fingerprint: hash(evidence.database_fingerprint, 'schema_verification.database_fingerprint'),
    readback_cycle_id: identifier(evidence.readback_cycle_id, 'schema_verification.readback_cycle_id'),
    expires_at: identifier(evidence.expires_at, 'schema_verification.expires_at'),
    secrets_included: false,
  });
  if (evidence.runtime_parity !== true || normalized.source_commit !== normalized.deployed_runtime_sha) {
    throw fail(409, 'STORAGE_VERIFIED_SQL_COMPOSITION_RUNTIME_PARITY_REQUIRED', 'Exact deployed runtime parity is required.');
  }
  if (!Number.isFinite(Date.parse(normalized.expires_at)) || Date.parse(normalized.expires_at) <= Date.now()) {
    throw fail(409, 'STORAGE_VERIFIED_SQL_COMPOSITION_SCHEMA_VERIFICATION_EXPIRED', 'Schema verification is expired or invalid.');
  }
  return normalized;
}

function facet(methods) {
  return Object.freeze(Object.fromEntries(Object.entries(methods).map(([name, method]) => [name, (...args) => method(...args)])));
}

export function createHostingerStorageVerifiedSqlRuntimeComposition(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw fail(500, 'STORAGE_VERIFIED_SQL_COMPOSITION_OPTIONS_INVALID', 'Composition options must be an object.');
  }
  const unsupported = Object.keys(options).filter((key) => !ALLOWED_OPTIONS.has(key));
  if (unsupported.length) {
    throw fail(409, 'STORAGE_VERIFIED_SQL_COMPOSITION_COMPONENT_OVERRIDE_FORBIDDEN', 'Raw component overrides and unknown options are forbidden.', { unsupported_options: unsupported.sort() });
  }
  const { pool, schema_verification, lock_timeout_seconds = 5 } = options;
  if (!pool || typeof pool.getConnection !== 'function') {
    throw fail(500, 'STORAGE_VERIFIED_SQL_COMPOSITION_POOL_INVALID', 'A mysql2-compatible pool is required.');
  }
  if (!Number.isInteger(lock_timeout_seconds) || lock_timeout_seconds < 1 || lock_timeout_seconds > 30) {
    throw fail(500, 'STORAGE_VERIFIED_SQL_COMPOSITION_LOCK_TIMEOUT_INVALID', 'SQL lock timeout must be between 1 and 30 seconds.');
  }
  const verification = normalizeVerification(schema_verification);

  const adapter = createMySqlHostingerStoragePersistenceAdapter({ pool, lock_timeout_seconds });
  const repository = createHostingerStorageControlPlaneRepository({ adapter });
  const parentWriter = createMySqlHostingerStorageSqlParentWriter({ pool, schema_verification, lock_timeout_seconds });
  const childWriter = createHostingerStorageSqlChildEvidenceWriter({ pool, schema_verification, lock_timeout_seconds });
  const runReader = createHostingerStorageSqlRunReader({ pool, schema_verification });

  if (!isCanonicalMySqlHostingerStoragePersistenceAdapter(adapter)
    || !isCanonicalHostingerStorageControlPlaneRepository(repository)
    || !isCanonicalMySqlHostingerStorageSqlParentWriter(parentWriter)
    || !isCanonicalHostingerStorageSqlChildEvidenceWriter(childWriter)
    || !isCanonicalHostingerStorageSqlRunReader(runReader)) {
    throw fail(500, 'STORAGE_VERIFIED_SQL_COMPOSITION_COMPONENT_INVALID', 'Every composed SQL component must be canonical.');
  }
  if (parentWriter.schema_verification_digest !== verification.evidence_digest
    || parentWriter.database_fingerprint !== verification.database_fingerprint
    || childWriter.schema_verification.evidence_digest !== verification.evidence_digest
    || childWriter.schema_verification.database_fingerprint !== verification.database_fingerprint
    || childWriter.schema_verification.source_commit !== verification.source_commit
    || childWriter.schema_verification.deployed_runtime_sha !== verification.deployed_runtime_sha
    || runReader.schema_verification_digest !== verification.evidence_digest
    || runReader.database_fingerprint !== verification.database_fingerprint) {
    throw fail(409, 'STORAGE_VERIFIED_SQL_COMPOSITION_PROVENANCE_MISMATCH', 'Composed readers and writers do not share one schema-verification provenance.');
  }

  const controlPlane = facet({
    createOperation: repository.createOperation,
    transitionOperation: repository.transitionOperation,
    persistImmutablePlan: repository.persistImmutablePlan,
    appendApproval: repository.appendApproval,
    invalidateApprovals: repository.invalidateApprovals,
    acquireLease: repository.acquireLease,
    renewLease: repository.renewLease,
    releaseLease: repository.releaseLease,
    consumePlan: repository.consumePlan,
    readAggregate: repository.readAggregate,
    exportSnapshot: repository.exportSnapshot,
  });
  const executionParents = facet({
    registerPlanItems: parentWriter.registerPlanItems,
    startRun: parentWriter.startRun,
    finalizeRun: parentWriter.finalizeRun,
    readRun: runReader.readRun,
  });
  const childEvidence = facet({
    appendJournalEvent: childWriter.appendJournalEvent,
    appendReconciliation: childWriter.appendReconciliation,
  });

  const composition = {
    composition_key: 'hostinger_storage_verified_sql_runtime_composition_v1',
    composition_version: HOSTINGER_STORAGE_VERIFIED_SQL_RUNTIME_COMPOSITION_VERSION,
    schema_verified: true,
    schema_provenance: verification,
    component_versions: Object.freeze({
      repository: HOSTINGER_STORAGE_CONTROL_PLANE_REPOSITORY_VERSION,
      adapter: HOSTINGER_STORAGE_SQL_PERSISTENCE_ADAPTER_VERSION,
      parent_writer: HOSTINGER_STORAGE_SQL_PARENT_WRITER_VERSION,
      child_writer: HOSTINGER_STORAGE_SQL_CHILD_EVIDENCE_WRITER_VERSION,
      run_reader: HOSTINGER_STORAGE_SQL_RUN_READER_VERSION,
    }),
    control_plane: controlPlane,
    execution_parents: executionParents,
    child_evidence: childEvidence,
    raw_components_exposed: false,
    legacy_child_write_paths_exposed: false,
    duplicate_write_paths_allowed: false,
    runtime_mounted: false,
    route_mounted: false,
    worker_mounted: false,
    live_database_access_performed_by_factory: false,
    foreign_keys_enabled: false,
    migration_apply_authorized: false,
    provider_dispatch_allowed: false,
    production_ready: false,
    secrets_included: false,
  };
  Object.defineProperty(composition, BRAND, { value: true, enumerable: false });
  return Object.freeze(composition);
}

export function isCanonicalHostingerStorageVerifiedSqlRuntimeComposition(value) {
  return Boolean(value?.[BRAND] === true
    && Object.isFrozen(value)
    && value?.composition_key === 'hostinger_storage_verified_sql_runtime_composition_v1'
    && value?.composition_version === HOSTINGER_STORAGE_VERIFIED_SQL_RUNTIME_COMPOSITION_VERSION
    && value?.schema_verified === true
    && value?.raw_components_exposed === false
    && value?.legacy_child_write_paths_exposed === false
    && value?.duplicate_write_paths_allowed === false
    && value?.runtime_mounted === false
    && value?.route_mounted === false
    && value?.worker_mounted === false
    && value?.foreign_keys_enabled === false
    && value?.migration_apply_authorized === false
    && value?.provider_dispatch_allowed === false
    && value?.production_ready === false
    && typeof value?.control_plane?.createOperation === 'function'
    && typeof value?.control_plane?.appendJournalEvent === 'undefined'
    && typeof value?.control_plane?.recordReconciliation === 'undefined'
    && typeof value?.execution_parents?.registerPlanItems === 'function'
    && typeof value?.execution_parents?.readRun === 'function'
    && typeof value?.child_evidence?.appendJournalEvent === 'function'
    && typeof value?.child_evidence?.appendReconciliation === 'function');
}
