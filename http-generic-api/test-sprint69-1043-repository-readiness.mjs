import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = resolve(process.cwd(), '..');
const scriptPath = resolve(repoRoot, '.github/ops/sprint69-1043-repository-readiness.mjs');
const workflowPath = resolve(repoRoot, '.github/workflows/sprint69-1043-repository-readiness.yml');
const migrationPath = resolve(repoRoot, 'http-generic-api/migrations/1043_sprint69_tenant_managed_execution_lifecycle.sql');
const evidenceDir = mkdtempSync(resolve(tmpdir(), 'migration-1043-readiness-'));

try {
  const script = readFileSync(scriptPath, 'utf8');
  const workflow = readFileSync(workflowPath, 'utf8');
  const migration = readFileSync(migrationPath, 'utf8');

  assert.match(workflow, /permissions:\s*\n\s+contents:\s+read/);
  assert.match(workflow, /Inspect Migration 1043 without runtime or database access/);
  assert.match(workflow, /sprint69-1043-repository-readiness\.mjs/);
  assert.doesNotMatch(workflow, /issue_comment|workflow_dispatch|secrets\.|BACKEND_API_KEY|auth\.mad4b\.com|gh api/i);
  assert.doesNotMatch(script, /fetch\s*\(|\/admin\/control|\/gpt\/tools\/call|Authorization\s*:/i);
  assert.match(script, /repository_readiness_only:\s+true/);
  assert.match(script, /apply_sent:\s+false/);
  assert.match(script, /database_mutation_executed:\s+false/);
  assert.match(script, /activation_registry_sync_executed:\s+false/);

  const run = spawnSync(process.execPath, [scriptPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      EVIDENCE_DIR: evidenceDir,
      GITHUB_SHA: '1111111111111111111111111111111111111111',
    },
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);

  const summary = JSON.parse(readFileSync(resolve(evidenceDir, 'summary.json'), 'utf8'));
  const expectedChecksum = createHash('sha256').update(migration, 'utf8').digest('hex');
  const body = Buffer.from(migration, 'utf8');
  const expectedBlob = createHash('sha1')
    .update(Buffer.from(`blob ${body.length}\0`, 'utf8'))
    .update(body)
    .digest('hex');

  assert.equal(summary.status, 'pass');
  assert.equal(summary.statement_count, 4);
  assert.equal(summary.migration_checksum_sha256, expectedChecksum);
  assert.equal(summary.migration_blob_sha, expectedBlob);
  assert.equal(summary.migration_blob_sha, '7f3e0152bcdfba36a659ff4a1df8e30d82024c8c');
  assert.deepEqual(summary.expected_tables, [
    'managed_execution_bindings',
    'managed_execution_step_requests',
    'managed_execution_events',
  ]);
  assert.equal(summary.expected_view, 'v_managed_execution_lifecycle_readiness');
  assert.equal(summary.source_commit_sha, '1111111111111111111111111111111111111111');
  for (const key of [
    'runtime_contacted',
    'authorization_created',
    'apply_authorized',
    'apply_sent',
    'database_mutation_executed',
    'activation_registry_sync_executed',
    'provider_call_executed',
    'credential_accessed',
    'external_write_executed',
    'secrets_included',
  ]) {
    assert.equal(summary[key], false, `${key} must remain false`);
  }

  console.log('Sprint 69 Migration 1043 repository readiness tests passed');
} finally {
  rmSync(evidenceDir, { recursive: true, force: true });
}
