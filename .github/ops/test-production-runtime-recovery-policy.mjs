#!/usr/bin/env node

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertMigration,
  exactSet,
  validateConfiguredRecoveryStep,
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
