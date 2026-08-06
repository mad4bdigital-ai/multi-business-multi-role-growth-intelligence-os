import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GITHUB_REPOSITORY_POLICY_CONFIRMATION,
  REPOSITORY_AUTOMATION_CAPABILITIES,
  REPOSITORY_POLICY_STEPS,
  buildGithubRepositoryPolicyPlan,
  buildRepositoryAutomationPlan,
  runGithubRepositoryPolicyController,
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
assert.equal(dryPlan.apply_binding, undefined);

const routeSource = readFileSync(new URL("./routes/repositoryAutomationRoutes.js", import.meta.url), "utf8");
const migrationSource = readFileSync(new URL("./migrations/20260805_github_repository_policy_controller.sql", import.meta.url), "utf8");
assert.equal(routeSource.includes('router.post("/admin/repository-automation/policy-controller", ...requireAdmin'), true);
assert.equal(routeSource.includes('runGithubRepositoryPolicyController(bodyOf(req), automationDeps(req))'), true);
assert.equal(routeSource.includes('from "../repositoryAutomationPolicyFacade.js"'), true);
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
const applyPlanEnvelopeOne = buildRepositoryAutomationPlan({
  automation_key: "repository_policy",
  mode: "apply",
  owner: OWNER,
  repo: REPO,
  default_branch: "main",
  expected_main_sha: MAIN_SHA,
  expected_policy_fingerprint: policyPlan.policy_fingerprint,
  confirm: GITHUB_REPOSITORY_POLICY_CONFIRMATION,
  capability_envelope_id: "env-policy-1",
});
const applyPlanEnvelopeTwo = buildRepositoryAutomationPlan({
  automation_key: "repository_policy",
  mode: "apply",
  owner: OWNER,
  repo: REPO,
  default_branch: "main",
  expected_main_sha: MAIN_SHA,
  expected_policy_fingerprint: policyPlan.policy_fingerprint,
  confirm: GITHUB_REPOSITORY_POLICY_CONFIRMATION,
  capability_envelope_id: "env-policy-2",
});
const applyPlanMovedMain = buildRepositoryAutomationPlan({
  automation_key: "repository_policy",
  mode: "apply",
  owner: OWNER,
  repo: REPO,
  default_branch: "main",
  expected_main_sha: "b".repeat(40),
  expected_policy_fingerprint: policyPlan.policy_fingerprint,
  confirm: GITHUB_REPOSITORY_POLICY_CONFIRMATION,
  capability_envelope_id: "env-policy-1",
});
assert.equal(applyPlanEnvelopeOne.apply_binding.expected_main_sha, MAIN_SHA);
assert.equal(applyPlanEnvelopeOne.apply_binding.expected_policy_fingerprint, policyPlan.policy_fingerprint);
assert.equal(applyPlanEnvelopeOne.apply_binding.expected_main_sha_valid, true);
assert.equal(applyPlanEnvelopeOne.apply_binding.expected_policy_fingerprint_valid, true);
assert.equal(applyPlanEnvelopeOne.apply_binding.capability_envelope_present, true);
assert.equal(applyPlanEnvelopeOne.apply_binding.typed_confirmation_matches, true);
assert.match(applyPlanEnvelopeOne.apply_binding.expected_main_sha_input_sha256, /^[a-f0-9]{64}$/);
assert.match(applyPlanEnvelopeOne.apply_binding.expected_policy_fingerprint_input_sha256, /^[a-f0-9]{64}$/);
assert.match(applyPlanEnvelopeOne.apply_binding.capability_envelope_ref_sha256, /^[a-f0-9]{64}$/);
assert.match(applyPlanEnvelopeOne.apply_binding.typed_confirmation_sha256, /^[a-f0-9]{64}$/);
assert.notEqual(applyPlanEnvelopeOne.plan_sha256, applyPlanEnvelopeTwo.plan_sha256);
assert.notEqual(applyPlanEnvelopeOne.plan_sha256, applyPlanMovedMain.plan_sha256);
assert.notEqual(
  applyPlanEnvelopeOne.apply_binding.capability_envelope_ref_sha256,
  applyPlanEnvelopeTwo.apply_binding.capability_envelope_ref_sha256
);
assert.equal(JSON.stringify(applyPlanEnvelopeOne).includes("env-policy-1"), false);

const applyPlanOverlongMain = buildRepositoryAutomationPlan({
  automation_key: "repository_policy",
  mode: "apply",
  owner: OWNER,
  repo: REPO,
  default_branch: "main",
  expected_main_sha: `${MAIN_SHA}0`,
  expected_policy_fingerprint: policyPlan.policy_fingerprint,
  confirm: GITHUB_REPOSITORY_POLICY_CONFIRMATION,
  capability_envelope_id: "env-policy-1",
});
const applyPlanOverlongFingerprint = buildRepositoryAutomationPlan({
  automation_key: "repository_policy",
  mode: "apply",
  owner: OWNER,
  repo: REPO,
  default_branch: "main",
  expected_main_sha: MAIN_SHA,
  expected_policy_fingerprint: `${policyPlan.policy_fingerprint}0`,
  confirm: GITHUB_REPOSITORY_POLICY_CONFIRMATION,
  capability_envelope_id: "env-policy-1",
});
assert.equal(applyPlanOverlongMain.apply_binding.expected_main_sha, null);
assert.equal(applyPlanOverlongMain.apply_binding.expected_main_sha_valid, false);
assert.equal(applyPlanOverlongFingerprint.apply_binding.expected_policy_fingerprint, null);
assert.equal(applyPlanOverlongFingerprint.apply_binding.expected_policy_fingerprint_valid, false);
assert.notEqual(applyPlanEnvelopeOne.plan_sha256, applyPlanOverlongMain.plan_sha256);
assert.notEqual(applyPlanEnvelopeOne.plan_sha256, applyPlanOverlongFingerprint.plan_sha256);

await assert.rejects(
  runGithubRepositoryPolicyController({
    mode: "apply",
    owner: OWNER,
    repo: REPO,
    expected_main_sha: `${MAIN_SHA}0`,
    expected_policy_fingerprint: policyPlan.policy_fingerprint,
    confirm: GITHUB_REPOSITORY_POLICY_CONFIRMATION,
  }, { auth: { caller_type: "admin" } }),
  (error) => error?.code === "github_repository_policy_expected_main_sha_required"
);
await assert.rejects(
  runGithubRepositoryPolicyController({
    mode: "apply",
    owner: OWNER,
    repo: REPO,
    expected_main_sha: MAIN_SHA,
    expected_policy_fingerprint: `${policyPlan.policy_fingerprint}0`,
    confirm: GITHUB_REPOSITORY_POLICY_CONFIRMATION,
  }, { auth: { caller_type: "admin" } }),
  (error) => error?.code === "github_repository_policy_fingerprint_required"
);

let invalidAutomationProviderCalls = 0;
await assert.rejects(
  runRepositoryAutomation({
    automation_key: "repository_policy",
    mode: "apply",
    owner: OWNER,
    repo: REPO,
    expected_main_sha: `${MAIN_SHA}0`,
    expected_policy_fingerprint: policyPlan.policy_fingerprint,
    confirm: GITHUB_REPOSITORY_POLICY_CONFIRMATION,
    capability_envelope_id: "env-policy-1",
  }, {
    persist: false,
    policyController: async () => {
      invalidAutomationProviderCalls += 1;
      return readback;
    },
  }),
  (error) => error?.code === "github_repository_policy_expected_main_sha_required"
);
assert.equal(invalidAutomationProviderCalls, 0, "Invalid Apply authority must fail before readback or provider access.");

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

const persistedIdempotencyKeys = [];
function persistencePool() {
  return {
    async query(sql, params = []) {
      if (sql.includes("SELECT run_id FROM repository_automation_runs")) {
        persistedIdempotencyKeys.push(params[0]);
      }
      return [[]];
    },
  };
}
const persistenceController = async (args) => {
  if (args.mode === "readback") return readback;
  if (args.mode === "apply") {
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
for (const capabilityEnvelopeId of ["env-policy-1", "env-policy-2"]) {
  await runRepositoryAutomation({
    automation_key: "repository_policy",
    mode: "apply",
    owner: OWNER,
    repo: REPO,
    default_branch: "main",
    expected_main_sha: MAIN_SHA,
    expected_policy_fingerprint: policyPlan.policy_fingerprint,
    confirm: GITHUB_REPOSITORY_POLICY_CONFIRMATION,
    capability_envelope_id: capabilityEnvelopeId,
    idempotency_key: "customer-retry-key",
  }, {
    persist: true,
    pool: persistencePool(),
    policyController: persistenceController,
    auth: { caller_type: "admin" },
  });
}
assert.equal(persistedIdempotencyKeys.length, 2);
assert.match(persistedIdempotencyKeys[0], /^repository-policy:[a-f0-9]{64}$/);
assert.match(persistedIdempotencyKeys[1], /^repository-policy:[a-f0-9]{64}$/);
assert.notEqual(persistedIdempotencyKeys[0], persistedIdempotencyKeys[1]);

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
assert.equal(capturedApply, null, "Missing typed confirmation must fail before readback or apply dispatch.");

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
  apply_idempotency_bound_to_main_policy_and_envelope: true,
  caller_supplied_idempotency_key_bound_to_plan_identity: true,
  overlong_authority_values_rejected_without_truncation: true,
  invalid_authority_inputs_have_distinct_plan_identity: true,
  invalid_apply_rejected_before_provider_readback: true,
  capability_envelope_reference_not_exposed: true,
  dry_run_default_no_mutation: true,
  typed_confirmation_not_invented: true,
  existing_control_plane_delegation_preserved: true,
  secrets_included: false,
}));
