import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const registry = JSON.parse(fs.readFileSync(path.join(root, ".github/derived-state-governance.json"), "utf8"));
const workflow = fs.readFileSync(path.join(root, ".github/workflows/derived-state-closure.yml"), "utf8");
const repair = fs.readFileSync(path.join(root, ".github/workflows/derived-state-repair-dispatch.yml"), "utf8");
const automerge = fs.readFileSync(path.join(root, ".github/workflows/derived-state-converged-automerge.yml"), "utf8");
const inventoryDispatch = fs.readFileSync(path.join(root, ".github/workflows/repository-inventory-autofix-dispatch.yml"), "utf8");
const script = fs.readFileSync(path.join(root, "scripts/derived-state-closure.mjs"), "utf8");
const inventoryGate = fs.readFileSync(path.join(root, "scripts/repository-inventory-verification-gate.mjs"), "utf8");

assert.equal(registry.contract, "mad4b.repository-derived-state-governance.v1");
assert.equal(registry.policy.main_requires_zero_stale_registered_artifacts, false);
assert.equal(registry.policy.main_requires_zero_stale_blocking_semantic_artifacts, true);
assert.equal(registry.policy.observability_artifacts_publish_post_merge_only, true);
assert.equal(registry.policy.observability_premerge_mutation_forbidden, true);
assert.equal(registry.repository_governance.dynamic_objection_mode, "typed_policy_objections");
assert.equal(registry.repository_governance.derived_dependency_execution_topological, true);
assert.equal(registry.convergence.repair_order, "derived_dependency_topological_order");
assert.equal(registry.convergence.draft_pr_repair_allowed, true);
assert.equal(registry.convergence.draft_pr_automerge_forbidden, true);
assert.equal(registry.convergence.automation_control_surface_changes_require_manual_merge, true);
assert.equal(registry.server_enforcement.activation_guard, "trusted_evidence_finalizer_and_live_readback");

const ids = registry.artifacts.map((entry) => entry.artifact_id);
assert.equal(new Set(ids).size, ids.length);
for (const artifact of registry.artifacts) {
  assert.ok(["semantic", "observability"].includes(artifact.artifact_class));
  assert.equal(typeof artifact.merge_blocking, "boolean");
  if (artifact.artifact_class === "observability") assert.equal(artifact.merge_blocking, false);
  if (artifact.artifact_class === "semantic") assert.equal(artifact.merge_blocking, true);
}
assert.equal(registry.artifacts.find((entry) => entry.artifact_id === "repository_inventory").artifact_class, "observability");
assert.equal(registry.artifacts.find((entry) => entry.artifact_id === "repository_evaluation").artifact_class, "observability");
assert.equal(registry.artifacts.find((entry) => entry.artifact_id === "remote_mcp_write_scope_inventory").dependency_scope.some((entry) => entry.type === "git_index_shape"), false);

assert.match(script, /topologicalArtifacts/u);
assert.match(script, /execution_order/u);
assert.match(script, /blocking_stale_or_failed_artifact_count/u);
assert.match(script, /observability_stale_or_failed_artifact_count/u);
assert.match(script, /advisory_repair_authorities/u);
assert.doesNotMatch(script, /git\s+push/u);

assert.match(workflow, /name:\s*Derived State Closure/u);
assert.match(workflow, /repository-governance-objection-gate\.mjs/u);
assert.match(workflow, /repository-governance-evidence-finalizer\.mjs/u);
assert.match(workflow, /evidence-producers\.json/u);
assert.match(workflow, /continue-on-error:\s*true/u);
assert.match(workflow, /blocking_count/u);
assert.doesNotMatch(workflow, /\n\s*paths:/u);

assert.match(repair, /Draft is intentionally allowed for bounded repair/u);
assert.doesNotMatch(repair, /\.draft.*false/u);
assert.match(repair, /\.repair_authorities\[0\]/u);
assert.match(repair, /generated_artifact_recipe/u);
assert.match(repair, /delegated_work_map_writer/u);
assert.match(repair, /RECOVER_SPEC_KIT_WORK_MAP_AUTOFIX/u);
assert.match(repair, /topological_order=true/u);
assert.doesNotMatch(repair, /git\s+push/u);

assert.match(automerge, /blocking_stale_or_failed_artifact_count/u);
assert.match(automerge, /blocking_count/u);
assert.match(automerge, /manual_count/u);
assert.match(automerge, /automerge_allowed/u);
assert.match(automerge, /test "\$\(jq -r '\.draft'/u);
assert.match(automerge, /--match-head-commit/u);
assert.doesNotMatch(automerge, /test .*stale_or_failed_artifact_count/u);

assert.match(inventoryDispatch, /observability_premerge_mutation_forbidden/u);
assert.match(inventoryDispatch, /feature-PR mutation intentionally suppressed/u);
assert.match(inventoryDispatch, /create_from_main:"true"/u);
assert.doesNotMatch(inventoryDispatch, /create_from_main:"false"/u);

assert.match(inventoryGate, /artifact_class === "observability"/u);
assert.match(inventoryGate, /merge_blocking === false/u);
assert.match(inventoryGate, /post_merge_observability_publish/u);
assert.match(inventoryGate, /process\.exit\(0\)/u);

console.log(JSON.stringify({
  ok: true,
  contract: registry.contract,
  topological_derived_state: true,
  observability_premerge_mutation_forbidden: true,
  draft_repair_allowed: true,
  objection_driven_automerge: true
}));
