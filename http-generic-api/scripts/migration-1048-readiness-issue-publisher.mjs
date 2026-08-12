#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const EXPECTED_WORKFLOW = 'Governed Migration 1048 Transport Response Schema Rollout';
const EXPECTED_ISSUE = 6531;
const READY_PREFIX = 'TRANSPORT_RESPONSE_SCHEMA_1048_READINESS result=pass ';
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/u;

function env(name) {
  return String(process.env[name] || '').trim();
}

async function githubJson(url, { token, method = 'GET', body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'mad4b-migration-1048-readiness-publisher',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  assert.ok(response.ok, `GitHub API ${method} failed: HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}

function validateMarker(summary) {
  assert.equal(summary?.result, 'ready_for_apply', 'Readiness publisher only accepts ready_for_apply evidence');
  assert.equal(summary?.secrets_included, false, 'Readiness evidence must declare secrets_included=false');
  assert.match(String(summary?.production_sha || ''), SHA_PATTERN, 'Readiness evidence has invalid Production SHA');
  assert.match(String(summary?.migration_blob_sha || ''), SHA_PATTERN, 'Readiness evidence has invalid migration blob SHA');
  assert.match(String(summary?.checksum || ''), CHECKSUM_PATTERN, 'Readiness evidence has invalid checksum');
  assert.equal(Number(summary?.statement_count), 34, 'Readiness evidence statement count mismatch');
  assert.equal(summary?.authorization, 'pass', 'Readiness authorization must pass');
  assert.equal(summary?.dry_run, 'pass', 'Readiness dry-run must pass');

  const marker = String(summary?.readiness_marker || '');
  assert.ok(marker.startsWith(READY_PREFIX), 'Readiness marker prefix mismatch');
  for (const expected of [
    `production_sha=${summary.production_sha}`,
    `migration_blob=${summary.migration_blob_sha}`,
    `checksum=${summary.checksum}`,
    `statement_count=${summary.statement_count}`,
    'authorization=pass',
    'dry_run=pass',
  ]) {
    assert.ok(marker.includes(expected), `Readiness marker missing ${expected}`);
  }
  return marker;
}

async function main() {
  const repository = env('GITHUB_REPOSITORY');
  const token = env('GITHUB_TOKEN');
  const sourceRunId = Number(env('SOURCE_RUN_ID'));
  const sourceHeadSha = env('SOURCE_HEAD_SHA');
  const summaryPath = path.resolve(env('READINESS_SUMMARY_PATH'));
  const issue = Number(env('CONTROL_ISSUE') || EXPECTED_ISSUE);

  assert.match(repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u, 'GITHUB_REPOSITORY must be owner/name');
  assert.ok(token, 'GITHUB_TOKEN is required');
  assert.ok(Number.isInteger(sourceRunId) && sourceRunId > 0, 'SOURCE_RUN_ID must be positive');
  assert.match(sourceHeadSha, SHA_PATTERN, 'SOURCE_HEAD_SHA must be a full SHA');
  assert.equal(issue, EXPECTED_ISSUE, 'Control issue binding mismatch');
  assert.ok(fs.existsSync(summaryPath), 'Readiness summary artifact is missing');

  const api = `https://api.github.com/repos/${repository}`;
  const sourceRun = await githubJson(`${api}/actions/runs/${sourceRunId}`, { token });
  assert.equal(sourceRun?.name, EXPECTED_WORKFLOW, 'Unexpected readiness source workflow');
  assert.equal(sourceRun?.event, 'issue_comment', 'Readiness source must originate from issue_comment');
  assert.equal(sourceRun?.status, 'completed', 'Readiness source run must be completed');
  assert.equal(sourceRun?.conclusion, 'success', 'Readiness source run must succeed');
  assert.equal(sourceRun?.head_sha, sourceHeadSha, 'Readiness source head SHA mismatch');

  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  if (summary?.result === 'already_applied') {
    process.stdout.write(`${JSON.stringify({ ok: true, action: 'not_required', reason: 'already_applied', source_run_id: sourceRunId, source_head_sha: sourceHeadSha, secrets_included: false })}\n`);
    return;
  }
  const marker = validateMarker(summary);

  const comments = await githubJson(`${api}/issues/${issue}/comments?per_page=100`, { token });
  const existing = [...comments].reverse().find((comment) => String(comment?.body || '') === marker);
  if (existing) {
    process.stdout.write(`${JSON.stringify({ ok: true, action: 'unchanged', comment_id: existing.id, source_run_id: sourceRunId, source_head_sha: sourceHeadSha, secrets_included: false })}\n`);
    return;
  }

  const created = await githubJson(`${api}/issues/${issue}/comments`, {
    token,
    method: 'POST',
    body: { body: marker },
  });
  process.stdout.write(`${JSON.stringify({ ok: true, action: 'created', comment_id: created.id, source_run_id: sourceRunId, source_head_sha: sourceHeadSha, secrets_included: false })}\n`);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});
