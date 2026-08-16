import assert from "node:assert/strict";
import test from "node:test";
import {
  ADAPTERS,
  GATEWAY_WORKFLOW,
  loadRegistry,
  resolveCommandPlan,
  validateRegistry,
} from "../scripts/governed-command-core.mjs";

const ROOT = process.cwd();
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

function registryClone() {
  return structuredClone(loadRegistry(undefined, ROOT));
}

function expectRegistryFailure(mutator, pattern, adapters = ADAPTERS) {
  const registry = registryClone();
  mutator(registry);
  assert.throws(() => validateRegistry(registry, { rootDir: ROOT, adapters }), pattern);
}

test("canonical registry validates", () => {
  const result = validateRegistry(registryClone(), { rootDir: ROOT });
  assert.equal(result.commandCount, 2);
});

test("duplicate command ids fail closed", () => {
  expectRegistryFailure(
    (registry) => registry.commands.push(structuredClone(registry.commands[0])),
    /duplicate command id/,
  );
});

test("unknown adapter fails closed", () => {
  expectRegistryFailure(
    (registry) => { registry.commands[0].adapter = "arbitrary-shell"; },
    /unknown adapter/,
  );
});

test("unknown authority fails closed", () => {
  expectRegistryFailure(
    (registry) => { registry.commands[0].authority = "wildcard-admin"; },
    /unknown authority/,
  );
});

test("critical and elevated commands cannot drop SHA policy", () => {
  expectRegistryFailure(
    (registry) => { registry.commands[1].requires_sha_pin = false; },
    /must require a SHA pin/,
  );
});

test("registry cannot inject workflow targets", () => {
  expectRegistryFailure(
    (registry) => { registry.commands[0].target_workflow = "anything.yml"; },
    /unsupported field: target_workflow/,
  );
});

test("unbounded permission profile fails closed", () => {
  expectRegistryFailure(
    (registry) => { registry.commands[0].permission_profile = "write-all"; },
    /unbounded or unknown permission profile/,
  );
});

test("schema paths cannot escape the governed parameter contract directory", () => {
  expectRegistryFailure(
    (registry) => { registry.commands[0].parameter_schema = "../../payload.json"; },
    /must be under/,
  );
});

test("recursive gateway adapter targets fail closed", () => {
  const adapters = structuredClone(ADAPTERS);
  adapters["spec-kit-work-map-recovery"].targetWorkflow = GATEWAY_WORKFLOW;
  expectRegistryFailure(
    () => {},
    /recursive gateway dispatch is forbidden/,
    adapters,
  );
});

test("unregistered adapter workflow targets fail closed", () => {
  const adapters = structuredClone(ADAPTERS);
  adapters["spec-kit-work-map-recovery"].targetWorkflow = "arbitrary.yml";
  expectRegistryFailure(
    () => {},
    /unregistered execution target/,
    adapters,
  );
});

test("spec kit command resolves only to the authoritative recovery workflow", () => {
  const plan = resolveCommandPlan({
    registry: registryClone(),
    command: "spec_kit_work_map_recovery",
    parameters: { pr_number: "6934", expected_head_sha: SHA_B },
    authorization: "RECOVER_SPEC_KIT_WORK_MAP_AUTOFIX",
    expectedHeadSha: SHA_A,
    currentHeadSha: SHA_A,
    currentRef: "main",
    rootDir: ROOT,
  });

  assert.equal(plan.target_workflow, "spec-kit-work-map-autofix-recovery-dispatch.yml");
  assert.equal(plan.target_ref, "main");
  assert.equal(plan.inputs.confirmation, "RECOVER_SPEC_KIT_WORK_MAP_AUTOFIX");
  assert.equal(plan.evidence.direct_production_mutation, false);
});

test("unsupported command parameters fail closed", () => {
  assert.throws(() => resolveCommandPlan({
    registry: registryClone(),
    command: "spec_kit_work_map_recovery",
    parameters: { pr_number: "6934", expected_head_sha: SHA_B, workflow: "arbitrary.yml" },
    authorization: "RECOVER_SPEC_KIT_WORK_MAP_AUTOFIX",
    expectedHeadSha: SHA_A,
    currentHeadSha: SHA_A,
    currentRef: "main",
    rootDir: ROOT,
  }), /unsupported field: workflow/);
});

test("stale gateway SHA fails closed", () => {
  assert.throws(() => resolveCommandPlan({
    registry: registryClone(),
    command: "spec_kit_work_map_recovery",
    parameters: { pr_number: "6934", expected_head_sha: SHA_B },
    authorization: "RECOVER_SPEC_KIT_WORK_MAP_AUTOFIX",
    expectedHeadSha: SHA_A,
    currentHeadSha: SHA_B,
    currentRef: "main",
    rootDir: ROOT,
  }), /expected head SHA mismatch/);
});

test("non-main gateway execution fails closed", () => {
  assert.throws(() => resolveCommandPlan({
    registry: registryClone(),
    command: "spec_kit_work_map_recovery",
    parameters: { pr_number: "6934", expected_head_sha: SHA_B },
    authorization: "RECOVER_SPEC_KIT_WORK_MAP_AUTOFIX",
    expectedHeadSha: SHA_A,
    currentHeadSha: SHA_A,
    currentRef: "feat/not-main",
    rootDir: ROOT,
  }), /trusted main/);
});

test("typed authorization mismatch fails closed", () => {
  assert.throws(() => resolveCommandPlan({
    registry: registryClone(),
    command: "spec_kit_work_map_recovery",
    parameters: { pr_number: "6934", expected_head_sha: SHA_B },
    authorization: "RECOVER_SOMETHING_ELSE",
    expectedHeadSha: SHA_A,
    currentHeadSha: SHA_A,
    currentRef: "main",
    rootDir: ROOT,
  }), /authorization mismatch/);
});

test("unknown commands fail closed", () => {
  assert.throws(() => resolveCommandPlan({
    registry: registryClone(),
    command: "arbitrary_command",
    parameters: {},
    authorization: "ANYTHING",
    expectedHeadSha: SHA_A,
    currentHeadSha: SHA_A,
    currentRef: "main",
    rootDir: ROOT,
  }), /unknown command/);
});

test("production command resolves only to the existing governed launcher", () => {
  const plan = resolveCommandPlan({
    registry: registryClone(),
    command: "production_promotion_request",
    parameters: {
      request_pr: "7000",
      expected_head_sha: SHA_A,
      expected_request_head_sha: SHA_B,
      release_branch_prefix: "release/production-candidate",
      validation_branch_prefix: "release/production-validation",
      validation_base_branch_prefix: "release/production-validation-base",
      review_mode: "ai_policy",
    },
    authorization: "AUTHORIZE_GOVERNED_PRODUCTION_PROMOTION_REQUEST",
    expectedHeadSha: SHA_A,
    currentHeadSha: SHA_A,
    currentRef: "main",
    rootDir: ROOT,
  });

  assert.equal(plan.target_workflow, "governed-production-promotion-request-launcher.yml");
  assert.equal(plan.target_ref, "main");
  assert.equal(plan.evidence.direct_production_mutation, false);
  assert.equal(plan.inputs.review_mode, "ai_policy");
  assert.deepEqual(Object.keys(plan.inputs).sort(), [
    "confirmation",
    "expected_head_sha",
    "expected_request_head_sha",
    "release_branch_prefix",
    "request_pr",
    "review_mode",
    "validation_base_branch_prefix",
    "validation_branch_prefix",
  ]);
});

test("AI policy review mode is restricted to registered values", () => {
  assert.throws(() => resolveCommandPlan({
    registry: registryClone(),
    command: "production_promotion_request",
    parameters: {
      request_pr: "7000",
      expected_head_sha: SHA_A,
      expected_request_head_sha: SHA_B,
      release_branch_prefix: "release/production-candidate",
      validation_branch_prefix: "release/production-validation",
      validation_base_branch_prefix: "release/production-validation-base",
      review_mode: "autonomous_merge",
    },
    authorization: "AUTHORIZE_GOVERNED_PRODUCTION_PROMOTION_REQUEST",
    expectedHeadSha: SHA_A,
    currentHeadSha: SHA_A,
    currentRef: "main",
    rootDir: ROOT,
  }), /does not match its required pattern/);
});

test("reference adapters bind protected-branch guard to the exact target PR head", () => {
  const specPlan = resolveCommandPlan({
    registry: registryClone(),
    command: "spec_kit_work_map_recovery",
    parameters: { pr_number: "6934", expected_head_sha: SHA_B },
    authorization: "RECOVER_SPEC_KIT_WORK_MAP_AUTOFIX",
    expectedHeadSha: SHA_A,
    currentHeadSha: SHA_A,
    currentRef: "main",
    rootDir: ROOT,
  });
  assert.deepEqual(specPlan.protected_branch_guard, {
    pr_number: "6934",
    expected_pr_head_sha: SHA_B,
    required_base_ref: "main",
    require_same_repository: true,
    forbidden_branches: ["main", "Production"],
  });
});

test("production reference command must pin the gateway trusted main SHA", () => {
  assert.throws(() => resolveCommandPlan({
    registry: registryClone(),
    command: "production_promotion_request",
    parameters: {
      request_pr: "7000",
      expected_head_sha: SHA_B,
      expected_request_head_sha: SHA_B,
      release_branch_prefix: "release/production-candidate",
      validation_branch_prefix: "release/production-validation",
      validation_base_branch_prefix: "release/production-validation-base",
      review_mode: "ai_policy",
    },
    authorization: "AUTHORIZE_GOVERNED_PRODUCTION_PROMOTION_REQUEST",
    expectedHeadSha: SHA_A,
    currentHeadSha: SHA_A,
    currentRef: "main",
    rootDir: ROOT,
  }), /same trusted main SHA/);
});
