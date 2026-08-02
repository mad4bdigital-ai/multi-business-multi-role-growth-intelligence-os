#!/usr/bin/env node
import fs from 'node:fs';

const workflowPath = '.github/workflows/frontend-surface-dispatch.yml';
const workflow = fs.readFileSync(workflowPath, 'utf8');

function requireIncludes(needle, label) {
  if (!workflow.includes(needle)) {
    throw new Error(`${label}: missing required contract: ${needle}`);
  }
}

function requireExcludes(needle, label) {
  if (workflow.includes(needle)) {
    throw new Error(`${label}: forbidden contract present: ${needle}`);
  }
}

requireIncludes('name: Frontend surface dispatch', 'Workflow identity');
requireIncludes('  pull_request:', 'Pull-request trigger');
requireIncludes('  workflow_dispatch:', 'Read-only manual verification trigger');
requireIncludes('permissions:\n  contents: read', 'Workflow permissions');
requireIncludes('persist-credentials: false', 'Checkout credential boundary');
requireIncludes("contract: 'mad4b.frontend-generator-contract-summary.v1'", 'Structured evidence contract');
requireIncludes('repository_mutation: false', 'Structured no-mutation declaration');
requireIncludes('consult_job_logs: false', 'Structured no-log authority');
requireIncludes('secrets_included: false', 'Structured no-secret declaration');

for (const forbidden of [
  'contents: write',
  'refresh-generated:',
  'git commit ',
  'git push ',
  'persist-credentials: true',
  'APPLY_GENERATED_ARTIFACT_REFRESH',
]) {
  requireExcludes(forbidden, 'Read-only PR workflow');
}

console.log(JSON.stringify({
  ok: true,
  contract: 'mad4b.frontend-surface-dispatch-read-only.v1',
  workflow: 'Frontend surface dispatch',
  pull_request_read_only: true,
  manual_verification_read_only: true,
  repository_mutation: false,
  expected_head_guard_required: false,
  protected_branch_guard_required: false,
  delegated_refresh_workflow: 'Governed Generated Artifact Refresh',
  job_logs_consulted: false,
  secrets_included: false,
}, null, 2));
