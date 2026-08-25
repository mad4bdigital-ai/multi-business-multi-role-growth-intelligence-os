#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const EXPECTED_WORKFLOW = "Governed GitHub Review Policy Live Activation";
const EXPECTED_ISSUE = 6625;
const DIAGNOSTIC_PREFIX = "GITHUB_REVIEW_POLICY_READINESS_DIAGNOSTIC result=fail";
const SHA40 = /^[0-9a-f]{40}$/;

const TOKEN = String(process.env.GITHUB_TOKEN || "").trim();
const REPOSITORY = String(process.env.REPOSITORY || "").trim();
const SOURCE_RUN_ID = Number(process.env.SOURCE_RUN_ID || 0);
const SOURCE_HEAD_SHA = String(process.env.SOURCE_HEAD_SHA || "").trim().toLowerCase();
const SOURCE_WORKFLOW = String(process.env.SOURCE_WORKFLOW || "").trim();
const SOURCE_CONCLUSION = String(process.env.SOURCE_CONCLUSION || "").trim().toLowerCase();
const CONTROL_ISSUE = Number(process.env.CONTROL_ISSUE || EXPECTED_ISSUE);
const FAILURE_PATH = String(process.env.READINESS_FAILURE_PATH || "").trim();
const STATE_PATH = String(process.env.READINESS_STATE_PATH || "").trim();

function boundedScalar(value, maxLength = 240) {
  return String(value ?? "")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b[A-Za-z0-9_]*(?:password|passwd|secret|token|api[_-]?key|credential|private[_-]?key)[A-Za-z0-9_]*\s*[:=]\s*[^\s,;]+/gi, "[redacted]")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

async function readJson(path) {
  if (!path) return null;
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

function safeMissingCounts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(
    ["tables", "columns", "indexes", "rule_conditions"]
      .filter((key) => Number.isFinite(Number(value[key])))
      .map((key) => [key, Number(value[key])]),
  );
}

async function githubJson(pathname, init = {}) {
  const response = await fetch(`https://api.github.com${pathname}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "mad4b-github-review-policy-readiness-failure-publisher",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    signal: AbortSignal.timeout(30000),
  });
  const payload = await response.json().catch(() => ({}));
  assert.ok(response.ok, `GitHub API request failed with HTTP ${response.status}`);
  return payload;
}

async function commentAlreadyExists(owner, repo, body) {
  for (let page = 1; page <= 20; page += 1) {
    const comments = await githubJson(`/repos/${owner}/${repo}/issues/${CONTROL_ISSUE}/comments?per_page=100&page=${page}`);
    assert.ok(Array.isArray(comments), "Issue comments readback must be an array");
    if (comments.some((comment) => String(comment?.body || "").trim() === body)) return true;
    if (comments.length < 100) return false;
  }
  throw new Error("Issue comment pagination exceeded bounded diagnostic scan");
}

async function main() {
  assert.ok(TOKEN, "GITHUB_TOKEN is required");
  assert.match(REPOSITORY, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "REPOSITORY must be owner/repo");
  assert.ok(Number.isInteger(SOURCE_RUN_ID) && SOURCE_RUN_ID > 0, "SOURCE_RUN_ID must be a positive integer");
  assert.match(SOURCE_HEAD_SHA, SHA40, "SOURCE_HEAD_SHA must be an exact 40-character SHA");
  assert.equal(SOURCE_WORKFLOW, EXPECTED_WORKFLOW, "Unexpected source workflow");
  assert.notEqual(SOURCE_CONCLUSION, "success", "Failure publisher must not process a successful source run");
  assert.equal(CONTROL_ISSUE, EXPECTED_ISSUE, "Readiness failure diagnostics are bound to issue #6625");

  const [failure, state] = await Promise.all([readJson(FAILURE_PATH), readJson(STATE_PATH)]);
  assert.ok(failure || state, "Readiness artifact contains neither failure.json nor state.json");

  const phase = boundedScalar(failure?.phase || state?.phase || "unknown", 40);
  assert.equal(phase, "readiness", "Failure diagnostic artifact is not a readiness phase");
  assert.equal(failure?.secrets_included ?? state?.secrets_included, false, "Readiness evidence must declare secrets_included=false");
  assert.notEqual(failure?.apply_sent, true, "Readiness failure diagnostic must not represent an Apply attempt");
  assert.notEqual(state?.apply_sent, true, "Readiness failure state must not represent an Apply attempt");
  assert.notEqual(failure?.provider_call_executed, true, "Readiness failure must not execute provider mutation");
  assert.notEqual(failure?.external_write_executed, true, "Readiness failure must not execute external mutation");

  const targetBranch = boundedScalar(failure?.target_branch || state?.target_branch || "unknown", 32);
  assert.ok(["main", "Production"].includes(targetBranch), "Unexpected readiness target branch");
  const targetShaRaw = String(failure?.target_sha || state?.target_sha || "").trim().toLowerCase();
  const targetSha = SHA40.test(targetShaRaw) ? targetShaRaw : "unresolved";
  const stage = boundedScalar(state?.stage || "unknown", 80) || "unknown";
  const errorCode = boundedScalar(failure?.error?.code || "policy_live_activation_failed", 120) || "policy_live_activation_failed";
  const details = failure?.error?.details && typeof failure.error.details === "object" ? failure.error.details : {};

  const diagnostic = {
    contract: "mad4b.github-review-policy-readiness-diagnostic.v1",
    result: "fail",
    source_run_id: SOURCE_RUN_ID,
    source_conclusion: boundedScalar(SOURCE_CONCLUSION, 32),
    source_head_sha: SOURCE_HEAD_SHA,
    phase,
    target_branch: targetBranch,
    target_sha: targetSha,
    main_sha: SHA40.test(String(failure?.main_sha || state?.main_sha || "").toLowerCase()) ? String(failure?.main_sha || state?.main_sha).toLowerCase() : null,
    production_sha: SHA40.test(String(failure?.production_sha || state?.production_sha || "").toLowerCase()) ? String(failure?.production_sha || state?.production_sha).toLowerCase() : null,
    stage,
    error_code: errorCode,
    response_error_code: boundedScalar(details?.response_error_code || "", 120) || null,
    response_readback_status: boundedScalar(details?.response_readback_status || "", 40) || null,
    response_ledger_found: typeof details?.response_ledger_found === "boolean" ? details.response_ledger_found : null,
    response_missing_counts: safeMissingCounts(details?.response_missing_counts),
    transport_ok: typeof details?.transport_ok === "boolean" ? details.transport_ok : null,
    http_status: Number.isInteger(Number(details?.http_status)) ? Number(details.http_status) : null,
    apply_sent: false,
    provider_call_executed: false,
    external_write_executed: false,
    marker_grants_apply_authority: false,
    secrets_included: false,
  };

  const body = `${DIAGNOSTIC_PREFIX} target_branch=${targetBranch} target_sha=${targetSha} source_run_id=${SOURCE_RUN_ID} stage=${stage} error_code=${errorCode}\n\n\`\`\`json\n${JSON.stringify(diagnostic, null, 2)}\n\`\`\`\n\nThis is bounded no-secret failure evidence only. It is not a readiness success marker and grants no Apply authority.`;
  const [owner, repo] = REPOSITORY.split("/");
  if (await commentAlreadyExists(owner, repo, body)) {
    console.log(JSON.stringify({ published: false, duplicate: true, source_run_id: SOURCE_RUN_ID, secrets_included: false }));
    return;
  }
  const posted = await githubJson(`/repos/${owner}/${repo}/issues/${CONTROL_ISSUE}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
  assert.ok(Number(posted?.id) > 0, "GitHub readiness failure diagnostic comment returned no id");
  console.log(JSON.stringify({ published: true, comment_id: Number(posted.id), source_run_id: SOURCE_RUN_ID, secrets_included: false }));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: { name: error?.name || "Error", message: boundedScalar(error?.message || error, 300) }, secrets_included: false }));
  process.exitCode = 1;
});
