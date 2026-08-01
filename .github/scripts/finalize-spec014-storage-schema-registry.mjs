#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const contractPath = 'specs/014-governed-hostinger-storage-orchestration/e2e-phases.json';
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));

assert.equal(contract.feature_key, '014-governed-hostinger-storage-orchestration');
assert.equal(contract.delivery_mode, 'multi_pr');
assert.equal(contract.parallel_work?.enabled, true);
assert.ok(contract.parallel_work.workstreams.some((entry) => entry.id === 'contracts' && entry.status === 'integrated'));
assert.equal(contract.parallel_work.workstreams.some((entry) => entry.id === 'schema-classification'), false);

const implementationHead = 'c17f29be718851ad43df8c99450f04b1e11842cd';
const workstream = {
  id: 'schema-classification',
  title: 'Canonical storage schema classification',
  status: 'ready_for_integration',
  owner_type: 'mixed',
  branch_pattern: 'gpt/014-hostinger/schema-classification-*',
  scope: {
    include: [
      '.github/contracts/spec014/hostinger-storage-schema-classification.json',
      '.github/contracts/spec014/validate-hostinger-storage-schema-classification.mjs',
      '.github/workflows/hostinger-storage-schema-classification-guard.yml',
      '.specify/work-map-schema-classification-registry.json',
    ],
  },
  depends_on: ['contracts'],
  deliverables: [
    'Canonical pre-SQL classification for the 15 proposed Hostinger storage tables with one bounded exact registry rule per object',
    'Fail-closed contract, canonical registry, and current Work Map coverage validation before SQL creation',
  ],
  integration_points: [
    'work-map-schema-classification-registry-v1',
    'data-model-domain-map',
  ],
  required_tests: [
    {
      id: 'hostinger-storage-schema-classification-contract',
      runner: 'node',
      working_directory: '.',
      path: '.github/contracts/spec014/validate-hostinger-storage-schema-classification.mjs',
      args: [],
    },
  ],
  commit_evidence: {
    branch: 'gpt/014-hostinger/canonical-schema-registry-generated-20260802',
    head_sha: implementationHead,
    commits: [implementationHead],
  },
};

contract.parallel_work.workstreams.push(workstream);
if (!contract.parallel_work.integration.required_workstreams.includes(workstream.id)) {
  contract.parallel_work.integration.required_workstreams.push(workstream.id);
}

assert.equal(contract.parallel_work.workstreams.filter((entry) => entry.id === workstream.id).length, 1);
assert.ok(contract.parallel_work.integration.required_workstreams.includes(workstream.id));
assert.equal(workstream.scope.include.length, 4);
assert.equal(new Set(workstream.scope.include).size, 4);

fs.writeFileSync(contractPath, `${JSON.stringify(contract)}\n`);

console.log(JSON.stringify({
  ok: true,
  feature_key: contract.feature_key,
  workstream_id: workstream.id,
  status: workstream.status,
  branch_pattern: workstream.branch_pattern,
  depends_on: workstream.depends_on,
  commit_evidence_head_sha: workstream.commit_evidence.head_sha,
  scope_count: workstream.scope.include.length,
  current_phase_changed: false,
  secrets_included: false,
}));
