import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(
  new URL('../.github/workflows/spec014-wave1-apply.yml', import.meta.url),
  'utf8',
);

for (const required of [
  'name: Spec 014 Wave 1 Migration Apply (terminally locked)',
  'run-name: Spec 014 Wave 1 terminal lock / comment',
  'permissions: {}',
  'reject-retired-apply:',
  'APPLY_20260802_01_SPEC014_HOSTINGER_STORAGE_FOUNDATION',
  "CANONICAL_APPLY_COMMENT_ID: '5195149968'",
  "CANONICAL_APPLY_RUN_ID: '31030632615'",
  "CANONICAL_CERTIFICATION_COMMENT_ID: '5195415632'",
  "CANONICAL_CERTIFICATION_RUN_ID: '31032704208'",
  'Apply authority: retired',
  'SQL execution: prohibited',
  'Retry: prohibited',
  'exit 1',
]) {
  assert.ok(workflow.includes(required), `missing terminal-lock binding: ${required}`);
}

for (const forbidden of [
  'BACKEND_API_KEY',
  'secrets.',
  'actions/checkout',
  'actions/setup-node',
  'spec014-wave1-apply.mjs',
  'contents: write',
  'issues: write',
  'pull-requests: write',
]) {
  assert.ok(!workflow.includes(forbidden), `retired workflow retains forbidden authority: ${forbidden}`);
}

console.log('Spec 014 Wave 1 Apply terminal-lock regression passed.');
