#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { COMMENT_MARKER, upsertEvidenceComment } from "./ci-evidence-pr-comment.mjs";

const CONTRACT = "mad4b.governed-generated-artifact-refresh-dispatch.v1";
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const BRANCH_PATTERN = /^(?:gpt|cert|fix|feat|chore|docs|release)\/[A-Za-z0-9._/-]+$/u;
const CONCLUSIONS = new Set(["success", "failure", "cancelled", "timed_out", "action_required", "startup_failure", "stale", "skipped", "neutral"]);

function parseArgs(argv) {
  const options = {
    repository: null,
    prNumber: null,
    workflowConclusion: null,
    reportFile: null,
    workflowRunId: null,
    sourceHeadSha: null,
    token: process.env.GITHUB_TOKEN || null,
  };
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
    else if (arg === "--workflow-conclusion") { options.workflowConclusion = take(index, arg); index += 1; }
    else if (arg.startsWith("--workflow-conclusion=")) options.workflowConclusion = value;
    else if (arg === "--report") { options.reportFile = take(index, arg); index += 1; }
    else if (arg.startsWith("--report=")) options.reportFile = value;
    else if (arg === "--workflow-run-id") { options.workflowRunId = Number(take(index, arg)); index += 1; }
    else if (arg.startsWith("--workflow-run-id=")) options.workflowRunId = Number(value);
    else if (arg === "--source-head-sha") { options.sourceHeadSha = take(index, arg); index += 1; }
    else if (arg.startsWith("--source-head-sha=")) options.sourceHeadSha = value;
    else if (arg === "--head-branch") { take(index, arg); index += 1; }
    else if (arg.startsWith("--head-branch=")) { /* accepted but intentionally ignored */ }
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!/^[-A-Za-z0-9_.]+\/[-A-Za-z0-9_.]+$/u.test(options.repository || "")) throw new Error("--repository must be owner/name.");
  if (options.prNumber !== null && (!Number.isInteger(options.prNumber) || options.prNumber < 1)) throw new Error("--pr-number must be positive.");
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
      "User-Agent": "mad4b-generated-artifact-dispatch-evidence-publisher",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`GitHub API ${method} ${url} failed: ${response.status}`);
  return response.status === 204 ? null : response.json();
}

export function normalizeGeneratedArtifactDispatchEvidence({ report, workflowConclusion, workflowRunId }) {
  if (report?.contract !== CONTRACT) throw new Error("Unexpected generated-artifact dispatcher contract.");
  if (report?.secrets_included !== false) throw new Error("Dispatcher report must declare secrets_included=false.");
  if (report?.source_of_truth !== "structured_report" || report?.consult_job_logs !== false) {
    throw new Error("Dispatcher report must remain structured and Job-log independent.");
  }
  if (!BRANCH_PATTERN.test(report?.target_ref || "") || report.target_ref === "main" || report.target_ref === "Production") {
    throw new Error("Dispatcher target_ref is not a permitted work branch.");
  }
  if (!SHA_PATTERN.test(report?.expected_head_sha || "")) throw new Error("Dispatcher report requires an exact expected_head_sha.");
  if (!Number.isInteger(report?.pr_number) || report.pr_number < 1) throw new Error("Dispatcher report requires the associated PR number.");
  if (!new Set(["passed", "skipped", "blocked"]).has(report?.outcome)) throw new Error("Dispatcher report outcome is invalid.");
  if (report.outcome === "blocked" && workflowConclusion === "success") throw new Error("A blocked dispatcher report cannot come from a successful workflow.");
  if (report.outcome !== "blocked" && workflowConclusion !== "success") throw new Error("A non-blocked dispatcher report requires a successful workflow.");
  if (report.outcome === "passed" && report.dispatch_requested !== true) throw new Error("Passed dispatcher evidence must confirm dispatch_requested=true.");
  if (report.outcome === "blocked" && !report?.first_failure?.code) throw new Error("Blocked dispatcher evidence requires first_failure.code.");

  return {
    slug: "governed-generated-artifact-refresh-dispatch",
    workflow: "Governed Generated Artifact Refresh Dispatch",
    workflowConclusion,
    runId: workflowRunId,
    candidateKind: "head",
    candidateSha: report.expected_head_sha,
    sourceHeadSha: report.expected_head_sha,
    outcome: report.outcome === "blocked" ? "failed" : "passed",
    detail: report.first_failure?.code || report.reason || (report.dispatch_requested ? "governed writer dispatch requested" : "dispatch skipped"),
    artifactContract: report.contract,
    targetRef: report.target_ref,
    prNumber: report.pr_number,
  };
}

export function assertGeneratedArtifactDispatchPrIdentity(pr, evidence, repository) {
  if (pr?.state !== "open") throw new Error("Dispatcher evidence may be published only to an open PR.");
  if (pr?.head?.repo?.full_name !== repository) throw new Error("Dispatcher evidence requires a same-repository PR.");
  if (pr?.head?.ref !== evidence.targetRef) throw new Error("Dispatcher PR head branch mismatch.");
  if (pr?.head?.sha !== evidence.candidateSha) throw new Error("Dispatcher PR head no longer matches expected_head_sha.");
  return true;
}

export async function publishGeneratedArtifactDispatchEvidence(options) {
  const api = `https://api.github.com/repos/${options.repository}`;
  const report = JSON.parse(fs.readFileSync(path.resolve(options.reportFile), "utf8"));
  const evidence = normalizeGeneratedArtifactDispatchEvidence({ ...options, report });
  if (options.prNumber !== null && options.prNumber !== evidence.prNumber) throw new Error("workflow_run PR number does not match dispatcher report.");
  const pr = await request(`${api}/pulls/${evidence.prNumber}`, { token: options.token });
  assertGeneratedArtifactDispatchPrIdentity(pr, evidence, options.repository);
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
  const result = await publishGeneratedArtifactDispatchEvidence(parseArgs(argv));
  process.stdout.write(`${JSON.stringify({ ...result, secrets_included: false })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  run().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 2;
  });
}
