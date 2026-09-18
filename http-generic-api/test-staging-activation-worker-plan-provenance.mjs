import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildStagingActivationWorkerPreflightBinding,
  verifyStagingActivationWorkerHandoff,
} from "./scripts/staging-activation-worker-handoff-verifier.mjs";

const root = path.resolve(import.meta.dirname, "..");
const registry = JSON.parse(fs.readFileSync(path.join(root, "http-generic-api/config/environment-convergence-registry.json"), "utf8"));
const workflow = fs.readFileSync(path.join(root, ".github/workflows/staging-main-deploy-eligibility.yml"), "utf8");
const profile = registry.profiles.staging.activation_gateway;
const sourceSha = "a".repeat(40);
const oldSha = "b".repeat(40);
const callerPlanA = "c".repeat(64);
const callerPlanB = "d".repeat(64);
const staleHealth = {
  ok: false,
  service: "activation-gateway",
  stale: true,
  policyKey: profile.policy_key,
  policyHash: profile.expected_policy_hash,
  sourceCommit: oldSha,
  workerBuildSha: oldSha,
  secretsIncluded: false,
  error: { code: "GATEWAY_POLICY_STALE" },
};
const staleFetch = async () => new Response(JSON.stringify(staleHealth), {
  status: 503,
  headers: { "content-type": "application/json" },
});

const first = await verifyStagingActivationWorkerHandoff({
  sourceSha,
  expectedPolicyHash: profile.expected_policy_hash,
  callerPlanSha256: callerPlanA,
  fetchImpl: staleFetch,
  repositoryRoot: root,
});
const second = await verifyStagingActivationWorkerHandoff({
  sourceSha,
  expectedPolicyHash: profile.expected_policy_hash,
  callerPlanSha256: callerPlanB,
  fetchImpl: staleFetch,
  repositoryRoot: root,
});

assert.match(first.authoritative_plan_sha256, /^[a-f0-9]{64}$/u);
assert.match(first.worker_bundle_sha256, /^[a-f0-9]{64}$/u);
assert.match(first.preflight_binding_sha256, /^[a-f0-9]{64}$/u);
assert.equal(first.status, "handoff_ready");
assert.equal(first.authoritative_plan_status, "handoff_ready");
assert.equal(first.operator_acknowledgement_status, "acknowledged_for_handoff");
assert.equal(first.operator_acknowledgement_is_execution_authority, false);
assert.equal(first.caller_plan_digest_is_execution_authority, false);
assert.equal(first.provider_target_caller_selectable, false);
assert.equal(first.provider_accessed, false);
assert.equal(first.provider_mutation_performed, false);
assert.equal(first.production_mutation_performed, false);
assert.equal(first.authoritative_plan_sha256, second.authoritative_plan_sha256);
assert.equal(first.worker_bundle_sha256, second.worker_bundle_sha256);
assert.equal(first.preflight_binding_sha256, second.preflight_binding_sha256);
assert.notEqual(first.caller_parent_convergence_plan_sha256, second.caller_parent_convergence_plan_sha256);

const rebuiltBinding = buildStagingActivationWorkerPreflightBinding({
  sourceSha,
  expectedPolicyHash: profile.expected_policy_hash,
  authoritativePlanSha256: first.authoritative_plan_sha256,
  workerBundleSha256: first.worker_bundle_sha256,
});
assert.equal(rebuiltBinding.preflight_binding_sha256, first.preflight_binding_sha256);

await assert.rejects(
  verifyStagingActivationWorkerHandoff({
    sourceSha,
    expectedPolicyHash: profile.expected_policy_hash,
    fetchImpl: async () => new Response(JSON.stringify({ ...staleHealth, stale: false, ok: true }), { status: 200 }),
    repositoryRoot: root,
  }),
  (error) => error?.code === "staging_activation_worker_handoff_not_stale",
);
await assert.rejects(
  verifyStagingActivationWorkerHandoff({
    sourceSha,
    expectedPolicyHash: profile.expected_policy_hash,
    healthUrl: "https://activation.mad4b.com/health",
    fetchImpl: staleFetch,
    repositoryRoot: root,
  }),
  (error) => error?.code === "staging_activation_worker_health_target_override_forbidden",
);

assert.match(workflow, /caller-observed parent convergence-plan SHA-256 for trace only; never execution authority/u);
assert.match(workflow, /authoritative_plan_sha256: \$\{\{ steps\.handoff\.outputs\.authoritative_plan_sha256 \}\}/u);
assert.match(workflow, /VERIFIED_CONVERGENCE_PLAN_SHA256: \$\{\{ needs\.activation_worker_refresh_preflight\.outputs\.authoritative_plan_sha256 \}\}/u);
assert.match(workflow, /VERIFIED_WORKER_BUNDLE_SHA256: \$\{\{ needs\.activation_worker_refresh_preflight\.outputs\.worker_bundle_sha256 \}\}/u);
assert.match(workflow, /PREFLIGHT_BINDING_SHA256: \$\{\{ needs\.activation_worker_refresh_preflight\.outputs\.preflight_binding_sha256 \}\}/u);
assert.match(workflow, /staging-activation-worker-handoff-verifier\.mjs/u);
assert.match(workflow, /buildStagingActivationWorkerPreflightBinding/u);
assert.doesNotMatch(workflow, /\n      CONVERGENCE_PLAN_SHA256: \$\{\{ inputs\.environment_convergence_plan_sha256 \}\}/u);
assert.doesNotMatch(workflow, /caller_plan_digest_is_execution_authority: true/u);

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.staging.activation-worker-plan-provenance.test.v1",
  caller_plan_assertion_deauthorized: true,
  live_workflow_owned_plan_required: true,
  acknowledged_handoff_required: true,
  same_run_binding_required: true,
  provider_mutation: false,
  production_mutation: false,
}));
