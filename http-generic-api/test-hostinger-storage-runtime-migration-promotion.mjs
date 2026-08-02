#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assessMigrationSqlPreflight,
  splitSqlStatements,
} from './releaseReadiness.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const REPORT_FILE = process.env.MIGRATION_PROMOTION_REPORT_FILE || '';
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const readJson = (relative) => JSON.parse(read(relative));
const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const normalizeExecutableStatement = (value) => value
  .replace(/\/\*[\s\S]*?\*\//gu, ' ')
  .replace(/^\s*--.*$/gmu, ' ')
  .replace(/\s+/gu, ' ')
  .trim();

const metadata = readJson('.github/contracts/spec014/hostinger-storage-runtime-migrations.json');
const dependencyRegistry = readJson('http-generic-api/config/governed-migration-dependencies.json');
const promotionContract = readJson(
  '.github/contracts/spec014/hostinger-storage-durable-authorized-injection-runtime-sequence-promotion.json',
);

const waves = [
  {
    id: 1,
    runtime: 'http-generic-api/migrations/20260802_01_spec014_hostinger_storage_foundation.sql',
    candidate: '.github/contracts/spec014/migrations/wave-1-foundation.sql',
    expected_tables: [
      'storage_provider_accounts',
      'storage_targets',
      'storage_target_bindings',
      'storage_pressure_snapshots',
    ],
    dependency: null,
    expected_preflight_status: 'pass',
    expected_risk_codes: [],
  },
  {
    id: 2,
    runtime: 'http-generic-api/migrations/20260802_02_spec014_hostinger_storage_control_plane.sql',
    candidate: '.github/contracts/spec014/migrations/wave-2-control-plane.sql',
    expected_tables: [
      'storage_cleanup_operations',
      'storage_cleanup_plans',
      'storage_cleanup_plan_items',
      'storage_cleanup_plan_impacts',
      'storage_cleanup_approvals',
      'storage_execution_leases',
    ],
    dependency: '20260802_01_spec014_hostinger_storage_foundation.sql',
    expected_preflight_status: 'pass',
    expected_risk_codes: [],
  },
  {
    id: 3,
    runtime: 'http-generic-api/migrations/20260802_03_spec014_hostinger_storage_execution_evidence.sql',
    candidate: '.github/contracts/spec014/migrations/wave-3-execution-evidence.sql',
    expected_tables: [
      'storage_cleanup_runs',
      'storage_cleanup_run_items',
      'storage_reconciliation_results',
      'storage_emergency_reserves',
      'storage_pressure_incidents',
    ],
    expected_views: [
      'v_storage_admin_target_readiness',
      'v_storage_tenant_target_readiness',
      'v_storage_cleanup_operation_readback',
    ],
    expected_tools: [
      'hostinger_storage_snapshot_read',
      'hostinger_storage_plan_inspect',
      'hostinger_storage_plan_apply',
    ],
    dependency: '20260802_02_spec014_hostinger_storage_control_plane.sql',
    expected_preflight_status: 'warn',
    expected_risk_codes: [
      'create_view_without_or_replace',
      'create_view_without_or_replace',
      'create_view_without_or_replace',
      'insert_without_ignore_or_on_duplicate',
    ],
  },
  {
    id: 4,
    runtime: 'http-generic-api/migrations/20260802_04_spec014_hostinger_storage_authorized_injection_state.sql',
    candidate: '.github/contracts/spec014/sql/hostinger-storage-durable-authorized-injection-state.sql',
    expected_tables: [
      'storage_authorized_injection_states',
      'storage_authorized_injection_rollbacks',
    ],
    dependency: '20260802_03_spec014_hostinger_storage_execution_evidence.sql',
    expected_preflight_status: 'pass',
    expected_risk_codes: [],
  },
];

assert.equal(metadata.contract, 'spec014.hostinger-storage-runtime-migrations.v1');
assert.equal(metadata.status, 'governed_sequence_registered_apply_blocked');
assert.equal(metadata.migration_apply_authorized, false);
assert.equal(metadata.live_database_access_performed, false);
assert.equal(metadata.schema_verified, false);
assert.equal(metadata.production_ready, false);
assert.equal(metadata.secrets_included, false);
assert.deepEqual(metadata.extension_source_contracts, [
  '.github/contracts/spec014/hostinger-storage-durable-authorized-injection-migration-candidate.json',
  '.github/contracts/spec014/hostinger-storage-durable-authorized-injection-runtime-sequence-promotion.json',
]);
assert.equal(dependencyRegistry.schema_version, 'governed_migration_dependencies.v1');
assert.equal(
  promotionContract.contract,
  'spec014.hostinger-storage-durable-authorized-injection-runtime-sequence-promotion.v1',
);
assert.equal(promotionContract.candidate_source.pull_request, 4879);
assert.equal(
  promotionContract.candidate_source.integration_merge_sha,
  '4ca8d8691baa66210b679da51c5d92909c88c14c',
);
assert.equal(promotionContract.promotion.runtime_sequence_promoted, true);
assert.equal(promotionContract.promotion.dependency_registry_updated, true);
assert.equal(promotionContract.terminal_boundary.authorization_created, false);
assert.equal(promotionContract.terminal_boundary.migration_sql_executed, false);
assert.equal(promotionContract.terminal_boundary.live_database_access_performed, false);
assert.equal(
  promotionContract.terminal_boundary.signed_schema_verification_contract_refreshed,
  false,
);
assert.equal(promotionContract.terminal_boundary.production_ready, false);
assert.equal(promotionContract.secrets_included, false);

const report = {
  gate: 'hostinger_storage_runtime_migration_promotion',
  generated_at: new Date().toISOString(),
  waves: [],
  migration_apply_performed: false,
  live_database_access_performed: false,
  provider_dispatch_performed: false,
  credential_access_performed: false,
  production_mutation_performed: false,
  secrets_included: false,
};

function writeReport() {
  if (!REPORT_FILE) return;
  fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
  fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function assertDependencyBinding(wave, checksum, statementCount) {
  if (!wave.dependency) return;
  const target = dependencyRegistry.migrations[path.basename(wave.runtime)];
  assert(target, `${path.basename(wave.runtime)}: dependency registry target missing`);
  assert.equal(target.checksum_sha256, checksum, `${path.basename(wave.runtime)}: target checksum drift`);
  assert.equal(target.statement_count, statementCount, `${path.basename(wave.runtime)}: target statement count drift`);
  assert.equal(target.dependencies.length, 1, `${path.basename(wave.runtime)}: exact one dependency required`);
  const dependency = target.dependencies[0];
  const dependencyWave = waves.find((entry) => path.basename(entry.runtime) === wave.dependency);
  const dependencyMetadata = metadata.waves.find((entry) => entry.migration === wave.dependency);
  assert(dependencyWave, `${path.basename(wave.runtime)}: declared dependency wave missing`);
  assert(dependencyMetadata, `${path.basename(wave.runtime)}: dependency metadata missing`);
  assert.equal(dependency.migration, wave.dependency);
  assert.equal(dependency.checksum_sha256, dependencyMetadata.checksum_sha256);
  assert.equal(dependency.statement_count, dependencyMetadata.statement_count);
  assert.equal(dependency.required_ledger_mode, 'apply');
}

const reports = [];
for (const wave of waves) {
  const sql = read(wave.runtime);
  const candidateSql = read(wave.candidate);
  const filename = path.basename(wave.runtime);
  const statements = splitSqlStatements(sql);
  const candidateStatements = splitSqlStatements(candidateSql);
  const normalizedStatements = statements.map(normalizeExecutableStatement);
  const normalizedCandidateStatements = candidateStatements.map(normalizeExecutableStatement);
  const mismatchIndex = normalizedStatements.findIndex(
    (statement, index) => statement !== normalizedCandidateStatements[index],
  );
  const preflight = assessMigrationSqlPreflight(filename, sql);
  const checksum = sha256(sql);
  const riskCodes = (preflight.risks || []).map((risk) => risk.code);
  const metadataWave = metadata.waves.find((entry) => entry.wave === wave.id);
  const diagnostic = {
    wave: wave.id,
    migration: filename,
    checksum_sha256: checksum,
    statement_count: statements.length,
    candidate_statement_count: candidateStatements.length,
    executable_candidate_parity:
      statements.length === candidateStatements.length && mismatchIndex === -1,
    first_mismatch_index: mismatchIndex,
    first_runtime_statement: mismatchIndex >= 0 ? normalizedStatements[mismatchIndex] : null,
    first_candidate_statement:
      mismatchIndex >= 0 ? normalizedCandidateStatements[mismatchIndex] : null,
    preflight,
    dependency: wave.dependency,
  };
  report.waves.push(diagnostic);
  writeReport();

  assert.equal(
    statements.length,
    candidateStatements.length,
    `${filename}: executable statement count drifted from reviewed candidate`,
  );
  assert.equal(mismatchIndex, -1, `${filename}: executable SQL drifted from reviewed candidate`);
  assert.equal(preflight.status, wave.expected_preflight_status, `${filename}: preflight status drift`);
  assert.deepEqual(riskCodes, wave.expected_risk_codes, `${filename}: preflight risk set drift`);
  assert.equal(
    Number(preflight.risk_count || 0),
    wave.expected_risk_codes.length,
    `${filename}: preflight risk count drift`,
  );
  assert.equal(
    Number(preflight?.counts?.statements || 0),
    statements.length,
    `${filename}: preflight statement count drift`,
  );

  assert(metadataWave, `${filename}: pinned metadata missing`);
  assert.equal(metadataWave.migration, filename);
  assert.equal(metadataWave.checksum_sha256, checksum, `${filename}: pinned checksum drift`);
  assert.equal(metadataWave.statement_count, statements.length, `${filename}: pinned statement count drift`);
  assert.equal(metadataWave.preflight_status, preflight.status, `${filename}: pinned preflight status drift`);
  assert.equal(metadataWave.preflight_risk_count, riskCodes.length, `${filename}: pinned risk count drift`);
  assert.deepEqual(metadataWave.preflight_risk_codes, riskCodes, `${filename}: pinned risk codes drift`);
  assert.equal(metadataWave.dependency, wave.dependency, `${filename}: pinned dependency drift`);
  assertDependencyBinding(wave, checksum, statements.length);

  assert.doesNotMatch(
    sql,
    /\b(?:DROP|TRUNCATE|DELETE\s+FROM|RENAME\s+TABLE)\b/iu,
    `${filename}: destructive SQL`,
  );
  assert.doesNotMatch(
    sql,
    /\bSET\s+FOREIGN_KEY_CHECKS\s*=\s*0\b/iu,
    `${filename}: FK checks disabled`,
  );
  assert.doesNotMatch(
    sql,
    /\b(?:password|private_key|access_token|refresh_token|secret_payload)\b/iu,
    `${filename}: secret-bearing field`,
  );

  const tables = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+`?([a-z0-9_]+)`?/gu)]
    .map((match) => match[1]);
  assert.deepEqual(tables.sort(), [...wave.expected_tables].sort(), `${filename}: exact table set`);

  if (wave.expected_views) {
    const views = [...sql.matchAll(/CREATE VIEW\s+`?([a-z0-9_]+)`?/gu)]
      .map((match) => match[1]);
    assert.deepEqual(views.sort(), [...wave.expected_views].sort(), `${filename}: exact view set`);
    for (const tool of wave.expected_tools) {
      assert.ok(sql.includes(`'${tool}'`), `${filename}: missing disabled tool ${tool}`);
    }
    assert.equal(
      (sql.match(/\n\s*0,\n\s*36[0-2]\n\)/gu) || []).length,
      3,
      `${filename}: tools must remain disabled`,
    );
    assert.equal(metadata.apply_blockers.length >= 7, true, `${filename}: explicit apply blockers required`);
  }

  reports.push({
    wave: wave.id,
    migration: filename,
    checksum_sha256: checksum,
    statement_count: statements.length,
    dependency: wave.dependency,
    preflight_status: preflight.status,
    preflight_risk_count: riskCodes.length,
    preflight_risk_codes: riskCodes,
    executable_candidate_parity: true,
    metadata_pinned: true,
    dependency_pinned: Boolean(wave.dependency),
  });
}

assert.equal(reports.length, 4);
assert.equal(metadata.waves.length, 4);
assert.equal(reports[1].dependency, reports[0].migration);
assert.equal(reports[2].dependency, reports[1].migration);
assert.equal(reports[3].dependency, reports[2].migration);
assert.equal(reports[3].checksum_sha256, promotionContract.candidate_source.checksum_sha256);
assert.equal(reports[3].statement_count, promotionContract.candidate_source.statement_count);
assert.equal(
  promotionContract.promotion.dependency,
  reports[2].migration,
);
assert.equal(
  promotionContract.promotion.dependency_checksum_sha256,
  reports[2].checksum_sha256,
);
assert.equal(
  metadata.apply_blockers.some((item) => item.includes('Signed schema verification')),
  true,
);

report.ok = true;
report.reports = reports;
writeReport();
console.log(JSON.stringify(report, null, 2));
