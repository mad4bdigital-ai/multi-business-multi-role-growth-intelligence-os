import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { buildPromotionEvidence } from "../scripts/production-promotion-evidence.mjs";
import { selectPromotionRun } from "../scripts/production-promotion-run-selector.mjs";

const sha = (digit) => String(digit).repeat(40);
const digest = "a".repeat(64);
const run = (id, createdAt, status, conclusion, headSha = sha(1), event = "workflow_dispatch") => ({
  databaseId: id,
  createdAt,
  status,
  conclusion,
  headSha,
  event,
});

function evidenceInput(review_mode = "ai_policy") {
  return {
    review_mode,
    attempt: 1,
    request_pr: "7206",
    main_sha: sha(1),
    production_sha: sha(2),
    candidate_sha: sha(3),
    release_branch: "release/production-candidate-a",
    validation_branch: "gpt/validate-production-candidate-a",
    validation_base_branch: "gpt/validate-production-base-a",
    builder_run_id: "100",
    exact_validation_run_id: "101",
    supporting_runs: {
      "Frontend surface dispatch": "102",
      "HTTP Generic API Fanout Relocation": "103",
      "Custom GPT Contract Guard": "104",
      "Platform Completion Cleanup Readback": "105",
      "Platform Remaining Scope Scorecard": "106",
      "Spec 011 Delegation MariaDB Certification": "107",
    },
    release_pr: "7207",
    validation_pr: "7208",
    evidence_digest: digest,
  };
}

test("evidence serializer produces valid bounded ai_policy evidence", () => {
  const evidence = buildPromotionEvidence(evidenceInput("ai_policy"));
  assert.equal(evidence.review_authority, "bounded_ai_policy_agent");
  assert.equal(evidence.ai_policy_scope, "read_only_supporting_gates_and_exact_candidate_validation");
  assert.equal(evidence.merge_executed, false);
  assert.equal(evidence.deployment_executed, false);
  assert.equal(evidence.migration_executed, false);
  assert.equal(evidence.provider_call_executed, false);
  assert.equal(evidence.credential_payload_read, false);
  assert.equal(evidence.secrets_included, false);
  assert.deepEqual(JSON.parse(JSON.stringify(evidence)), evidence);
});

test("evidence serializer produces human evidence without ai authority", () => {
  const evidence = buildPromotionEvidence(evidenceInput("human"));
  assert.equal(evidence.review_authority, "human_maintainer");
  assert.equal(evidence.ai_policy_scope, null);
});

test("evidence serializer fails closed on invalid review mode or unsafe identifiers", () => {
  assert.throws(() => buildPromotionEvidence(evidenceInput("robot")), /review_mode/u);
  assert.throws(() => buildPromotionEvidence({ ...evidenceInput(), candidate_sha: "short" }), /candidate_sha/u);
  assert.throws(() => buildPromotionEvidence({ ...evidenceInput(), evidence_digest: "short" }), /evidence_digest/u);
  assert.throws(() => buildPromotionEvidence({ ...evidenceInput(), supporting_runs: { Gate: "0" } }), /supporting run Gate/u);
});

test("selector prefers terminal exact-head success over newer queued duplicate", () => {
  const selected = selectPromotionRun([
    run("100", "2026-08-14T17:15:00Z", "completed", "success"),
    run("101", "2026-08-14T17:16:00Z", "queued", "", sha(1)),
  ], { earliest: "2026-08-14T17:14:20Z", headSha: sha(1), event: "workflow_dispatch" });
  assert.equal(selected.databaseId, "100");
});

test("selector chooses newest pending exact-head run when no terminal success exists", () => {
  const selected = selectPromotionRun([
    run("200", "2026-08-14T17:15:00Z", "queued", ""),
    run("201", "2026-08-14T17:16:00Z", "in_progress", ""),
  ], { earliest: "2026-08-14T17:14:20Z", headSha: sha(1), event: "workflow_dispatch" });
  assert.equal(selected.databaseId, "201");
});

test("selector excludes action_required by default and can opt in explicitly", () => {
  const runs = [run("300", "2026-08-14T17:15:00Z", "completed", "action_required")];
  assert.equal(selectPromotionRun(runs, { headSha: sha(1), event: "workflow_dispatch" }), null);
  assert.equal(selectPromotionRun(runs, { headSha: sha(1), event: "workflow_dispatch", includeActionRequired: true }).databaseId, "300");
});

test("selector excludes stale head and wrong event runs", () => {
  const selected = selectPromotionRun([
    run("400", "2026-08-14T17:15:00Z", "completed", "success", sha(4), "pull_request"),
    run("401", "2026-08-14T17:15:00Z", "completed", "success", sha(1), "workflow_dispatch"),
  ], { headSha: sha(1), event: "workflow_dispatch" });
  assert.equal(selected.databaseId, "401");
});

test("launcher uses runtime helpers and does not retain unsupported jq ternary", () => {
  const launcher = fs.readFileSync(new URL("../workflows/governed-production-promotion-request-launcher.yml", import.meta.url), "utf8");
  assert.match(launcher, /production-promotion-evidence\.mjs/u);
  assert.match(launcher, /production-promotion-run-selector\.mjs/u);
  assert.match(launcher, /Preflight promotion runtime helpers/u);
  assert.doesNotMatch(launcher, /review_authority: \(\$review_mode == "ai_policy" \?/u);
  assert.match(launcher, /merge_executed=false deployment_executed=false/u);
});

console.log(JSON.stringify({
  contract: "mad4b.production-promotion-runtime-regression.v1",
  ok: true,
  covers: ["evidence_serializer", "run_selector", "duplicate_preference", "action_required_fail_closed", "safe_failure"],
  production_merge: false,
  deployment: false,
  migrations: false,
  grants: false,
  provider_mutation: false,
  secrets_included: false,
}));
