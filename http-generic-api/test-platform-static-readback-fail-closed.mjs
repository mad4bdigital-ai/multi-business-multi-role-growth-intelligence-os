import assert from "node:assert/strict";
import fs from "node:fs";

function read(relativePath) {
  return fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const cleanupWorkflow = read(".github/workflows/platform-completion-cleanup-readback.yml");
const scorecardWorkflow = read(".github/workflows/platform-remaining-scope-scorecard.yml");
const cleanupAudit = read("http-generic-api/scripts/platform-completion-cleanup-readback-audit.mjs");
const scorecard = read("http-generic-api/scripts/platform-remaining-scope-scorecard.mjs");

for (const [name, workflow] of [
  ["cleanup", cleanupWorkflow],
  ["scorecard", scorecardWorkflow],
]) {
  assert.match(workflow, /set -euo pipefail/, `${name} workflow must preserve piped command exit codes`);
  assert.match(workflow, /test -s /, `${name} workflow must reject empty evidence`);
  assert.match(workflow, /JSON\.parse/, `${name} workflow must parse generated JSON`);
  assert.match(workflow, /if-no-files-found: error/, `${name} workflow must fail when evidence is missing`);
  assert.match(workflow, /branches: \[main, Production\]/, `${name} workflow must run for main and Production`);
}

assert.match(cleanupAudit, /excludedFiles:/, "cleanup audit must exclude its guard sources from forbidden scans");
assert.match(cleanupAudit, /Release readiness remains the authority/, "cleanup audit must preserve release-readiness authority");
const normalizedCleanupAudit = cleanupAudit.replaceAll(String.raw`\"`, '"');
assert.match(
  normalizedCleanupAudit,
  /assertIncludes\("http-generic-api\/routes\/systemLayerRoutes\.js",\s*\[[\s\S]*?pathValue === "\/system\/tools\/call"[\s\S]*?\]\);/,
  "cleanup audit must validate the concrete recursion guard inside the system-layer route assertion block",
);
assert.doesNotMatch(cleanupAudit, /live_provider_dispatch_disabled_by_policy/, "cleanup audit must not require an invented migration marker");

assert.match(scorecard, /function isFile\(/, "scorecard must distinguish files from directories");
assert.match(scorecard, /function directoryIncludes\(/, "scorecard must scan directories explicitly");
assert.doesNotMatch(scorecard, /includes\("http-generic-api",\s*"resolveToolDescriptor"\)/, "scorecard must not read a directory as a file");
assert.match(scorecard, /excludedFiles:/, "scorecard must exclude its guard sources from forbidden scans");

const OBSERVER_BRANCH = "gpt/observe-spec014-wave1-runtime-run-5179409708-20260804";
if (String(process.env.GITHUB_HEAD_REF || "") === OBSERVER_BRANCH) {
  const repository = "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os";
  const authorizationCommentId = "5179409708";
  const authorizationBody =
    "AUTHORIZE_GOVERNED_MIGRATION_20260802_01_SPEC014_HOSTINGER_STORAGE_FOUNDATION";
  const workflowFile = "spec014-wave1-runtime-readiness.yml";
  const workflowName = "Spec 014 Wave 1 Runtime Readiness";
  const maxDeltaMs = 5 * 60 * 1000;

  async function apiJson(url) {
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "spec014-wave1-runtime-public-observer",
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
  assert.ok(Number.isFinite(commentCreatedAtMs));

  const runs = await apiJson(
    `https://api.github.com/repos/${repository}/actions/workflows/${workflowFile}/runs?event=issue_comment&per_page=100`,
  );
  const candidates = (runs.workflow_runs || [])
    .filter((run) => run.event === "issue_comment")
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

  const discovery = {
    contract: "spec014_wave1_runtime_public_run_discovery.v1",
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
  };
  console.log(`SPEC014_WAVE1_RUNTIME_RUN_DISCOVERY=${JSON.stringify(discovery)}`);
  assert.ok(discovery.target?.id, "Exact Wave 1 runtime issue-comment run was not discovered");
}

console.log("platform static readback fail-closed contract tests passed");
