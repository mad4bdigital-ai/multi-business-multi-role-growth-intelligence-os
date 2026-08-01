import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const preciseSyncPath = resolve('scripts/openapi-precise-contract-registry-sync.mjs');
const preciseSyncSource = readFileSync(preciseSyncPath, 'utf8');

assert(preciseSyncSource.includes('replace_inline_operation_ids'), 'precise registry sync must support explicitly authorized inline-contract migrations');
assert(preciseSyncSource.includes('current_operation_ids'), 'conflict evidence must disclose bounded operationId identity');
assert(preciseSyncSource.includes('migrated_inline_contracts'), 'canonical sync report must disclose completed inline migrations');
assert(preciseSyncSource.includes('openapi_precise_contract_path_conflict'), 'non-authorized occupied paths must remain fail-closed');

const tempRoot = join(tmpdir(), `openapi-precise-migration-${process.pid}-${Date.now()}`);
try {
  mkdirSync(join(tempRoot, 'openapi'), { recursive: true });
  writeFileSync(join(tempRoot, 'openapi/legacy.yaml'), [
    'schemas:',
    '  LegacyResponse:',
    '    type: object',
    'legacyPath:',
    '  post:',
    '    operationId: exactLegacyOperation',
    '    responses:',
    "      '200':",
    '        description: ok',
    '',
  ].join('\n'));
  writeFileSync(join(tempRoot, 'openapi-route-contracts.yaml'), [
    'contracts:',
    '  POST /legacy:',
    "    route_file: 'routes/legacy.js'",
    "    path_item_ref: './openapi/legacy.yaml#/legacyPath'",
    '    replace_inline_operation_ids:',
    '      - exactLegacyOperation',
    '',
  ].join('\n'));
  const inlineRoot = [
    'openapi: 3.1.0',
    'info:',
    '  title: Fixture',
    '  version: 1.0.0',
    'paths:',
    '  /before:',
    '    get:',
    '      operationId: beforeOperation',
    '      responses:',
    "        '200': { description: ok }",
    '  /legacy:',
    '    post:',
    '      operationId: exactLegacyOperation',
    '      description: Legacy inline contract eligible for exact migration',
    '      responses:',
    "        '200': { description: legacy }",
    '  /after:',
    '    get:',
    '      operationId: afterOperation',
    '      responses:',
    "        '200': { description: ok }",
    'components:',
    '  schemas: {}',
    '',
  ].join('\n');
  writeFileSync(join(tempRoot, 'openapi.yaml'), inlineRoot);

  const pendingOutput = execFileSync(process.execPath, [preciseSyncPath], { cwd: tempRoot, encoding: 'utf8' });
  const pending = JSON.parse(pendingOutput);
  assert.equal(pending.ok, false, 'authorized inline contract must remain pending until explicit write mode');
  assert.equal(pending.pending_migration_count, 1);
  assert.equal(pending.conflict_count, 0);
  assert.deepEqual(pending.migrations[0].operation_ids, ['exactLegacyOperation']);

  const writeOutput = execFileSync(process.execPath, [preciseSyncPath, '--write'], { cwd: tempRoot, encoding: 'utf8' });
  const written = JSON.parse(writeOutput);
  assert.equal(written.ok, true);
  assert.equal(written.changed, true);
  assert.equal(written.migration_count, 1);
  assert.equal(written.pending_migration_count, 0);
  assert.equal(written.migrated_inline_contracts[0].path, '/legacy');

  const migratedRoot = readFileSync(join(tempRoot, 'openapi.yaml'), 'utf8');
  assert(migratedRoot.includes('  /legacy:\n    $ref: ./openapi/legacy.yaml#/legacyPath\n'), 'authorized inline path must be replaced by the canonical path-item ref');
  assert(migratedRoot.includes('operationId: beforeOperation'), 'migration must preserve the preceding path without reformatting it');
  assert(migratedRoot.includes('operationId: afterOperation'), 'migration must preserve the following path without reformatting it');
  assert(!migratedRoot.includes('Legacy inline contract eligible for exact migration'), 'legacy inline body must be removed after migration');

  const finalOutput = execFileSync(process.execPath, [preciseSyncPath, '--check'], { cwd: tempRoot, encoding: 'utf8' });
  const final = JSON.parse(finalOutput);
  assert.equal(final.ok, true);
  assert.equal(final.pending_migration_count, 0);

  const mismatchedRoot = inlineRoot.replace('operationId: exactLegacyOperation', 'operationId: differentOperation');
  writeFileSync(join(tempRoot, 'openapi.yaml'), mismatchedRoot);
  const mismatch = spawnSync(process.execPath, [preciseSyncPath, '--write'], { cwd: tempRoot, encoding: 'utf8' });
  assert.notEqual(mismatch.status, 0, 'mismatched inline operationId must fail closed');
  assert.match(mismatch.stderr, /openapi_precise_contract_path_conflict/);
  assert.equal(readFileSync(join(tempRoot, 'openapi.yaml'), 'utf8'), mismatchedRoot, 'failed migration must not rewrite the root document');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('openapi precise contract guarded migration tests passed');
