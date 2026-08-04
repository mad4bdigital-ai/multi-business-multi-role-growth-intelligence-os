import assert from 'node:assert/strict';

const repository = 'mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os';
const authorizationCommentId = '5179409708';
const authorizationBody =
  'AUTHORIZE_GOVERNED_MIGRATION_20260802_01_SPEC014_HOSTINGER_STORAGE_FOUNDATION';
const workflowFile = 'spec014-wave1-runtime-readiness.yml';
const workflowName = 'Spec 014 Wave 1 Runtime Readiness';
const maxDeltaMs = 5 * 60 * 1000;

async function apiJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'spec014-wave1-runtime-public-observer',
    },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  assert.ok(response.ok, `GitHub public API ${response.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

const comment = await apiJson(
  `https://api.github.com/repos/${repository}/issues/comments/${authorizationCommentId}`,
);
assert.equal(String(comment.id), authorizationCommentId);
assert.equal(comment.body, authorizationBody);
assert.equal(comment.issue_url, `https://api.github.com/repos/${repository}/issues/6215`);
const commentCreatedAtMs = Date.parse(comment.created_at);
assert.ok(Number.isFinite(commentCreatedAtMs), 'Authorization comment timestamp must be valid');

const runs = await apiJson(
  `https://api.github.com/repos/${repository}/actions/workflows/${workflowFile}/runs?event=issue_comment&per_page=100`,
);
const candidates = (runs.workflow_runs || [])
  .filter((run) => run.event === 'issue_comment')
  .filter((run) => run.name === workflowName)
  .filter((run) => run.actor?.login === comment.user?.login)
  .map((run) => ({
    id: run.id,
    status: run.status,
    conclusion: run.conclusion,
    created_at: run.created_at,
    updated_at: run.updated_at,
    head_sha: run.head_sha,
    head_branch: run.head_branch,
    actor: run.actor?.login || null,
    delta_ms: Math.abs(Date.parse(run.created_at) - commentCreatedAtMs),
  }))
  .filter((entry) => Number.isFinite(entry.delta_ms))
  .filter((entry) => entry.delta_ms <= maxDeltaMs)
  .sort((a, b) => a.delta_ms - b.delta_ms || Number(a.id) - Number(b.id));

const discovery = Object.freeze({
  contract: 'spec014_wave1_runtime_public_run_discovery.v1',
  authorization_comment_id: authorizationCommentId,
  authorization_created_at: comment.created_at,
  authorization_actor: comment.user?.login || null,
  candidate_count: candidates.length,
  target: candidates[0] || null,
  candidates,
  public_metadata_only: true,
  runtime_contact: false,
  database_access: false,
  migration_apply_executed: false,
  provider_call_executed: false,
  credential_payload_accessed: false,
  external_business_write_executed: false,
  secrets_included: false,
});

process.stdout.write(`SPEC014_WAVE1_RUNTIME_RUN_DISCOVERY=${JSON.stringify(discovery)}\n`);
assert.ok(discovery.target?.id, 'Exact Wave 1 runtime issue-comment run was not discovered');
