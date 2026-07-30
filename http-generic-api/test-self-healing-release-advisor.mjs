import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildReleaseAdvisorPlan,
  normalizeReleaseAdvisorInput,
  sanitizeReleaseAdvisorEvidence,
} from "./selfHealingReleaseAdvisorService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const targetId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const expectedSha = "a".repeat(40);
const deployedSha = "b".repeat(40);

const normalized = normalizeReleaseAdvisorInput({
  environment_key: "production",
  runtime_verification_run_id: runId,
  target_id: targetId,
  expected_commit_sha: expectedSha,
  context: { reason: "test", api_key: "must-not-survive" },
});
assert.equal(normalized.environment_key, "production");
assert.equal(normalized.context.api_key, undefined);
assert.throws(
  () => normalizeReleaseAdvisorInput({ runtime_verification_run_id: "not-a-uuid" }),
  (error) => error.code === "release_advisor_validation_error" && error.status === 400,
);

const mismatchPlan = buildReleaseAdvisorPlan({
  environment_key: "production",
  target_id: targetId,
  verification: {
    run_id: runId,
    environment_key: "production",
    production_parity: "degraded",
    expected_commit_sha: expectedSha,
    deployed_commit_sha: deployedSha,
  },
  gaps: [{
    gap_id: "33333333-3333-4333-8333-333333333333",
    gap_key: "deployed_commit_mismatch",
    classification: "deployment_parity_mismatch",
    severity: "critical",
    blocks_production_parity: 1,
    remediation_type: "repo_patch_or_deploy",
    auto_fix_allowed: 0,
    approval_required: 1,
    owner_key: "release_platform",
    recommended_action: "Redeploy or reconcile and rerun verification.",
    runbook_json: JSON.stringify({ steps: ["read deployment info", "reconcile"], success_condition: "commits match" }),
  }],
  operation: null,
  gate: null,
  async_deployment: null,
});
assert.equal(mismatchPlan.advisor_status, "review_required");
assert.equal(mismatchPlan.severity, "critical");
assert.equal(mismatchPlan.recommendation_count, 1);
assert.equal(mismatchPlan.recommendations[0].template_key, "hostinger_release_deploy_v1");
assert.equal(mismatchPlan.recommendations[0].execution_allowed, false);
assert.equal(mismatchPlan.recommendations[0].provider_write, false);
assert.equal(mismatchPlan.recommendations[0].external_write, false);
assert.equal(mismatchPlan.recommendations[0].plan.status, "proposed");
assert.ok(mismatchPlan.recommendations[0].plan.steps.every((step) => step.execution_allowed === false));
assert.match(mismatchPlan.plan_fingerprint_sha256, /^[0-9a-f]{64}$/);

const mismatchPlanRetry = buildReleaseAdvisorPlan({
  environment_key: "production",
  target_id: targetId,
  verification: {
    run_id: runId,
    environment_key: "production",
    production_parity: "degraded",
    expected_commit_sha: expectedSha,
    deployed_commit_sha: deployedSha,
  },
  gaps: [{
    gap_key: "deployed_commit_mismatch",
    classification: "deployment_parity_mismatch",
    severity: "critical",
    remediation_type: "repo_patch_or_deploy",
  }],
});
assert.equal(mismatchPlan.plan_fingerprint_sha256, mismatchPlanRetry.plan_fingerprint_sha256);

const mainMovedPlan = buildReleaseAdvisorPlan({
  environment_key: "production",
  target_id: targetId,
  context: {
    source: "repository_main_moved_trigger_coordinator",
    production_sync_required: true,
    source_branch: "main",
    deployment_branch: "Production",
  },
  verification: {
    run_id: runId,
    environment_key: "production",
    production_parity: "degraded",
    expected_commit_sha: expectedSha,
    deployed_commit_sha: deployedSha,
  },
  gaps: [{
    gap_key: "deployed_commit_mismatch",
    classification: "deployment_parity_mismatch",
    severity: "critical",
    remediation_type: "repo_patch_or_deploy",
    approval_required: 1,
  }],
});
const syncRecommendation = mainMovedPlan.recommendations[0];
assert.equal(syncRecommendation.action_key, "release.sync_production_from_latest_main");
assert.equal(syncRecommendation.template_key, null);
assert.equal(syncRecommendation.plan.source_branch, "main");
assert.equal(syncRecommendation.plan.deployment_branch, "Production");
assert.equal(syncRecommendation.plan.expected_main_commit_sha, expectedSha);
assert.equal(syncRecommendation.plan.fresh_hostinger_build_required, true);
assert.equal(syncRecommendation.plan.same_cycle_readback_required, true);
assert.deepEqual(syncRecommendation.plan.steps.map((step) => step.step_key), [
  "read_latest_main_sha",
  "compare_production_with_latest_main",
  "create_or_update_main_to_production_pr",
  "run_ci_gate",
  "obtain_typed_approval",
  "merge_latest_main_into_production",
  "verify_fresh_hostinger_build",
  "verify_deployment_manifest_sha",
  "verify_production_health",
]);
assert.ok(syncRecommendation.plan.steps.every((step) => step.execution_allowed === false));
assert.notEqual(mainMovedPlan.plan_fingerprint_sha256, mismatchPlan.plan_fingerprint_sha256);

const healthyPlan = buildReleaseAdvisorPlan({
  environment_key: "production",
  verification: {
    run_id: runId,
    environment_key: "production",
    production_parity: "verified",
    expected_commit_sha: expectedSha,
    deployed_commit_sha: expectedSha,
  },
  gaps: [],
});
assert.equal(healthyPlan.advisor_status, "no_action");
assert.equal(healthyPlan.recommendation_count, 0);
assert.equal(healthyPlan.policy.execution_allowed, false);

const sanitized = sanitizeReleaseAdvisorEvidence({ token: "blocked", nested: { password: "blocked", value: "kept" }, secrets_included: false });
assert.equal(sanitized.token, undefined);
assert.equal(sanitized.nested.password, undefined);
assert.equal(sanitized.nested.value, "kept");
assert.equal(sanitized.secrets_included, false);

const migration = fs.readFileSync(path.join(__dirname, "migrations", "20260716_self_healing_release_advisor.sql"), "utf8");
assert.match(migration, /CREATE TABLE IF NOT EXISTS release_advisor_runs/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS release_advisor_recommendations/);
assert.match(migration, /release_advisor_run_create/);
assert.match(migration, /release_advisor_run_get/);
assert.match(migration, /self_healing_release_advisor_policy_v1/);
assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE)\b/i);

const openapi = fs.readFileSync(path.join(__dirname, "openapi", "self-healing-release-advisor.yaml"), "utf8");
assert.match(openapi, /openapi: 3\.1\.0/);
assert.match(openapi, /operationId: createReleaseAdvisorRun/);
assert.match(openapi, /operationId: getReleaseAdvisorRun/);
assert.match(openapi, /execution_allowed: \{ type: boolean, const: false \}/);

const mutationPolicyMigration = fs.readFileSync(
  path.join(__dirname, "migrations", "20260716_self_healing_release_advisor_mutation_policy.sql"),
  "utf8",
);
assert.match(mutationPolicyMigration, /WHERE tool_key = 'release_advisor_run_create'/);
for (const marker of [
  "mutation_policy_required",
  "capability_envelope",
  "approval_required",
  "readback",
  "same_cycle_readback",
]) {
  assert.match(mutationPolicyMigration, new RegExp(marker));
}
assert.doesNotMatch(mutationPolicyMigration, /\b(?:DROP|TRUNCATE|DELETE)\b/i);

console.log("self-healing release advisor tests passed");
