import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, '..');

const workflowPaths = [
  '.github/workflows/response-chunk-ownership-governed-rollout-push.yml',
  '.github/workflows/governed-migration-dependency-gate.yml',
  '.github/workflows/hostinger-nodejs-completed-build-log-evidence-r3c-windows.yml',
  '.github/workflows/hostinger-production-release-evidence-r5.yml',
  '.github/workflows/production-certified-release-cut-validation.yml',
  '.github/workflows/ueacp-live-authority-evidence-one-shot.yml',
  '.github/workflows/governed-production-promotion-request-launcher.yml',
  '.github/workflows/hostinger-nodejs-completed-build-log-evidence.yml',
  '.github/workflows/governed-production-promotion-post-finalization-guard.yml',
  '.github/workflows/hostinger-nodejs-completed-build-log-evidence-push-r3b.yml',
];

function jobLevelRunnerTempBindings(source) {
  const findings = [];
  const lines = source.split(/\r?\n/);
  let inJobs = false;
  let inJobEnv = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      inJobEnv = false;
      continue;
    }
    if (!inJobs) continue;
    if (/^[^\s]/.test(line) && line.trim() !== '') {
      inJobs = false;
      inJobEnv = false;
      continue;
    }
    if (/^    env:\s*$/.test(line)) {
      inJobEnv = true;
      continue;
    }
    if (inJobEnv && /^    \S/.test(line)) {
      inJobEnv = false;
    }
    if (inJobEnv && /^      [A-Za-z_][A-Za-z0-9_]*:.*\$\{\{\s*runner\.temp\s*\}\}/.test(line)) {
      findings.push({ line: index + 1, text: line.trim() });
    }
  }

  return findings;
}

for (const workflowPath of workflowPaths) {
  const source = readFileSync(resolve(repositoryRoot, workflowPath), 'utf8');
  const findings = jobLevelRunnerTempBindings(source);
  assert.deepEqual(
    findings,
    [],
    `${workflowPath} evaluates runner.temp in job-level env before runner allocation: ${JSON.stringify(findings)}`,
  );
  assert.match(
    source,
    /RUNNER_TEMP|\.artifacts\//,
    `${workflowPath} must initialize bounded evidence through RUNNER_TEMP after allocation or a stable repository-relative .artifacts path`,
  );
}

console.log(`Validated post-allocation evidence-path registration for ${workflowPaths.length} push/reusable workflows.`);
