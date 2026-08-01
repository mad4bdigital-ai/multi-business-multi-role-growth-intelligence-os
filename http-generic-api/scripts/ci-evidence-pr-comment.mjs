#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const COMMENT_MARKER = "<!-- mad4b-ci-evidence-authority -->";
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
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
const WORKFLOWS = Object.freeze({
  "E2E Phase Governance": { slug: "e2e-phase-governance", contract: "mad4b.ci-evidence-summary.v1", candidateKind: "head" },
  "Context Kernel Hardcoding Report": { slug: "context-kernel-hardcoding", contract: "mad4b.context-kernel-hardcoding-summary.v1", candidateKind: "head" },
  "Branch Test Diagnostic Shards": { slug: "branch-test-diagnostic", contract: "mad4b.test-diagnostic-summary.v2", candidateKind: "merge_candidate" }
});

function text(value, max = 240) {
  return String(value ?? "unknown").replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/`/gu, "'").slice(0, max);
}

function parseArgs(argv) {
  const options = {
    repository: null,
    prNumber: null,
    workflow: null,
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
    else if (arg === "--workflow") options.workflow = take();
    else if (arg.startsWith("--workflow=")) options.workflow = arg.slice(11);
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
  if (!Number.isInteger(options.prNumber) || options.prNumber < 1) throw new Error("--pr-number must be positive.");
  if (!WORKFLOWS[options.workflow]) throw new Error("Unsupported workflow.");
  if (!WORKFLOW_CONCLUSIONS.has(options.workflowConclusion)) throw new Error("--workflow-conclusion must be a supported completed conclusion.");
  if (!options.reportFile) throw new Error("--report is required.");
  if (!Number.isInteger(options.workflowRunId) || options.workflowRunId < 1) throw new Error("--workflow-run-id must be positive.");
  if (!SHA_PATTERN.test(options.sourceHeadSha || "")) throw new Error("--source-head-sha must be a full lowercase SHA.");
  if (!options.token) throw new Error("GITHUB_TOKEN is required.");
  return options;
}

function assertConclusionMatchesOutcome(workflowConclusion, outcome) {
  const passed = outcome === "passed";
  if (workflowConclusion === "success" && !passed) {
    throw new Error("Successful workflow_run cannot publish a non-passed canonical outcome.");
  }
  if (workflowConclusion !== "success" && passed) {
    throw new Error("Non-successful workflow_run cannot publish a passed canonical outcome.");
  }
}

export function normalizeEvidence({ workflow, workflowConclusion, report, prNumber, workflowRunId, sourceHeadSha }) {
  const route = WORKFLOWS[workflow];
  if (!route) throw new Error("Unsupported workflow.");
  if (!WORKFLOW_CONCLUSIONS.has(workflowConclusion)) throw new Error("Unsupported workflow conclusion.");
  if (report?.contract !== route.contract) throw new Error(`Unexpected canonical contract for ${workflow}.`);
  if (workflow === "Branch Test Diagnostic Shards") {
    if (!SHA_PATTERN.test(report?.commitSha || "")) throw new Error("Branch diagnostic report is missing a valid merge-candidate SHA.");
    if (report?.ref !== `refs/pull/${prNumber}/merge`) throw new Error("Branch diagnostic report ref does not match the PR merge candidate.");
    if (report?.secretsIncluded !== false) throw new Error("Branch diagnostic report must declare secretsIncluded=false.");
    const outcome = Number(report.failedCount || 0) === 0 ? "passed" : "failed";
    assertConclusionMatchesOutcome(workflowConclusion, outcome);
    return {
      slug: route.slug,
      workflow,
      workflowConclusion,
      runId: workflowRunId,
      candidateKind: "merge_candidate",
      candidateSha: report.commitSha,
      sourceHeadSha,
      outcome,
      detail: `${Number(report.passedCount || 0)}/${Number(report.selectedCount || 0)} tests passed; ${Number(report.failedCount || 0)} failed`,
      artifactContract: report.contract
    };
  }
  if (report?.secrets_included !== false) throw new Error(`${workflow} report must declare secrets_included=false.`);
  if (report?.identity?.candidate_kind !== "head") throw new Error(`${workflow} must publish head evidence.`);
  if (!SHA_PATTERN.test(report?.identity?.candidate_sha || "")) throw new Error(`${workflow} report is missing a valid candidate SHA.`);
  if (report.identity.candidate_sha !== sourceHeadSha) throw new Error(`${workflow} report candidate does not match workflow_run head_sha.`);
  assertConclusionMatchesOutcome(workflowConclusion, report.outcome);
  return {
    slug: route.slug,
    workflow,
    workflowConclusion,
    runId: workflowRunId,
    candidateKind: "head",
    candidateSha: report.identity.candidate_sha,
    sourceHeadSha,
    outcome: report.outcome,
    detail: report.first_failure?.code || report.first_failure?.test_id || (report.integrity_findings?.length ? `${report.integrity_findings.length} integrity finding(s)` : "no blocking finding"),
    artifactContract: report.contract
  };
}

export function renderEvidenceSection(evidence) {
  const start = `<!-- ci-evidence-section:${evidence.slug}:start run_id=${evidence.runId} -->`;
  const end = `<!-- ci-evidence-section:${evidence.slug}:end -->`;
  return [
    start,
    `### ${text(evidence.workflow, 100)}`,
    "",
    `- Run ID: \`${evidence.runId}\``,
    `- Workflow conclusion: \`${text(evidence.workflowConclusion, 40)}\``,
    `- Candidate kind: \`${evidence.candidateKind}\``,
    `- Exact candidate SHA: \`${evidence.candidateSha}\``,
    `- PR source head SHA: \`${evidence.sourceHeadSha}\``,
    `- Contract: \`${text(evidence.artifactContract, 100)}\``,
    `- Outcome: **${text(evidence.outcome, 40)}**`,
    `- Decision detail: ${text(evidence.detail, 500)}`,
    "- Job logs: diagnostic-only; this section was generated from the canonical artifact.",
    end
  ].join("\n");
}

function sectionPattern(slug) {
  return new RegExp(`<!-- ci-evidence-section:${slug}:start run_id=(\\d+) -->[\\s\\S]*?<!-- ci-evidence-section:${slug}:end -->`, "u");
}

export function upsertEvidenceComment(existingBody, evidence) {
  const base = existingBody?.includes(COMMENT_MARKER)
    ? existingBody
    : `${COMMENT_MARKER}\n## Canonical CI evidence\n\nThis comment is maintained by the trusted \`workflow_run\` publisher. Newer runs replace the matching workflow section; Job logs are not the status authority.`;
  const pattern = sectionPattern(evidence.slug);
  const match = base.match(pattern);
  const existingRunId = match ? Number(match[1]) : 0;
  if (existingRunId > evidence.runId) return { body: base, changed: false, reason: "newer_section_already_present" };
  const section = renderEvidenceSection(evidence);
  const body = match ? base.replace(pattern, section) : `${base.trim()}\n\n${section}\n`;
  return { body, changed: body !== existingBody, reason: match ? "section_replaced" : "section_added" };
}

async function githubRequest(url, { token, method = "GET", body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "mad4b-ci-evidence-publisher"
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  if (!response.ok) throw new Error(`GitHub API ${method} ${url} failed: ${response.status}`);
  return response.status === 204 ? null : response.json();
}

export async function publishEvidenceComment(options) {
  const report = JSON.parse(fs.readFileSync(path.resolve(options.reportFile), "utf8"));
  const evidence = normalizeEvidence({ ...options, report });
  const api = `https://api.github.com/repos/${options.repository}`;
  const pullRequest = await githubRequest(`${api}/pulls/${options.prNumber}`, { token: options.token });
  if (pullRequest?.head?.sha !== options.sourceHeadSha) {
    throw new Error("Refusing to publish canonical evidence for a stale PR head.");
  }
  const comments = await githubRequest(`${api}/issues/${options.prNumber}/comments?per_page=100`, { token: options.token });
  const existing = comments.find((comment) => typeof comment.body === "string" && comment.body.includes(COMMENT_MARKER));
  const updated = upsertEvidenceComment(existing?.body || "", evidence);
  if (!updated.changed) return { ok: true, action: "unchanged", reason: updated.reason, evidence };
  if (existing) {
    await githubRequest(`${api}/issues/comments/${existing.id}`, { token: options.token, method: "PATCH", body: { body: updated.body } });
    return { ok: true, action: "updated", comment_id: existing.id, evidence };
  }
  const created = await githubRequest(`${api}/issues/${options.prNumber}/comments`, { token: options.token, method: "POST", body: { body: updated.body } });
  return { ok: true, action: "created", comment_id: created.id, evidence };
}

export async function runCiEvidencePrComment(argv = process.argv.slice(2)) {
  const result = await publishEvidenceComment(parseArgs(argv));
  process.stdout.write(`${JSON.stringify({ ...result, secrets_included: false })}\n`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runCiEvidencePrComment().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 2;
  });
}
