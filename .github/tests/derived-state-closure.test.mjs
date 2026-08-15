import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const registry = JSON.parse(fs.readFileSync(path.join(root, ".github/derived-state-governance.json"), "utf8"));
const maintenancePolicy = JSON.parse(fs.readFileSync(path.join(root, ".github/repository-maintenance-tool-governance.json"), "utf8"));
const workflow = fs.readFileSync(path.join(root, ".github/workflows/derived-state-closure.yml"), "utf8");
const scriptPath = "http-generic-api/scripts/maintenance-tools/derived-state-closure.mjs";
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

const closureAuthority = maintenancePolicy.tools?.["derived-state-closure"];
assert.equal(closureAuthority?.entrypoint, scriptPath);
assert.equal(closureAuthority?.mode, "read_only");
assert.equal(closureAuthority?.report_contract, "mad4b.repository-derived-state-closure.v1");

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
assert.match(workMapRecoveryWorkflow, /expected_head_sha/u);
assert.match(workMapRecoveryWorkflow, /behind_by/u);
assert.match(workMapRecoveryWorkflow, /authorization_consumed/u);
assert.match(workMapRecoveryWorkflow, /spec-kit-work-map-autofix\.yml/u);

assert.match(workflow, /name:\s*Derived State Closure/u);
assert.match(workflow, /pull_request:\s*\n\s*branches:\s*\[main\]/u);
assert.doesNotMatch(workflow, /\n\s*paths:/u);
assert.doesNotMatch(workflow, /startsWith\([^\n]*head\.ref/u);
assert.match(workflow, /contents:\s*read/u);
assert.match(workflow, /persist-credentials:\s*false/u);
assert.doesNotMatch(workflow, /contents:\s*write/u);
assert.doesNotMatch(workflow, /git\s+push/u);
assert.match(workflow, /DERIVED_STATE_EXPECTED_SHA/u);
assert.match(workflow, /github\.sha/u);
assert.match(workflow, /http-generic-api\/scripts\/maintenance-tools\/derived-state-closure\.mjs/u);

assert.match(prRefreshWorkflow, /branches:\s*\[main\]/u);
assert.doesNotMatch(prRefreshWorkflow, /\n\s*paths:/u);
assert.doesNotMatch(prRefreshWorkflow, /startsWith\([^\n]*head\.ref/u);
assert.match(prRefreshWorkflow, /CI_CLOSURE_CANDIDATE_SHA/u);
assert.match(prRefreshWorkflow, /github\.sha/u);
assert.match(prRefreshWorkflow, /persist-credentials:\s*false/u);
assert.doesNotMatch(prRefreshWorkflow, /contents:\s*write/u);
assert.match(prRefreshWorkflow, /http-generic-api\/scripts\/maintenance-tools\/derived-state-closure\.mjs/u);

assert.match(stagingWorkflow, /Verify repository derived-state closure/u);
assert.match(stagingWorkflow, /--candidate-kind "exact_main"/u);
assert.match(stagingWorkflow, /derived_state_closure: true/u);
assert.match(stagingWorkflow, /http-generic-api\/scripts\/maintenance-tools\/derived-state-closure\.mjs/u);

assert.match(script, /git status/u);
assert.match(script, /verifierMutation/u);
assert.match(script, /repair_authorities/u);
assert.match(script, /repair_recipes/u);
assert.match(script, /generated_artifact_recipe/u);
assert.match(script, /delegated_work_map_writer/u);
assert.doesNotMatch(script, /git\s+push/u);
assert.doesNotMatch(script, /update-ref/u);
assert.doesNotMatch(script, /--apply/u);

console.log(JSON.stringify({ ok: true, contract: registry.contract, artifact_count: registry.artifacts.length, read_only: true, registered_authority: true, branch_prefix_dependency_inference: false, truthful_work_map_repair_authority: true }));
