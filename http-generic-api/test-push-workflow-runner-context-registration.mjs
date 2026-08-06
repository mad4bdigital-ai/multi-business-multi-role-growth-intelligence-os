import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, '..');
const workflowDirectory = resolve(repositoryRoot, '.github/workflows');

const workflowPaths = readdirSync(workflowDirectory)
  .filter((name) => /\.ya?ml$/u.test(name))
  .sort()
  .map((name) => join('.github/workflows', name));

const repairedWorkflowPaths = [
  '.github/workflows/governed-migration-dependency-gate.yml',
  '.github/workflows/governed-production-promotion-post-finalization-guard.yml',
  '.github/workflows/governed-production-promotion-request-launcher.yml',
  '.github/workflows/hostinger-nodejs-completed-build-log-evidence-push-r3b.yml',
  '.github/workflows/hostinger-nodejs-completed-build-log-evidence-r3c-windows.yml',
  '.github/workflows/hostinger-nodejs-completed-build-log-evidence.yml',
  '.github/workflows/hostinger-production-release-evidence-r5.yml',
  '.github/workflows/response-chunk-ownership-governed-rollout-push.yml',
  '.github/workflows/ueacp-live-authority-evidence-one-shot.yml',
];

function preAllocationRunnerContextBindings(source, workflowPath) {
  const findings = [];
  const stack = [];
  const lines = source.split(/\r?\n/u);

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const indent = raw.match(/^ */u)?.[0].length || 0;
    while (stack.length > 0 && stack.at(-1).indent >= indent) stack.pop();

    const keyMatch = trimmed.match(/^([A-Za-z0-9_.-]+):(?:\s|$)/u);
    if (keyMatch) stack.push({ key: keyMatch[1], indent });

    if (!/\$\{\{\s*runner\./u.test(raw)) continue;
    const insideSteps = stack.some((entry) => entry.key === 'steps');
    if (!insideSteps) {
      findings.push({
        workflow: workflowPath,
        line: index + 1,
        text: trimmed.slice(0, 500),
        context: stack.map((entry) => entry.key).join('.'),
      });
    }
  }

  return findings;
}

const findings = [];
for (const workflowPath of workflowPaths) {
  const source = readFileSync(resolve(repositoryRoot, workflowPath), 'utf8');
  findings.push(...preAllocationRunnerContextBindings(source, workflowPath));
}

assert.deepEqual(
  findings,
  [],
  `runner context must not be evaluated outside runner-backed steps: ${JSON.stringify(findings)}`,
);

for (const workflowPath of repairedWorkflowPaths) {
  const source = readFileSync(resolve(repositoryRoot, workflowPath), 'utf8');
  assert.match(
    source,
    /RUNNER_TEMP|\.artifacts\//u,
    `${workflowPath} must retain a bounded post-allocation or repository-relative evidence path`,
  );
}

console.log(JSON.stringify({
  contract: 'mad4b.pre-allocation-runner-context-regression.v2',
  workflow_count: workflowPaths.length,
  repaired_workflow_count: repairedWorkflowPaths.length,
  pre_allocation_runner_context_findings: findings.length,
  secrets_included: false,
}));
