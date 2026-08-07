import { readFileSync, writeFileSync } from 'node:fs';

const runnerPath = '.github/ops/transport-response-schema-1048-governed-rollout.mjs';
const workflowPath = '.github/workflows/transport-response-schema-1048-governed-rollout.yml';
const testPath = 'http-generic-api/test-transport-response-schema-1048-governed-rollout.mjs';

function once(text, oldValue, newValue, label) {
  const count = text.split(oldValue).length - 1;
  console.log(`[repair-v3] ${label}: matches=${count}`);
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  return text.replace(oldValue, newValue);
}

let runner = readFileSync(runnerPath, 'utf8');
runner = once(runner, "const AUTH_CONFIRM = 'AUTHORIZE_GOVERNED_MIGRATION_1048_TRANSPORT_RESPONSE_SCHEMA_RECOVERY';", "const AUTH_CONFIRM = 'AUTHORIZE_GOVERNED_MIGRATION_1048_TRANSPORT_RESPONSE_CHUNK_SCHEMA_RECOVERY';", 'runner AUTH_CONFIRM');
runner = once(runner, "const APPLY_CONFIRM = 'APPLY_GOVERNED_MIGRATION_1048_TRANSPORT_RESPONSE_SCHEMA_RECOVERY';", "const APPLY_CONFIRM = 'APPLY_1048_TRANSPORT_RESPONSE_CHUNK_SCHEMA_RECOVERY';", 'runner APPLY_CONFIRM');
runner = once(runner, "const VERIFY_CONFIRM = 'VERIFY_GOVERNED_MIGRATION_1048_TRANSPORT_RESPONSE_SCHEMA_RECOVERY';", "const VERIFY_CONFIRM = 'VERIFY_GOVERNED_MIGRATION_1048_TRANSPORT_RESPONSE_CHUNK_SCHEMA_RECOVERY';", 'runner VERIFY_CONFIRM');
writeFileSync(runnerPath, runner);
console.log('[repair-v3] runner patched');

let workflow = readFileSync(workflowPath, 'utf8');
workflow = once(workflow, "github.event.comment.body == 'AUTHORIZE_GOVERNED_MIGRATION_1048_TRANSPORT_RESPONSE_SCHEMA_RECOVERY'", "github.event.comment.body == 'AUTHORIZE_GOVERNED_MIGRATION_1048_TRANSPORT_RESPONSE_CHUNK_SCHEMA_RECOVERY'", 'workflow authorize trigger');
workflow = once(workflow, "github.event.comment.body == 'APPLY_GOVERNED_MIGRATION_1048_TRANSPORT_RESPONSE_SCHEMA_RECOVERY'", "github.event.comment.body == 'APPLY_1048_TRANSPORT_RESPONSE_CHUNK_SCHEMA_RECOVERY'", 'workflow apply trigger');
workflow = once(workflow, "github.event.comment.body == 'VERIFY_GOVERNED_MIGRATION_1048_TRANSPORT_RESPONSE_SCHEMA_RECOVERY'", "github.event.comment.body == 'VERIFY_GOVERNED_MIGRATION_1048_TRANSPORT_RESPONSE_CHUNK_SCHEMA_RECOVERY'", 'workflow verify trigger');
workflow = once(workflow, "  readiness:\n    name: Authorize and dry-run Migration 1048\n    if: >-", "  readiness:\n    name: Authorize and dry-run Migration 1048\n    permissions:\n      contents: read\n      issues: write\n    if: >-", 'workflow readiness permissions');

const oldBoundary = [
  '      - name: Execute Production-bound authorization and dry-run',
  '        run: node .github/ops/transport-response-schema-1048-governed-rollout.mjs',
  '',
  '      - name: Upload no-secret readiness evidence',
].join('\n');
const newBoundary = [
  '      - name: Execute Production-bound authorization and dry-run',
  '        run: node .github/ops/transport-response-schema-1048-governed-rollout.mjs',
  '',
  '      - name: Publish checksum-bound readiness marker',
  '        if: success()',
  '        uses: actions/github-script@v7',
  '        with:',
  '          script: |',
  "            const fs = require('node:fs');",
  '            const summaryPath = `${process.env.EVIDENCE_DIR}/summary.json`;',
  "            const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));",
  "            if (summary.result === 'ready_for_apply') {",
  "              const marker = String(summary.readiness_marker || '');",
  "              if (!marker.startsWith('TRANSPORT_RESPONSE_SCHEMA_1048_READINESS result=pass ')) {",
  "                core.setFailed('Malformed Migration 1048 readiness marker');",
  '                return;',
  '              }',
  '              await github.rest.issues.createComment({',
  '                owner: context.repo.owner,',
  '                repo: context.repo.repo,',
  '                issue_number: 6531,',
  '                body: marker,',
  '              });',
  "            } else if (summary.result !== 'already_applied') {",
  '              core.setFailed(`Unexpected Migration 1048 readiness result: ${summary.result}`);',
  '            }',
  '',
  '      - name: Upload no-secret readiness evidence',
].join('\n');
workflow = once(workflow, oldBoundary, newBoundary, 'workflow readiness publication');
writeFileSync(workflowPath, workflow);
console.log('[repair-v3] workflow patched');

let test = readFileSync(testPath, 'utf8');
for (const [oldValue, newValue, label] of [
  ['AUTHORIZE_GOVERNED_MIGRATION_1048_TRANSPORT_RESPONSE_SCHEMA_RECOVERY', 'AUTHORIZE_GOVERNED_MIGRATION_1048_TRANSPORT_RESPONSE_CHUNK_SCHEMA_RECOVERY', 'test authorize token'],
  ['APPLY_GOVERNED_MIGRATION_1048_TRANSPORT_RESPONSE_SCHEMA_RECOVERY', 'APPLY_1048_TRANSPORT_RESPONSE_CHUNK_SCHEMA_RECOVERY', 'test apply token'],
  ['VERIFY_GOVERNED_MIGRATION_1048_TRANSPORT_RESPONSE_SCHEMA_RECOVERY', 'VERIFY_GOVERNED_MIGRATION_1048_TRANSPORT_RESPONSE_CHUNK_SCHEMA_RECOVERY', 'test verify token'],
]) test = once(test, oldValue, newValue, label);

const anchor = "const applyModeLiterals = runner.match(/mode:\\s*'apply'/g) || [];";
const block = [
  "for (const expected of [",
  "  'issues: write',",
  "  'Publish checksum-bound readiness marker',",
  "  'actions/github-script@v7',",
  "  'summary.readiness_marker',",
  "]) assert.ok(workflow.includes(expected), `Migration 1048 workflow is missing readiness publication contract: ${expected}`);",
  "",
  "for (const expected of [",
  "  \"const AUTH_CONFIRM = 'AUTHORIZE_GOVERNED_MIGRATION_1048_TRANSPORT_RESPONSE_CHUNK_SCHEMA_RECOVERY'\",",
  "  \"const APPLY_CONFIRM = 'APPLY_1048_TRANSPORT_RESPONSE_CHUNK_SCHEMA_RECOVERY'\",",
  "  \"const VERIFY_CONFIRM = 'VERIFY_GOVERNED_MIGRATION_1048_TRANSPORT_RESPONSE_CHUNK_SCHEMA_RECOVERY'\",",
  "]) assert.ok(runner.includes(expected), `Migration 1048 runner is missing canonical confirmation: ${expected}`);",
  "",
  "for (const forbidden of [",
  "  'AUTHORIZE_GOVERNED_MIGRATION_1048_TRANSPORT_RESPONSE_SCHEMA_RECOVERY',",
  "  'APPLY_GOVERNED_MIGRATION_1048_TRANSPORT_RESPONSE_SCHEMA_RECOVERY',",
  "]) {",
  "  assert.ok(!workflow.includes(forbidden), `Migration 1048 workflow retains obsolete confirmation: ${forbidden}`);",
  "  assert.ok(!runner.includes(forbidden), `Migration 1048 runner retains obsolete confirmation: ${forbidden}`);",
  "}",
  "",
  anchor,
].join('\n');
test = once(test, anchor, block, 'test regression block');
writeFileSync(testPath, test);
console.log('[repair-v3] regression test patched');
