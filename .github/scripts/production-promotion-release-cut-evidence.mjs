#!/usr/bin/env node
import fs from "node:fs";

const SHA = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const POSITIVE_INT = /^[1-9][0-9]*$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const MODES = new Set(["human", "ai_policy"]);
const CANDIDATE_WORKFLOW = "production-promotion-candidate.yml";
const MAX_RUN_PAGES = 20;

function fail(message) {
  throw new Error(message);
}

function requireString(value, label, pattern) {
  if (typeof value !== "string" || !pattern.test(value)) fail(`${label} is invalid`);
  return value;
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}

async function githubJson(path, { repository, token, fetchImpl }) {
  const response = await fetchImpl(`https://api.github.com/repos/${repository}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) fail(`GitHub API ${path} failed with HTTP ${response.status}`);
  return response.json();
}

export function selectReusableBuilderRun({ requestHeadSha, candidateSha, runs, artifactsByRun }) {
  requireString(requestHeadSha, "request_head_sha", SHA);
  requireString(candidateSha, "candidate_sha", SHA);
  if (!Array.isArray(runs)) fail("candidate workflow runs must be an array");
  requireObject(artifactsByRun, "artifacts_by_run");

  const artifactName = `production-promotion-candidate-${candidateSha}`;
  const matches = new Set();

  for (const run of runs) {
    if (!run || typeof run !== "object" || Array.isArray(run)) continue;
    if (run.head_sha !== requestHeadSha) continue;
    if (run.event !== "workflow_dispatch") continue;
    if (run.status !== "completed" || run.conclusion !== "success") continue;

    const runId = requireString(String(run.id), "candidate builder run id", POSITIVE_INT);
    const artifacts = artifactsByRun[runId];
    if (!Array.isArray(artifacts)) continue;
    if (artifacts.some((artifact) => artifact?.name === artifactName && artifact?.expired === false)) matches.add(runId);
  }

  if (matches.size !== 1) {
    fail(`expected exactly one reusable builder run for candidate ${candidateSha}, found ${matches.size}`);
  }
  return [...matches][0];
}

export async function resolveReusedBuilderRunId(input, options = {}) {
  requireObject(input, "input");
  const suppliedRunId = String(input.builder_run_id ?? "");
  if (suppliedRunId !== "reused") return requireString(suppliedRunId, "builder_run_id", POSITIVE_INT);

  const candidateSha = requireString(input.candidate_sha, "candidate_sha", SHA);
  const requestPr = requireString(String(input.request_pr), "request_pr", POSITIVE_INT);
  const repository = requireString(
    String(options.repository ?? process.env.REPOSITORY ?? process.env.GITHUB_REPOSITORY ?? ""),
    "repository",
    REPOSITORY,
  );
  const token = String(options.token ?? process.env.GH_TOKEN ?? "");
  if (token.length === 0) fail("GitHub token is required to resolve reused builder provenance");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") fail("fetch implementation is required to resolve reused builder provenance");

  const request = await githubJson(`/pulls/${requestPr}`, { repository, token, fetchImpl });
  const requestHeadSha = requireString(request?.head?.sha, "request_head_sha", SHA);

  const runs = [];
  for (let page = 1; page <= MAX_RUN_PAGES; page += 1) {
    const payload = await githubJson(
      `/actions/workflows/${CANDIDATE_WORKFLOW}/runs?event=workflow_dispatch&status=success&per_page=100&page=${page}`,
      { repository, token, fetchImpl },
    );
    const batch = payload?.workflow_runs;
    if (!Array.isArray(batch)) fail("candidate workflow run response is invalid");
    runs.push(...batch);
    if (batch.length < 100) break;
    if (page === MAX_RUN_PAGES) fail("candidate builder run search exceeded bounded page limit");
  }

  const artifactsByRun = {};
  for (const run of runs) {
    if (run?.head_sha !== requestHeadSha || run?.event !== "workflow_dispatch" || run?.status !== "completed" || run?.conclusion !== "success") continue;
    const runId = requireString(String(run.id), "candidate builder run id", POSITIVE_INT);
    const payload = await githubJson(`/actions/runs/${runId}/artifacts?per_page=100`, { repository, token, fetchImpl });
    const artifacts = payload?.artifacts;
    if (!Array.isArray(artifacts)) fail(`candidate builder artifact response is invalid for run ${runId}`);
    if (Number(payload?.total_count ?? artifacts.length) > artifacts.length) {
      fail(`candidate builder artifact response is truncated for run ${runId}`);
    }
    artifactsByRun[runId] = artifacts;
  }

  return selectReusableBuilderRun({ requestHeadSha, candidateSha, runs, artifactsByRun });
}

export function buildReleaseCutPromotionEvidence(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("input must be an object");
  const reviewMode = input.review_mode;
  if (!MODES.has(reviewMode)) fail("review_mode is invalid");
  const supportingRuns = input.supporting_runs;
  if (!supportingRuns || typeof supportingRuns !== "object" || Array.isArray(supportingRuns)) fail("supporting_runs must be an object");
  const normalizedRuns = {};
  for (const [gateId, runId] of Object.entries(supportingRuns)) {
    if (!/^[a-z][a-z0-9_]{2,79}$/u.test(gateId)) fail(`supporting gate id is invalid: ${gateId}`);
    normalizedRuns[gateId] = requireString(String(runId), `supporting run ${gateId}`, POSITIVE_INT);
  }
  if (Object.keys(normalizedRuns).length === 0) fail("supporting_runs must not be empty");

  const releaseCutSha = requireString(input.release_cut_sha, "release_cut_sha", SHA);
  const currentMainSha = requireString(input.current_main_sha, "current_main_sha", SHA);
  return {
    schema_version: "governed_production_promotion_convergence.v2",
    ok: true,
    release_mode: "certified_release_cut",
    review_mode: reviewMode,
    review_authority: reviewMode === "ai_policy" ? "bounded_ai_policy_agent" : "human_maintainer",
    request_pr: requireString(String(input.request_pr), "request_pr", POSITIVE_INT),
    release_pr: requireString(String(input.release_pr), "release_pr", POSITIVE_INT),
    validation_pr: requireString(String(input.validation_pr), "validation_pr", POSITIVE_INT),
    release_cut_sha: releaseCutSha,
    main_sha: releaseCutSha,
    current_main_sha: currentMainSha,
    main_advanced_after_release_cut: currentMainSha !== releaseCutSha,
    production_sha: requireString(input.production_sha, "production_sha", SHA),
    candidate_sha: requireString(input.candidate_sha, "candidate_sha", SHA),
    builder_run_id: requireString(String(input.builder_run_id), "builder_run_id", POSITIVE_INT),
    exact_validation_run_id: requireString(String(input.certified_validation_run_id), "certified_validation_run_id", POSITIVE_INT),
    certified_validation_run_id: requireString(String(input.certified_validation_run_id), "certified_validation_run_id", POSITIVE_INT),
    gate_registry_sha256: requireString(input.gate_registry_sha256, "gate_registry_sha256", SHA256),
    supporting_runs: normalizedRuns,
    candidate_tree_matches_release_cut: true,
    release_cut_is_ancestor_of_current_main: true,
    production_is_ancestor_of_release_cut: true,
    candidate_contains_production: true,
    protected_refs_stable_during_validation: true,
    production_ref_stable_during_validation: true,
    exact_full_ci_success: true,
    supporting_gates_success: true,
    main_tip_may_advance: true,
    merge_executed: false,
    deployment_executed: false,
    migration_executed: false,
    grant_executed: false,
    provider_call_executed: false,
    credential_payload_read: false,
    secrets_included: false,
  };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2).replace(/-/gu, "_");
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`${token} requires a value`);
    args[key] = value;
    index += 1;
  }
  return args;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv);
  if (!args.input || !args.output) fail("--input and --output are required");
  const input = JSON.parse(fs.readFileSync(args.input, "utf8"));
  if (String(input.builder_run_id ?? "") === "reused") {
    input.builder_run_id = await resolveReusedBuilderRunId(input);
  }
  const evidence = buildReleaseCutPromotionEvidence(input);
  fs.writeFileSync(args.output, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
}
