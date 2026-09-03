#!/usr/bin/env node

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertMigration,
  exactSet,
  parseBoolean,
  selectCanonicalLedgerApplyRecord,
  validateConfiguredRecoveryStep,
  validateFallbackTargetPlan,
  validateProductionBaseUrl,
  validateRecoveryPlan,
} from './production-runtime-recovery-policy.mjs';

const CHECKSUM_225 = '35b034940c2be63d9bf8a8099573cac1c5a75b5fffd8ccfad60a453ed3cf7419';
const CHECKSUM_1048 = 'aecfbd9d87dca6eba11677cd992637f55ecf3c0743f704df4bbea48c57d8d788';
const CHECKSUM_20260815 = '528143808adac23eb457058c4c34dd95c4c5d462bca9ac4b170b1f19b2006681';

function migrationStep(migration, checksum, count, mode, mutation = false) {
  return {
    route_key: 'gpt_tool_call',
    mutation,
    body: {
      name: 'governed_migration_execute',
      tool_args: {
        migration,
        mode,
        expected_checksum_sha256: checksum,
        expected_statement_count: count,
      },
    },
  };
}

test('exactSet ignores ordering but not membership', () => {
  assert.equal(exactSet(['B', 'A'], ['A', 'B']), true);
  assert.equal(exactSet(['A'], ['A', 'B']), false);
});

test('recovery booleans are parsed explicitly and fail closed on unknown values', () => {
  assert.equal(parseBoolean(undefined, false), false);
  assert.equal(parseBoolean('', true), true);
  assert.equal(parseBoolean('true'), true);
  assert.equal(parseBoolean('YES'), true);
  assert.equal(parseBoolean('0', true), false);
  assert.equal(parseBoolean('off', true), false);
  assert.throws(() => parseBoolean('sometimes'), /RECOVERY_INVALID_BOOLEAN/);
});

test('canonical apply-ledger selection fails on any checksum conflict even with an exact record', () => {
  const exact = {
    run_id: 'exact-run',
    migration_checksum_sha256: CHECKSUM_20260815,
    mode: 'apply',
  };
  assert.equal(
    selectCanonicalLedgerApplyRecord([exact], '20260815_custom_gpt_mcp_catalog_levels.sql', CHECKSUM_20260815),
    exact,
  );
  assert.equal(
    selectCanonicalLedgerApplyRecord([], '20260815_custom_gpt_mcp_catalog_levels.sql', CHECKSUM_20260815),
    null,
  );
  assert.throws(() => selectCanonicalLedgerApplyRecord([
    exact,
    { run_id: 'conflict-run', migration_checksum_sha256: '0'.repeat(64), mode: 'apply' },
  ], '20260815_custom_gpt_mcp_catalog_levels.sql', CHECKSUM_20260815), /RECOVERY_GOVERNED_LEDGER_CHECKSUM_DIVERGENCE/);
});

test('225 and 1048 are dry-run only', () => {
  assert.doesNotThrow(() => assertMigration({
    migration: '225_sprint67_capability_resolution_envelope_ledger.sql',
    expected_checksum_sha256: CHECKSUM_225,
    expected_statement_count: 3,
  }, 'dry_run'));
  assert.throws(() => assertMigration({
    migration: '225_sprint67_capability_resolution_envelope_ledger.sql',
    expected_checksum_sha256: CHECKSUM_225,
    expected_statement_count: 3,
  }, 'apply'), /RECOVERY_MIGRATION_MODE_DENIED/);
  assert.throws(() => assertMigration({
    migration: '1048_transport_response_chunk_schema_recovery.sql',
    expected_checksum_sha256: CHECKSUM_1048,
    expected_statement_count: 34,
  }, 'apply'), /RECOVERY_MIGRATION_MODE_DENIED/);
});

test('20260815 is the only current apply migration candidate', () => {
  assert.doesNotThrow(() => assertMigration({
    migration: '20260815_custom_gpt_mcp_catalog_levels.sql',
    expected_checksum_sha256: CHECKSUM_20260815,
    expected_statement_count: 7,
  }, 'apply'));
  assert.throws(() => assertMigration({
    migration: '20260815_custom_gpt_mcp_catalog_levels.sql',
    expected_checksum_sha256: '0'.repeat(64),
    expected_statement_count: 7,
  }, 'apply'), /RECOVERY_MIGRATION_CHECKSUM_REQUIRED/);
});

test('arbitrary paths and dedicated smoke through generic configured steps are denied', () => {
  assert.throws(() => validateConfiguredRecoveryStep({ route_key: 'health', path: '/other' }, 'probe'), /RECOVERY_ARBITRARY_ROUTE_DENIED/);
  assert.throws(() => validateConfiguredRecoveryStep({
    route_key: 'gpt_tool_call',
    body: { name: 'response_chunk_durable_recovery_smoke', tool_args: { confirm: 'RUN_RESPONSE_CHUNK_DURABLE_RECOVERY_SMOKE' } },
  }, 'final'), /RECOVERY_DEDICATED_TOOL_GENERIC_DISPATCH_DENIED/);
});

test('read phases accept verification-only migration dry-runs', () => {
  assert.doesNotThrow(() => validateConfiguredRecoveryStep(
    migrationStep('225_sprint67_capability_resolution_envelope_ledger.sql', CHECKSUM_225, 3, 'dry_run'),
    'probe',
  ));
  assert.doesNotThrow(() => validateConfiguredRecoveryStep(
    migrationStep('1048_transport_response_chunk_schema_recovery.sql', CHECKSUM_1048, 34, 'dry_run'),
    'final',
  ));
});

test('mutation phase accepts only checksum-bound 20260815 apply', () => {
  assert.doesNotThrow(() => validateConfiguredRecoveryStep(
    migrationStep('20260815_custom_gpt_mcp_catalog_levels.sql', CHECKSUM_20260815, 7, 'apply', true),
    'mutation',
  ));
  assert.throws(() => validateConfiguredRecoveryStep(
    migrationStep('1048_transport_response_chunk_schema_recovery.sql', CHECKSUM_1048, 34, 'apply', true),
    'mutation',
  ), /RECOVERY_MIGRATION_MODE_DENIED/);
});

test('snapshot requires an explicit DB-independent source and cannot mutate', () => {
  assert.doesNotThrow(() => validateRecoveryPlan({
    RECOVERY_STRATEGY: 'snapshot',
    RUNTIME_RECOVERY_SOURCE_MODE: 'github_snapshot',
    APPLY_EXECUTION: 'false',
  }));
  assert.throws(() => validateRecoveryPlan({
    RECOVERY_STRATEGY: 'snapshot',
    RUNTIME_RECOVERY_SOURCE_MODE: 'sql',
    APPLY_EXECUTION: 'false',
  }), /RECOVERY_SNAPSHOT_SOURCE_REQUIRED/);
  assert.throws(() => validateRecoveryPlan({
    RECOVERY_STRATEGY: 'snapshot',
    RUNTIME_RECOVERY_SOURCE_MODE: 'repository_snapshot',
    APPLY_EXECUTION: 'true',
  }), /RECOVERY_SNAPSHOT_MUTATION_DENIED/);
  assert.throws(() => validateRecoveryPlan({
    RECOVERY_STRATEGY: 'snapshot',
    RUNTIME_RECOVERY_SOURCE_MODE: 'repository_snapshot',
    APPLY_EXECUTION: 'maybe',
  }), /RECOVERY_INVALID_BOOLEAN/);
});

test('Production origin binding rejects non-canonical bearer destinations', () => {
  assert.equal(validateProductionBaseUrl('https://auth.mad4b.com'), 'https://auth.mad4b.com');
  assert.throws(() => validateProductionBaseUrl('https://mcp.mad4b.com'), /RECOVERY_PRODUCTION_ORIGIN_HOST_DENIED/);
  assert.throws(() => validateProductionBaseUrl('http://auth.mad4b.com'), /RECOVERY_PRODUCTION_ORIGIN_HTTPS_REQUIRED/);
  assert.throws(() => validateProductionBaseUrl('https://auth.mad4b.com/path'), /RECOVERY_PRODUCTION_ORIGIN_PATH_DENIED/);
});

test('fallback separates canonical baseline bootstrap from incident recovery', () => {
  assert.deepEqual(validateFallbackTargetPlan({
    key: 'runtime',
    database: 'growthOS',
    baseline_bootstrap_migrations: [{
      kind: 'schema',
      file: 'http-generic-api/schema.sql',
      expected_checksum: '14e624b74f86160475c66ba02f1003f3221acb46d9d9f79334352afa16a36c33',
      expected_statement_count: 27,
      data_statements_allowed: false,
    }],
    incident_recovery_migrations: [{
      kind: 'migration',
      file: 'http-generic-api/migrations/20260815_custom_gpt_mcp_catalog_levels.sql',
      expected_checksum: CHECKSUM_20260815,
      expected_statement_count: 7,
    }],
  }).incidentEntries.length, 1);
  assert.throws(() => validateFallbackTargetPlan({ key: 'runtime', database: 'growthOS', migrations: [] }), /RECOVERY_AMBIGUOUS_MIGRATIONS_FIELD/);
  assert.throws(() => validateFallbackTargetPlan({
    key: 'runtime',
    database: 'growthOS',
    incident_recovery_migrations: [{
      file: 'http-generic-api/migrations/1048_transport_response_chunk_schema_recovery.sql',
      expected_checksum: CHECKSUM_1048,
      expected_statement_count: 34,
    }],
  }), /RECOVERY_INCIDENT_MIGRATION_DENIED|RECOVERY_INCIDENT_MIGRATION_ROLE_DENIED/);
});

test('fallback grants are exactly six tables with SELECT INSERT UPDATE only', () => {
  const tables = [
    'customer_sessions',
    'gpt_session_turns',
    'actions',
    'dynamic_audit_scheduler_runs',
    'execution_log',
    'json_assets',
  ];
  const env = {
    RECOVERY_STRATEGY: 'fallback',
    PRODUCTION_BASE_URL: 'https://auth.mad4b.com',
    PRODUCTION_SOURCE_BRANCH: 'Production',
    RUNTIME_RECOVERY_SOURCE_MODE: 'sql',
    RECOVERY_TARGET_KEY: 'runtime',
    RUNTIME_RECOVERY_TARGETS_JSON: JSON.stringify([{
      key: 'runtime',
      database: 'growthOS',
      grants: tables.map((table) => ({ table, privileges: ['SELECT', 'INSERT', 'UPDATE'] })),
    }]),
  };
  const result = validateRecoveryPlan(env);
  assert.equal(result.ok, true);
  assert.equal(result.grant_table_count, 6);

  const widened = JSON.parse(env.RUNTIME_RECOVERY_TARGETS_JSON);
  widened[0].grants[0].privileges.push('DELETE');
  assert.throws(() => validateRecoveryPlan({ ...env, RUNTIME_RECOVERY_TARGETS_JSON: JSON.stringify(widened) }), /RECOVERY_GRANT_OPERATION_SET_DENIED/);
});
