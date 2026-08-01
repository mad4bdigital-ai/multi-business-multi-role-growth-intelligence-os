#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const contractPath = 'specs/014-governed-hostinger-storage-orchestration/e2e-phases.json';
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));

assert.equal(contract.feature_key, '014-governed-hostinger-storage-orchestration');
assert.equal(contract.delivery_mode, 'multi_pr');
assert.equal(contract.parallel_work?.enabled, true);

const workstream = contract.parallel_work.workstreams.find((entry) => entry.id === 'contracts');
assert.ok(workstream, 'contracts workstream is required');
assert.equal(workstream.status, 'integrated');
assert.equal(workstream.branch_pattern, 'gpt/014-hostinger/contracts-*');

const includePaths = [
  '.github/contracts/spec014/hostinger-storage-schema-classification.json',
  '.github/contracts/spec014/validate-hostinger-storage-schema-classification.mjs',
  '.github/workflows/hostinger-storage-schema-classification-guard.yml',
  '.specify/work-map-schema-classification-registry.json',
];
for (const path of includePaths) {
  if (!workstream.scope.include.includes(path)) workstream.scope.include.push(path);
}

const deliverable = 'Canonical pre-SQL schema classification for the 15 proposed Hostinger storage tables with exact Work Map registry rules and fail-closed coverage validation';
if (!workstream.deliverables.includes(deliverable)) workstream.deliverables.push(deliverable);

const testId = 'hostinger-storage-schema-classification-contract';
if (!workstream.required_tests.some((entry) => entry.id === testId)) {
  workstream.required_tests.push({
    id: testId,
    runner: 'node',
    working_directory: '.',
    path: '.github/contracts/spec014/validate-hostinger-storage-schema-classification.mjs',
    args: [],
  });
}

assert.equal(new Set(workstream.scope.include).size, workstream.scope.include.length);
assert.equal(workstream.required_tests.filter((entry) => entry.id === testId).length, 1);
assert.ok(includePaths.every((path) => workstream.scope.include.includes(path)));

fs.writeFileSync(contractPath, `${JSON.stringify(contract)}\n`);

console.log(JSON.stringify({
  ok: true,
  feature_key: contract.feature_key,
  workstream_id: workstream.id,
  branch_pattern: workstream.branch_pattern,
  scope_paths_added: includePaths,
  required_test_added: testId,
  current_phase_changed: false,
  secrets_included: false,
}));
