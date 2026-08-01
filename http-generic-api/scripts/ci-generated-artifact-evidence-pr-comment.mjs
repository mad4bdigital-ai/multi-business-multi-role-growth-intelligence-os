#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  COMMENT_MARKER,
  assertCurrentPullRequestIdentity,
  upsertEvidenceComment,
} from "./ci-evidence-pr-comment.mjs";

const CONTRACT = "mad4b.pr-generated-artifact-refresh-summary.v1";
const WORKFLOW = "PR Generated Artifact Refresh";
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
  "neutral",
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
    token: process.env.GITHUB_TOKEN || null,
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
  if (!options.repository || !/^[-A-Za-z0-9_.]+\/[-A-Za-z0-9_.]+$/u.test(options.repository)) throw new Error("--repository must be owner/name.");
  if (options.prNumber !== null && (!Number.isInteger(options.prNumber) || options.prNumber < 1)) throw new Error("--pr-number must be positive when supplied.");
  if (options.headBranch && !HEAD_BRANCH_PATTERN.test(options.headBranch)) throw new Error("--head-branch is invalid.");
  if (!WORKFLOW_CONCLUSIONS.has(options.workflowConclusion)) throw new Error("--workflow-conclusion is invalid.");
  if (!options.reportFile) throw new Error("--report is required.");
  if (!Number.isInteger(options.workflowRunId) || options.workflowRunId < 1) throw new Error("--workflow-run-id must be positive.");
  if (!SHA_PATTERN.test(options.sourceHeadSha || "")) throw new Error("--source-head-sha must be a full lowercase SHA.");
  if (!options.token) throw new Error("GITHUB_TOKEN is required.");
  return options;
}

async function githubRequest(url, { token, method = "GET", body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "mad4b-generated-artifact-evidence-publisher",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
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

function selectCurrentPullRequest({ pullRequests, repository, headBranch, sourceHeadSha }) {
  const exact = pullRequests.filter((pullRequest) => (
    pullRequest?.head?.repo?.full_name === repository &&
    pullRequest?.head?.sha === sourceHeadSha &&
    (!headBranch || pullRequest?.head?.ref === headBranch)
  ));
  const open = exact.filter((pullRequest) => pullRequest?.state === "open");
  if (open.length === 1) return open[0];
  if (open.length > 1) throw new Error("Ambiguous open pull request for generated-artifact evidence.");
  const merged = exact.filter((pullRequest) => pullRequest?.state === "closed" && (pullRequest?.merged === true || pullRequest?.merged_at));
  if (merged.length === 1) return merged[0];
  if (merged.length > 1) throw new Error("Ambiguous merged pull request for generated-artifact evidence.");
  throw new Error("Unable to resolve an exact pull request for generated-artifact evidence.");
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
    sourceHeadSha: options.sourceHeadSha,
  });
}

export function normalizeGeneratedArtifactEvidence({ report, workflowConclusion, workflowRunId, sourceHeadSha }) {
  if (report?.contract !== CONTRACT) throw new Error("Unexpected generated-artifact canonical contract.");
  if (report?.secrets_included !== false) throw new Error("Generated-artifact report must declare secrets_included=false.");
  if (report?.identity?.candidate_kind !== "head") throw new Error("Generated-artifact report must describe the PR head.");
  if (!SHA_PATTERN.test(report?.identity?.candidate_sha || "")) throw new Error("Generated-artifact report is missing a valid candidate SHA.");
  if (report.identity.candidate_sha !== sourceHeadSha) throw new Error("Generated-artifact report candidate does not match workflow_run head_sha.");
  const passed = report.outcome === "passed";
  if (workflowConclusion === "success" && !passed) throw new Error("Successful workflow cannot publish a blocked report.");
  if (workflowConclusion !== "success" && passed) throw new Error("Non-successful workflow cannot publish a passed report.");
  return {
    slug: "pr-generated-artifact-refresh",
    workflow: WORKFLOW,
    workflowConclusion,
    runId: workflowRunId,
    candidateKind: "head",
    candidateSha: report.identity.candidate_sha,
    sourceHeadSha,
    outcome: report.outcome,
    detail: report.first_failure?.code || (report.generated_artifacts?.commit_sha ? `published ${report.generated_artifacts.commit_sha}` : "generated artifacts already current"),
    artifactContract: report.contract,
  };
}

export async function publishGeneratedArtifactEvidence(options) {
  const api = `https://api.github.com/repos/${options.repository}`;
  const pullRequest = await resolvePullRequest(options, api);
  const report = JSON.parse(fs.readFileSync(path.resolve(options.reportFile), "utf8"));
  const evidence = normalizeGeneratedArtifactEvidence({ ...options, report });
  assertCurrentPullRequestIdentity(pullRequest, evidence, options.headBranch);
  const comments = await githubRequest(`${api}/issues/${pullRequest.number}/comments?per_page=100`, { token: options.token });
  const existing = comments.find((comment) => typeof comment.body === "string" && comment.body.includes(COMMENT_MARKER));
  const updated = upsertEvidenceComment(existing?.body || "", evidence);
  if (!updated.changed) return { ok: true, action: "unchanged", reason: updated.reason, pr_number: pullRequest.number, evidence };
  if (existing) {
    await githubRequest(`${api}/issues/comments/${existing.id}`, { token: options.token, method: "PATCH", body: { body: updated.body } });
    return { ok: true, action: "updated", comment_id: existing.id, pr_number: pullRequest.number, evidence };
  }
  const created = await githubRequest(`${api}/issues/${pullRequest.number}/comments`, { token: options.token, method: "POST", body: { body: updated.body } });
  return { ok: true, action: "created", comment_id: created.id, pr_number: pullRequest.number, evidence };
}

export async function runGeneratedArtifactEvidencePublisher(argv = process.argv.slice(2)) {
  const result = await publishGeneratedArtifactEvidence(parseArgs(argv));
  process.stdout.write(`${JSON.stringify({ ...result, secrets_included: false })}\n`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runGeneratedArtifactEvidencePublisher().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 2;
  });
}
