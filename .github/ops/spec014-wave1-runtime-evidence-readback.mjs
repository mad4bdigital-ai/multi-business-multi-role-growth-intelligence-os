import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const TOKEN = String(process.env.GITHUB_TOKEN || '').trim();
const REPOSITORY = String(
  process.env.REPOSITORY || 'mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os',
).trim();
const ISSUE_NUMBER = Number(process.env.ISSUE_NUMBER || 6215);
const OUTPUT_DIR = String(
  process.env.EVIDENCE_DIR || '.artifacts/spec014-wave1-runtime-evidence-readback',
).trim();

const TARGET_WORKFLOW_FILE = 'spec014-wave1-runtime-readiness.yml';
const TARGET_WORKFLOW_NAME = 'Spec 014 Wave 1 Runtime Readiness';
const TARGET_EVENT_HEAD = 'd76dc2bf9b073a18c2fa51cd5907cb30f0c03ab4';
const AUTHORIZATION_COMMENT_ID = '5179409708';
const READBACK_MARKER = 'SPEC014_WAVE1_RUNTIME_EVIDENCE_READBACK';

assert.ok(TOKEN, 'GITHUB_TOKEN is required');
assert.equal(REPOSITORY, 'mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os');
assert.equal(ISSUE_NUMBER, 6215);
assert.match(TARGET_EVENT_HEAD, /^[0-9a-f]{40}$/);
await fs.mkdir(path.join(OUTPUT_DIR, 'target-artifact'), { recursive: true });

async function apiJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(options.timeoutMs || 30_000),
  });
  const text = await response.text();
  assert.ok(response.ok, `GitHub API ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function assertBoundary(record) {
  assert.equal(record.apply_authorized, false);
  assert.equal(record.apply_sent, false);
  assert.equal(record.migration_apply_executed, false);
  assert.equal(record.provider_call_executed, false);
  assert.equal(record.credential_payload_accessed, false);
  assert.equal(record.external_business_write_executed, false);
  assert.equal(record.secrets_included, false);
}

const runsUrl = `https://api.github.com/repos/${REPOSITORY}/actions/workflows/${TARGET_WORKFLOW_FILE}/runs?event=issue_comment&per_page=30`;
let targetRun = null;
for (let attempt = 1; attempt <= 40; attempt += 1) {
  const runs = await apiJson(runsUrl);
  await fs.writeFile(path.join(OUTPUT_DIR, 'workflow-runs.json'), `${JSON.stringify(runs, null, 2)}\n`);
  const candidates = (runs?.workflow_runs || [])
    .filter((run) => run.event === 'issue_comment')
    .filter((run) => run.name === TARGET_WORKFLOW_NAME)
    .filter((run) => String(run.head_sha || '').toLowerCase() === TARGET_EVENT_HEAD)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  targetRun = candidates[0] || null;
  if (targetRun?.id) break;
  await sleep(15_000);
}
assert.ok(targetRun?.id, 'Exact Wave 1 issue-comment run was not discovered');
await fs.writeFile(path.join(OUTPUT_DIR, 'target-run-id.txt'), `${targetRun.id}\n`);

const runUrl = `https://api.github.com/repos/${REPOSITORY}/actions/runs/${targetRun.id}`;
for (let attempt = 1; attempt <= 120; attempt += 1) {
  targetRun = await apiJson(runUrl);
  await fs.writeFile(path.join(OUTPUT_DIR, 'target-run.json'), `${JSON.stringify(targetRun, null, 2)}\n`);
  if (targetRun.status === 'completed') break;
  await sleep(15_000);
}
assert.equal(targetRun.status, 'completed');
assert.equal(targetRun.event, 'issue_comment');
assert.equal(targetRun.name, TARGET_WORKFLOW_NAME);
assert.equal(String(targetRun.head_sha).toLowerCase(), TARGET_EVENT_HEAD);

const jobs = await apiJson(
  `https://api.github.com/repos/${REPOSITORY}/actions/runs/${targetRun.id}/jobs?per_page=100`,
);
await fs.writeFile(path.join(OUTPUT_DIR, 'target-jobs.json'), `${JSON.stringify(jobs, null, 2)}\n`);

const artifacts = await apiJson(
  `https://api.github.com/repos/${REPOSITORY}/actions/runs/${targetRun.id}/artifacts?per_page=100`,
);
await fs.writeFile(path.join(OUTPUT_DIR, 'target-artifacts.json'), `${JSON.stringify(artifacts, null, 2)}\n`);
const artifact = (artifacts?.artifacts || []).find((item) =>
  String(item.name || '').startsWith('spec014-wave1-runtime-readiness-'),
);
assert.ok(artifact?.id, 'Wave 1 runtime readiness Artifact was not found');
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

const state = JSON.parse(
  await fs.readFile(path.join(OUTPUT_DIR, 'target-artifact', 'state.json'), 'utf8'),
);
const summary = await fs
  .readFile(path.join(OUTPUT_DIR, 'target-artifact', 'summary.json'), 'utf8')
  .then(JSON.parse)
  .catch(() => null);
const failure = await fs
  .readFile(path.join(OUTPUT_DIR, 'target-artifact', 'failure.json'), 'utf8')
  .then(JSON.parse)
  .catch(() => null);

assertBoundary(state);
if (summary) {
  assert.ok(['pass', 'already_applied'].includes(summary.result));
  assertBoundary(summary);
} else {
  assert.ok(failure, 'Neither summary.json nor failure.json exists');
  assert.equal(failure.ok, false);
  assertBoundary(failure);
}

const evidence = summary || failure;
const evidenceResult = summary?.result || 'failure';
const stage = failure?.stage || state.stage || (summary ? 'readiness_complete' : 'unknown');
const observerResult = {
  contract: 'spec014_wave1_runtime_evidence_readback.v1',
  authorization_comment_id: AUTHORIZATION_COMMENT_ID,
  target_run_id: String(targetRun.id),
  target_run_status: targetRun.status,
  target_run_conclusion: targetRun.conclusion,
  target_artifact_id: String(artifact.id),
  target_artifact_name: artifact.name,
  target_artifact_digest: artifact.digest || null,
  evidence_result: evidenceResult,
  stage,
  runtime_parity: evidence.runtime_parity || null,
  authorization_created: Boolean(evidence.authorization_created),
  authorization_bootstrap: evidence.authorization_bootstrap || null,
  dry_run: evidence.dry_run || null,
  managed_control_plane_write_executed: Boolean(evidence.managed_control_plane_write_executed),
  business_data_mutation_executed: false,
  apply_authorized: false,
  apply_sent: false,
  migration_apply_executed: false,
  provider_call_executed: false,
  credential_payload_accessed: false,
  external_business_write_executed: false,
  secrets_included: false,
};
await fs.writeFile(
  path.join(OUTPUT_DIR, 'readback-result.json'),
  `${JSON.stringify(observerResult, null, 2)}\n`,
);

const commentBody = [
  READBACK_MARKER,
  `authorization_comment_id=${AUTHORIZATION_COMMENT_ID}`,
  `target_run_id=${observerResult.target_run_id}`,
  `target_run_status=${observerResult.target_run_status}`,
  `target_run_conclusion=${observerResult.target_run_conclusion}`,
  `target_artifact_id=${observerResult.target_artifact_id}`,
  `target_artifact_name=${observerResult.target_artifact_name}`,
  `target_artifact_digest=${observerResult.target_artifact_digest || 'unknown'}`,
  `evidence_result=${observerResult.evidence_result}`,
  `stage=${observerResult.stage}`,
  `runtime_parity=${observerResult.runtime_parity || 'unknown'}`,
  `authorization_created=${observerResult.authorization_created}`,
  `authorization_bootstrap=${observerResult.authorization_bootstrap || 'unknown'}`,
  `dry_run=${observerResult.dry_run || 'unknown'}`,
  `managed_control_plane_write_executed=${observerResult.managed_control_plane_write_executed}`,
  'business_data_mutation_executed=false',
  'apply_authorized=false',
  'apply_sent=false',
  'migration_apply_executed=false',
  'provider_call_executed=false',
  'credential_payload_accessed=false',
  'external_business_write_executed=false',
  'secrets_included=false',
].join('\n');

const posted = await apiJson(
  `https://api.github.com/repos/${REPOSITORY}/issues/${ISSUE_NUMBER}/comments`,
  {
    method: 'POST',
    body: JSON.stringify({ body: commentBody }),
  },
);
await fs.writeFile(
  path.join(OUTPUT_DIR, 'posted-comment.json'),
  `${JSON.stringify({ id: posted.id, url: posted.html_url, marker: READBACK_MARKER }, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify(observerResult, null, 2)}\n`);
