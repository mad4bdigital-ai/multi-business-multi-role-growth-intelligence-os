#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { COMMENT_MARKER, upsertEvidenceComment } from "./ci-evidence-pr-comment.mjs";

const CONTRACT = "mad4b.pr-generated-artifact-refresh-summary.v1";
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const BRANCH_PATTERN = /^[A-Za-z0-9._/-]{1,255}$/u;
const CONCLUSIONS = new Set(["success", "failure", "cancelled", "timed_out", "action_required", "startup_failure", "stale", "skipped", "neutral"]);

function parseArgs(argv) {
  const options = { repository: null, prNumber: null, headBranch: null, workflowConclusion: null, reportFile: null, workflowRunId: null, sourceHeadSha: null, token: process.env.GITHUB_TOKEN || null };
  const take = (index, arg) => {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : null;
    if (arg === "--repository") { options.repository = take(index, arg); index += 1; }
    else if (arg.startsWith("--repository=")) options.repository = value;
    else if (arg === "--pr-number") { options.prNumber = Number(take(index, arg)); index += 1; }
    else if (arg.startsWith("--pr-number=")) options.prNumber = Number(value);
    else if (arg === "--head-branch") { options.headBranch = take(index, arg); index += 1; }
    else if (arg.startsWith("--head-branch=")) options.headBranch = value;
    else if (arg === "--workflow-conclusion") { options.workflowConclusion = take(index, arg); index += 1; }
    else if (arg.startsWith("--workflow-conclusion=")) options.workflowConclusion = value;
    else if (arg === "--report") { options.reportFile = take(index, arg); index += 1; }
    else if (arg.startsWith("--report=")) options.reportFile = value;
    else if (arg === "--workflow-run-id") { options.workflowRunId = Number(take(index, arg)); index += 1; }
    else if (arg.startsWith("--workflow-run-id=")) options.workflowRunId = Number(value);
    else if (arg === "--source-head-sha") { options.sourceHeadSha = take(index, arg); index += 1; }
    else if (arg.startsWith("--source-head-sha=")) options.sourceHeadSha = value;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!/^[-A-Za-z0-9_.]+\/[-A-Za-z0-9_.]+$/u.test(options.repository || "")) throw new Error("--repository must be owner/name.");
  if (options.prNumber !== null && (!Number.isInteger(options.prNumber) || options.prNumber < 1)) throw new Error("--pr-number must be positive.");
  if (options.headBranch && !BRANCH_PATTERN.test(options.headBranch)) throw new Error("--head-branch is invalid.");
  if (!CONCLUSIONS.has(options.workflowConclusion)) throw new Error("--workflow-conclusion is invalid.");
  if (!options.reportFile) throw new Error("--report is required.");
  if (!Number.isInteger(options.workflowRunId) || options.workflowRunId < 1) throw new Error("--workflow-run-id must be positive.");
  if (!SHA_PATTERN.test(options.sourceHeadSha || "")) throw new Error("--source-head-sha must be a full lowercase SHA.");
  if (!options.token) throw new Error("GITHUB_TOKEN is required.");
  return options;
}

async function request(url, { token, method = "GET", body } = {}) {
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

function isMerged(pr) {
  return pr?.merged === true || Boolean(pr?.merged_at);
}

async function resolvePullRequest(options, api) {
  if (options.prNumber) return request(`${api}/pulls/${options.prNumber}`, { token: options.token });
  const candidates = [];
  if (options.headBranch) {
    const owner = options.repository.split("/")[0];
    const query = new URLSearchParams({ state: "all", head: `${owner}:${options.headBranch}`, per_page: "100" });
    candidates.push(...await request(`${api}/pulls?${query}`, { token: options.token }));
  }
  candidates.push(...await request(`${api}/commits/${options.sourceHeadSha}/pulls?per_page=100`, { token: options.token }));
  const unique = [...new Map(candidates.filter((pr) => Number.isInteger(pr?.number)).map((pr) => [pr.number, pr])).values()];
  const exact = unique.filter((pr) => (
    pr?.head?.repo?.full_name === options.repository
    && pr?.head?.sha === options.sourceHeadSha
    && (!options.headBranch || pr?.head?.ref === options.headBranch)
  ));
  const open = exact.filter((pr) => pr.state === "open");
  if (open.length === 1) return open[0];
  if (open.length > 1) throw new Error("Ambiguous open PR resolution.");
  const merged = exact.filter((pr) => pr.state === "closed" && isMerged(pr));
  if (merged.length === 1) return merged[0];
  if (merged.length > 1) throw new Error("Ambiguous merged PR resolution.");
  throw new Error("Unable to resolve an exact open or merged PR.");
}

export function normalizeGeneratedArtifactEvidence({ report, workflowConclusion, workflowRunId, sourceHeadSha }) {
  if (report?.contract !== CONTRACT) throw new Error("Unexpected generated-artifact canonical contract.");
  if (report?.secrets_included !== false) throw new Error("Report must declare secrets_included=false.");
  if (report?.identity?.candidate_kind !== "head") throw new Error("Report must describe a head candidate.");
  if (!SHA_PATTERN.test(report?.identity?.source_head_sha || "") || report.identity.source_head_sha !== sourceHeadSha) {
    throw new Error("Report source head does not match workflow_run head_sha.");
  }
  if (report?.identity?.candidate_sha !== sourceHeadSha) {
    throw new Error("Read-only PR refresh evidence candidate must equal source head.");
  }
  if (report?.generated_artifacts?.commit_sha !== null) {
    throw new Error("Read-only PR refresh evidence may not report a generated commit.");
  }
  if (report?.generated_artifacts?.repository_mutation_performed !== false) {
    throw new Error("Read-only PR refresh evidence must declare repository_mutation_performed=false.");
  }
  const passed = report.outcome === "passed";
  if (workflowConclusion === "success" && !passed) throw new Error("Successful workflow cannot publish a blocked report.");
  if (workflowConclusion !== "success" && passed) throw new Error("Non-successful workflow cannot publish a passed report.");
  return {
    slug: "pr-generated-artifact-refresh",
    workflow: "PR Generated Artifact Refresh",
    workflowConclusion,
    runId: workflowRunId,
    candidateKind: "head",
    candidateSha: sourceHeadSha,
    sourceHeadSha,
    outcome: report.outcome,
    detail: report.first_failure?.code || "generated artifacts current",
    artifactContract: report.contract,
  };
}

export function assertGeneratedArtifactPrIdentity(pr, evidence, expectedBranch = null) {
  if (pr?.state !== "open" && !isMerged(pr)) throw new Error("Refusing to publish to a closed unmerged PR.");
  if (expectedBranch && pr?.head?.ref !== expectedBranch) throw new Error("PR head branch mismatch.");
  if (pr?.head?.sha !== evidence.candidateSha) throw new Error("Current PR head does not match the exact read-only candidate.");
  return true;
}

export async function publishGeneratedArtifactEvidence(options) {
  const api = `https://api.github.com/repos/${options.repository}`;
  const pr = await resolvePullRequest(options, api);
  const report = JSON.parse(fs.readFileSync(path.resolve(options.reportFile), "utf8"));
  const evidence = normalizeGeneratedArtifactEvidence({ ...options, report });
  assertGeneratedArtifactPrIdentity(pr, evidence, options.headBranch);
  const comments = await request(`${api}/issues/${pr.number}/comments?per_page=100`, { token: options.token });
  const existing = comments.find((comment) => typeof comment.body === "string" && comment.body.includes(COMMENT_MARKER));
  const updated = upsertEvidenceComment(existing?.body || "", evidence);
  if (!updated.changed) return { ok: true, action: "unchanged", reason: updated.reason, pr_number: pr.number, evidence };
  if (existing) {
    await request(`${api}/issues/comments/${existing.id}`, { token: options.token, method: "PATCH", body: { body: updated.body } });
    return { ok: true, action: "updated", comment_id: existing.id, pr_number: pr.number, evidence };
  }
  const created = await request(`${api}/issues/${pr.number}/comments`, { token: options.token, method: "POST", body: { body: updated.body } });
  return { ok: true, action: "created", comment_id: created.id, pr_number: pr.number, evidence };
}

export async function run(argv = process.argv.slice(2)) {
  const result = await publishGeneratedArtifactEvidence(parseArgs(argv));
  process.stdout.write(`${JSON.stringify({ ...result, secrets_included: false })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  run().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 2;
  });
}
