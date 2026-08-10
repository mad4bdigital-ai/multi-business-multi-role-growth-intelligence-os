import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowPath = '.github/workflows/tenant-platform-plugin-1052-governed-readiness.yml';
const scriptPath = '.github/ops/tenant-platform-plugin-1052-governed-readiness.mjs';

const [workflow, script] = await Promise.all([
  readFile(workflowPath, 'utf8'),
  readFile(scriptPath, 'utf8'),
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
assert.ok(script.includes("name: 'governed_migration_execute'"));
assert.ok(script.includes("mode: 'dry_run'"));
assert.ok(script.includes('migration_apply_performed: false'));
assert.ok(script.includes('runtime_dispatch_certification_issued: false'));
assert.ok(script.includes('managed_execution_run_created: false'));
assert.ok(!script.includes("mode: 'apply'"), 'Readiness script must not call governed migration Apply');
assert.ok(!script.includes('APPLY_1052_'), 'Readiness script must not contain an Apply confirmation');
assert.ok(!script.includes('capability_resolution_envelope_apply_authorize'), 'Readiness bridge must not request Apply authority');
assert.ok(!script.includes('tenantPlatformPluginManagedRepairExecutor'), 'Readiness bridge must not invoke managed repair execution');

console.log('Migration 1052 governed readiness bridge contract: OK');
