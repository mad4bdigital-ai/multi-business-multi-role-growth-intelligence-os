import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bootstrapGovernedMigrationAuthorization as bootstrapRuntime } from './governedMigrationAuthorizationBootstrapRuntime.js';

const workflowPath = '../.github/workflows/tenant-platform-plugin-1052-governed-readiness.yml';
const scriptPath = '../.github/ops/tenant-platform-plugin-1052-governed-readiness.mjs';
const runtimePath = './governedMigrationAuthorizationBootstrapRuntime.js';
const wrapperPath = './governedMigrationAuthorizationBootstrap.js';
const manifestPath = './scripts/test-manifest.mjs';

const [workflow, script, runtimeSource, wrapperSource, manifestSource] = await Promise.all([
  readFile(workflowPath, 'utf8'),
  readFile(scriptPath, 'utf8'),
  readFile(runtimePath, 'utf8'),
  readFile(wrapperPath, 'utf8'),
  readFile(manifestPath, 'utf8'),
]);

const token = 'AUTHORIZE_GOVERNED_MIGRATION_1052_TENANT_PLATFORM_PLUGIN_MANAGED_REPAIR_AUTHORITY';
const migration = '1052_tenant_platform_plugin_managed_repair_authority.sql';
const productionSha = '87811cb84352382329e5d60dcf3030f4bc21964f';

assert.match(workflow, /github\.event\.issue\.number == 4451/);
assert.ok(workflow.includes(token));
assert.match(workflow, /Authorize and dry-run Migration 1052/);
assert.ok(!workflow.includes('APPLY_1052_'), 'Migration 1052 readiness workflow must not expose an Apply trigger');
assert.ok(!workflow.includes('ROLLOUT_PHASE: apply'), 'Migration 1052 readiness workflow must not define an Apply phase');

assert.ok(script.includes(migration));
assert.ok(script.includes(productionSha));
assert.ok(script.includes("name: 'governed_migration_authorization_bootstrap'"));
assert.ok(script.includes("executor_readiness_mode: 'require_existing'"));
assert.ok(script.includes("name: 'governed_migration_execute'"));
assert.ok(script.includes("mode: 'dry_run'"));
assert.ok(script.includes("stage = 'production_ref_repin'"));
assert.ok(script.includes('Production ref moved after runtime parity and before authorization mutation'));
assert.ok(script.includes('--decision-note=Approve checksum-bound Migration 1052 authorization bootstrap and dry-run readiness only. No Migration Apply'));
assert.ok(!script.includes('readiness only; no Migration Apply'), 'Shell approval note must not contain a semicolon');
assert.ok(script.includes('migration_apply_performed: false'));
assert.ok(script.includes('runtime_dispatch_certification_issued: false'));
assert.ok(script.includes('managed_execution_run_created: false'));
assert.ok(!script.includes("mode: 'apply'"), 'Readiness script must not call governed migration Apply');
assert.ok(!script.includes('APPLY_1052_'), 'Readiness script must not contain an Apply confirmation');
assert.ok(!script.includes('capability_resolution_envelope_apply_authorize'), 'Readiness bridge must not request Apply authority');
assert.ok(!script.includes('tenantPlatformPluginManagedRepairExecutor'), 'Readiness bridge must not invoke managed repair execution');

assert.ok(runtimeSource.includes('EXECUTOR_READINESS_MODES'));
assert.ok(runtimeSource.includes('require_existing'));
assert.ok(runtimeSource.includes('governed_migration_executor_apply_policy_required'));
assert.ok(runtimeSource.includes('governed_migration_executor_dispatch_certification_required'));
assert.ok(runtimeSource.includes('resolveMigrationExecutorReadiness'));
assert.match(wrapperSource, /readPool/);
assert.match(wrapperSource, /writerPool/);
assert.match(wrapperSource, /pool: writerPool/);
assert.match(wrapperSource, /pool: readPool/);
assert.ok(manifestSource.includes('node test-tenant-platform-plugin-1052-governed-readiness.mjs'));

await assert.rejects(
  () => bootstrapRuntime({ executor_readiness_mode: 'unsupported' }),
  (error) => error?.code === 'governed_migration_executor_readiness_mode_invalid'
);

console.log('Migration 1052 governed readiness bridge contract: OK');
