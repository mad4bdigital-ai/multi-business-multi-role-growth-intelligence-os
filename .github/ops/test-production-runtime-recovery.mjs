#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  assertBaselineSchemaSafety,
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
import {
  validateFallbackTargetPlan,
  validateProductionBaseUrl,
} from './production-runtime-recovery-policy.mjs';
import { buildVersionPayload } from '../../http-generic-api/deploymentManifest.js';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const workflow = readFileSync(new URL('../workflows/production-runtime-parity-evidence.yml', import.meta.url), 'utf8');
const operator = readFileSync(new URL('./production-runtime-recovery-autodeploy.mjs', import.meta.url), 'utf8');
const recoveryPolicy = readFileSync(new URL('./production-runtime-recovery-policy.mjs', import.meta.url), 'utf8');
const routeContract = JSON.parse(readFileSync(new URL('./production-runtime-recovery-routes.json', import.meta.url), 'utf8'));
const deploymentPolicy = JSON.parse(readFileSync(new URL('../../http-generic-api/config/deployment-branch-policy.json', import.meta.url), 'utf8'));
const gptRoutes = readFileSync(new URL('../../http-generic-api/routes/gptToolsRoutes.js', import.meta.url), 'utf8');
const activationRoutes = readFileSync(new URL('../../http-generic-api/routes/activationRoutes.js', import.meta.url), 'utf8');
const deploymentRoutes = readFileSync(new URL('../../http-generic-api/routes/deploymentInfoRoutes.js', import.meta.url), 'utf8');
const healthRoutes = readFileSync(new URL('../../http-generic-api/routes/healthRoutes.js', import.meta.url), 'utf8');
const snapshotModule = readFileSync(new URL('../../http-generic-api/runtimeRecoverySnapshot.js', import.meta.url), 'utf8');
const migrationExecutionTool = readFileSync(new URL('../../http-generic-api/governedMigrationExecutionTool.js', import.meta.url), 'utf8');
const migrationRunnerBootstrap = readFileSync(new URL('../../http-generic-api/scripts/governed-migration-runner-bootstrap.mjs', import.meta.url), 'utf8');
const migrationRunner = readFileSync(new URL('../../http-generic-api/scripts/governed-migration-runner.mjs', import.meta.url), 'utf8');

test('canonical route contract is bound to repository runtime routes and deployment policy', () => {
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

  assert.equal(deploymentPolicy.production.deployment_mode, 'hostinger_auto_deploy');
  assert.equal(deploymentPolicy.production.auto_deploy_on_push, true);
  assert.equal(deploymentPolicy.production.source_branch, 'Production');
  assert.deepEqual(
    [...deploymentPolicy.production.required_readbacks].sort(),
    [resolveRoute('health').path, resolveRoute('version').path, resolveRoute('deployment_info').path].sort(),
  );
  assert.equal(routeContract.production_origin_binding.source_policy, 'http-generic-api/config/deployment-branch-policy.json');
  assert.equal(routeContract.production_origin_binding.require_exact_hostname, true);
  assert.equal(routeContract.production_origin_binding.require_https, true);
  assert.deepEqual(routeContract.fallback_migration_policy.incident_recovery_allowlist, ['20260815_custom_gpt_mcp_catalog_levels.sql']);
  assert.deepEqual([...routeContract.fallback_migration_policy.verification_only_allowlist].sort(), [
    '225_sprint67_capability_resolution_envelope_ledger.sql',
    '1048_transport_response_chunk_schema_recovery.sql',
  ].sort());
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

test('version payload exposes canonical full SHA and branch from deployment manifest', () => {
  const payload = buildVersionPayload({
    serviceVersion: 'test',
    env: {
      DEPLOYMENT_MANIFEST_JSON: JSON.stringify({
        repository: 'mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os',
        branch: 'Production',
        commit_sha: SHA,
        source: 'test',
        secrets_included: false,
      }),
      DEPLOYMENT_EXPECTED_COMMIT_SHA: SHA,
    },
  });
  assert.equal(payload.gitCommitFull, SHA);
  assert.equal(payload.gitBranch, 'Production');
  assert.equal(payload.deployment.deployed_commit_sha, SHA);
});

test('deployment-info source exposes canonical manifest identity fields rather than relying on git fallback', () => {
  assert.match(deploymentRoutes, /gitCommitFull:\s*canonicalCommitFull/u);
  assert.match(deploymentRoutes, /gitBranch:\s*canonicalBranch/u);
  assert.match(deploymentRoutes, /provenanceSource:\s*canonicalDeployment\?\.source/u);
  assert.match(deploymentRoutes, /canonical_manifest_detected:\s*Boolean\(canonicalDeployment\)/u);
});

test('Hostinger Auto Deploy provenance requires exact structured full commit and branch on each response', () => {
  const response = { ok: true, json: { gitCommitFull: SHA, gitBranch: 'Production', extra: true } };
  assert.equal(manifestMatches({ response, sha: SHA, branch: 'Production' }), true);
  assert.equal(manifestMatches({ response, sha: SHA, branch: 'main' }), false);
  assert.equal(manifestMatches({ response: { ok: true, json: { gitCommitFull: SHA.slice(0, 12), gitBranch: 'Production' } }, sha: SHA, branch: 'Production' }), false);
  assert.equal(manifestMatches({ response: { ok: true, json: { gitCommitFull: SHA, gitBranch: null } }, sha: SHA, branch: 'Production' }), false);
});

test('workflow observes Hostinger Auto Deploy and contains no provider deployment credential path', () => {
  assert.match(workflow, /Recover Production after Hostinger Auto Deploy/u);
  assert.match(workflow, /production-runtime-recovery-policy\.mjs execute/u);
  assert.doesNotMatch(workflow, /PRODUCTION_DEPLOY_URL/u);
  assert.doesNotMatch(workflow, /PRODUCTION_DEPLOY_AUTH_VALUE/u);
  assert.doesNotMatch(workflow, /HOSTINGER_DEPLOYMENT_TARGET_ID/u);
  assert.doesNotMatch(operator, /deployRelease\(/u);
  assert.doesNotMatch(operator, /provider_deploy_credential_required:\s*true/u);
});

test('primary and fallback recovery share one Production mutation lock', () => {
  const recoveryConcurrency = workflow.match(/\n  recovery:[\s\S]*?\n    env:/u)?.[0] || '';
  assert.match(recoveryConcurrency, /concurrency:\n\s+group: production-runtime-recovery-production\n\s+cancel-in-progress: false/u);
  assert.doesNotMatch(recoveryConcurrency, /production-runtime-recovery-\$\{\{ inputs\.strategy/u);
  assert.doesNotMatch(recoveryConcurrency, /production-runtime-recovery-\$\{\{ inputs\.target_key/u);
});

test('Production bearer destination is bound to the canonical origin', () => {
  assert.equal(validateProductionBaseUrl('https://auth.mad4b.com'), 'https://auth.mad4b.com');
  assert.equal(validateProductionBaseUrl('https://AUTH.MAD4B.COM/'), 'https://auth.mad4b.com');
  assert.throws(() => validateProductionBaseUrl('https://mcp.mad4b.com'), /RECOVERY_PRODUCTION_ORIGIN_HOST_DENIED/);
  assert.throws(() => validateProductionBaseUrl('https://auth.mad4b.com:8443'), /RECOVERY_PRODUCTION_ORIGIN_PORT_DENIED/);
  assert.throws(() => validateProductionBaseUrl('https://user:pass@auth.mad4b.com'), /RECOVERY_PRODUCTION_ORIGIN_USERINFO_DENIED/);
  assert.throws(() => validateProductionBaseUrl('https://auth.mad4b.com/recovery'), /RECOVERY_PRODUCTION_ORIGIN_PATH_DENIED/);
});

test('operator self-enforces the centralized policy before every strategy', () => {
  assert.match(operator, /validateRecoveryPlan\(env, ROUTE_CONTRACT\)/u);
  assert.match(operator, /validateProductionBaseUrl\(env\.PRODUCTION_BASE_URL, ROUTE_CONTRACT\)/u);
  assert.match(operator, /validateFallbackTargetPlan\(target, ROUTE_CONTRACT\)/u);
});

test('reviewed route contract narrows recovery tools, migrations and grant scope', () => {
  const policy = routeContract.routes.gpt_tool_call.tool_policy;
  assert.equal(policy.unknown_tool_policy, 'deny');
  assert.deepEqual(policy.read_only_tools, ['governed_migration_schema_readback']);
  assert.deepEqual(policy.mode_scoped_tools.governed_migration_execute.read_only_modes, ['dry_run']);
  assert.deepEqual(policy.mode_scoped_tools.governed_migration_execute.mutation_modes, ['apply']);
  assert.deepEqual([...policy.mutation_tools].sort(), [
    'governed_migration_apply_policy_bootstrap',
    'governed_migration_authorization_bootstrap',
  ]);
  assert.equal(policy.dedicated_post_apply_tools.response_chunk_durable_recovery_smoke.generic_configured_step_allowed, false);
  assert.equal(policy.dedicated_post_apply_tools.response_chunk_durable_recovery_smoke.confirmation_value, 'RUN_RESPONSE_CHUNK_DURABLE_RECOVERY_SMOKE');

  assert.deepEqual(routeContract.recovery_migrations['225_sprint67_capability_resolution_envelope_ledger.sql'].allowed_modes, ['dry_run']);
  assert.deepEqual(routeContract.recovery_migrations['1048_transport_response_chunk_schema_recovery.sql'].allowed_modes, ['dry_run']);
  assert.deepEqual(routeContract.recovery_migrations['20260815_custom_gpt_mcp_catalog_levels.sql'].allowed_modes, ['dry_run', 'apply']);
  assert.equal(routeContract.recovery_migrations['20260815_custom_gpt_mcp_catalog_levels.sql'].incident_role, 'only_current_apply_candidate');

  assert.deepEqual(routeContract.grant_policy.required_tables, [
    'customer_sessions',
    'gpt_session_turns',
    'actions',
    'dynamic_audit_scheduler_runs',
    'execution_log',
    'json_assets',
  ]);
  assert.deepEqual(routeContract.grant_policy.required_operations, ['SELECT', 'INSERT', 'UPDATE']);
  assert.equal(routeContract.grant_policy.allow_additional_tables, false);
  assert.equal(routeContract.grant_policy.allow_schema_write_privileges, false);
  assert.equal(routeContract.grant_policy.allow_global_write_privileges, false);
  assert.equal(routeContract.grant_policy.allow_grant_option, false);
  assert.equal(routeContract.grant_policy.same_cycle_readback_required, true);
  assert.equal(routeContract.fallback_sql_policy, undefined);
  assert.equal(routeContract.fallback_migration_policy.canonical_governed_ledger, 'governed_migration_ledger');
  assert.equal(routeContract.fallback_migration_policy.canonical_governed_ledger_required, true);
  assert.deepEqual(Object.keys(routeContract.fallback_migration_policy.incident_postconditions['20260815_custom_gpt_mcp_catalog_levels.sql']), ['0', '1', '2', '3', '4']);
});

test('runner ancestry preserves bounded diagnostics and canonical ledger evidence', () => {
  assert.match(migrationExecutionTool, /governed_migration_runner_timeout/u);
  assert.match(migrationExecutionTool, /governed_migration_runner_output_limit_exceeded/u);
  assert.match(migrationRunnerBootstrap, /runner_artifact_readability/u);
  assert.match(migrationRunnerBootstrap, /runner_module_import/u);
  assert.match(migrationRunnerBootstrap, /runner_execution/u);
  assert.match(migrationRunner, /governed_migration_ledger/u);
  assert.match(migrationRunner, /record_only/u);
});

test('workflow enforces tool policy and performs same-cycle privilege and live persistence readbacks', () => {
  assert.match(workflow, /Validate configured recovery plan against reviewed policy/u);
  assert.match(recoveryPolicy, /RECOVERY_DEDICATED_TOOL_GENERIC_DISPATCH_DENIED/u);
  assert.match(recoveryPolicy, /export async function executeRecovery/u);
  assert.match(recoveryPolicy, /prepareFallbackCanonicalLedger/u);
  assert.match(recoveryPolicy, /finalizeFallbackCanonicalLedger/u);
  assert.match(recoveryPolicy, /governed_migration_ledger/u);
  assert.match(recoveryPolicy, /RECOVERY_DRY_RUN_REQUIRED/u);
  assert.match(recoveryPolicy, /RECOVERY_APPLY_MIGRATION_DENIED/u);
  assert.match(recoveryPolicy, /RECOVERY_GRANT_TABLE_SET_DENIED/u);
  assert.match(workflow, /Verify fallback least-privilege grants in same cycle/u);
  assert.match(recoveryPolicy, /information_schema\.USER_PRIVILEGES/u);
  assert.match(recoveryPolicy, /information_schema\.SCHEMA_PRIVILEGES/u);
  assert.match(recoveryPolicy, /information_schema\.TABLE_PRIVILEGES/u);
  assert.match(recoveryPolicy, /outside_allowlist_table_write_count/u);
  assert.match(workflow, /Verify live response-chunk persistence binding/u);
  assert.match(recoveryPolicy, /response_chunk_durable_recovery_smoke/u);
  assert.match(recoveryPolicy, /smokePolicy\.confirmation_value/u);
  assert.match(recoveryPolicy, /durable_row_present_immediately_after_chunk_id_return/u);
  assert.match(recoveryPolicy, /recovery_source === 'governed_tool_response_chunk_store'/u);
  assert.match(recoveryPolicy, /exact_unicode_reconstruction/u);
  assert.match(recoveryPolicy, /sliding_extension_verified/u);
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

test('canonical baseline schema is checksum-bound, statement-bound, and data-free', () => {
  const schema = readFileSync(new URL('../../http-generic-api/schema.sql', import.meta.url), 'utf8');
  assert.doesNotThrow(() => assertBaselineSchemaSafety('http-generic-api/schema.sql', schema, {
    sha256: 'ccec29be9d88e8c8eb9355169467270d03a72b8887d48a510634cfe797fd5169',
    statement_count: 27,
  }));
  assert.throws(() => assertBaselineSchemaSafety('http-generic-api/schema.sql', 'CREATE TABLE x (id INT); INSERT INTO x VALUES (1);', {
    sha256: '0'.repeat(64),
    statement_count: 2,
  }), (error) => error.code === 'baseline_migration_checksum_mismatch');
});

test('migration paths remain confined to canonical repository migrations', () => {
  const safe = resolveMigrationPath('http-generic-api/migrations/20260815_custom_gpt_mcp_catalog_levels.sql');
  assert.match(safe.repoPath, /^http-generic-api\/migrations\//u);
  assert.throws(() => resolveMigrationPath('../../.github/workflows/production-runtime-parity-evidence.yml'), (error) => error.code === 'unsafe_migration_path');
});

test('fallback target plan is explicit and identifier-safe', () => {
  assert.doesNotThrow(() => validateTargetPlan({
    key: 'runtime',
    database: 'u338416126_growthOS',
    principal: 'u338416126_growthOS',
    principal_host: '%',
    incident_recovery_migrations: [{
      file: 'http-generic-api/migrations/20260815_custom_gpt_mcp_catalog_levels.sql',
      expected_checksum: '528143808adac23eb457058c4c34dd95c4c5d462bca9ac4b170b1f19b2006681',
      expected_statement_count: 7,
    }],
  }));
  assert.throws(() => validateTargetPlan({
    key: 'runtime',
    database: 'growthOS',
    migrations: [],
  }), (error) => error.code === 'ambiguous_migrations_field');
  assert.throws(() => validateFallbackTargetPlan({
    key: 'runtime',
    database: 'growthOS',
    incident_recovery_migrations: [{
      file: 'http-generic-api/migrations/225_sprint67_capability_resolution_envelope_ledger.sql',
      expected_checksum: '35b034940c2be63d9bf8a8099573cac1c5a75b5fffd8ccfad60a453ed3cf7419',
      expected_statement_count: 3,
    }],
  }), /RECOVERY_INCIDENT_MIGRATION_DENIED|RECOVERY_INCIDENT_MIGRATION_ROLE_DENIED/);
  assert.throws(() => validateTargetPlan({ key: 'runtime', database: 'growthOS;DROP DATABASE x', incident_recovery_migrations: [] }), (error) => error.code === 'target_invalid');
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

test('explicit bootstrap requires live Hostinger parity and runs the parity contract test', () => {
  const parityGate = workflow.indexOf('Require live Hostinger runtime parity before bootstrap');
  const bootstrapRun = workflow.indexOf('Run selected bootstrap contract mode');
  assert.ok(parityGate >= 0 && parityGate < bootstrapRun, 'runtime parity gate must precede bootstrap execution');
  assert.match(workflow, /if: inputs\.bootstrap_mode != 'plan'/u);
  assert.match(workflow, /curl --proto '=https' --tlsv1\.2 --fail --silent --show-error/u);
  assert.match(workflow, /https:\/\/auth\.mad4b\.com\/version/u);
  assert.match(workflow, /https:\/\/auth\.mad4b\.com\/deployment-info/u);
  assert.match(workflow, /version_sha,,.*EXPECTED_SHA/u);
  assert.match(workflow, /deployment_sha,,.*EXPECTED_SHA/u);
  assert.match(workflow, /deployment_branch.*EXPECTED_BRANCH/u);
  assert.match(workflow, /BOOTSTRAP_RESULT_PATH: \$\{\{ github\.workspace \}\}/u);
  assert.match(workflow, /node --test test-runtime-gate-deployment-info-parity\.mjs/u);
  assert.match(workflow, /apply_migration/u);
  assert.match(workflow, /apply_grants/u);
  assert.match(workflow, /BOOTSTRAP_MIGRATION_CONFIRMATION/u);
  assert.match(workflow, /BOOTSTRAP_GRANTS_CONFIRMATION/u);
  assert.match(workflow, /group: production-runtime-bootstrap-production/u);
  assert.doesNotMatch(workflow, /group: production-runtime-bootstrap-\$\{\{.*expected_sha/u);
  const bootstrapJob = workflow.slice(workflow.indexOf('  bootstrap:'), workflow.indexOf('  live:'));
  assert.doesNotMatch(bootstrapJob, /^\s{6}.*runner\./mu);
  assert.doesNotMatch(workflow, /^\s{6}(?:BOOTSTRAP_RESULT_PATH|MYSQL_BOOTSTRAP_(?:HOST|PORT|USER|PASSWORD)):.*runner\.temp/mu);
  assert.match(workflow, /mutation_performed:false/iu);
  assert.match(workflow, /provider_mutation_performed:false/iu);
  assert.match(workflow, /secrets_included:false/iu);
});
