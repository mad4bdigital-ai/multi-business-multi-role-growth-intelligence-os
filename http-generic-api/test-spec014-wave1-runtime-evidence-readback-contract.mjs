import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OBSERVER_BRANCH = 'gpt/observe-spec014-wave1-runtime-run-5179409708-20260804';
const DISCOVERY_PATH = path.join(
  ROOT,
  'http-generic-api/scripts/hostinger-r7-public-run-discovery-5180820710.mjs',
);
const discovery = await fs.readFile(DISCOVERY_PATH, 'utf8');
const syntax = spawnSync(process.execPath, ['--check', DISCOVERY_PATH], {
  cwd: ROOT,
  encoding: 'utf8',
});
assert.equal(syntax.status, 0, syntax.stderr || 'Corrected R7 observer syntax failed');

assert.match(discovery, /5180820710/);
assert.match(discovery, /hostinger-production-runtime-readback-r7\.yml/);
assert.match(discovery, /Hostinger Production Runtime Readback R7/);
assert.match(discovery, /event=issue_comment/);
assert.match(discovery, /maxDeltaMs = 5 \* 60 \* 1000/);
assert.match(discovery, /public_metadata_only: true/);
assert.match(discovery, /deployment_performed: false/);
assert.match(discovery, /restart_performed: false/);
assert.match(discovery, /sql_execution_performed: false/);
assert.match(discovery, /migration_apply_executed: false/);
assert.match(discovery, /database_mutation_performed: false/);
assert.match(discovery, /secrets_included: false/);
assert.doesNotMatch(
  discovery,
  /Authorization:|GITHUB_TOKEN|GH_TOKEN|BACKEND_API_KEY|HOSTINGER_API_TOKEN|auth\.mad4b\.com/,
);

if (String(process.env.GITHUB_HEAD_REF || '') === OBSERVER_BRANCH) {
  await import('./scripts/hostinger-r7-public-run-discovery-5180820710.mjs');
}

console.log(
  JSON.stringify(
    {
      ok: true,
      contract: 'hostinger_r7_corrected_public_run_discovery_guard.v1',
      observer_branch: OBSERVER_BRANCH,
      trigger_comment_id: '5180820710',
      public_metadata_only: true,
      runtime_contact: false,
      provider_credential_accessed: false,
      deployment_performed: false,
      restart_performed: false,
      sql_execution_performed: false,
      migration_apply_executed: false,
      database_mutation_performed: false,
      secrets_included: false,
    },
    null,
    2,
  ),
);
