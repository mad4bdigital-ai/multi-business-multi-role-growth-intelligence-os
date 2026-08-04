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
const AUTHORIZATION_COMMENT_ID = '5179409708';
const AUTHORIZATION_COMMENT =
  'AUTHORIZE_GOVERNED_MIGRATION_20260802_01_SPEC014_HOSTINGER_STORAGE_FOUNDATION';
const READBACK_MARKER = 'SPEC014_WAVE1_RUNTIME_EVIDENCE_READBACK';
const MAX_RUN_SELECTION_DELTA_MS = 5 * 60 * 1000;

assert.ok(TOKEN, 'GITHUB_TOKEN is required');
assert.equal(REPOSITORY, 'mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os');
assert.equal(ISSUE_NUMBER, 6215);
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

async function writeJson(name, value) {
  await fs.writeFile(path.join(OUTPUT_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
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

function safeString(value, fallback = 'unknown') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

const baseResult = {
  contract: 'spec014_wave1_runtime_evidence_readback.v2',
  authorization_comment_id: AUTHORIZATION_COMMENT_ID,
  readback_status: 'complete',
  target_run_id: null,
  target_run_status: null,
  target_run_conclusion: null,
  target_head_sha: null,
  target_artifact_id: null,
  target_artifact_name: null,
  target_artifact_digest: null,
  selection_delta_ms: null,
  evidence_result: 'failure',
  stage: 'readback_initialization',
  failure_code: null,
  runtime_parity: null,
  authorization_created: false,
  authorization_bootstrap: null,
  dry_run: null,
  managed_control_plane_write_executed: false,
  business_data_mutation_executed: false,
  apply_authorized: false,
  apply_sent: false,
  migration_apply_executed: false,
  provider_call_executed: false,
  credential_payload_accessed: false,
  external_business_write_executed: false,
  secrets_included: false,
};

let observerResult = { ...baseResult };

async function postResult(result) {
  await writeJson('readback-result.json', result);
  const commentBody = [
    READBACK_MARKER,
    `readback_status=${result.readback_status}`,
    `authorization_comment_id=${AUTHORIZATION_COMMENT_ID}`,
    `target_run_id=${result.target_run_id || 'not_found'}`,
    `target_run_status=${result.target_run_status || 'unknown'}`,
    `target_run_conclusion=${result.target_run_conclusion || 'unknown'}`,
    `target_head_sha=${result.target_head_sha || 'unknown'}`,
    `selection_delta_ms=${result.selection_delta_ms ?? 'unknown'}`,
    `target_artifact_id=${result.target_artifact_id || 'not_found'}`,
    `target_artifact_name=${result.target_artifact_name || 'unknown'}`,
    `target_artifact_digest=${result.target_artifact_digest || 'unknown'}`,
    `evidence_result=${result.evidence_result}`,
    `stage=${result.stage}`,
    `failure_code=${result.failure_code || 'none'}`,
    `runtime_parity=${result.runtime_parity || 'unknown'}`,
    `authorization_created=${result.authorization_created}`,
    `authorization_bootstrap=${result.authorization_bootstrap || 'unknown'}`,
    `dry_run=${result.dry_run || 'unknown'}`,
    `managed_control_plane_write_executed=${result.managed_control_plane_write_executed}`,
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
  await writeJson('posted-comment.json', {
    id: posted.id,
    url: posted.html_url,
    marker: READBACK_MARKER,
  });
}

try {
  observerResult.stage = 'authorization_comment_readback';
  const authorizationComment = await apiJson(
    `https://api.github.com/repos/${REPOSITORY}/issues/comments/${AUTHORIZATION_COMMENT_ID}`,
  );
  assert.equal(String(authorizationComment.id), AUTHORIZATION_COMMENT_ID);
  assert.equal(authorizationComment.body, AUTHORIZATION_COMMENT);
  assert.equal(
    authorizationComment.issue_url,
    `https://api.github.com/repos/${REPOSITORY}/issues/${ISSUE_NUMBER}`,
  );
  const authorizationCreatedAtMs = Date.parse(authorizationComment.created_at);
  assert.ok(Number.isFinite(authorizationCreatedAtMs), 'Authorization comment timestamp is invalid');
  await writeJson('authorization-comment.json', {
    id: authorizationComment.id,
    body: authorizationComment.body,
    created_at: authorizationComment.created_at,
    user_login: authorizationComment.user?.login || null,
    author_association: authorizationComment.author_association || null,
  });

  observerResult.stage = 'target_run_discovery';
  const runsUrl = `https://api.github.com/repos/${REPOSITORY}/actions/workflows/${TARGET_WORKFLOW_FILE}/runs?event=issue_comment&per_page=100`;
  let targetRun = null;
  let selectionDeltaMs = null;
  for (let attempt = 1; attempt <= 40; attempt += 1) {
    const runs = await apiJson(runsUrl);
    await writeJson('workflow-runs.json', runs);
    const candidates = (runs?.workflow_runs || [])
      .filter((run) => run.event === 'issue_comment')
      .filter((run) => run.name === TARGET_WORKFLOW_NAME)
      .filter((run) => run.actor?.login === authorizationComment.user?.login)
      .map((run) => ({
        run,
        delta_ms: Math.abs(Date.parse(run.created_at) - authorizationCreatedAtMs),
      }))
      .filter((entry) => Number.isFinite(entry.delta_ms))
      .filter((entry) => entry.delta_ms <= MAX_RUN_SELECTION_DELTA_MS)
      .sort((a, b) => a.delta_ms - b.delta_ms || Number(a.run.id) - Number(b.run.id));
    await writeJson(
      'run-selection-candidates.json',
      candidates.map((entry) => ({
        id: entry.run.id,
        created_at: entry.run.created_at,
        head_sha: entry.run.head_sha,
        status: entry.run.status,
        conclusion: entry.run.conclusion,
        actor: entry.run.actor?.login || null,
        delta_ms: entry.delta_ms,
      })),
    );
    if (candidates[0]?.run?.id) {
      targetRun = candidates[0].run;
      selectionDeltaMs = candidates[0].delta_ms;
      break;
    }
    await sleep(15_000);
  }
  if (!targetRun?.id) {
    observerResult = {
      ...observerResult,
      stage: 'target_run_discovery',
      failure_code: 'target_run_not_found_near_authorization_comment',
    };
  } else {
    observerResult = {
      ...observerResult,
      target_run_id: String(targetRun.id),
      target_head_sha: String(targetRun.head_sha || '').toLowerCase() || null,
      selection_delta_ms: selectionDeltaMs,
    };
    await fs.writeFile(path.join(OUTPUT_DIR, 'target-run-id.txt'), `${targetRun.id}\n`);

    observerResult.stage = 'target_run_terminal_wait';
    const runUrl = `https://api.github.com/repos/${REPOSITORY}/actions/runs/${targetRun.id}`;
    for (let attempt = 1; attempt <= 120; attempt += 1) {
      targetRun = await apiJson(runUrl);
      await writeJson('target-run.json', targetRun);
      if (targetRun.status === 'completed') break;
      await sleep(15_000);
    }
    observerResult = {
      ...observerResult,
      target_run_status: targetRun.status || null,
      target_run_conclusion: targetRun.conclusion || null,
      target_head_sha: String(targetRun.head_sha || '').toLowerCase() || observerResult.target_head_sha,
    };

    if (targetRun.status !== 'completed') {
      observerResult = {
        ...observerResult,
        stage: 'target_run_terminal_wait',
        failure_code: 'target_run_not_terminal_within_bounded_window',
      };
    } else {
      assert.equal(targetRun.event, 'issue_comment');
      assert.equal(targetRun.name, TARGET_WORKFLOW_NAME);

      observerResult.stage = 'target_jobs_and_artifact_readback';
      const jobs = await apiJson(
        `https://api.github.com/repos/${REPOSITORY}/actions/runs/${targetRun.id}/jobs?per_page=100`,
      );
      await writeJson('target-jobs.json', jobs);

      const artifacts = await apiJson(
        `https://api.github.com/repos/${REPOSITORY}/actions/runs/${targetRun.id}/artifacts?per_page=100`,
      );
      await writeJson('target-artifacts.json', artifacts);
      const artifact = (artifacts?.artifacts || []).find((item) =>
        String(item.name || '').startsWith('spec014-wave1-runtime-readiness-'),
      );

      if (!artifact?.id) {
        observerResult = {
          ...observerResult,
          stage: 'target_jobs_and_artifact_readback',
          failure_code:
            targetRun.conclusion === 'skipped'
              ? 'target_runtime_job_skipped_no_artifact'
              : 'target_runtime_artifact_not_found',
        };
      } else {
        observerResult = {
          ...observerResult,
          target_artifact_id: String(artifact.id),
          target_artifact_name: artifact.name,
          target_artifact_digest: artifact.digest || null,
        };
        await fs.writeFile(path.join(OUTPUT_DIR, 'target-artifact-id.txt'), `${artifact.id}\n`);

        observerResult.stage = 'target_artifact_download';
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

        observerResult.stage = 'target_artifact_validation';
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
        observerResult = {
          ...observerResult,
          evidence_result: summary?.result || 'failure',
          stage: failure?.stage || state.stage || (summary ? 'readiness_complete' : 'unknown'),
          failure_code: failure?.error?.code || null,
          runtime_parity: evidence.runtime_parity || null,
          authorization_created: Boolean(evidence.authorization_created),
          authorization_bootstrap: evidence.authorization_bootstrap || null,
          dry_run: evidence.dry_run || null,
          managed_control_plane_write_executed: Boolean(
            evidence.managed_control_plane_write_executed,
          ),
        };
      }
    }
  }
} catch (error) {
  observerResult = {
    ...observerResult,
    evidence_result: 'failure',
    failure_code: safeString(error?.code || error?.name, 'readback_internal_error'),
    stage: observerResult.stage || 'readback_internal_error',
  };
  await writeJson('readback-error.json', {
    code: observerResult.failure_code,
    message: safeString(error?.message, 'Unknown readback error').slice(0, 1000),
  });
}

assertBoundary(observerResult);
await postResult(observerResult);
process.stdout.write(`${JSON.stringify(observerResult, null, 2)}\n`);
