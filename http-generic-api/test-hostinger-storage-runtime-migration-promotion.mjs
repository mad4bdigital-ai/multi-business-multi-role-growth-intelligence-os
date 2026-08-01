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
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const normalizeExecutableStatement = (value) => value
  .replace(/\/\*[\s\S]*?\*\//gu, ' ')
  .replace(/^\s*--.*$/gmu, ' ')
  .replace(/\s+/gu, ' ')
  .trim();

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
  },
];

const reports = [];
for (const wave of waves) {
  const sql = read(wave.runtime);
  const candidateSql = read(wave.candidate);
  const filename = path.basename(wave.runtime);
  const statements = splitSqlStatements(sql);
  const candidateStatements = splitSqlStatements(candidateSql);
  assert.equal(statements.length, candidateStatements.length, `${filename}: executable statement count drifted from reviewed candidate`);
  assert.deepEqual(
    statements.map(normalizeExecutableStatement),
    candidateStatements.map(normalizeExecutableStatement),
    `${filename}: executable SQL drifted from reviewed candidate`,
  );

  const preflight = assessMigrationSqlPreflight(filename, sql);
  assert.equal(preflight.status, 'pass', `${filename}: preflight must pass`);
  assert.equal(Number(preflight.risk_count || 0), 0, `${filename}: preflight must have zero risks`);
  assert.equal(Number(preflight?.counts?.statements || 0), statements.length, `${filename}: preflight statement count drift`);

  assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE|DELETE\s+FROM|RENAME\s+TABLE)\b/iu, `${filename}: destructive SQL`);
  assert.doesNotMatch(sql, /\bSET\s+FOREIGN_KEY_CHECKS\s*=\s*0\b/iu, `${filename}: FK checks disabled`);
  assert.doesNotMatch(sql, /\b(?:password|private_key|access_token|refresh_token|secret_payload)\b/iu, `${filename}: secret-bearing field`);

  const tables = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+`?([a-z0-9_]+)`?/gu)].map((match) => match[1]);
  assert.deepEqual(tables.sort(), [...wave.expected_tables].sort(), `${filename}: exact table set`);

  if (wave.expected_views) {
    const views = [...sql.matchAll(/CREATE VIEW\s+`?([a-z0-9_]+)`?/gu)].map((match) => match[1]);
    assert.deepEqual(views.sort(), [...wave.expected_views].sort(), `${filename}: exact view set`);
    for (const tool of wave.expected_tools) {
      assert.ok(sql.includes(`'${tool}'`), `${filename}: missing disabled tool ${tool}`);
    }
    assert.equal((sql.match(/\n\s*0,\n\s*36[0-2]\n\)/gu) || []).length, 3, `${filename}: tools must remain disabled`);
  }

  reports.push({
    wave: wave.id,
    migration: filename,
    checksum_sha256: sha256(sql),
    statement_count: statements.length,
    dependency: wave.dependency,
    preflight_status: preflight.status,
    preflight_risk_count: Number(preflight.risk_count || 0),
    executable_candidate_parity: true,
  });
}

assert.equal(reports.length, 3);
assert.equal(reports[1].dependency, reports[0].migration);
assert.equal(reports[2].dependency, reports[1].migration);

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_runtime_migration_promotion',
  reports,
  migration_apply_performed: false,
  live_database_access_performed: false,
  provider_dispatch_performed: false,
  credential_access_performed: false,
  production_mutation_performed: false,
  secrets_included: false,
}, null, 2));
