import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const TOKEN = String(process.env.GITHUB_TOKEN || '').trim();
const REPOSITORY = String(process.env.REPOSITORY || '').trim();
const EXPECTED_HEAD = String(process.env.EXPECTED_EVENT_HEAD || '').trim().toLowerCase();
const OUTPUT_DIR = String(process.env.EVIDENCE_DIR || '').trim();
const WORKFLOW_FILE = 'spec014-wave1-runtime-readiness.yml';
const WORKFLOW_NAME = 'Spec 014 Wave 1 Runtime Readiness';

assert.ok(TOKEN, 'GITHUB_TOKEN is required');
assert.equal(REPOSITORY, 'mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os');
assert.match(EXPECTED_HEAD, /^[0-9a-f]{40}$/);
assert.ok(OUTPUT_DIR);
await fs.mkdir(path.join(OUTPUT_DIR, 'target-artifact'), { recursive: true });

async function apiJson(url) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  assert.ok(response.ok, `GitHub API ${response.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const runsUrl = `https://api.github.com/repos/${REPOSITORY}/actions/workflows/${WORKFLOW_FILE}/runs?event=issue_comment&per_page=20`;
let targetRun = null;
for (let attempt = 1; attempt <= 40; attempt += 1) {
  const payload = await apiJson(runsUrl);
  const candidates = (payload?.workflow_runs || [])
    .filter((run) => run.event === 'issue_comment')
    .filter((run) => String(run.head_sha || '').toLowerCase() === EXPECTED_HEAD)
    .filter((run) => run.name === WORKFLOW_NAME)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  targetRun = candidates[0] || null;
  await fs.writeFile(
    path.join(OUTPUT_DIR, 'workflow-runs.json'),
    `${JSON.stringify(payload, null, 2)}\n`,
  );
  if (targetRun?.id) break;
  await sleep(15_000);
}
assert.ok(targetRun?.id, 'Exact issue-comment workflow run was not discovered');
await fs.writeFile(path.join(OUTPUT_DIR, 'target-run-id.txt'), `${targetRun.id}\n`);

const runUrl = `https://api.github.com/repos/${REPOSITORY}/actions/runs/${targetRun.id}`;
for (let attempt = 1; attempt <= 120; attempt += 1) {
  targetRun = await apiJson(runUrl);
  await fs.writeFile(
    path.join(OUTPUT_DIR, 'target-run.json'),
    `${JSON.stringify(targetRun, null, 2)}\n`,
  );
  if (targetRun.status === 'completed') break;
  await sleep(15_000);
}
assert.equal(targetRun.status, 'completed');
assert.equal(targetRun.event, 'issue_comment');
assert.equal(String(targetRun.head_sha).toLowerCase(), EXPECTED_HEAD);
assert.equal(targetRun.name, WORKFLOW_NAME);

const jobs = await apiJson(
  `https://api.github.com/repos/${REPOSITORY}/actions/runs/${targetRun.id}/jobs?per_page=100`,
);
await fs.writeFile(path.join(OUTPUT_DIR, 'target-jobs.json'), `${JSON.stringify(jobs, null, 2)}\n`);

const artifacts = await apiJson(
  `https://api.github.com/repos/${REPOSITORY}/actions/runs/${targetRun.id}/artifacts?per_page=100`,
);
await fs.writeFile(
  path.join(OUTPUT_DIR, 'target-artifacts.json'),
  `${JSON.stringify(artifacts, null, 2)}\n`,
);
const artifact = (artifacts?.artifacts || []).find((item) =>
  String(item.name || '').startsWith('spec014-wave1-runtime-readiness-'),
);
assert.ok(artifact?.id, 'Target runtime Artifact was not found');
await fs.writeFile(path.join(OUTPUT_DIR, 'target-artifact-id.txt'), `${artifact.id}\n`);

const archiveResponse = await fetch(
  `https://api.github.com/repos/${REPOSITORY}/actions/artifacts/${artifact.id}/zip`,
  {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(60_000),
  },
);
assert.ok(archiveResponse.ok, `Artifact download failed: HTTP ${archiveResponse.status}`);
const archivePath = path.join(OUTPUT_DIR, 'target-artifact.zip');
await fs.writeFile(archivePath, Buffer.from(await archiveResponse.arrayBuffer()));
execFileSync('unzip', ['-q', archivePath, '-d', path.join(OUTPUT_DIR, 'target-artifact')]);

const statePath = path.join(OUTPUT_DIR, 'target-artifact', 'state.json');
const summaryPath = path.join(OUTPUT_DIR, 'target-artifact', 'summary.json');
const failurePath = path.join(OUTPUT_DIR, 'target-artifact', 'failure.json');
const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
const summary = await fs
  .readFile(summaryPath, 'utf8')
  .then(JSON.parse)
  .catch(() => null);
const failure = await fs
  .readFile(failurePath, 'utf8')
  .then(JSON.parse)
  .catch(() => null);

function assertBoundary(record) {
  assert.equal(record.apply_authorized, false);
  assert.equal(record.apply_sent, false);
  assert.equal(record.migration_apply_executed, false);
  assert.equal(record.provider_call_executed, false);
  assert.equal(record.credential_payload_accessed, false);
  assert.equal(record.external_business_write_executed, false);
  assert.equal(record.secrets_included, false);
}
assertBoundary(state);
if (summary) {
  assert.ok(['pass', 'already_applied'].includes(summary.result));
  assertBoundary(summary);
} else {
  assert.ok(failure);
  assert.equal(failure.ok, false);
  assertBoundary(failure);
}

const result = {
  contract: 'spec014_wave1_runtime_observer_result.v2',
  target_run_id: String(targetRun.id),
  target_artifact_id: String(artifact.id),
  target_status: targetRun.status,
  target_conclusion: targetRun.conclusion,
  evidence_result: summary?.result || 'failure',
  repository_write: false,
  migration_apply_executed: false,
  provider_call_executed: false,
  credential_payload_accessed: false,
  external_business_write_executed: false,
  secrets_included: false,
};
await fs.writeFile(path.join(OUTPUT_DIR, 'observer-result.json'), `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
