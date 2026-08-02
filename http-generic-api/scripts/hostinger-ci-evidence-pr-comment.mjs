#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  COMMENT_MARKER,
  assertCurrentPullRequestIdentity,
  selectCurrentPullRequest,
  upsertEvidenceComment
} from "./ci-evidence-pr-comment.mjs";

const SOURCE_WORKFLOW = "Hostinger Storage Tenant Canary Guard";
const REPORT_WORKFLOW = "Hostinger Storage Tenant Canary Guard";
const CONTRACT = "mad4b.hostinger-guard-summary.v1";
const GUARD_KEY = "hostinger-storage-tenant-canary";
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const HEAD_BRANCH_PATTERN = /^[A-Za-z0-9._/-]{1,255}$/u;
const WORKFLOW_CONCLUSIONS = new Set([
  "success",
  "failure",
  "cancelled",
  "timed_out",
  "action_required",
  "startup_failure",
  "stale",
  "skipped",
  "neutral"
]);

function parseArgs(argv) {
  const options = {
    repository: null,
    prNumber: null,
    headBranch: null,
    workflowConclusion: null,
    reportFile: null,
    workflowRunId: null,
    sourceHeadSha: null,
    token: process.env.GITHUB_TOKEN || null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const take = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
      index += 1;
      return value;
    };
    if (arg === "--repository") options.repository = take();
    else if (arg.startsWith("--repository=")) options.repository = arg.slice(13);
    else if (arg === "--pr-number") options.prNumber = Number(take());
    else if (arg.startsWith("--pr-number=")) options.prNumber = Number(arg.slice(12));
    else if (arg === "--head-branch") options.headBranch = take();
    else if (arg.startsWith("--head-branch=")) options.headBranch = arg.slice(14);
    else if (arg === "--workflow-conclusion") options.workflowConclusion = take();
    else if (arg.startsWith("--workflow-conclusion=")) options.workflowConclusion = arg.slice(22);
    else if (arg === "--report") options.reportFile = take();
    else if (arg.startsWith("--report=")) options.reportFile = arg.slice(9);
    else if (arg === "--workflow-run-id") options.workflowRunId = Number(take());
    else if (arg.startsWith("--workflow-run-id=")) options.workflowRunId = Number(arg.slice(18));
    else if (arg === "--source-head-sha") options.sourceHeadSha = take();
    else if (arg.startsWith("--source-head-sha=")) options.sourceHeadSha = arg.slice(18);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.repository || !/^[-A-Za-z0-9_.]+\/[-A-Za-z0-9_.]+$/u.test(options.repository)) {
    throw new Error("--repository must be owner/name.");
  }
  if (options.prNumber !== null && (!Number.isInteger(options.prNumber) || options.prNumber < 1)) {
    throw new Error("--pr-number must be positive when supplied.");
  }
  if (options.headBranch && !HEAD_BRANCH_PATTERN.test(options.headBranch)) {
    throw new Error("--head-branch is invalid.");
  }
  if (!WORKFLOW_CONCLUSIONS.has(options.workflowConclusion)) {
    throw new Error("--workflow-conclusion must be a supported completed conclusion.");
  }
  if (!options.reportFile) throw new Error("--report is required.");
  if (!Number.isInteger(options.workflowRunId) || options.workflowRunId < 1) {
    throw new Error("--workflow-run-id must be positive.");
  }
  if (!SHA_PATTERN.test(options.sourceHeadSha || "")) {
    throw new Error("--source-head-sha must be a full lowercase SHA.");
  }
  if (!options.token) throw new Error("GITHUB_TOKEN is required.");
  return options;
}

function requireNonNegativeInteger(value, field) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${field} must be a non-negative integer.`);
  return value;
}

export function normalizeHostingerEvidence({
  workflowConclusion,
  report,
  workflowRunId,
  sourceHeadSha
}) {
  if (!WORKFLOW_CONCLUSIONS.has(workflowConclusion)) throw new Error("Unsupported workflow conclusion.");
  if (report?.contract !== CONTRACT) throw new Error("Unexpected Hostinger canonical contract.");
  if (report?.workflow !== REPORT_WORKFLOW) throw new Error("Hostinger guard identity mismatch.");
  if (report?.guard_key !== GUARD_KEY) throw new Error("Hostinger report guard identity mismatch.");
  if (report?.secrets_included !== false) throw new Error("Hostinger report must declare secrets_included=false.");
  if (report?.job_logs_consulted !== false) throw new Error("Hostinger canonical decision must not consult Job logs.");
  if (report?.identity?.candidate_kind !== "head") throw new Error("Hostinger guard must publish head evidence.");
  if (!SHA_PATTERN.test(report?.identity?.candidate_sha || "")) {
    throw new Error("Hostinger report is missing a valid candidate SHA.");
  }
  if (report.identity.candidate_sha !== sourceHeadSha) {
    throw new Error("Hostinger report candidate does not match workflow_run head_sha.");
  }
  if (!Array.isArray(report?.integrity_findings)) throw new Error("Hostinger integrity_findings must be an array.");
  const selected = requireNonNegativeInteger(report?.checks?.selected_count, "checks.selected_count");
  const passed = requireNonNegativeInteger(report?.checks?.passed_count, "checks.passed_count");
  const failed = requireNonNegativeInteger(report?.checks?.failed_count, "checks.failed_count");
  if (selected < 1 || passed + failed !== selected) throw new Error("Hostinger check counts are inconsistent.");
  if (!Array.isArray(report?.results) || report.results.length !== selected) {
    throw new Error("Hostinger results must match checks.selected_count.");
  }
  const allowedOutcomes = new Set(["passed", "failed"]);
  if (!allowedOutcomes.has(report?.outcome)) throw new Error("Hostinger report outcome is unsupported.");
  if (report.outcome === "passed") {
    if (failed !== 0 || passed !== selected || report.integrity_findings.length !== 0 || report.first_failure !== null) {
      throw new Error("Passed Hostinger report contains a failure or integrity finding.");
    }
  } else if (failed < 1 || !report.first_failure?.check_id) {
    throw new Error("Failed Hostinger report must identify the first failed check.");
  }
  if (workflowConclusion === "success" && report.outcome !== "passed") {
    throw new Error("Successful workflow_run cannot publish a non-passed Hostinger outcome.");
  }
  if (workflowConclusion !== "success" && report.outcome === "passed") {
    throw new Error("Non-successful workflow_run cannot publish a passed Hostinger outcome.");
  }
  const detail = report.outcome === "passed"
    ? `${passed}/${selected} guard checks passed; 0 failed`
    : `${passed}/${selected} guard checks passed; first failure: ${report.first_failure.check_id}`;
  return {
    slug: GUARD_KEY,
    workflow: SOURCE_WORKFLOW,
    workflowConclusion,
    runId: workflowRunId,
    candidateKind: "head",
    candidateSha: report.identity.candidate_sha,
    sourceHeadSha,
    outcome: report.outcome,
    detail,
    artifactContract: report.contract
  };
}

async function githubRequest(url, { token, method = "GET", body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "mad4b-hostinger-ci-evidence-publisher"
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  if (!response.ok) throw new Error(`GitHub API ${method} ${url} failed: ${response.status}`);
  return response.status === 204 ? null : response.json();
}

function dedupePullRequests(pullRequests) {
  const byNumber = new Map();
  for (const pullRequest of pullRequests) {
    if (Number.isInteger(pullRequest?.number)) byNumber.set(pullRequest.number, pullRequest);
  }
  return [...byNumber.values()];
}

async function resolvePullRequest(options, api) {
  if (options.prNumber) return githubRequest(`${api}/pulls/${options.prNumber}`, { token: options.token });
  const candidates = [];
  if (options.headBranch) {
    const owner = options.repository.split("/")[0];
    const query = new URLSearchParams({ state: "all", head: `${owner}:${options.headBranch}`, per_page: "100" });
    candidates.push(...await githubRequest(`${api}/pulls?${query.toString()}`, { token: options.token }));
  }
  candidates.push(...await githubRequest(`${api}/commits/${options.sourceHeadSha}/pulls?per_page=100`, { token: options.token }));
  return selectCurrentPullRequest({
    pullRequests: dedupePullRequests(candidates),
    repository: options.repository,
    headBranch: options.headBranch,
    sourceHeadSha: options.sourceHeadSha
  });
}

export async function publishHostingerEvidenceComment(options) {
  const api = `https://api.github.com/repos/${options.repository}`;
  const pullRequest = await resolvePullRequest(options, api);
  const report = JSON.parse(fs.readFileSync(path.resolve(options.reportFile), "utf8"));
  const evidence = normalizeHostingerEvidence({ ...options, report });
  assertCurrentPullRequestIdentity(pullRequest, evidence, options.headBranch);
  const comments = await githubRequest(`${api}/issues/${pullRequest.number}/comments?per_page=100`, { token: options.token });
  const existing = comments.find((comment) => typeof comment.body === "string" && comment.body.includes(COMMENT_MARKER));
  const updated = upsertEvidenceComment(existing?.body || "", evidence);
  if (!updated.changed) {
    return { ok: true, action: "unchanged", reason: updated.reason, pr_number: pullRequest.number, evidence };
  }
  if (existing) {
    await githubRequest(`${api}/issues/comments/${existing.id}`, {
      token: options.token,
      method: "PATCH",
      body: { body: updated.body }
    });
    return { ok: true, action: "updated", comment_id: existing.id, pr_number: pullRequest.number, evidence };
  }
  const created = await githubRequest(`${api}/issues/${pullRequest.number}/comments`, {
    token: options.token,
    method: "POST",
    body: { body: updated.body }
  });
  return { ok: true, action: "created", comment_id: created.id, pr_number: pullRequest.number, evidence };
}

export async function runHostingerEvidencePublisher(argv = process.argv.slice(2)) {
  const result = await publishHostingerEvidenceComment(parseArgs(argv));
  process.stdout.write(`${JSON.stringify({ ...result, secrets_included: false })}\n`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runHostingerEvidencePublisher().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}
