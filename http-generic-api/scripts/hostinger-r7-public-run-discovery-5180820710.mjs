import assert from 'node:assert/strict';

const repository = 'mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os';
const commentId = '5180820710';
const expectedBody =
  'RUN_HOSTINGER_PRODUCTION_RUNTIME_READBACK_R7 expected_production_sha=42177d360e9c6d76b4f09eaf06bd98ac26d09abe';
const workflowFile = 'hostinger-production-runtime-readback-r7.yml';
const workflowName = 'Hostinger Production Runtime Readback R7';
const maxDeltaMs = 5 * 60 * 1000;

async function apiJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'hostinger-r7-public-run-observer',
    },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  assert.ok(response.ok, `GitHub public API ${response.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

const comment = await apiJson(
  `https://api.github.com/repos/${repository}/issues/comments/${commentId}`,
);
assert.equal(String(comment.id), commentId);
assert.equal(comment.body, expectedBody);
assert.ok(String(comment.issue_url || '').endsWith('/issues/6275'));
const createdAtMs = Date.parse(comment.created_at);
assert.ok(Number.isFinite(createdAtMs));

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
    delta_ms: Math.abs(Date.parse(run.created_at) - createdAtMs),
  }))
  .filter((entry) => Number.isFinite(entry.delta_ms) && entry.delta_ms <= maxDeltaMs)
  .sort((a, b) => a.delta_ms - b.delta_ms || Number(a.id) - Number(b.id));

const result = Object.freeze({
  contract: 'hostinger_production_runtime_readback_r7_public_run_discovery.v2',
  trigger_comment_id: commentId,
  trigger_created_at: comment.created_at,
  trigger_actor: comment.user?.login || null,
  candidate_count: candidates.length,
  target: candidates[0] || null,
  candidates,
  public_metadata_only: true,
  provider_credential_accessed: false,
  deployment_performed: false,
  restart_performed: false,
  sql_execution_performed: false,
  migration_apply_executed: false,
  database_mutation_performed: false,
  secrets_included: false,
});
process.stdout.write(`HOSTINGER_R7_CORRECTED_RUN_DISCOVERY=${JSON.stringify(result)}\n`);
assert.ok(result.target?.id, 'Corrected Hostinger R7 run was not discovered');
