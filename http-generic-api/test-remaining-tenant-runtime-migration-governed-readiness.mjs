import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { splitMigrationSqlStatements } from './migrationSqlStatements.js';

const workflowPath = '../.github/workflows/remaining-tenant-runtime-migration-governed-readiness.yml';
const scriptPath = '../.github/ops/remaining-tenant-runtime-migration-governed-readiness.mjs';
const migrationPath = './migrations/20260810_remaining_tenant_runtime_lifecycle_gap_closure.sql';
const manifestPath = './scripts/test-manifest.mjs';

const [workflow, script, migration, manifest] = await Promise.all([
  readFile(workflowPath, 'utf8'),
  readFile(scriptPath, 'utf8'),
  readFile(migrationPath),
  readFile(manifestPath, 'utf8'),
]);

const token = 'AUTHORIZE_GOVERNED_MIGRATION_20260810_REMAINING_TENANT_RUNTIME_LIFECYCLE_GAP_CLOSURE';
const productionSha = '9ed415e324d8d5187b2c29bdf16aaf77187f0333';
const sourceMergeSha = 'c4c044c75c138f53b4f90cefdc4879cfd472b82c';
const expectedChecksum = '355a4a375a12c50b19ad96299e9b95c67b83bd4835a86832e771824bd2a8ccb0';
const expectedBlobSha = 'dfd207c5aeba248b25f9db023e324f904b1e5a39';

const gitBlobSha = createHash('sha1')
  .update(Buffer.from(`blob ${migration.length}\0`, 'utf8'))
  .update(migration)
  .digest('hex');
const checksum = createHash('sha256').update(migration).digest('hex');
const statementCount = splitMigrationSqlStatements(migration.toString('utf8')).length;

assert.match(workflow, /github\.event\.issue\.number == 6871/);
assert.ok(workflow.includes(token));
assert.match(workflow, /Authorize and dry-run remaining tenant runtime migration/);
assert.ok(!workflow.includes('mode: apply'), 'Readiness workflow must not expose Migration Apply');
assert.ok(!workflow.includes('APPLY_CMS_AUTHORITY_RECONCILIATION'));
assert.ok(!workflow.includes('APPLY_SUPPORT_TICKET_RESOLUTION_RECONCILIATION'));

assert.ok(script.includes(productionSha));
assert.ok(script.includes(sourceMergeSha));
assert.ok(script.includes(expectedChecksum));
assert.ok(script.includes(expectedBlobSha));
assert.ok(script.includes("name: 'governed_migration_authorization_bootstrap'"));
assert.ok(script.includes("executor_readiness_mode: 'ensure'"));
assert.ok(script.includes("name: 'governed_migration_execute'"));
assert.ok(script.includes("mode: 'dry_run'"));
assert.ok(script.includes("stage = 'production_ref_repin_before_authorization'"));
assert.ok(script.includes("stage = 'production_ref_repin_after_dry_run'"));
assert.ok(script.includes('migration_apply_performed: false'));
assert.ok(script.includes('live_tenant_repair_executed: false'));
assert.ok(!script.includes("mode: 'apply'"), 'Readiness executor must not call governed migration Apply');
assert.ok(!script.includes('capability_resolution_envelope_apply_authorize'), 'Readiness executor must not request Apply authority');
assert.ok(!script.includes('APPLY_CMS_AUTHORITY_RECONCILIATION'));
assert.ok(!script.includes('APPLY_SUPPORT_TICKET_RESOLUTION_RECONCILIATION'));

assert.equal(gitBlobSha, expectedBlobSha);
assert.equal(checksum, expectedChecksum);
assert.equal(statementCount, 4);
assert.ok(manifest.includes('node test-remaining-tenant-runtime-migration-governed-readiness.mjs'));

console.log('Remaining tenant runtime migration governed readiness bridge contract: OK');
