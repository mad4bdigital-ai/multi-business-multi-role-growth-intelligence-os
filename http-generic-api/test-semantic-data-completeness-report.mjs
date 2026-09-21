import assert from "node:assert/strict";
import {buildSemanticDataCompletenessReport} from "./semanticDataCompletenessReport.js";

const initial=buildSemanticDataCompletenessReport({observations:{workspace_registry:{present:true,cardinality:1,readback_status:"ready"}}});
assert.equal(initial.contract,"mad4b.semantic-data-completeness-report.v3");
assert.equal(initial.artifact_dependency_graph.contract,"mad4b.canonical-semantic-artifact-dag-status.v1");
assert.equal(initial.artifact_dependency_graph.complete,true);
assert.ok(initial.artifact_dependency_graph.topological_order.indexOf("runtime_canonical_registry_snapshot")<initial.artifact_dependency_graph.topological_order.indexOf("platform_admin_workspace"));
assert.equal(initial.unresolved_replay_debt_count,0);
assert.equal(initial.unresolved_replay_debt.length,0);
assert.equal(initial.complete,false);
assert.ok(initial.not_ready_canonical_dataset_count>0);
const workspace=initial.datasets.find((item)=>item.dataset_key==="workspace_registry");
assert.equal(workspace.replayability,"replayable");assert.equal(workspace.present,true);assert.equal(workspace.cardinality,1);assert.equal(workspace.readback_status,"ready");
assert.equal(workspace.dependency_status,"ready");
assert.deepEqual(workspace.canonical_artifact_dependencies,["runtime_canonical_registry_snapshot"]);
for(const key of ["tenant_platform_endpoint_tools","platform_endpoint_tool_exports","activation_connector_pack_registry","activation_delivery_policy_registry"]){
  const dataset=initial.datasets.find((item)=>item.dataset_key===key);
  assert.ok(dataset,key);assert.equal(dataset.replayability,"replayable");assert.equal(dataset.replay_strategy,"disposable_git_semantic_snapshot");
  assert.equal(dataset.canonical_artifact_keys.includes("runtime_canonical_registry_snapshot"),true);
}
const activationFamily=initial.families.find((item)=>item.pattern==="^activation_.*_registry$");
assert.ok(activationFamily);assert.equal(activationFamily.replayability,"guard_only");assert.equal(activationFamily.unregistered_family_member_policy,"fail_closed");
const connected=initial.datasets.find((item)=>item.dataset_key==="connected_systems");
assert.equal(connected.external_reprovision_required,true);assert.equal(connected.repair_required,false);
const memberships=initial.datasets.find((item)=>item.dataset_key==="memberships");
assert.equal(memberships.operational_reseed_forbidden,true);assert.equal(memberships.repair_required,false);

const observations=Object.fromEntries(initial.datasets
  .filter((item)=>item.lifecycle_class==="canonical_registry"||item.lifecycle_class==="mixed")
  .map((item)=>[item.dataset_key,{present:true,cardinality:1,readback_status:"ready"}]));
const ready=buildSemanticDataCompletenessReport({observations});
assert.equal(ready.unresolved_replay_debt_count,0);
assert.equal(ready.not_ready_canonical_dataset_count,0);
assert.equal(ready.complete,true);
assert.equal(ready.database_mutation_performed,false);assert.equal(ready.production_mutation_performed,false);assert.equal(ready.secrets_included,false);
console.log("Semantic data completeness report tests passed");
