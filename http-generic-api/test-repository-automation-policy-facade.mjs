import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GITHUB_REPOSITORY_POLICY_CONFIRMATION,
  REPOSITORY_AUTOMATION_CAPABILITIES,
  REPOSITORY_POLICY_STEPS,
  buildGithubRepositoryPolicyPlan,
  buildRepositoryAutomationPlan,
  runRepositoryAutomation,
} from "./repositoryAutomationPolicyFacade.js";

const OWNER = "mad4bdigital-ai";
const REPO = "multi-business-multi-role-growth-intelligence-os";
const MAIN_SHA = "a".repeat(40);

const readback = {
  contract: "github-repository-policy-controller-v1",
  mode: "readback",
  target: { owner: OWNER, repo: REPO, default_branch: "main" },
  main_sha: MAIN_SHA,
  ruleset_details: [],
  managed_ruleset_count: 0,
  bypass_actors: [],
  proof: {
    policy_state_readable: true,
    finalizer_app_identity_resolved: true,
    auto_merge_disabled: true,
    merge_queue_disabled_or_equivalent: true,
    server_policy_gate_complete: false,
  },
  secrets_included: false,
};

assert.ok(REPOSITORY_AUTOMATION_CAPABILITIES.includes("repository_policy_controller"));
assert.deepEqual(REPOSITORY_POLICY_STEPS.map((step) => step.step_key), ["policy_readback", "policy_plan", "policy_apply"]);
assert.equal(REPOSITORY_POLICY_STEPS.find((step) => step.step_key === "policy_apply").mutation_required, true);

const dryPlan = buildRepositoryAutomationPlan({
  automation_key: "repository_policy",
  mode: "dry_run",
  owner: OWNER,
  repo: REPO,
  default_branch: "main",
});
assert.equal(dryPlan.automation_key, "repository_policy");
assert.equal(dryPlan.steps.length, 3);
assert.equal(dryPlan.live_apply_authorized, false);
assert.equal(dryPlan.repository_content_mutation_allowed, false);
assert.equal(dryPlan.force_push_allowed, false);
assert.equal(dryPlan.secrets_included, false);

const routeSource = readFileSync(new URL("./routes/repositoryAutomationRoutes.js", import.meta.url), "utf8");
const migrationSource = readFileSync(new URL("./migrations/20260805_github_repository_policy_controller.sql", import.meta.url), "utf8");
assert.equal(routeSource.includes('router.post("/admin/repository-automation/policy-controller", ...requireAdmin'), true);
assert.equal(routeSource.includes('runGithubRepositoryPolicyController(bodyOf(req), automationDeps(req))'), true);
assert.equal(migrationSource.includes("'github_repository_policy_controller'"), true);
assert.equal(migrationSource.includes("'VIRTUAL'"), true);
assert.equal(migrationSource.includes("'internal://github-repository-policy-controller'"), true);
assert.equal(migrationSource.includes("APPLY_GITHUB_MAIN_REVIEW_POLICY"), true);
assert.equal(migrationSource.includes("live_apply_during_implementation_allowed',FALSE"), true);

const dryRun = await runRepositoryAutomation({
  automation_key: "repository_policy",
  mode: "dry_run",
  owner: OWNER,
  repo: REPO,
}, { persist: false });
assert.equal(dryRun.status, "dry_run_complete");
assert.equal(dryRun.mutations_executed, false);

const policyPlan = buildGithubRepositoryPolicyPlan({ owner: OWNER, repo: REPO }, readback);
const calls = [];
const policyController = async (args) => {
  calls.push(args.mode);
  if (args.mode === "readback") return readback;
  if (args.mode === "apply") {
    assert.equal(args.confirm, GITHUB_REPOSITORY_POLICY_CONFIRMATION);
    assert.equal(args.expected_main_sha, MAIN_SHA);
    assert.equal(args.expected_policy_fingerprint, policyPlan.policy_fingerprint);
    assert.equal(args.capability_envelope_id, "env-policy-1");
    return {
      contract: "github-repository-policy-controller-v1",
      mode: "apply",
      policy_fingerprint: policyPlan.policy_fingerprint,
      mutation: { operation: "create_ruleset", ruleset_id: 42 },
      mutation_executed: true,
      readback: {
        ...readback,
        proof: { ...readback.proof, server_policy_gate_complete: true },
      },
      secrets_included: false,
    };
  }
  throw new Error(`unexpected mode ${args.mode}`);
};

const applied = await runRepositoryAutomation({
  automation_key: "repository_policy",
  mode: "apply",
  owner: OWNER,
  repo: REPO,
  default_branch: "main",
  expected_main_sha: MAIN_SHA,
  expected_policy_fingerprint: policyPlan.policy_fingerprint,
  confirm: GITHUB_REPOSITORY_POLICY_CONFIRMATION,
  capability_envelope_id: "env-policy-1",
}, {
  persist: false,
  policyController,
  auth: { caller_type: "admin" },
});
assert.deepEqual(calls, ["readback", "apply"]);
assert.equal(applied.status, "completed");
assert.equal(applied.results.length, 3);
assert.equal(applied.mutations_executed, true);
assert.equal(applied.summary.server_policy_gate_complete, true);
assert.equal(applied.repository_content_mutation_executed, false);
assert.equal(applied.force_push_executed, false);
assert.equal(applied.secrets_included, false);

let capturedApply = null;
await assert.rejects(
  runRepositoryAutomation({
    automation_key: "repository_policy",
    mode: "apply",
    owner: OWNER,
    repo: REPO,
    expected_main_sha: MAIN_SHA,
    expected_policy_fingerprint: policyPlan.policy_fingerprint,
    capability_envelope_id: "env-policy-1",
  }, {
    persist: false,
    policyController: async (args) => {
      if (args.mode === "readback") return readback;
      capturedApply = args;
      const error = new Error("confirmation missing");
      error.code = "github_repository_policy_confirmation_invalid";
      throw error;
    },
    auth: { caller_type: "admin" },
  }),
  (error) => error?.code === "github_repository_policy_confirmation_invalid"
);
assert.equal(capturedApply.confirm, undefined, "The facade must not invent typed confirmation.");

assert.throws(
  () => buildRepositoryAutomationPlan({ automation_key: "repository_policy", default_branch: "Production" }),
  (error) => error?.code === "repository_policy_automation_main_only"
);
assert.throws(
  () => buildRepositoryAutomationPlan({ automation_key: "repository_policy", private_key: "forbidden" }),
  (error) => error?.code === "repository_policy_automation_secret_field_rejected"
);

console.log(JSON.stringify({
  ok: true,
  test: "repository_automation_policy_facade",
  capability_registered: true,
  three_steps_registered: true,
  persisted_surface_compatible: true,
  dry_run_default_no_mutation: true,
  typed_confirmation_not_invented: true,
  existing_control_plane_delegation_preserved: true,
  secrets_included: false,
}));
