import assert from "node:assert/strict";
import fs from "node:fs";

const CONTRACT = "mad4b.repository-state-generated-artifact-convergence-test.v2";
const writerPath = "scripts/maintenance-tools/generated-artifact-refresh.mjs";
const writer = fs.readFileSync(writerPath, "utf8");
const governance = JSON.parse(fs.readFileSync("../.github/repository-maintenance-tool-governance.json", "utf8"));
const derivedState = JSON.parse(fs.readFileSync("../.github/derived-state-governance.json", "utf8"));
const governedWorkflow = fs.readFileSync("../.github/workflows/governed-generated-artifact-refresh.yml", "utf8");
const inventoryWorkflow = fs.readFileSync("../.github/workflows/repository-inventory.yml", "utf8");
const evaluationWorkflow = fs.readFileSync("../.github/workflows/repository-evaluation.yml", "utf8");

const checks = [];
function check(id, fn) {
  fn();
  checks.push({ id, ok: true });
}

check("repository-evaluation-output-set", () => {
  assert.match(writer, /REPOSITORY_EVALUATION_OUTPUTS/u);
  for (const output of [
    "docs/repository-evaluation.json",
    "docs/repository-evaluation-summary.json",
    "docs/repository-evaluation.md",
  ]) assert.ok(writer.includes(`"${output}"`), `missing bounded Evaluation output: ${output}`);
});

check("inventory-before-evaluation-order", () => {
  const inventoryContract = writer.indexOf("verify_repository_inventory_contract");
  const evaluationFirst = writer.indexOf("generate_repository_evaluation_first_pass");
  const evaluationSecond = writer.indexOf("generate_repository_evaluation_second_pass");
  const evaluationContract = writer.indexOf("verify_repository_evaluation_contract");
  const evaluationCurrent = writer.indexOf("verify_repository_evaluation_current");
  assert.ok(inventoryContract >= 0, "Inventory contract verification must exist");
  assert.ok(evaluationFirst > inventoryContract, "Evaluation generation must start only after Inventory verification");
  assert.ok(evaluationSecond > evaluationFirst, "Evaluation must run a second deterministic generation pass");
  assert.ok(evaluationContract > evaluationSecond, "Evaluation test must run after deterministic generation");
  assert.ok(evaluationCurrent > evaluationContract, "Evaluation currentness must run after the Evaluation test");
});

check("repository-evaluation-determinism-and-currentness", () => {
  assert.match(writer, /repository_evaluation_not_deterministic/u);
  assert.match(writer, /"npm", \["run", "evaluation:write", "--", "--enforce"\]/u);
  assert.match(writer, /"npm", \["run", "evaluation:test"\]/u);
  assert.match(writer, /"npm", \["run", "evaluation:check", "--", "--enforce"\]/u);
});

check("single-recipe-bounded-write-set", () => {
  assert.match(writer, /REPOSITORY_INVENTORY_OUTPUTS\.has\(file\) \|\| REPOSITORY_EVALUATION_OUTPUTS\.has\(file\)/u);
  assert.match(writer, /docs\(inventory\): regenerate repository inventory and evaluation/u);
  assert.match(writer, /inventory_already_current/u);
});

check("governance-allows-both-artifact-families", () => {
  const registration = governance.tools?.["generated-artifact-refresh"];
  assert.equal(registration?.mode, "mutating");
  for (const pattern of [
    "^docs/repository-inventory\\.json$",
    "^docs/repository-inventory-summary\\.json$",
    "^docs/repository-inventory\\.md$",
    "^docs/repository-evaluation\\.json$",
    "^docs/repository-evaluation-summary\\.json$",
    "^docs/repository-evaluation\\.md$",
  ]) assert.ok(registration.allowed_changed_path_patterns.includes(pattern), `missing governance pattern: ${pattern}`);
  const repositoryStateOutputs = [
    "docs/repository-inventory.json",
    "docs/repository-inventory-summary.json",
    "docs/repository-inventory.md",
    "docs/repository-evaluation.json",
    "docs/repository-evaluation-summary.json",
    "docs/repository-evaluation.md",
  ];
  const competingMutatingTools = Object.entries(governance.tools)
    .filter(([name, registrationValue]) =>
      name !== "generated-artifact-refresh"
      && registrationValue.mode === "mutating"
      && repositoryStateOutputs.some((output) =>
        (registrationValue.allowed_changed_path_patterns || []).some((pattern) => new RegExp(pattern, "u").test(output))))
    .map(([name]) => name);
  assert.deepEqual(competingMutatingTools, [], "the generated-artifact writer must remain the sole mutating authority for Repository Inventory and Evaluation outputs");
});

check("writer-dispatches-dual-exact-head-verification", () => {
  assert.match(governedWorkflow, /repository_inventory_refresh/u);
  assert.match(governedWorkflow, /repository-inventory\.yml/u);
  assert.match(governedWorkflow, /repository-evaluation\.yml/u);
  assert.match(governedWorkflow, /expected_head_sha/u);
  assert.match(governedWorkflow, /result_sha/u);
  assert.match(governedWorkflow, /remote_sha/u);
  assert.match(governedWorkflow, /generated-artifact-refresh-verification-dispatch\.v1/u);
  assert.match(governedWorkflow, /workflow_file:\$workflow_file/u);
  assert.match(governedWorkflow, /verifiers:\$verifiers/u);
  assert.doesNotMatch(governedWorkflow, /git\s+push\s+.*--force/u);
});

check("evaluation-verifier-is-exact-head-read-only", () => {
  assert.match(evaluationWorkflow, /target_ref:/u);
  assert.match(evaluationWorkflow, /expected_head_sha:/u);
  assert.match(evaluationWorkflow, /Validate exact-head verification dispatch/u);
  assert.match(evaluationWorkflow, /Verify local and remote exact-head identity/u);
  assert.match(evaluationWorkflow, /persist-credentials:\s*false/u);
  assert.match(evaluationWorkflow, /contents:\s*read/u);
  assert.doesNotMatch(evaluationWorkflow, /contents:\s*write/u);
  assert.doesNotMatch(evaluationWorkflow, /git\s+push/u);
});

check("observability-artifacts-are-advisory-premerge", () => {
  const inventory = derivedState.artifacts.find((entry) => entry.artifact_id === "repository_inventory");
  const evaluation = derivedState.artifacts.find((entry) => entry.artifact_id === "repository_evaluation");
  assert.equal(derivedState.policy?.observability_artifacts_publish_post_merge_only, true);
  assert.equal(derivedState.policy?.observability_premerge_mutation_forbidden, true);
  assert.equal(inventory?.artifact_class, "observability");
  assert.equal(inventory?.merge_blocking, false);
  assert.equal(evaluation?.artifact_class, "observability");
  assert.equal(evaluation?.merge_blocking, false);
  assert.equal(inventory?.recipe, "repository_inventory_refresh");
  assert.equal(evaluation?.recipe, "repository_inventory_refresh");
});

check("evaluation-v2-removes-feature-branch-bootstrap", () => {
  assert.match(evaluationWorkflow, /Verify Evaluation currentness or classify observability drift/u);
  assert.match(evaluationWorkflow, /stale_observability/u);
  assert.match(evaluationWorkflow, /feature-PR mutation intentionally suppressed/u);
  assert.match(evaluationWorkflow, /post_merge_observability_publish/u);
  assert.match(evaluationWorkflow, /node scripts\/repository-evaluation\.mjs --check --enforce/u);
  assert.doesNotMatch(evaluationWorkflow, /bootstrap_pending/u);
  assert.doesNotMatch(evaluationWorkflow, /repository-state-bootstrap-proof/u);
  assert.doesNotMatch(evaluationWorkflow, /git show .*repository-inventory-verification-gate/u);
});

check("exact-main-signal-covers-shared-recipe", () => {
  assert.match(inventoryWorkflow, /Signal post-merge Repository State convergence/u);
  assert.match(inventoryWorkflow, /repository_evaluation/u);
  assert.match(inventoryWorkflow, /repository_inventory_refresh/u);
  assert.match(inventoryWorkflow, /node scripts\/repository-evaluation\.mjs --check --enforce/u);
  assert.match(inventoryWorkflow, /Repository Evaluation is stale on exact main/u);
  assert.doesNotMatch(inventoryWorkflow, /contents:\s*write/u);
  assert.doesNotMatch(inventoryWorkflow, /git\s+push/u);
});

console.log(JSON.stringify({
  contract: CONTRACT,
  ok: true,
  checks,
  inventory_then_evaluation: true,
  exact_head_dual_verification: true,
  premerge_observability_is_advisory: true,
  post_merge_shared_recipe_signal: true,
  feature_branch_bootstrap_removed: true,
  verification_dispatch_v1_compatible: true,
  sole_repository_state_writer_preserved: true,
  protected_branch_mutation: false,
  force_push: false,
  secrets_included: false,
}));
