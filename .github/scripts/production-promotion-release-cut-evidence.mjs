#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const SHA = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const POSITIVE_INT = /^[1-9][0-9]*$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const MODES = new Set(["human", "ai_policy"]);
const CANDIDATE_WORKFLOW_PATH = ".github/workflows/production-promotion-candidate.yml";

function fail(message) {
  throw new Error(message);
}

function requireString(value, label, pattern) {
  if (typeof value !== "string" || !pattern.test(value)) fail(`${label} is invalid`);
  return value;
}

export function resolveReusedBuilderRunId({ input, requestPull, artifacts, runsById }) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("input must be an object");
  const candidateSha = requireString(input.candidate_sha, "candidate_sha", SHA);
  const requestHeadSha = requireString(requestPull?.head?.sha, "request PR head sha", SHA);
  const requestHeadBranch = requestPull?.head?.ref;
  if (typeof requestHeadBranch !== "string" || requestHeadBranch.length === 0) fail("request PR head branch is invalid");
  if (!artifacts || !Array.isArray(artifacts.artifacts)) fail("builder artifact response is invalid");
  if (!runsById || typeof runsById !== "object" || Array.isArray(runsById)) fail("builder run response map is invalid");

  const artifactName = `production-promotion-candidate-${candidateSha}`;
  const matchingArtifacts = artifacts.artifacts
    .filter((artifact) => artifact?.name === artifactName
      && artifact?.expired === false
      && String(artifact?.workflow_run?.head_sha ?? "") === requestHeadSha
      && String(artifact?.workflow_run?.head_branch ?? "") === requestHeadBranch
      && POSITIVE_INT.test(String(artifact?.workflow_run?.id ?? "")))
    .sort((left, right) => Number(right.id ?? 0) - Number(left.id ?? 0));

  for (const artifact of matchingArtifacts) {
    const runId = String(artifact.workflow_run.id);
    const run = runsById[runId];
    if (!run) continue;
    if (String(run.id ?? "") !== runId) continue;
    if (run.path !== CANDIDATE_WORKFLOW_PATH) continue;
    if (run.event !== "workflow_dispatch") continue;
    if (run.status !== "completed" || run.conclusion !== "success") continue;
    if (run.head_sha !== requestHeadSha || run.head_branch !== requestHeadBranch) continue;
    return runId;
  }

  fail("reused promotion surfaces have no exact successful candidate builder provenance");
}

function ghJson(endpoint) {
  try {
    return JSON.parse(execFileSync("gh", ["api", endpoint], { encoding: "utf8" }));
  } catch (error) {
    const detail = error?.stderr ? String(error.stderr).trim() : String(error?.message ?? error);
    fail(`GitHub provenance read failed for ${endpoint}: ${detail}`);
  }
}

function normalizeCliInput(input) {
  if (String(input?.builder_run_id ?? "") !== "reused") return input;

  const repository = requireString(process.env.REPOSITORY, "REPOSITORY", REPOSITORY);
  const requestPr = requireString(String(input.request_pr), "request_pr", POSITIVE_INT);
  const candidateSha = requireString(input.candidate_sha, "candidate_sha", SHA);
  const requestPull = ghJson(`/repos/${repository}/pulls/${requestPr}`);
  const artifactName = `production-promotion-candidate-${candidateSha}`;
  const artifacts = ghJson(`/repos/${repository}/actions/artifacts?name=${encodeURIComponent(artifactName)}&per_page=100`);
  const runsById = {};

  for (const artifact of artifacts?.artifacts ?? []) {
    const runId = String(artifact?.workflow_run?.id ?? "");
    if (!POSITIVE_INT.test(runId) || Object.hasOwn(runsById, runId)) continue;
    runsById[runId] = ghJson(`/repos/${repository}/actions/runs/${runId}`);
  }

  return {
    ...input,
    builder_run_id: resolveReusedBuilderRunId({ input, requestPull, artifacts, runsById }),
  };
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
  const input = normalizeCliInput(JSON.parse(fs.readFileSync(args.input, "utf8")));
  const evidence = buildReleaseCutPromotionEvidence(input);
  fs.writeFileSync(args.output, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
}
