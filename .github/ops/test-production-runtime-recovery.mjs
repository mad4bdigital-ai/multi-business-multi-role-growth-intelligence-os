#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  isSubset,
  manifestMatches,
  run,
  parseBoolean,
  renderTemplate,
  requiredConfirmation,
  resolveMigrationPath,
  resolveRoute,
  validateApplyGate,
  validateConfiguredStep,
  validateSha,
  validateTargetPlan,
} from './production-runtime-recovery-autodeploy.mjs';
import {
  buildRuntimeRecoverySnapshotWriteBlockedError,
  isRuntimeRecoverySnapshotEnabled,
  loadRuntimeRecoverySnapshot,
  resolveRuntimeRecoverySourceMode,
} from '../../http-generic-api/runtimeRecoverySnapshot.js';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const workflow = readFileSync(new URL('../workflows/production-runtime-recovery.yml', import.meta.url), 'utf8');
const operator = readFileSync(new URL('./production-runtime-recovery-autodeploy.mjs', import.meta.url), 'utf8');
const routeContract = JSON.parse(readFileSync(new URL('./production-runtime-recovery-routes.json', import.meta.url), 'utf8'));
const gptRoutes = readFileSync(new URL('../../http-generic-api/routes/gptToolsRoutes.js', import.meta.url), 'utf8');
const activationRoutes = readFileSync(new URL('../../http-generic-api/routes/activationRoutes.js', import.meta.url), 'utf8');
const deploymentRoutes = readFileSync(new URL('../../http-generic-api/routes/deploymentInfoRoutes.js', import.meta.url), 'utf8');
const healthRoutes = readFileSync(new URL('../../http-generic-api/routes/healthRoutes.js', import.meta.url), 'utf8');
const snapshotModule = readFileSync(new URL('../../http-generic-api/runtimeRecoverySnapshot.js', import.meta.url), 'utf8');

test('canonical route contract is bound to repository runtime routes', () => {
  assert.equal(routeContract.schema_version, 'production-runtime-recovery-routes.v1');
  assert.equal(resolveRoute('health').path, '/health');
  assert.equal(resolveRoute('version').path, '/version');
  assert.equal(resolveRoute('deployment_info').path, '/deployment-info');
  assert.equal(resolveRoute('gpt_tools').path, '/gpt/tools');
  assert.equal(resolveRoute('gpt_tool_call').path, '/gpt/tools/call');
  assert.equal(resolveRoute('session_context').path, '/activation/session-context/read-only');

  assert.match(healthRoutes, /["']\/health["']/u);
  assert.match(healthRoutes, /["']\/version["']/u);
  assert.match(deploymentRoutes, /["']\/deployment-info["']/u);
  assert.match(gptRoutes, /["']\/gpt\/tools["']/u);
  assert.match(gptRoutes, /["']\/gpt\/tools\/call["']/u);
  assert.match(activationRoutes, /["']\/activation\/session-context\/read-only["']/u);
});

test('configured steps cannot redirect recovery to arbitrary paths', () => {
  assert.throws(
    () => validateConfiguredStep({ route_key: 'gpt_tool_call', path: '/other', body: { name: 'x', tool_args: {} } }, { allowMutation: true }),
    (error) => error.code === 'arbitrary_route_forbidden',
  );
  assert.throws(
    () => validateConfiguredStep({ route_key: 'unknown', body: {} }, { allowMutation: false }),
    (error) => error.code === 'route_key_unknown',
  );
  assert.throws(
    () => validateConfiguredStep({ route_key: 'gpt_tool_call', method: 'GET', body: { name: 'x', tool_args: {} } }, { allowMutation: true }),
    (error) => error.code === 'route_method_mismatch',
  );
});

test('gpt tool call envelope is fixed to name plus tool_args object', () => {
  assert.doesNotThrow(() => validateConfiguredStep({
    route_key: 'gpt_tool_call',
    mutation: true,
    body: { name: 'governed_migration_execute', tool_args: { migration: 'x.sql', mode: 'dry_run' } },
  }, { allowMutation: true }));
  assert.throws(
    () => validateConfiguredStep({ route_key: 'gpt_tool_call', body: { name: 'x' } }),
    (error) => error.code === 'tool_call_envelope_invalid',
  );
});

test('Hostinger Auto Deploy provenance requires exact structured commit and branch on each manifest response', () => {
  const response = { ok: true, json: { gitCommitFull: SHA, gitBranch: 'Production', extra: true } };
  assert.equal(manifestMatches({ response, sha: SHA, branch: 'Production' }), true);
  assert.equal(manifestMatches({ response, sha: SHA, branch: 'main' }), false);
  assert.equal(manifestMatches({ response: { ok: true, json: { gitCommit: SHA.slice(0, 12), gitBranch: 'Production' } }, sha: SHA, branch: 'Production' }), false);
});

test('workflow observes Hostinger Auto Deploy and contains no provider deployment credential path', () => {
  assert.match(workflow, /Recover Production after Hostinger Auto Deploy/u);
  assert.match(workflow, /production-runtime-recovery-autodeploy\.mjs/u);
  assert.doesNotMatch(workflow, /PRODUCTION_DEPLOY_URL/u);
  assert.doesNotMatch(workflow, /PRODUCTION_DEPLOY_AUTH_VALUE/u);
  assert.doesNotMatch(workflow, /HOSTINGER_DEPLOYMENT_TARGET_ID/u);
  assert.doesNotMatch(operator, /deployRelease\(/u);
  assert.doesNotMatch(operator, /provider_deploy_credential_required:\s*true/u);
});

test('renderTemplate replaces only known placeholders recursively', () => {
  const rendered = renderTemplate({ ref: '{{sha}}', nested: ['{{branch}}', '{{unknown}}'] }, { sha: SHA, branch: 'Production' });
  assert.deepEqual(rendered, { ref: SHA, nested: ['Production', '{{unknown}}'] });
});

test('isSubset validates nested expected contracts without exact response equality', () => {
  assert.equal(isSubset({ result: { already_applied: true, applies_sql: false } }, { result: { already_applied: true, applies_sql: false, extra: 1 }, request_id: 'x' }), true);
  assert.equal(isSubset({ result: { already_applied: true } }, { result: { already_applied: false } }), false);
});

test('validateSha accepts only full commit SHAs', () => {
  assert.equal(validateSha(SHA.toUpperCase()), SHA);
  assert.throws(() => validateSha('abc123'), (error) => error.code === 'invalid_sha');
});

test('mutation confirmation is bound to strategy and exact SHA', () => {
  assert.equal(requiredConfirmation('primary', SHA), `RECOVER:primary:${SHA}`);
  assert.doesNotThrow(() => validateApplyGate({ strategy: 'fallback', sha: SHA, applyExecution: true, confirmation: `RECOVER:fallback:${SHA}` }));
  assert.throws(
    () => validateApplyGate({ strategy: 'fallback', sha: SHA, applyExecution: true, confirmation: `RECOVER:primary:${SHA}` }),
    (error) => error.code === 'confirmation_mismatch',
  );
  assert.doesNotThrow(() => validateApplyGate({ strategy: 'primary', sha: SHA, applyExecution: false, confirmation: '' }));
  assert.equal(parseBoolean('TRUE'), true);
});

test('migration paths remain confined to canonical repository migrations', () => {
  const safe = resolveMigrationPath('http-generic-api/migrations/20260815_custom_gpt_mcp_catalog_levels.sql');
  assert.match(safe.repoPath, /^http-generic-api\/migrations\//u);
  assert.throws(() => resolveMigrationPath('../../.github/workflows/production-runtime-recovery.yml'), (error) => error.code === 'unsafe_migration_path');
});

test('fallback target plan is explicit and identifier-safe', () => {
  assert.doesNotThrow(() => validateTargetPlan({
    key: 'runtime',
    database: 'u338416126_growthOS',
    principal: 'u338416126_growthOS',
    principal_host: '%',
    migrations: [{
      file: 'http-generic-api/migrations/20260815_custom_gpt_mcp_catalog_levels.sql',
      expected_checksum: '528143808adac23eb457058c4c34dd95c4c5d462bca9ac4b170b1f19b2006681',
    }],
  }));
  assert.throws(() => validateTargetPlan({ key: 'runtime', database: 'growthOS;DROP DATABASE x', migrations: [] }), (error) => error.code === 'target_invalid');
});

test('repository snapshot stays DB-independent, read-only, and non-persistent', () => {
  const snapshot = loadRuntimeRecoverySnapshot({ RUNTIME_RECOVERY_SOURCE_MODE: 'repository_snapshot' });
  assert.equal(snapshot.enabled, true);
  assert.equal(snapshot.mode, 'repository_snapshot');
  assert.equal(snapshot.database_required, false);
  assert.equal(snapshot.database_connection_performed, false);
  assert.equal(snapshot.database_mutation_performed, false);
  assert.equal(snapshot.provider_mutation_performed, false);
  assert.equal(snapshot.runtime_authority, false);
  assert.equal(snapshot.persistence, 'unavailable');
  assert.equal(snapshot.sessionContext.read_only, true);
  assert.equal(snapshot.sessionContext.session_management.persistent, false);
});

test('Auto Deploy snapshot result is explicitly DB-independent and non-authoritative', async () => {
  const result = await run({
    RECOVERY_STRATEGY: 'snapshot',
    EXPECTED_SHA: SHA,
    APPLY_EXECUTION: 'false',
    RUNTIME_RECOVERY_SOURCE_MODE: 'repository_snapshot',
  });
  assert.equal(result.ok, true);
  assert.equal(result.mutation_performed, false);
  assert.equal(result.database_connection_performed, false);
  assert.equal(result.database_mutation_performed, false);
  assert.equal(result.provider_mutation_performed, false);
  assert.equal(result.database_required, false);
  assert.equal(result.persistence, 'unavailable');
  assert.equal(result.runtime_authority, false);
  assert.equal(result.snapshot.mode, 'repository_snapshot');
});

test('GitHub snapshot variables cannot carry runtime authority or durable session IDs', () => {
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
  assert.equal(buildRuntimeRecoverySnapshotWriteBlockedError('grant_apply').code, 'RUNTIME_RECOVERY_SNAPSHOT_READ_ONLY');
});

test('workflow exposes snapshot variables only as non-secret descriptors', () => {
  assert.match(workflow, /- snapshot/u);
  assert.match(workflow, /RUNTIME_RECOVERY_SOURCE_MODE: \$\{\{ inputs\.source_mode \}\}/u);
  assert.match(workflow, /RUNTIME_RECOVERY_SNAPSHOT_JSON: \$\{\{ vars\.RUNTIME_RECOVERY_SNAPSHOT_JSON \}\}/u);
  assert.match(workflow, /RUNTIME_RECOVERY_CATALOG_JSON: \$\{\{ vars\.RUNTIME_RECOVERY_CATALOG_JSON \}\}/u);
  assert.match(workflow, /RUNTIME_RECOVERY_SESSION_CONTEXT_JSON: \$\{\{ vars\.RUNTIME_RECOVERY_SESSION_CONTEXT_JSON \}\}/u);
  assert.doesNotMatch(workflow, /RUNTIME_RECOVERY_(?:SNAPSHOT|CATALOG|SESSION_CONTEXT)_JSON: \$\{\{ secrets\./u);
  assert.doesNotMatch(workflow, /^\s{6}PRODUCTION_PROBE_AUTH_VALUE:/mu);
  assert.doesNotMatch(workflow, /^\s{6}MYSQL_BOOTSTRAP_(?:HOST|PORT|USER|PASSWORD):/mu);
  assert.match(workflow, /inputs\.strategy != 'snapshot' && secrets\.PRODUCTION_PROBE_AUTH_VALUE/u);
  assert.match(workflow, /inputs\.strategy == 'fallback' && secrets\.MYSQL_BOOTSTRAP_(?:USER|PASSWORD)/u);
  assert.match(operator, /snapshot_mutation_forbidden/u);
  assert.match(snapshotModule, /snapshot_read_only/u);
});
