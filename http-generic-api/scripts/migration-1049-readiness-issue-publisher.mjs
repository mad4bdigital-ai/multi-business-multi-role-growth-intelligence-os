import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const GH = String(process.env.GITHUB_TOKEN || '').trim();
const REPO = String(process.env.REPOSITORY || 'mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os').trim();
const ISSUE = Number(process.env.CONTROL_ISSUE || 6612);
const SOURCE_RUN_ID = Number(process.env.SOURCE_RUN_ID || 0);
const SOURCE_HEAD_SHA = String(process.env.SOURCE_HEAD_SHA || '').trim().toLowerCase();
const SOURCE_WORKFLOW = String(process.env.SOURCE_WORKFLOW || '').trim();
const SUMMARY_PATH = String(process.env.READINESS_SUMMARY_PATH || '').trim();
const EXPECTED_WORKFLOW = 'Governed Migration 1049 GitHub Repository Policy Rollout';
const EXPECTED_SOURCE_MERGE_SHA = 'f3f98374a8207c6106aea8a6a334e38101defed1';
const READY_PREFIX = 'GITHUB_REPOSITORY_POLICY_1049_READINESS result=pass ';

async function github(pathname, options = {}) {
  const response = await fetch(`https://api.github.com${pathname}`, {
    ...options,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${GH}`, 'X-GitHub-Api-Version': '2022-11-28', ...(options.headers || {}) },
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let payload = null; try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  assert.ok(response.ok, `GitHub request failed HTTP ${response.status}: ${pathname}`);
  return payload;
}

assert.ok(GH, 'GITHUB_TOKEN required');
assert.equal(SOURCE_WORKFLOW, EXPECTED_WORKFLOW);
assert.match(SOURCE_HEAD_SHA, /^[0-9a-f]{40}$/);
assert.ok(SOURCE_RUN_ID > 0);
assert.ok(SUMMARY_PATH);

const sourceRun = await github(`/repos/${REPO}/actions/runs/${SOURCE_RUN_ID}`);
assert.equal(sourceRun?.name, EXPECTED_WORKFLOW);
assert.equal(sourceRun?.event, 'issue_comment');
assert.equal(sourceRun?.conclusion, 'success');
assert.equal(String(sourceRun?.head_sha || '').toLowerCase(), SOURCE_HEAD_SHA);

const summary = JSON.parse(readFileSync(SUMMARY_PATH, 'utf8'));
assert.equal(summary?.result, 'ready_for_apply');
assert.equal(summary?.authorization, 'pass');
assert.equal(summary?.dry_run, 'pass');
assert.match(String(summary?.production_sha || ''), /^[0-9a-f]{40}$/);
assert.match(String(summary?.migration_blob_sha || ''), /^[0-9a-f]{40}$/);
assert.match(String(summary?.checksum || ''), /^[0-9a-f]{64}$/);
assert.equal(Number(summary?.statement_count), 4);
assert.ok(['ahead', 'identical'].includes(String(summary?.source_merge_status || '')), 'Readiness summary did not prove the canonical source merge is contained in Production');
assert.equal(summary?.secrets_included, false);

const marker = `${READY_PREFIX}production_sha=${summary.production_sha} migration_blob=${summary.migration_blob_sha} checksum=${summary.checksum} statement_count=${summary.statement_count} source_merge=${EXPECTED_SOURCE_MERGE_SHA}`;
const comments = await github(`/repos/${REPO}/issues/${ISSUE}/comments?per_page=100`);
if (comments.some((comment) => String(comment?.body || '').trim() === marker)) {
  console.log(JSON.stringify({ ok: true, action: 'unchanged', issue: ISSUE, source_run_id: SOURCE_RUN_ID, source_head_sha: SOURCE_HEAD_SHA, source_merge_sha: EXPECTED_SOURCE_MERGE_SHA, marker_sha256_bound: true, secrets_included: false }));
  process.exit(0);
}
await github(`/repos/${REPO}/issues/${ISSUE}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: marker }) });
console.log(JSON.stringify({ ok: true, action: 'created', issue: ISSUE, source_run_id: SOURCE_RUN_ID, source_head_sha: SOURCE_HEAD_SHA, source_merge_sha: EXPECTED_SOURCE_MERGE_SHA, marker_sha256_bound: true, secrets_included: false }));
