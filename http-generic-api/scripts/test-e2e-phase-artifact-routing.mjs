#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflowPath = '.github/workflows/e2e-phase-governance.yml';
const workflow = fs.readFileSync(workflowPath, 'utf8');

const sourceOnlyPattern = 'pattern: e2e-phase-e*-${{ github.run_id }}';
const selfContaminatingPattern = 'pattern: e2e-phase-*-${{ github.run_id }}';

assert.equal(
  workflow.includes(sourceOnlyPattern),
  true,
  'The canonical summarizer must download only evaluation/execution source artifacts.',
);
assert.equal(
  workflow.includes(selfContaminatingPattern),
  false,
  'The canonical summarizer must not redownload its own prior summary artifact on a rerun.',
);
assert.equal(
  workflow.includes('name: e2e-phase-evaluation-${{ github.run_id }}'),
  true,
  'Evaluation evidence must retain the governed artifact name.',
);
assert.equal(
  workflow.includes('name: e2e-phase-execution-${{ github.run_id }}'),
  true,
  'Execution evidence must retain the governed artifact name.',
);
assert.equal(
  workflow.includes('name: e2e-phase-summary-${{ github.run_id }}'),
  true,
  'Canonical summaries must remain a separate output artifact.',
);

console.log(JSON.stringify({
  ok: true,
  test: 'e2e_phase_artifact_routing',
  rerun_summary_self_contamination_blocked: true,
  secrets_included: false,
}));
