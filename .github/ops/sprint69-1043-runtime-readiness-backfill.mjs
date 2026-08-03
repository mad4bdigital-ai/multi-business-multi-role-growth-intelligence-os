#!/usr/bin/env node
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const MODE = String(process.argv[2] || '').trim().toLowerCase();
const API = 'https://api.github.com';
const REPOSITORY = String(process.env.REPOSITORY || 'mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os').trim();
const ISSUE_NUMBER = Number(process.env.ISSUE_NUMBER || 4449);
const AUTHORIZATION_COMMENT_ID = Number(process.env.AUTHORIZATION_COMMENT_ID || 5160291051);
const AUTHORIZATION_COMMENT = 'AUTHORIZE_GOVERNED_MIGRATION_1043_SPRINT69_TENANT_MANAGED_EXECUTION_LIFECYCLE';
const WORKFLOW_FILE = 'sprint69-1043-runtime-readiness.yml';
const WORKFLOW_NAME = 'Sprint 69 Migration 1043 Runtime Readiness';
const REPORT_DIR = String(process.env.REPORT_DIR || '.artifacts/sprint69-1043-runtime-readiness-backfill').trim();
const SOURCE_DIR = String(process.env.SOURCE_DIR || '.artifacts/sprint69-1043-runtime-readiness-source').trim();
const TOKEN = String(process.env.GH_TOKEN || '').trim();
const OUTPUT_PATH = String(process.env.GITHUB_OUTPUT || '').trim();
const ALLOWED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
const ALLOWED_AUTHORIZATION_COMMENT_IDS = new Set([5160291051, 5169156192]);

const sensitiveKey = /(password|secret|token|authorization|cookie|api[_-]?key|credential|private[_-]?key|refresh[_-]?token|access[_-]?token)/i;
const SAFE_EVIDENCE_KEYS = new Set([
  'activation_registry_sync_executed',
  'apply_authorized',
  'apply_sent',
  'authorization_bootstrap',
  'authorization_comment_id',
  'authorization_created',
  'authorization_required',
  'business_data_mutation_executed',
  'credential_payload_accessed',
  'external_business_write_executed',
  'external_write_executed',
  'managed_control_plane_write_executed',
  'migration_apply_executed',
  'provider_call_executed',
  'repository_mutation_performed',
  'secrets_included',
]);

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    sensitiveKey.test(key) && !SAFE_EVIDENCE_KEYS.has(key)
      ? '[redacted]'
      : sanitize(child),
  ]));
}

async function writeJson(name, value) {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  await fs.writeFile(path.join(REPORT_DIR, name), `${JSON.stringify(sanitize(value), null, 2)}\n`, 'utf8');
}

async function writeText(name, value) {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  await fs.writeFile(path.join(REPORT_DIR, name), String(value), 'utf8');
}

async function output(name, value) {
  if (!OUTPUT_PATH) return;
  await fs.appendFile(OUTPUT_PATH, `${name}=${String(value)}\n`, 'utf8');
}

async function githubJson(pathname, options = {}) {
  assert.ok(TOKEN, 'GH_TOKEN is required');
  const response = await fetch(`${API}${pathname}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; }
  catch { payload = { non_json_response: true }; }
  assert.ok(response.ok, `GitHub request failed for ${pathname}: HTTP ${response.status}`);
  return payload;
}

function isoMs(value) {
  const ms = Date.parse(String(value || ''));
  assert.ok(Number.isFinite(ms), `Invalid GitHub timestamp: ${value}`);
  return ms;
}

async function discover() {
  assert.equal(REPOSITORY, 'mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os');
  assert.equal(ISSUE_NUMBER, 4449);
  assert.ok(ALLOWED_AUTHORIZATION_COMMENT_IDS.has(AUTHORIZATION_COMMENT_ID), 'Authorization comment is not an approved immutable T016 binding');

  const comment = await githubJson(`/repos/${REPOSITORY}/issues/comments/${AUTHORIZATION_COMMENT_ID}`);
  assert.equal(String(comment?.body || '').trim(), AUTHORIZATION_COMMENT);
  assert.equal(Number(String(comment?.issue_url || '').split('/').pop()), ISSUE_NUMBER);
  assert.equal(comment?.user?.login, 'mad4bdigital-ai');
  assert.ok(ALLOWED_ASSOCIATIONS.has(String(comment?.author_association || '').toUpperCase()));

  const commentMs = isoMs(comment.created_at);
  const allRuns = [];
  let pagesFetched = 0;
  let reachedCommentBoundary = false;
  for (let page = 1; page <= 20; page += 1) {
    const list = await githubJson(
      `/repos/${REPOSITORY}/actions/workflows/${encodeURIComponent(WORKFLOW_FILE)}/runs?event=issue_comment&per_page=100&page=${page}`,
    );
    const pageRuns = list?.workflow_runs || [];
    pagesFetched = page;
    allRuns.push(...pageRuns);
    if (!pageRuns.length) break;
    const oldestMs = Math.min(...pageRuns.map((candidate) => isoMs(candidate.created_at)));
    if (oldestMs <= commentMs) {
      reachedCommentBoundary = true;
      break;
    }
  }
  assert.ok(reachedCommentBoundary, 'Runtime Readiness run pagination did not reach the authorization boundary');
  const candidates = allRuns
    .filter((run) => run?.name === WORKFLOW_NAME)
    .filter((run) => run?.event === 'issue_comment')
    .filter((run) => run?.head_branch === 'main')
    .filter((run) => run?.actor?.login === comment.user.login)
    .filter((run) => isoMs(run.created_at) >= commentMs)
    .sort((left, right) => isoMs(left.created_at) - isoMs(right.created_at));
  const nonSkippedCandidates = candidates.filter((run) => run?.conclusion !== 'skipped');

  let run = nonSkippedCandidates[0] || null;
  if (run) {
    for (let attempt = 1; attempt <= 12 && run.status !== 'completed'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10000));
      run = await githubJson(`/repos/${REPOSITORY}/actions/runs/${run.id}`);
    }
  }

  let artifact = null;
  if (run?.status === 'completed') {
    const artifacts = await githubJson(`/repos/${REPOSITORY}/actions/runs/${run.id}/artifacts?per_page=100`);
    const expectedName = `sprint69-1043-runtime-readiness-${run.id}`;
    artifact = (artifacts?.artifacts || []).find((candidate) => (
      candidate?.name === expectedName && candidate?.expired === false
    )) || null;
  }

  const outcome = !run
    ? 'run_not_found'
    : run.status !== 'completed'
      ? 'run_not_completed'
      : !artifact
        ? 'artifact_missing'
        : 'artifact_ready';

  const report = {
    contract: 'sprint69_1043_runtime_readiness_backfill_discovery.v1',
    outcome,
    repository: REPOSITORY,
    issue_number: ISSUE_NUMBER,
    authorization_comment_id: AUTHORIZATION_COMMENT_ID,
    authorization_comment_verified: true,
    authorization_actor: comment.user.login,
    authorization_association: comment.author_association,
    authorization_created_at: comment.created_at,
    workflow_name: WORKFLOW_NAME,
    workflow_file: WORKFLOW_FILE,
    pages_fetched: pagesFetched,
    reached_comment_boundary: reachedCommentBoundary,
    scanned_run_count: allRuns.length,
    candidate_count: candidates.length,
    non_skipped_candidate_count: nonSkippedCandidates.length,
    run_id: run?.id || null,
    run_url: run?.html_url || null,
    run_status: run?.status || null,
    run_conclusion: run?.conclusion || null,
    run_created_at: run?.created_at || null,
    run_updated_at: run?.updated_at || null,
    artifact_id: artifact?.id || null,
    artifact_name: artifact?.name || null,
    artifact_expired: artifact?.expired ?? null,
    repository_mutation_performed: false,
    runtime_contacted_by_backfill: false,
    managed_control_plane_write_executed_by_backfill: false,
    migration_apply_executed_by_backfill: false,
    provider_call_executed: false,
    credential_payload_accessed: false,
    external_business_write_executed: false,
    consult_job_logs: false,
    secrets_included: false,
  };

  await writeJson('discovery.json', report);
  await output('outcome', outcome);
  await output('run_id', run?.id || '');
  await output('run_url', run?.html_url || '');
  await output('run_conclusion', run?.conclusion || '');
  await output('artifact_found', artifact ? 'true' : 'false');
  await output('artifact_name', artifact?.name || '');
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function safeBoolean(value) {
  return value === true || value === false ? value : null;
}

function boundedRuntimeResult(summary, failure, discovery) {
  if (summary) {
    assert.equal(safeBoolean(summary.secrets_included), false);
    assert.equal(summary.contract, 'sprint69_1043_runtime_readiness.v1');
    return {
      status: 'pass',
      result: summary.result,
      main_sha: summary.main_sha || null,
      production_sha: summary.production_sha || null,
      migration_checksum_sha256: summary.migration_checksum_sha256 || null,
      statement_count: summary.statement_count ?? null,
      runtime_parity: summary.runtime_parity || null,
      authorization_created: summary.authorization_created ?? false,
      authorization_bootstrap: summary.authorization_bootstrap || null,
      dry_run: summary.dry_run || null,
      apply_authorized: summary.apply_authorized ?? false,
      apply_sent: summary.apply_sent ?? false,
      migration_apply_executed: summary.migration_apply_executed ?? false,
      activation_registry_sync_executed: summary.activation_registry_sync_executed ?? false,
      secrets_included: false,
    };
  }
  if (failure) {
    const failureSecretsIncluded = safeBoolean(failure.secrets_included);
    assert.equal(failure.contract, 'sprint69_1043_runtime_readiness_failure.v1');
    return {
      status: 'fail',
      result: 'runtime_readiness_failed',
      stage: failure.stage || 'unknown',
      main_sha: failure.main_sha || null,
      production_sha: failure.production_sha || null,
      migration_checksum_sha256: failure.migration_checksum_sha256 || null,
      statement_count: failure.statement_count ?? null,
      error_code: failure.error?.code || 'runtime_readiness_failed',
      authorization_created: failure.authorization_created ?? false,
      apply_authorized: failure.apply_authorized ?? false,
      apply_sent: failure.apply_sent ?? false,
      migration_apply_executed: failure.migration_apply_executed ?? false,
      activation_registry_sync_executed: failure.activation_registry_sync_executed ?? false,
      secrets_included: false,
    };
  }
  return {
    status: 'fail',
    result: discovery.outcome,
    error_code: discovery.outcome,
    authorization_created: false,
    apply_authorized: false,
    apply_sent: false,
    migration_apply_executed: false,
    activation_registry_sync_executed: false,
    secrets_included: false,
  };
}

function markdownBody(discovery, runtime) {
  const markerKey = discovery.run_id || `comment-${AUTHORIZATION_COMMENT_ID}`;
  const marker = `<!-- sprint69-1043-runtime-readiness-backfill:${markerKey} -->`;
  const lines = [
    marker,
    '## Migration 1043 Runtime Readiness evidence',
    '',
    `- Authorization comment: #${AUTHORIZATION_COMMENT_ID} verified`,
    `- Workflow run: ${discovery.run_url ? `[${discovery.run_id}](${discovery.run_url})` : 'not observed'}`,
    `- Workflow conclusion: ${discovery.run_conclusion || 'unavailable'}`,
    `- Evidence result: ${runtime.result || runtime.status}`,
    `- Main SHA: \`${runtime.main_sha || 'unverified'}\``,
    `- Production SHA: \`${runtime.production_sha || 'unverified'}\``,
    `- Migration checksum: \`${runtime.migration_checksum_sha256 || 'unverified'}\``,
    `- Statement count: ${runtime.statement_count ?? 'unverified'}`,
    `- Runtime parity: ${runtime.runtime_parity || 'unverified'}`,
    `- Authorization created by readiness run: ${runtime.authorization_created ?? false}`,
    `- Authorization bootstrap: ${runtime.authorization_bootstrap || 'unverified'}`,
    `- Dry run: ${runtime.dry_run || 'unverified'}`,
    `- Apply authorized: ${runtime.apply_authorized ?? false}`,
    `- Apply sent: ${runtime.apply_sent ?? false}`,
    `- Migration Apply executed: ${runtime.migration_apply_executed ?? false}`,
    `- Activation registry sync executed: ${runtime.activation_registry_sync_executed ?? false}`,
    `- Secrets included: ${runtime.secrets_included ?? 'unverified'}`,
    '',
    runtime.status === 'pass'
      ? 'Runtime Readiness evidence passed. Migration Apply remains a separate explicit action and was not triggered by this publisher.'
      : `Runtime Readiness evidence is not complete. Failure code: \`${runtime.error_code || runtime.result || 'unknown'}\`. No Apply action was triggered.`,
  ];
  return `${lines.join('\n')}\n`;
}

async function publish() {
  const discovery = await readJsonIfPresent(path.join(REPORT_DIR, 'discovery.json'));
  assert.ok(discovery, 'Discovery report is required');
  assert.equal(discovery.secrets_included, false);
  assert.equal(discovery.consult_job_logs, false);

  const summary = await readJsonIfPresent(path.join(SOURCE_DIR, 'summary.json'));
  const failure = await readJsonIfPresent(path.join(SOURCE_DIR, 'failure.json'));
  assert.ok(!(summary && failure), 'Source Artifact cannot contain both summary.json and failure.json');

  const runtime = boundedRuntimeResult(summary, failure, discovery);
  const body = markdownBody(discovery, runtime);
  const marker = body.split('\n', 1)[0];

  const comments = await githubJson(`/repos/${REPOSITORY}/issues/${ISSUE_NUMBER}/comments?per_page=100`);
  const existing = (comments || []).find((comment) => String(comment?.body || '').includes(marker));
  let published;
  if (existing) {
    published = await githubJson(`/repos/${REPOSITORY}/issues/comments/${existing.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
  } else {
    published = await githubJson(`/repos/${REPOSITORY}/issues/${ISSUE_NUMBER}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
  }

  const publication = {
    contract: 'sprint69_1043_runtime_readiness_backfill_publication.v1',
    outcome: runtime.status,
    issue_number: ISSUE_NUMBER,
    authorization_comment_id: AUTHORIZATION_COMMENT_ID,
    run_id: discovery.run_id,
    run_url: discovery.run_url,
    source_artifact_consumed: Boolean(summary || failure),
    source_contract: summary?.contract || failure?.contract || null,
    runtime_result: runtime.result,
    published_comment_id: published?.id || null,
    published_comment_url: published?.html_url || null,
    comment_updated: Boolean(existing),
    repository_mutation_performed: false,
    issue_comment_write_executed: true,
    runtime_contacted_by_backfill: false,
    managed_control_plane_write_executed_by_backfill: false,
    migration_apply_executed_by_backfill: false,
    provider_call_executed: false,
    credential_payload_accessed: false,
    external_business_write_executed: false,
    consult_job_logs: false,
    secrets_included: false,
  };
  await writeJson('publication.json', publication);
  await writeText('publication.md', body);
  await output('publication_ok', runtime.status === 'pass' ? 'true' : 'false');
  process.stdout.write(`${JSON.stringify(publication, null, 2)}\n`);
}

if (MODE === 'discover') await discover();
else if (MODE === 'publish') await publish();
else throw new Error('Expected mode discover or publish');
