#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  assertFallbackMigration,
  assertMigration,
  exactSet,
  validateConfiguredRecoveryStep,
  validateProductionBaseUrl,
  validateRecoveryPlan,
} from './production-runtime-recovery-policy.mjs';

const CHECKSUM_225 = '35b034940c2be63d9bf8a8099573cac1c5a75b5fffd8ccfad60a453ed3cf7419';
const CHECKSUM_1048 = 'aecfbd9d87dca6eba11677cd992637f55ecf3c0743f704df4bbea48c57d8d788';
const CHECKSUM_20260815 = '528143808adac23eb457058c4c34dd95c4c5d462bca9ac4b170b1f19b2006681';

const workflow = readFileSync(new URL('../workflows/production-runtime-parity-evidence.yml', import.meta.url), 'utf8');
const migrationExecutionTool = readFileSync(new URL('../../http-generic-api/governedMigrationExecutionTool.js', import.meta.url), 'utf8');
const migrationRunnerBootstrap = readFileSync(new URL('../../http-generic-api/scripts/governed-migration-runner-bootstrap.mjs', import.meta.url), 'utf8');
const migrationRunner = readFileSync(new URL('../../http-generic-api/scripts/governed-migration-runner.mjs', import.meta.url), 'utf8');

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

function fallbackMigration(migration, checksum, count, extra = {}) {
  return {
    file: `http-generic-api/migrations/${migration}`,
    expected_checksum: checksum,
    expected_statement_count: count,
    ...extra,
  };
}

function fallbackEnv(migrations = [fallbackMigration(
  '20260815_custom_gpt_mcp_catalog_levels.sql',
  CHECKSUM_20260815,
  7,
)]) {
  const tables = [
    'customer_sessions',
    'gpt_session_turns',
    'actions',
    'dynamic_audit_scheduler_runs',
    'execution_log',
    'json_assets',
  ];
  return {
    RECOVERY_STRATEGY: 'fallback',
    RUNTIME_RECOVERY_SOURCE_MODE: 'sql',
    PRODUCTION_BASE_URL: 'https://auth.mad4b.com',
    PRODUCTION_SOURCE_BRANCH: 'Production',
    RECOVERY_TARGET_KEY: 'runtime',
    RUNTIME_RECOVERY_TARGETS_JSON: JSON.stringify([{
      key: 'runtime',
      database: 'growthOS',
      principal: 'growthOS',
      principal_host: '%',
      migrations,
      grants: tables.map((table) => ({ table, privileges: ['SELECT', 'INSERT', 'UPDATE'] })),
    }]),
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

test('Production bearer origin is exact HTTPS auth host and Production branch', () => {
  assert.equal(validateProductionBaseUrl({
    PRODUCTION_BASE_URL: 'https://auth.mad4b.com',
    PRODUCTION_SOURCE_BRANCH: 'Production',
  }), 'https://auth.mad4b.com');
  assert.throws(() => validateProductionBaseUrl({
    PRODUCTION_BASE_URL: 'https://mcp.mad4b.com',
    PRODUCTION_SOURCE_BRANCH: 'Production',
  }), /RECOVERY_PRODUCTION_ORIGIN_HOST_DENIED/);
  assert.throws(() => validateProductionBaseUrl({
    PRODUCTION_BASE_URL: 'https://example.com',
    PRODUCTION_SOURCE_BRANCH: 'Production',
  }), /RECOVERY_PRODUCTION_ORIGIN_HOST_DENIED/);
  assert.throws(() => validateProductionBaseUrl({
    PRODUCTION_BASE_URL: 'http://auth.mad4b.com',
    PRODUCTION_SOURCE_BRANCH: 'Production',
  }), /RECOVERY_PRODUCTION_ORIGIN_TRANSPORT_DENIED/);
  assert.throws(() => validateProductionBaseUrl({
    PRODUCTION_BASE_URL: 'https://auth.mad4b.com/other',
    PRODUCTION_SOURCE_BRANCH: 'Production',
  }), /RECOVERY_PRODUCTION_BASE_URL_MUST_BE_ORIGIN/);
  assert.throws(() => validateProductionBaseUrl({
    PRODUCTION_BASE_URL: 'https://auth.mad4b.com',
    PRODUCTION_SOURCE_BRANCH: 'main',
  }), /RECOVERY_PRODUCTION_SOURCE_BRANCH_DENIED/);
});

test('direct SQL fallback is incident-scoped and cannot reapply 225 or 1048', () => {
  assert.doesNotThrow(() => assertFallbackMigration(fallbackMigration(
    '20260815_custom_gpt_mcp_catalog_levels.sql', CHECKSUM_20260815, 7,
  )));
  assert.equal(
    assertFallbackMigration(fallbackMigration(
      '20260815_custom_gpt_mcp_catalog_levels.sql', CHECKSUM_20260815, 7,
    )).role,
    'incident',
  );
  assert.throws(() => assertFallbackMigration(fallbackMigration(
    '225_sprint67_capability_resolution_envelope_ledger.sql', CHECKSUM_225, 3, { recovery_role: 'incident' },
  )), /RECOVERY_FALLBACK_INCIDENT_MIGRATION_DENIED/);
  assert.throws(() => assertFallbackMigration(fallbackMigration(
    '1048_transport_response_chunk_schema_recovery.sql', CHECKSUM_1048, 34, { recovery_role: 'incident' },
  )), /RECOVERY_FALLBACK_INCIDENT_MIGRATION_DENIED/);
  assert.throws(() => assertFallbackMigration(fallbackMigration(
    '176_sprint66_governed_migration_ledger.sql', '0'.repeat(64), 1, { recovery_role: 'baseline' },
  )), /RECOVERY_FALLBACK_BASELINE_MIGRATION_DENIED/);
});

test('fallback grants remain exactly six tables with SELECT INSERT UPDATE only', () => {
  const env = fallbackEnv();
  const result = validateRecoveryPlan(env);
  assert.equal(result.ok, true);
  assert.equal(result.contract, 'production-runtime-recovery-config-policy.v3');
  assert.equal(result.production_origin, 'https://auth.mad4b.com');
  assert.equal(result.grant_table_count, 6);
  assert.deepEqual(result.fallback_migrations, [{
    migration: '20260815_custom_gpt_mcp_catalog_levels.sql',
    role: 'incident',
  }]);

  const widened = JSON.parse(env.RUNTIME_RECOVERY_TARGETS_JSON);
  widened[0].grants[0].privileges.push('DELETE');
  assert.throws(() => validateRecoveryPlan({ ...env, RUNTIME_RECOVERY_TARGETS_JSON: JSON.stringify(widened) }), /RECOVERY_GRANT_OPERATION_SET_DENIED/);
});

test('workflow serializes all Production recovery and invokes centralized policy as execution authority', () => {
  assert.match(workflow, /group:\s*production-runtime-recovery-production/u);
  assert.doesNotMatch(workflow, /group:\s*production-runtime-recovery-\$\{\{\s*inputs\.strategy/u);
  assert.match(workflow, /node \.github\/ops\/production-runtime-recovery-policy\.mjs execute/u);
  assert.doesNotMatch(workflow, /run:\s*node \.github\/ops\/production-runtime-recovery-autodeploy\.mjs/u);
});

test('current runner ancestry contains bounded diagnostics and exact apply-ledger readback used to classify 502-class failures', () => {
  assert.match(migrationExecutionTool, /DEFAULT_DRY_RUN_RUNNER_TIMEOUT_MS\s*=\s*45_000/u);
  assert.match(migrationExecutionTool, /governed_migration_runner_timeout/u);
  assert.match(migrationExecutionTool, /governed_migration_runner_output_limit_exceeded/u);
  assert.match(migrationExecutionTool, /retry_without_readback_allowed:\s*false/u);
  assert.match(migrationRunnerBootstrap, /runner_artifact_readability/u);
  assert.match(migrationRunnerBootstrap, /runner_module_import/u);
  assert.match(migrationRunnerBootstrap, /runner_execution/u);
  assert.match(migrationRunner, /governed_migration_ledger/u);
  assert.match(migrationRunner, /findLedgerEntry\(migration, migration_checksum_sha256, "apply"\)/u);
  assert.match(migrationRunner, /already_applied:\s*true/u);
  assert.match(migrationRunner, /live_schema_preflight_skipped:\s*true/u);
});
