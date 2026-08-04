import assert from 'node:assert/strict';

const repository = 'mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os';
const authorizationCommentId = '5179409708';
const authorizationBody =
  'AUTHORIZE_GOVERNED_MIGRATION_20260802_01_SPEC014_HOSTINGER_STORAGE_FOUNDATION';
const workflowFile = 'spec014-wave1-runtime-readiness.yml';
const workflowName = 'Spec 014 Wave 1 Runtime Readiness';
const runtimeBase = 'https://auth.mad4b.com';
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

function collectShas(value, output = new Set()) {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/\b[0-9a-f]{40}\b/gi)) output.add(match[0].toLowerCase());
  } else if (Array.isArray(value)) {
    for (const child of value) collectShas(child, output);
  } else if (value && typeof value === 'object') {
    for (const child of Object.values(value)) collectShas(child, output);
  }
  return output;
}

async function publicRuntimeGet(pathname) {
  try {
    const response = await fetch(`${runtimeBase}${pathname}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'spec014-wave1-runtime-public-observer',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    let payload = null;
    let json = false;
    try {
      payload = text ? JSON.parse(text) : null;
      json = true;
    } catch {
      payload = null;
    }
    return {
      transport_ok: true,
      status: response.status,
      http_ok: response.ok,
      json,
      ok_flag: payload?.ok === true,
      top_level_keys:
        payload && typeof payload === 'object' && !Array.isArray(payload)
          ? Object.keys(payload).sort().slice(0, 30)
          : [],
      sha_matches: [...collectShas(payload)].sort(),
      non_json_body_length: json ? 0 : text.length,
    };
  } catch (error) {
    return {
      transport_ok: false,
      status: null,
      http_ok: false,
      json: false,
      ok_flag: false,
      top_level_keys: [],
      sha_matches: [],
      non_json_body_length: 0,
      transport_error: String(error?.name || 'Error'),
    };
  }
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

const [mainRef, productionRef, health, version, deploymentInfo] = await Promise.all([
  apiJson(`https://api.github.com/repos/${repository}/git/ref/heads/main`),
  apiJson(`https://api.github.com/repos/${repository}/git/ref/heads/Production`),
  publicRuntimeGet('/health'),
  publicRuntimeGet('/version'),
  publicRuntimeGet('/deployment-info'),
]);
const mainSha = String(mainRef?.object?.sha || '').toLowerCase();
const productionSha = String(productionRef?.object?.sha || '').toLowerCase();
assert.match(mainSha, /^[0-9a-f]{40}$/);
assert.match(productionSha, /^[0-9a-f]{40}$/);

const diagnostic = Object.freeze({
  contract: 'spec014_wave1_runtime_live_public_diagnostic.v1',
  observed_at: new Date().toISOString(),
  main_sha: mainSha,
  production_sha: productionSha,
  health,
  version,
  deployment_info: deploymentInfo,
  health_pass: health.http_ok && health.ok_flag,
  version_contains_production_sha: version.sha_matches.includes(productionSha),
  deployment_info_contains_production_sha: deploymentInfo.sha_matches.includes(productionSha),
  exact_runtime_parity:
    health.http_ok &&
    health.ok_flag &&
    version.http_ok &&
    version.sha_matches.includes(productionSha) &&
    deploymentInfo.http_ok &&
    deploymentInfo.sha_matches.includes(productionSha),
  public_get_only: true,
  runtime_contact: true,
  database_access: false,
  migration_apply_executed: false,
  provider_call_executed: false,
  credential_payload_accessed: false,
  external_business_write_executed: false,
  secrets_included: false,
});
process.stdout.write(`SPEC014_WAVE1_RUNTIME_LIVE_DIAGNOSTIC=${JSON.stringify(diagnostic)}\n`);
