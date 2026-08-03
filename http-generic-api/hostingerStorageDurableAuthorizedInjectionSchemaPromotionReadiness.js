import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { splitMigrationSqlStatements } from './migrationSqlStatements.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DDL_PATH = path.join(
  __dirname,
  '..',
  '.github',
  'contracts',
  'spec014',
  'sql',
  'hostinger-storage-durable-authorized-injection-state.sql',
);
const DEFAULT_STATE_CONTRACT_PATH = path.join(
  __dirname,
  '..',
  '.github',
  'contracts',
  'spec014',
  'hostinger-storage-durable-authorized-injection-state.json',
);

export const HOSTINGER_STORAGE_DURABLE_INJECTION_SCHEMA_PROMOTION_READINESS_VERSION =
  'spec014-hostinger-storage-durable-injection-schema-promotion-readiness-v1';
export const HOSTINGER_STORAGE_DURABLE_INJECTION_SCHEMA_PROMOTION_BASE_SHA =
  '3a1cc69846ecc2a2984c3fd0d7fefdde1c0bab13';
export const HOSTINGER_STORAGE_DURABLE_INJECTION_SCHEMA_DDL_BLOB_SHA =
  'f0a5803ef185556338a5dc4cd7b820861c1e797f';

const DDL_REPOSITORY_PATH =
  '.github/contracts/spec014/sql/hostinger-storage-durable-authorized-injection-state.sql';
const STATE_CONTRACT_REPOSITORY_PATH =
  '.github/contracts/spec014/hostinger-storage-durable-authorized-injection-state.json';
const EXPECTED_SCHEMA_CONTRACT_KEY =
  'hostinger_storage_durable_authorized_injection_state_schema_v1';
const EXPECTED_TABLES = Object.freeze([
  'storage_authorized_injection_states',
  'storage_authorized_injection_rollbacks',
]);
const SHA40_RE = /^[0-9a-f]{40}$/u;

function readinessError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = Object.freeze({ ...details, secrets_included: false });
  return error;
}

function sha256(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex');
}

function exactSha40(value, field) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!SHA40_RE.test(normalized)) {
    throw readinessError(
      'STORAGE_DURABLE_INJECTION_SCHEMA_PROMOTION_IDENTITY_INVALID',
      'A lowercase 40-character Git identity is required.',
      { field },
    );
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

function assertStateContract(contract = {}) {
  const schema = contract?.schema_contract || {};
  const tables = Array.isArray(schema.tables) ? schema.tables : [];
  if (
    contract.contract_key !== 'spec014_hostinger_storage_durable_authorized_injection_state'
    || Number(contract.schema_version) !== 1
    || schema.contract_key !== EXPECTED_SCHEMA_CONTRACT_KEY
    || schema.ddl_contract_path !== DDL_REPOSITORY_PATH
    || schema.ddl_contract_present !== true
    || schema.ddl_matches_registry_sql !== true
    || schema.contract_local_only !== true
    || schema.governed_runtime_migration_promoted !== false
    || schema.migration_apply_authorized !== false
    || schema.runtime_material_persisted !== false
    || JSON.stringify(tables) !== JSON.stringify(EXPECTED_TABLES)
    || contract?.forbidden_authority?.live_database_access !== false
    || contract?.forbidden_authority?.migration_apply !== false
    || contract?.forbidden_authority?.provider_dispatch !== false
    || contract?.forbidden_authority?.deployment !== false
    || contract?.forbidden_authority?.production_mutation !== false
    || contract.secrets_included !== false
  ) {
    throw readinessError(
      'STORAGE_DURABLE_INJECTION_SCHEMA_PROMOTION_STATE_CONTRACT_INVALID',
      'The durable injection state contract is not an exact contract-local, unapplied schema source.',
    );
  }
}

function extractCreateTableName(statement) {
  const match = String(statement).match(
    /^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+`?([A-Za-z0-9_]+)`?\s*\(/iu,
  );
  return match?.[1] || null;
}

function assertRequiredPattern(statement, pattern, field) {
  if (!pattern.test(statement)) {
    throw readinessError(
      'STORAGE_DURABLE_INJECTION_SCHEMA_PROMOTION_DDL_CONTRACT_MISMATCH',
      'The contract-local DDL is missing a required identity, constraint, or access-path binding.',
      { field },
    );
  }
}

function inspectDdl(ddl) {
  const statements = splitMigrationSqlStatements(ddl);
  if (statements.length !== 2) {
    throw readinessError(
      'STORAGE_DURABLE_INJECTION_SCHEMA_PROMOTION_STATEMENT_COUNT_INVALID',
      'Exactly two CREATE TABLE statements are required.',
      { statement_count: statements.length },
    );
  }

  const tableNames = statements.map(extractCreateTableName);
  if (JSON.stringify(tableNames) !== JSON.stringify(EXPECTED_TABLES)) {
    throw readinessError(
      'STORAGE_DURABLE_INJECTION_SCHEMA_PROMOTION_TABLE_ORDER_INVALID',
      'The state table must be created before its rollback child table.',
      { tables: tableNames },
    );
  }

  const normalized = statements.join('\n');
  if (
    /\b(?:DROP|TRUNCATE|RENAME|GRANT|REVOKE|CALL)\b/iu.test(normalized)
    || /\b(?:DELETE\s+FROM|INSERT\s+INTO|ALTER\s+TABLE|LOAD\s+DATA|INTO\s+(?:OUTFILE|DUMPFILE))\b/iu.test(normalized)
    || /\bCREATE\s+(?:PROCEDURE|FUNCTION|TRIGGER|EVENT)\b/iu.test(normalized)
  ) {
    throw readinessError(
      'STORAGE_DURABLE_INJECTION_SCHEMA_PROMOTION_UNSAFE_SQL_REJECTED',
      'The promotion source must remain additive table DDL only.',
    );
  }

  const [stateTable, rollbackTable] = statements;
  assertRequiredPattern(stateTable, /PRIMARY\s+KEY\s*\(\s*injection_id\s*\)/iu, 'state.primary_key');
  assertRequiredPattern(stateTable, /UNIQUE\s+KEY\s+uq_storage_authorized_injection_receipt\s*\(\s*injection_receipt_digest\s*\)/iu, 'state.receipt_unique');
  assertRequiredPattern(stateTable, /UNIQUE\s+KEY\s+uq_storage_authorized_injection_readback\s*\(\s*mount_readback_digest\s*\)/iu, 'state.readback_unique');
  assertRequiredPattern(stateTable, /KEY\s+idx_storage_authorized_injection_active_generation\s*\(\s*active\s*,\s*generation\s*\)/iu, 'state.active_generation_index');
  assertRequiredPattern(stateTable, /row_version\s+BIGINT\s+UNSIGNED\s+NOT\s+NULL\s+DEFAULT\s+1/iu, 'state.row_version');
  assertRequiredPattern(stateTable, /CHECK\s*\(\s*secrets_included\s*=\s*0\s*\)/iu, 'state.no_secrets');
  assertRequiredPattern(stateTable, /ENGINE\s*=\s*InnoDB/iu, 'state.engine');

  assertRequiredPattern(rollbackTable, /PRIMARY\s+KEY\s*\(\s*id\s*\)/iu, 'rollback.primary_key');
  assertRequiredPattern(rollbackTable, /UNIQUE\s+KEY\s+uq_storage_authorized_injection_rollback_once\s*\(\s*injection_id\s*\)/iu, 'rollback.once_per_injection');
  assertRequiredPattern(rollbackTable, /UNIQUE\s+KEY\s+uq_storage_authorized_injection_rollback_digest\s*\(\s*rollback_receipt_digest\s*\)/iu, 'rollback.digest_unique');
  assertRequiredPattern(
    rollbackTable,
    /FOREIGN\s+KEY\s*\(\s*injection_id\s*\)\s*REFERENCES\s+storage_authorized_injection_states\s*\(\s*injection_id\s*\)/iu,
    'rollback.state_foreign_key',
  );
  assertRequiredPattern(rollbackTable, /CHECK\s*\(\s*secrets_included\s*=\s*0\s*\)/iu, 'rollback.no_secrets');
  assertRequiredPattern(rollbackTable, /ENGINE\s*=\s*InnoDB/iu, 'rollback.engine');

  return deepFreeze({
    statements: clone(statements),
    statement_count: statements.length,
    tables: [...tableNames],
    state_before_rollback: true,
    foreign_key_order_verified: true,
    additive_create_table_only: true,
    secrets_included: false,
  });
}

export async function buildHostingerStorageDurableAuthorizedInjectionSchemaPromotionReadiness(
  input = {},
  deps = {},
) {
  const allowed = new Set(['source_commit', 'ddl_blob_sha']);
  const unsupported = Object.keys(input || {}).filter((key) => !allowed.has(key));
  if (unsupported.length) {
    throw readinessError(
      'STORAGE_DURABLE_INJECTION_SCHEMA_PROMOTION_FIELD_FORBIDDEN',
      'Unsupported schema-promotion readiness fields are forbidden.',
      { unsupported_fields: unsupported.sort() },
    );
  }

  const sourceCommit = exactSha40(
    input.source_commit ?? HOSTINGER_STORAGE_DURABLE_INJECTION_SCHEMA_PROMOTION_BASE_SHA,
    'source_commit',
  );
  const ddlBlobSha = exactSha40(
    input.ddl_blob_sha ?? HOSTINGER_STORAGE_DURABLE_INJECTION_SCHEMA_DDL_BLOB_SHA,
    'ddl_blob_sha',
  );
  if (sourceCommit !== HOSTINGER_STORAGE_DURABLE_INJECTION_SCHEMA_PROMOTION_BASE_SHA) {
    throw readinessError(
      'STORAGE_DURABLE_INJECTION_SCHEMA_PROMOTION_SOURCE_MISMATCH',
      'Readiness is bound to the exact reviewed Integration source snapshot.',
      { expected: HOSTINGER_STORAGE_DURABLE_INJECTION_SCHEMA_PROMOTION_BASE_SHA, actual: sourceCommit },
    );
  }
  if (ddlBlobSha !== HOSTINGER_STORAGE_DURABLE_INJECTION_SCHEMA_DDL_BLOB_SHA) {
    throw readinessError(
      'STORAGE_DURABLE_INJECTION_SCHEMA_PROMOTION_DDL_BLOB_MISMATCH',
      'Readiness is bound to the exact reviewed contract-local DDL blob.',
      { expected: HOSTINGER_STORAGE_DURABLE_INJECTION_SCHEMA_DDL_BLOB_SHA, actual: ddlBlobSha },
    );
  }

  const readFile = deps.readFile || fs.readFile.bind(fs);
  const ddlPath = deps.ddlPath || DEFAULT_DDL_PATH;
  const stateContractPath = deps.stateContractPath || DEFAULT_STATE_CONTRACT_PATH;
  const [ddl, rawContract] = await Promise.all([
    readFile(ddlPath, 'utf8'),
    readFile(stateContractPath, 'utf8'),
  ]);

  let stateContract;
  try {
    stateContract = JSON.parse(rawContract);
  } catch {
    throw readinessError(
      'STORAGE_DURABLE_INJECTION_SCHEMA_PROMOTION_STATE_CONTRACT_JSON_INVALID',
      'The durable injection state contract is not valid JSON.',
    );
  }
  assertStateContract(stateContract);
  const inspection = inspectDdl(ddl);

  const blockers = Object.freeze([
    'SEPARATELY_REVIEWED_MIGRATION_CANDIDATE_REQUIRED',
    'RUNTIME_MIGRATION_SEQUENCE_PROMOTION_REQUIRED',
    'FRESH_CAPABILITY_ENVELOPE_REQUIRED',
    'CHECKSUM_BOUND_AUTHORIZATION_REGISTRY_WRITE_REQUIRED',
    'SAME_CYCLE_DRY_RUN_REQUIRED',
    'LIVE_SCHEMA_ABSENCE_OR_COMPATIBILITY_READBACK_REQUIRED',
    'SIGNED_POST_APPLY_SCHEMA_VERIFICATION_REQUIRED',
  ]);

  return deepFreeze({
    contract: 'spec014.hostinger-storage-durable-authorized-injection-schema-promotion-readiness.v1',
    version: HOSTINGER_STORAGE_DURABLE_INJECTION_SCHEMA_PROMOTION_READINESS_VERSION,
    source_commit: sourceCommit,
    ddl_contract_path: DDL_REPOSITORY_PATH,
    ddl_blob_sha: ddlBlobSha,
    ddl_sha256: sha256(ddl),
    state_contract_path: STATE_CONTRACT_REPOSITORY_PATH,
    state_contract_sha256: sha256(rawContract),
    schema_contract_key: EXPECTED_SCHEMA_CONTRACT_KEY,
    statement_count: inspection.statement_count,
    tables: inspection.tables,
    state_before_rollback: inspection.state_before_rollback,
    foreign_key_order_verified: inspection.foreign_key_order_verified,
    additive_create_table_only: inspection.additive_create_table_only,
    contract_local_ddl_verified: true,
    ready_for_migration_candidate: true,
    ready_for_runtime_sequence_promotion: false,
    ready_for_authorization: false,
    ready_for_apply: false,
    readiness_state: 'repository_contract_verified_promotion_not_authorized',
    next_reviewed_step: 'create_checksum_bound_migration_candidate',
    blockers,
    migration_candidate_created: false,
    governed_runtime_migration_promoted: false,
    capability_envelope_resolved: false,
    authorization_created: false,
    dry_run_performed: false,
    migration_sql_executed: false,
    live_database_access_performed: false,
    live_schema_readback_performed: false,
    signed_schema_verification_created: false,
    provider_dispatch_allowed: false,
    worker_mounted: false,
    deployment_authorized: false,
    production_ready: false,
    automatic_retry_allowed: false,
    secrets_included: false,
  });
}
