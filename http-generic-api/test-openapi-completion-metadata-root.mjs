#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const root = dirname(fileURLToPath(import.meta.url));
const targetPath = '/admin/support/tickets/{ticket_id}/external-delivery/completion-certification';
const expectedRef = './openapi/support-ticket-runtime-completion.yaml#/certifyAdminSupportTicketExternalDeliveryCompletion';
const tempRoot = mkdtempSync(join(tmpdir(), 'openapi-completion-root-'));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const sourceOpenApi = resolve(root, 'openapi.yaml');
const sourceRegistry = resolve(root, 'openapi-route-contracts.yaml');
const sourceRoutes = resolve(root, 'routes/supportTicketRoutes.js');
const syncScript = resolve(root, 'scripts/openapi-precise-contract-registry-sync.mjs');

function run(args) {
  return spawnSync(process.execPath, [syncScript, ...args], {
    cwd: tempRoot,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test' },
    maxBuffer: 32 * 1024 * 1024,
  });
}

try {
  mkdirSync(join(tempRoot, 'routes'), { recursive: true });
  cpSync(sourceOpenApi, join(tempRoot, 'openapi.yaml'));
  cpSync(sourceRegistry, join(tempRoot, 'openapi-route-contracts.yaml'));
  cpSync(sourceRoutes, join(tempRoot, 'routes/supportTicketRoutes.js'));

  const sourceDigestBefore = hash(readFileSync(sourceOpenApi));
  const registryDigestBefore = hash(readFileSync(join(tempRoot, 'openapi-route-contracts.yaml'));
  const routesDigestBefore = hash(readFileSync(join(tempRoot, 'routes/supportTicketRoutes.js'));

  const write = run(['--write']);
  assert.equal(write.status, 0, (write.stderr || write.stdout).slice(-8000));
  const writeResult = JSON.parse(write.stdout);
  assert.equal(writeResult.ok, true);
  assert.equal(writeResult.changed, true);
  assert.equal(writeResult.conflict_count, 0);

  const migrated = YAML.parse(readFileSync(join(tempRoot, 'openapi.yaml'), 'utf8'));
  assert.deepEqual(migrated.paths[targetPath], { $ref: expectedRef });

  assert.equal(hash(readFileSync(join(tempRoot, 'openapi-route-contracts.yaml'))), registryDigestBefore);
  assert.equal(hash(readFileSync(join(tempRoot, 'routes/supportTicketRoutes.js'))), routesDigestBefore);
  assert.equal(hash(readFileSync(sourceOpenApi)), sourceDigestBefore, 'runner probe must not mutate the repository root document');

  const check = run(['--check']);
  assert.equal(check.status, 0, (check.stderr || check.stdout).slice(-8000));
  const checkResult = JSON.parse(check.stdout);
  assert.equal(checkResult.ok, true);
  assert.equal(checkResult.changed, false);
  assert.equal(checkResult.missing_count, 0);
  assert.equal(checkResult.conflict_count, 0);

  console.log(JSON.stringify({
    ok: true,
    gate: 'openapi_completion_metadata_root_probe',
    target_path: targetPath,
    observed_path_ref: migrated.paths[targetPath].$ref,
    exact_root_fixture: true,
    write_status: write.status,
    check_status: check.status,
    repository_mutation_performed: false,
    provider_dispatch: false,
    credential_access: false,
    external_send: false,
    secrets_included: false,
  }, null, 2));
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
