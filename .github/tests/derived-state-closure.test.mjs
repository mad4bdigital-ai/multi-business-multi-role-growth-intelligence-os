import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const registry = JSON.parse(fs.readFileSync(path.join(root, ".github/derived-state-governance.json"), "utf8"));
const workflow = fs.readFileSync(path.join(root, ".github/workflows/derived-state-closure.yml"), "utf8");
const repairWorkflowPath = ".github/workflows/derived-state-repair-dispatch.yml";
const automergeWorkflowPath = ".github/workflows/derived-state-converged-automerge.yml";
const mainConvergencePublisherPath = ".github/workflows/derived-state-main-convergence-publisher.yml";
const repairWorkflow = fs.readFileSync(path.join(root, repairWorkflowPath), "utf8");
const automergeWorkflow = fs.readFileSync(path.join(root, automergeWorkflowPath), "utf8");
const mainConvergencePublisher = fs.readFileSync(path.join(root, mainConvergencePublisherPath), "utf8");
const scriptPath = "scripts/derived-state-closure.mjs";
const script = fs.readFileSync(path.join(root, scriptPath), "utf8");
const stagingWorkflow = fs.readFileSync(path.join(root, ".github/workflows/staging-main-deploy-eligibility.yml"), "utf8");
const prRefreshWorkflow = fs.readFileSync(path.join(root, ".github/workflows/pr-generated-artifact-refresh.yml"), "utf8");
const workMapRecoveryWorkflowPath = ".github/workflows/spec-kit-work-map-autofix-recovery-dispatch.yml";
const workMapWriterWorkflowPath = ".github/workflows/spec-kit-work-map-autofix.yml";
const workMapRecoveryWorkflow = fs.readFileSync(path.join(root, workMapRecoveryWorkflowPath), "utf8");

assert.equal(registry.contract, "mad4b.repository-derived-state-governance.v1");
assert.equal(registry.policy.all_pull_requests_to_main_must_be_checked, true);
assert.equal(registry.policy.path_filtering_for_closure_forbidden, true);
assert.equal(registry.policy.branch_prefix_dependency_inference_forbidden, true);
assert.equal(registry.policy.detection_mode, "read_only");
assert.equal(registry.policy.mutation_mode, "separate_governed_writer");
assert.equal(registry.policy.protected_branch_mutation_forbidden, true);
assert.equal(registry.server_enforcement.main.required_checks.includes("Derived State Closure"), true);
assert.equal(registry.server_enforcement.Production.same_sha_closure_required, true);

assert.equal(registry.max_convergence_passes, 3);
assert.equal(registry.convergence.orchestration_mode, "workflow_run_one_authority_per_pass");
assert.equal(registry.convergence.repair_dispatch_workflow, repairWorkflowPath);
assert.equal(registry.convergence.auto_merge_workflow, automergeWorkflowPath);
assert.equal(registry.convergence.post_merge_publisher_workflow, mainConvergencePublisherPath);
assert.equal(registry.convergence.one_repair_authority_per_pass, true);
assert.equal(registry.convergence.auto_merge_requires_current_head_convergence_receipt, true);
assert.equal(registry.convergence.receipt_must_bind_result_head, true);
assert.equal(registry.convergence.closure_reverification_mode, "exact_merge_candidate_workflow_dispatch");
assert.equal(registry.convergence.automation_control_surface_changes_require_manual_review, true);
assert.equal(registry.convergence.repair_receipt_contract, "mad4b.derived-state-repair-dispatch.v1");
assert.equal(registry.convergence.main_convergence_receipt_contract, "mad4b.derived-state-main-convergence.v1");
assert.equal(registry.convergence.automerge_receipt_contract, "mad4b.derived-state-automerge.v1");
assert.equal(registry.convergence.post_merge_publishable_recipes.includes("repository_inventory_refresh"), true);
for (const controlPath of [
  ".github/derived-state-governance.json",
  ".github/tests/derived-state-closure.test.mjs",
  ".github/workflows/derived-state-closure.yml",
  repairWorkflowPath,
  automergeWorkflowPath,
  mainConvergencePublisherPath,
  "scripts/derived-state-closure.mjs",
  ".github/workflows/governed-generated-artifact-refresh.yml",
  ".github/workflows/spec-kit-work-map-recovery-bootstrap.yml",
  ".github/workflows/spec-kit-work-map-autofix-recovery-dispatch.yml",
  ".github/workflows/spec-kit-work-map-autofix.yml",
]) {
  assert.equal(registry.convergence.automation_control_paths.includes(controlPath), true, `missing automation control path ${controlPath}`);
}

const artifactIds = registry.artifacts.map((entry) => entry.artifact_id);
assert.equal(new Set(artifactIds).size, artifactIds.length);
for (const required of ["repository_inventory", "repository_evaluation", "remote_mcp_write_scope_inventory", "frontend_openapi_projection", "work_maps", "portable_staging_manifest"]) {
  assert.equal(artifactIds.includes(required), true, `missing registered derived-state family ${required}`);
}
const remote = registry.artifacts.find((entry) => entry.artifact_id === "remote_mcp_write_scope_inventory");
assert.equal(remote.dependency_scope.some((entry) => entry.type === "git_index_shape"), true);
const workMaps = registry.artifacts.find((entry) => entry.artifact_id === "work_maps");
assert.equal(workMaps.recipe, undefined);
assert.equal(workMaps.repair_authority?.id, "spec_kit_work_map_autofix");
assert.equal(workMaps.repair_authority?.kind, "delegated_work_map_writer");
assert.equal(workMaps.repair_authority?.workflow, workMapRecoveryWorkflowPath);
assert.equal(workMaps.repair_authority?.writer_workflow, workMapWriterWorkflowPath);
assert.notEqual(workMaps.repair_authority?.id, "work_map_self_hosting_bootstrap");
assert.match(workMapRecoveryWorkflow, /RECOVER_SPEC_KIT_WORK_MAP_AUTOFIX/u);
assert.match(workMapRecoveryWorkflow, /authorization_consumed/u);
assert.match(workMapRecoveryWorkflow, /spec-kit-work-map-autofix\.yml/u);

assert.match(workflow, /name:\s*Derived State Closure/u);
assert.match(workflow, /pull_request:\s*\n\s*branches:\s*\[main\]/u);
assert.doesNotMatch(workflow, /\n\s*paths:/u);
assert.match(workflow, /workflow_dispatch:/u);
assert.match(workflow, /pr_number:/u);
assert.match(workflow, /expected_head_sha:/u);
assert.match(workflow, /merge_commit_sha/u);
assert.match(workflow, /github_merge_candidate/u);
assert.match(workflow, /compare\/main\.\.\./u);
assert.match(workflow, /contents:\s*read/u);
assert.match(workflow, /pull-requests:\s*read/u);
assert.match(workflow, /persist-credentials:\s*false/u);
assert.doesNotMatch(workflow, /contents:\s*write/u);
assert.doesNotMatch(workflow, /git\s+push/u);
assert.match(workflow, /scripts\/derived-state-closure\.mjs/u);
assert.match(workflow, /--source-head-sha/u);
assert.match(workflow, /--base-sha/u);

assert.match(prRefreshWorkflow, /branches:\s*\[main\]/u);
assert.doesNotMatch(prRefreshWorkflow, /\n\s*paths:/u);
assert.match(prRefreshWorkflow, /CI_CLOSURE_CANDIDATE_SHA/u);
assert.match(prRefreshWorkflow, /persist-credentials:\s*false/u);
assert.doesNotMatch(prRefreshWorkflow, /contents:\s*write/u);
assert.match(prRefreshWorkflow, /scripts\/derived-state-closure\.mjs/u);

assert.match(stagingWorkflow, /Verify repository derived-state closure/u);
assert.match(stagingWorkflow, /--candidate-kind "exact_main"/u);
assert.match(stagingWorkflow, /derived_state_closure: true/u);
assert.match(stagingWorkflow, /scripts\/derived-state-closure\.mjs/u);

assert.match(script, /Read-only CI verifier/u);
assert.match(script, /git status/u);
assert.match(script, /verifierMutation/u);
assert.match(script, /repair_authorities/u);
assert.match(script, /repair_recipes/u);
assert.match(script, /generated_artifact_recipe/u);
assert.match(script, /delegated_work_map_writer/u);
assert.match(script, /pr_number/u);
assert.match(script, /source_head_sha/u);
assert.match(script, /base_sha/u);
assert.doesNotMatch(script, /git\s+push/u);
assert.doesNotMatch(script, /update-ref/u);
assert.doesNotMatch(script, /--apply/u);

assert.match(repairWorkflow, /workflow_run:/u);
assert.match(repairWorkflow, /\.github\/workflows\/derived-state-closure\.yml/u);
assert.match(repairWorkflow, /workflows:\s*\n\s*-\s*Derived State Closure/u);
assert.match(repairWorkflow, /conclusion == 'failure'/u);
assert.match(repairWorkflow, /\.repair_authorities\[0\]/u);
assert.match(repairWorkflow, /max_convergence_passes/u);
assert.match(repairWorkflow, /automation_control_paths/u);
assert.match(repairWorkflow, /governed-generated-artifact-refresh\.yml\/dispatches/u);
assert.match(repairWorkflow, /spec-kit-work-map-autofix-recovery-dispatch\.yml\/dispatches/u);
assert.match(repairWorkflow, /WORK_MAP_AUTHORIZATION_MARKER/u);
assert.match(repairWorkflow, /source_run_already_dispatched/u);
assert.match(repairWorkflow, /result_head_sha=/u);
assert.match(repairWorkflow, /closure_reverification_requested=true/u);
assert.match(repairWorkflow, /derived-state-closure\.yml\/dispatches/u);
assert.match(repairWorkflow, /ci\.yml\/dispatches|workflows\/\$\{workflow\}\/dispatches/u);
assert.match(repairWorkflow, /e2e-phase-governance\.yml/u);
assert.match(repairWorkflow, /writer_run_id/u);
assert.match(repairWorkflow, /DERIVED_STATE_REPAIR_DISPATCH/u);
assert.match(repairWorkflow, /behind_by/u);
assert.match(repairWorkflow, /protected_branch_mutation=false/u);
assert.match(repairWorkflow, /force_push=false/u);
assert.doesNotMatch(repairWorkflow, /git\s+push/u);
assert.doesNotMatch(repairWorkflow, /--admin/u);

assert.match(automergeWorkflow, /workflow_run:/u);
assert.match(automergeWorkflow, /\.github\/workflows\/derived-state-closure\.yml/u);
assert.match(automergeWorkflow, /conclusion == 'success'/u);
assert.match(automergeWorkflow, /auto_merge_requires_current_head_convergence_receipt/u);
assert.match(automergeWorkflow, /receipt_must_bind_result_head/u);
assert.match(automergeWorkflow, /result_head_sha=/u);
assert.match(automergeWorkflow, /DERIVED_STATE_REPAIR_DISPATCH/u);
assert.match(automergeWorkflow, /DERIVED_STATE_MAIN_CONVERGENCE/u);
assert.match(automergeWorkflow, /automation_control_paths/u);
assert.match(automergeWorkflow, /automerge_opt_out_labels/u);
assert.match(automergeWorkflow, /gh pr merge/u);
assert.match(automergeWorkflow, /--auto/u);
assert.match(automergeWorkflow, /--match-head-commit/u);
assert.match(automergeWorkflow, /compare\/main\.\.\./u);
assert.match(automergeWorkflow, /merge_commit_sha/u);
assert.doesNotMatch(automergeWorkflow, /git\s+push/u);
assert.doesNotMatch(automergeWorkflow, /--admin/u);

assert.match(mainConvergencePublisher, /Governed Generated Artifact Refresh/u);
assert.match(mainConvergencePublisher, /\.github\/workflows\/governed-generated-artifact-refresh\.yml/u);
assert.match(mainConvergencePublisher, /create_from_main/u);
assert.match(mainConvergencePublisher, /post_merge_publishable_recipes/u);
assert.match(mainConvergencePublisher, /repository-inventory-main-sync/u);
assert.match(mainConvergencePublisher, /gh pr create/u);
assert.match(mainConvergencePublisher, /DERIVED_STATE_MAIN_CONVERGENCE/u);
assert.match(mainConvergencePublisher, /head_sha=\$\{RESULT_HEAD_SHA\}/u);
assert.match(mainConvergencePublisher, /protected_branch_mutation=false/u);
assert.match(mainConvergencePublisher, /force_push=false/u);
assert.doesNotMatch(mainConvergencePublisher, /git\s+push/u);
assert.doesNotMatch(mainConvergencePublisher, /gh pr merge/u);

console.log(JSON.stringify({
  ok: true,
  contract: registry.contract,
  artifact_count: registry.artifacts.length,
  read_only_detector: true,
  one_authority_per_pass: true,
  bounded_automatic_repair: true,
  exact_merge_candidate_reverification: true,
  current_head_convergence_receipt_required: true,
  exact_head_automerge_guard: true,
  no_admin_bypass: true,
  post_merge_inventory_publisher: true,
}));
