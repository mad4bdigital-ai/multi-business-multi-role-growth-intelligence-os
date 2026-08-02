import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { splitMigrationSqlStatements } from './migrationSqlStatements.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const CONTRACTS_DIR = path.join(__dirname, '..', '.github', 'contracts', 'spec014');

export const HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_VERSION =
  'spec014-hostinger-storage-durable-injection-migration-candidate-v1';
export const HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_SOURCE_SHA =
  'a67c536785f3006521664019deb2d1d3bedd94b1';
export const HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE =
  '20260802_04_spec014_hostinger_storage_authorized_injection_state.sql';
export const HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_CHECKSUM =
  'fbc70636d07b2ae2e757ab20f48538746ea773bdba1c19e2604aeaa292b31981';
export const HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_DEPENDENCY =
  '20260802_03_spec014_hostinger_storage_execution_evidence.sql';
export const HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_DEPENDENCY_CHECKSUM =
  'cf484d413399bbd3a0ea9ff36155ceb8b369e1bd43c63c300a93a179e0a57096';

const CONTRACT_LOCAL_DDL = 'sql/hostinger-storage-durable-authorized-injection-state.sql';
const RUNTIME_CONTRACT = 'hostinger-storage-runtime-migrations.json';
const DEPENDENCY_REGISTRY = path.join(
  __dirname,
  'config',
  'governed-migration-dependencies.json',
);
const EXPECTED_TABLES = Object.freeze([
  'storage_authorized_injection_states',
  'storage_authorized_injection_rollbacks',
]);
const SHA40_RE = /^[0-9a-f]{40}$/u;

function candidateError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = Object.freeze({ ...details, secrets_included: false });
  return error;
}

function sha256(value) {
  return createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function exactSourceSha(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!SHA40_RE.test(normalized)) {
    throw candidateError(
      'STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_SOURCE_INVALID',
      'A lowercase 40-character source SHA is required.',
    );
  }
  if (normalized !== HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_SOURCE_SHA) {
    throw candidateError(
      'STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_SOURCE_MISMATCH',
      'The migration candidate is bound to the exact reviewed Integration source.',
      {
        expected: HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_SOURCE_SHA,
        actual: normalized,
      },
    );
  }
  return normalized;
}

function parseJson(raw, code, label) {
  try {
    return JSON.parse(raw);
  } catch {
    throw candidateError(code, `${label} is not valid JSON.`);
  }
}

function tableNames(statements) {
  return statements.map((statement) => {
    const match = String(statement).match(
      /^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+`?([A-Za-z0-9_]+)`?\s*\(/iu,
    );
    return match?.[1] || null;
  });
}

function assertCandidateSql(candidateSql, contractSql) {
  const checksum = sha256(candidateSql);
  if (checksum !== HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_CHECKSUM) {
    throw candidateError(
      'STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_CHECKSUM_MISMATCH',
      'The migration candidate checksum drifted.',
      {
        expected: HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_CHECKSUM,
        actual: checksum,
      },
    );
  }

  const candidateStatements = splitMigrationSqlStatements(candidateSql);
  const contractStatements = splitMigrationSqlStatements(contractSql);
  if (candidateStatements.length !== 2 || contractStatements.length !== 2) {
    throw candidateError(
      'STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_STATEMENT_COUNT_INVALID',
      'The migration candidate and contract-local source must each contain exactly two statements.',
      {
        candidate_statement_count: candidateStatements.length,
        contract_statement_count: contractStatements.length,
      },
    );
  }

  const observedTables = tableNames(candidateStatements);
  if (JSON.stringify(observedTables) !== JSON.stringify(EXPECTED_TABLES)) {
    throw candidateError(
      'STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_TABLE_ORDER_INVALID',
      'The migration candidate must create the state table before the rollback table.',
      { tables: observedTables },
    );
  }

  if (JSON.stringify(candidateStatements) !== JSON.stringify(contractStatements)) {
    throw candidateError(
      'STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_SOURCE_PARITY_MISMATCH',
      'The migration candidate statements differ from the reviewed contract-local DDL.',
    );
  }

  const source = candidateStatements.join('\n');
  if (
    /\b(?:DROP|TRUNCATE|RENAME|GRANT|REVOKE|CALL)\b/iu.test(source)
    || /\b(?:DELETE\s+FROM|INSERT\s+INTO|UPDATE\s+[`A-Za-z0-9_]+|ALTER\s+TABLE|LOAD\s+DATA|INTO\s+(?:OUTFILE|DUMPFILE))\b/iu.test(source)
    || /\bCREATE\s+(?:VIEW|PROCEDURE|FUNCTION|TRIGGER|EVENT)\b/iu.test(source)
  ) {
    throw candidateError(
      'STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_UNSAFE_SQL_REJECTED',
      'The candidate must remain additive table DDL only.',
    );
  }

  if (!candidateSql.includes(
    `Depends on ${HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_DEPENDENCY}`,
  ) || !candidateSql.includes(HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_DEPENDENCY_CHECKSUM)) {
    throw candidateError(
      'STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_DEPENDENCY_HEADER_MISMATCH',
      'The candidate header must bind the exact Wave 3 dependency and checksum.',
    );
  }

  return {
    checksum_sha256: checksum,
    statement_count: candidateStatements.length,
    tables: observedTables,
    exact_contract_local_statement_parity: true,
    additive_create_table_only: true,
    secrets_included: false,
  };
}

function assertNotPromoted(runtimeContract, dependencyRegistry) {
  if (
    runtimeContract?.contract !== 'spec014.hostinger-storage-runtime-migrations.v1'
    || runtimeContract?.migration_apply_authorized !== false
    || runtimeContract?.live_database_access_performed !== false
    || runtimeContract?.schema_verified !== false
    || runtimeContract?.production_ready !== false
    || runtimeContract?.secrets_included !== false
    || !Array.isArray(runtimeContract?.waves)
  ) {
    throw candidateError(
      'STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_RUNTIME_CONTRACT_INVALID',
      'The governed runtime migration contract is invalid or has crossed the unapplied boundary.',
    );
  }

  const dependencyWave = runtimeContract.waves.find(
    (wave) => wave.migration === HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_DEPENDENCY,
  );
  if (
    !dependencyWave
    || dependencyWave.checksum_sha256
      !== HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_DEPENDENCY_CHECKSUM
    || Number(dependencyWave.statement_count) !== 9
    || dependencyWave.dependency
      !== '20260802_02_spec014_hostinger_storage_control_plane.sql'
  ) {
    throw candidateError(
      'STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_DEPENDENCY_CONTRACT_MISMATCH',
      'The exact Wave 3 dependency is not present in the runtime migration contract.',
    );
  }

  if (runtimeContract.waves.some(
    (wave) => wave.migration === HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE,
  )) {
    throw candidateError(
      'STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_ALREADY_PROMOTED',
      'The migration candidate must not be in the governed runtime sequence in this slice.',
    );
  }

  if (
    dependencyRegistry?.schema_version !== 'governed_migration_dependencies.v1'
    || !dependencyRegistry?.migrations
    || typeof dependencyRegistry.migrations !== 'object'
  ) {
    throw candidateError(
      'STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_DEPENDENCY_REGISTRY_INVALID',
      'The governed migration dependency registry is invalid.',
    );
  }
  if (Object.hasOwn(
    dependencyRegistry.migrations,
    HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE,
  )) {
    throw candidateError(
      'STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_DEPENDENCY_ALREADY_REGISTERED',
      'The migration candidate must not be registered as a runtime dependency in this slice.',
    );
  }
}

export async function buildHostingerStorageDurableAuthorizedInjectionMigrationCandidate(
  input = {},
  deps = {},
) {
  const allowed = new Set(['source_commit']);
  const unsupported = Object.keys(input || {}).filter((key) => !allowed.has(key));
  if (unsupported.length) {
    throw candidateError(
      'STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_FIELD_FORBIDDEN',
      'Unsupported migration-candidate fields are forbidden.',
      { unsupported_fields: unsupported.sort() },
    );
  }
  const sourceCommit = exactSourceSha(
    input.source_commit ?? HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_SOURCE_SHA,
  );
  const readFile = deps.readFile || fs.readFile.bind(fs);
  const candidatePath = deps.candidatePath || path.join(
    MIGRATIONS_DIR,
    HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE,
  );
  const contractDdlPath = deps.contractDdlPath || path.join(CONTRACTS_DIR, CONTRACT_LOCAL_DDL);
  const runtimeContractPath = deps.runtimeContractPath || path.join(CONTRACTS_DIR, RUNTIME_CONTRACT);
  const dependencyRegistryPath = deps.dependencyRegistryPath || DEPENDENCY_REGISTRY;

  const [candidateSql, contractSql, runtimeRaw, dependencyRaw] = await Promise.all([
    readFile(candidatePath, 'utf8'),
    readFile(contractDdlPath, 'utf8'),
    readFile(runtimeContractPath, 'utf8'),
    readFile(dependencyRegistryPath, 'utf8'),
  ]);
  const runtimeContract = parseJson(
    runtimeRaw,
    'STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_RUNTIME_CONTRACT_JSON_INVALID',
    'Runtime migration contract',
  );
  const dependencyRegistry = parseJson(
    dependencyRaw,
    'STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_DEPENDENCY_REGISTRY_JSON_INVALID',
    'Migration dependency registry',
  );
  const inspection = assertCandidateSql(candidateSql, contractSql);
  assertNotPromoted(runtimeContract, dependencyRegistry);

  return deepFreeze({
    contract: 'spec014.hostinger-storage-durable-authorized-injection-migration-candidate.v1',
    version: HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_VERSION,
    source_commit: sourceCommit,
    migration: HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE,
    checksum_sha256: inspection.checksum_sha256,
    statement_count: inspection.statement_count,
    tables: inspection.tables,
    dependency: HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_DEPENDENCY,
    dependency_checksum_sha256:
      HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_DEPENDENCY_CHECKSUM,
    required_ledger_mode: 'apply',
    exact_contract_local_statement_parity:
      inspection.exact_contract_local_statement_parity,
    additive_create_table_only: inspection.additive_create_table_only,
    candidate_created: true,
    candidate_inspection_passed: true,
    runtime_sequence_promoted: false,
    dependency_registry_updated: false,
    ready_for_promotion_review: true,
    ready_for_authorization: false,
    ready_for_apply: false,
    blockers: Object.freeze([
      'SEPARATELY_REVIEWED_RUNTIME_SEQUENCE_PROMOTION_REQUIRED',
      'DEPENDENCY_REGISTRY_UPDATE_REQUIRED',
      'WAVE_3_APPLY_LEDGER_REQUIRED',
      'FRESH_CAPABILITY_ENVELOPE_REQUIRED',
      'CHECKSUM_BOUND_AUTHORIZATION_REGISTRY_WRITE_REQUIRED',
      'SAME_CYCLE_DRY_RUN_REQUIRED',
      'LIVE_SCHEMA_ABSENCE_OR_COMPATIBILITY_READBACK_REQUIRED',
      'SIGNED_POST_APPLY_SCHEMA_VERIFICATION_REQUIRED',
    ]),
    authorization_created: false,
    dry_run_performed: false,
    migration_sql_executed: false,
    live_database_access_performed: false,
    live_schema_readback_performed: false,
    provider_dispatch_allowed: false,
    worker_mounted: false,
    deployment_authorized: false,
    production_ready: false,
    automatic_retry_allowed: false,
    secrets_included: false,
  });
}
