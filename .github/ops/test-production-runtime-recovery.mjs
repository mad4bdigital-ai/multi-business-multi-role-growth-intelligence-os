#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  isSubset,
  parseBoolean,
  renderTemplate,
  requiredConfirmation,
  resolveMigrationPath,
  validateApplyGate,
  validateSha,
  validateTargetPlan,
} from './production-runtime-recovery.mjs';
import {
  buildRuntimeRecoverySnapshotWriteBlockedError,
  isRuntimeRecoverySnapshotEnabled,
  loadRuntimeRecoverySnapshot,
  resolveRuntimeRecoverySourceMode,
} from '../../http-generic-api/runtimeRecoverySnapshot.js';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const workflow = readFileSync(new URL('../workflows/production-runtime-recovery.yml', import.meta.url), 'utf8');
const operator = readFileSync(new URL('./production-runtime-recovery.mjs', import.meta.url), 'utf8');
const gptRoutes = readFileSync(new URL('../../http-generic-api/routes/gptToolsRoutes.js', import.meta.url), 'utf8');
const activationRoutes = readFileSync(new URL('../../http-generic-api/routes/activationRoutes.js', import.meta.url), 'utf8');
const snapshotModule = readFileSync(new URL('../../http-generic-api/runtimeRecoverySnapshot.js', import.meta.url), 'utf8');

test('renderTemplate replaces only known placeholders recursively', () => {
  const rendered = renderTemplate(
    {
      ref: '{{sha}}',
      nested: ['{{branch}}', '{{unknown}}'],
      untouched: true,
    },
    { sha: SHA, branch: 'main' },
  );
  assert.deepEqual(rendered, {
    ref: SHA,
    nested: ['main', '{{unknown}}'],
    untouched: true,
  });
});

test('isSubset validates nested expected contracts without requiring exact response equality', () => {
  assert.equal(isSubset(
    { already_applied: true, nested: { applies_sql: false } },
    { already_applied: true, nested: { applies_sql: false, extra: 'ok' }, extra: 1 },
  ), true);
  assert.equal(isSubset({ already_applied: true }, { already_applied: false }), false);
});

test('validateSha accepts only full lowercase-normalized commit SHAs', () => {
  assert.equal(validateSha(SHA.toUpperCase()), SHA);
  assert.throws(() => validateSha('abc123'), (error) => error.code === 'invalid_sha');
});

test('mutation confirmation is bound to strategy and exact SHA', () => {
  assert.equal(requiredConfirmation('primary', SHA), `RECOVER:primary:${SHA}`);
  assert.doesNotThrow(() => validateApplyGate({
    strategy: 'fallback',
    sha: SHA,
    applyExecution: true,
    confirmation: `RECOVER:fallback:${SHA}`,
  }));
  assert.throws(() => validateApplyGate({
    strategy: 'fallback',
    sha: SHA,
    applyExecution: true,
    confirmation: `RECOVER:primary:${SHA}`,
  }), (error) => error.code === 'confirmation_mismatch');
});

test('dry-run does not require a mutation confirmation', () => {
  assert.doesNotThrow(() => validateApplyGate({
    strategy: 'primary',
    sha: SHA,
    applyExecution: false,
    confirmation: '',
  }));
  assert.equal(parseBoolean('TRUE'), true);
  assert.equal(parseBoolean('false', true), false);
});

test('migration path is confined to canonical repository migrations directory', () => {
  const safe = resolveMigrationPath('http-generic-api/migrations/20260815_custom_gpt_mcp_catalog_levels.sql');
  assert.match(safe.repoPath, /^http-generic-api\/migrations\//);
  assert.throws(
    () => resolveMigrationPath('../../.github/workflows/production-runtime-recovery.yml'),
    (error) => error.code === 'unsafe_migration_path',
  );
});

test('target plan remains explicit and rejects unsafe database or migration configuration', () => {
  assert.doesNotThrow(() => validateTargetPlan({
    key: 'runtime',
    database: 'u338416126_growthOS',
    principal: 'u338416126_growthOS',
    principal_host: '%',
    migrations: [
      {
        file: 'http-generic-api/migrations/20260815_custom_gpt_mcp_catalog_levels.sql',
        expected_checksum: '528143808adac23eb457058c4c34dd95c4c5d462bca9ac4b170b1f19b2006681',
      },
    ],
  }));
  assert.throws(
    () => validateTargetPlan({ key: 'runtime', database: 'growthOS;DROP DATABASE x', migrations: [] }),
    (error) => error.code === 'target_invalid',
  );
});

test('repository snapshot is DB-independent, read-only, and non-persistent', () => {
  const snapshot = loadRuntimeRecoverySnapshot({ RUNTIME_RECOVERY_SOURCE_MODE: 'repository_snapshot' });
  assert.equal(snapshot.enabled, true);
  assert.equal(snapshot.mode, 'repository_snapshot');
  assert.equal(snapshot.database_required, false);
  assert.equal(snapshot.database_connection_performed, false);
  assert.equal(snapshot.database_mutation_performed, false);
  assert.equal(snapshot.provider_mutation_performed, false);
  assert.equal(snapshot.runtime_authority, false);
  assert.equal(snapshot.persistence, 'unavailable');
  assert.equal(snapshot.catalog.tools.length, 1);
  assert.equal(snapshot.sessionContext.read_only, true);
  assert.equal(snapshot.sessionContext.session_id, null);
  assert.equal(snapshot.sessionContext.session_management.persistent, false);
  assert.equal(snapshot.sessionContext.conversation_memory.status, 'snapshot');
  assert.equal(snapshot.sessionContext.platform_access.database_required, false);
  assert.equal(snapshot.sessionContext.authorized_access.database_required, false);
});

test('GitHub snapshot uses bounded JSON variables and rejects authority-bearing payloads', () => {
  const raw = JSON.stringify({
    catalog: { tools: [{ name: 'runtime_recovery_status_read_only', method: 'VIRTUAL' }] },
    session_context: { subject: { tenant_id: 'tenant-1' } },
  });
  const snapshot = loadRuntimeRecoverySnapshot({ RUNTIME_RECOVERY_SOURCE_MODE: 'github_snapshot', RUNTIME_RECOVERY_SNAPSHOT_JSON: raw });
  assert.equal(snapshot.mode, 'github_snapshot');
  assert.equal(isRuntimeRecoverySnapshotEnabled({ RUNTIME_RECOVERY_SOURCE_MODE: 'github_snapshot' }), true);
  assert.equal(resolveRuntimeRecoverySourceMode({ RUNTIME_RECOVERY_SOURCE_MODE: 'sql' }), 'sql');
  assert.throws(
    () => loadRuntimeRecoverySnapshot({ RUNTIME_RECOVERY_SOURCE_MODE: 'github_snapshot', RUNTIME_RECOVERY_SNAPSHOT_JSON: JSON.stringify({ catalog: { tools: [{ name: 'x' }] }, session_context: { session_id: 'durable-session' } }) }),
    (error) => error.code === 'RUNTIME_RECOVERY_SNAPSHOT_SESSION_ID_FORBIDDEN',
  );
  assert.throws(
    () => loadRuntimeRecoverySnapshot({ RUNTIME_RECOVERY_SOURCE_MODE: 'github_snapshot', RUNTIME_RECOVERY_SNAPSHOT_JSON: JSON.stringify({ catalog: { tools: [{ name: 'x' }] }, session_context: {}, runtime_authority: true }) }),
    (error) => error.code === 'RUNTIME_RECOVERY_SNAPSHOT_AUTHORITY_FORBIDDEN',
  );
  assert.throws(
    () => loadRuntimeRecoverySnapshot({ RUNTIME_RECOVERY_SOURCE_MODE: 'github_snapshot', RUNTIME_RECOVERY_SNAPSHOT_JSON: JSON.stringify({ catalog: { tools: [{ name: 'x' }] }, session_context: { password: 'nope' } }) }),
    (error) => error.code === 'RUNTIME_RECOVERY_SNAPSHOT_SENSITIVE_FIELD',
  );
  assert.equal(buildRuntimeRecoverySnapshotWriteBlockedError('grant_apply').code, 'RUNTIME_RECOVERY_SNAPSHOT_READ_ONLY');
  assert.throws(() => resolveRuntimeRecoverySourceMode({ RUNTIME_RECOVERY_SOURCE_MODE: 'unknown' }), (error) => error.code === 'RUNTIME_RECOVERY_SNAPSHOT_MODE_INVALID');
});

test('sql mode remains the only mode that requires database-backed runtime state', () => {
  const sql = loadRuntimeRecoverySnapshot({ RUNTIME_RECOVERY_SOURCE_MODE: 'sql' });
  assert.equal(sql.enabled, false);
  assert.equal(sql.database_required, true);
  assert.equal(isRuntimeRecoverySnapshotEnabled({ RUNTIME_RECOVERY_SOURCE_MODE: 'sql' }), false);
});

test('workflow exposes typed snapshot mode and non-secret variables', () => {
  assert.match(workflow, /- snapshot/u);
  assert.match(workflow, /source_mode:/u);
  assert.match(workflow, /github_snapshot/u);
  assert.match(workflow, /repository_snapshot/u);
  assert.match(workflow, /RUNTIME_RECOVERY_SOURCE_MODE: \$\{\{ inputs\.source_mode \}\}/u);
  assert.match(workflow, /RUNTIME_RECOVERY_SNAPSHOT_JSON: \$\{\{ vars\.RUNTIME_RECOVERY_SNAPSHOT_JSON \}\}/u);
  assert.match(workflow, /RUNTIME_RECOVERY_CATALOG_JSON: \$\{\{ vars\.RUNTIME_RECOVERY_CATALOG_JSON \}\}/u);
  assert.match(workflow, /RUNTIME_RECOVERY_SESSION_CONTEXT_JSON: \$\{\{ vars\.RUNTIME_RECOVERY_SESSION_CONTEXT_JSON \}\}/u);
  assert.match(workflow, /RUNTIME_RECOVERY_SNAPSHOT_PATH: \$\{\{ vars\.RUNTIME_RECOVERY_SNAPSHOT_PATH/gu);
  assert.doesNotMatch(workflow, /RUNTIME_RECOVERY_(?:SNAPSHOT|CATALOG|SESSION_CONTEXT)_JSON: \$\{\{ secrets\./u);
  assert.match(operator, /snapshot_mutation_forbidden/u);
  assert.match(gptRoutes, /isRuntimeRecoverySnapshotEnabled\(\)/u);
  assert.match(gptRoutes, /buildRuntimeRecoverySnapshotWriteBlockedError/u);
  assert.match(gptRoutes, /if \(!isRuntimeRecoverySnapshotEnabled\(\)\)/u);
  assert.match(activationRoutes, /export async function buildActivationSessionContext\(req\) \{\s*if \(isRuntimeRecoverySnapshotEnabled\(\)\)/u);
  assert.match(activationRoutes, /const pool = getPool\(\);/u);
  assert.match(snapshotModule, /snapshot_read_only/u);
});
