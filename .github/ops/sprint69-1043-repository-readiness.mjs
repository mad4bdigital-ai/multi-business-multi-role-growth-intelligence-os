import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { splitMigrationSqlStatements } from '../../http-generic-api/migrationSqlStatements.js';

const MIGRATION = '1043_sprint69_tenant_managed_execution_lifecycle.sql';
const MIGRATION_PATH = `http-generic-api/migrations/${MIGRATION}`;
const EVIDENCE_DIR = String(
  process.env.EVIDENCE_DIR || '.artifacts/sprint69-1043-repository-readiness',
).trim();
const SOURCE_COMMIT_SHA = String(process.env.GITHUB_SHA || '').trim() || null;
const EXPECTED_STATEMENT_COUNT = 4;
const EXPECTED_TABLES = Object.freeze([
  'managed_execution_bindings',
  'managed_execution_step_requests',
  'managed_execution_events',
]);
const EXPECTED_VIEW = 'v_managed_execution_lifecycle_readiness';

function gitBlobSha(content) {
  const body = Buffer.from(content, 'utf8');
  return createHash('sha1')
    .update(Buffer.from(`blob ${body.length}\0`, 'utf8'))
    .update(body)
    .digest('hex');
}

function sha256(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

async function writeJson(name, value) {
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await fs.writeFile(
    `${EVIDENCE_DIR}/${name}`,
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  );
}

function assertRepositoryReadiness(sql, statements) {
  assert.equal(
    statements.length,
    EXPECTED_STATEMENT_COUNT,
    `Migration 1043 must contain exactly ${EXPECTED_STATEMENT_COUNT} top-level statements.`,
  );
  assert.equal(
    statements.filter((statement) => /^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\b/i.test(statement)).length,
    3,
    'Migration 1043 must contain exactly three idempotent CREATE TABLE IF NOT EXISTS statements.',
  );
  assert.equal(
    statements.filter((statement) => /^CREATE\s+OR\s+REPLACE\s+VIEW\b/i.test(statement)).length,
    1,
    'Migration 1043 must contain exactly one idempotent CREATE OR REPLACE VIEW statement.',
  );

  for (const table of EXPECTED_TABLES) {
    assert.match(
      sql,
      new RegExp(`CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+${table}\\b`, 'i'),
      `Migration 1043 is missing expected table ${table}.`,
    );
  }
  assert.match(
    sql,
    new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+VIEW\\s+${EXPECTED_VIEW}\\b`, 'i'),
    `Migration 1043 is missing readiness view ${EXPECTED_VIEW}.`,
  );

  assert.doesNotMatch(
    sql,
    /\b(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT|ALTER|GRANT|REVOKE|CALL)\b/i,
    'Repository readiness rejects destructive, data-mutating, privilege-changing, or procedure-call statements.',
  );
  assert.doesNotMatch(
    sql,
    /\b(?:DEFINER|OUTFILE|INFILE|LOAD\s+DATA)\b/i,
    'Repository readiness rejects privileged or file-system SQL clauses.',
  );
}

async function main() {
  const sql = await fs.readFile(MIGRATION_PATH, 'utf8');
  const statements = splitMigrationSqlStatements(sql);
  assertRepositoryReadiness(sql, statements);

  const summary = {
    contract: 'sprint69_1043_repository_readiness.v1',
    status: 'pass',
    migration: MIGRATION,
    migration_path: MIGRATION_PATH,
    migration_blob_sha: gitBlobSha(sql),
    migration_checksum_sha256: sha256(sql),
    statement_count: statements.length,
    statement_kinds: statements.map((statement) =>
      statement.match(/^CREATE\s+TABLE/i)
        ? 'create_table_if_not_exists'
        : 'create_or_replace_view',
    ),
    expected_tables: [...EXPECTED_TABLES],
    expected_view: EXPECTED_VIEW,
    source_commit_sha: SOURCE_COMMIT_SHA,
    repository_readiness_only: true,
    runtime_contacted: false,
    authorization_created: false,
    apply_authorized: false,
    apply_sent: false,
    database_mutation_executed: false,
    activation_registry_sync_executed: false,
    provider_call_executed: false,
    credential_accessed: false,
    external_write_executed: false,
    secrets_included: false,
    generated_at: new Date().toISOString(),
  };
  await writeJson('summary.json', summary);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

try {
  await main();
} catch (error) {
  const failure = {
    contract: 'sprint69_1043_repository_readiness.v1',
    status: 'fail',
    migration: MIGRATION,
    migration_path: MIGRATION_PATH,
    source_commit_sha: SOURCE_COMMIT_SHA,
    error: {
      code: 'migration_1043_repository_readiness_failed',
      message: String(error?.message || error),
    },
    repository_readiness_only: true,
    runtime_contacted: false,
    authorization_created: false,
    apply_authorized: false,
    apply_sent: false,
    database_mutation_executed: false,
    activation_registry_sync_executed: false,
    provider_call_executed: false,
    credential_accessed: false,
    external_write_executed: false,
    secrets_included: false,
    generated_at: new Date().toISOString(),
  };
  await writeJson('failure.json', failure);
  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
}
