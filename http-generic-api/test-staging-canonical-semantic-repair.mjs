import assert from "node:assert/strict";
import {applyStagingCanonicalSemanticRepair,inspectStagingCanonicalSemanticRepair,planStagingCanonicalSemanticRepair,reconcileStagingCanonicalSemanticRepair,STAGING_CANONICAL_SEMANTIC_REPAIR_ARTIFACT} from "./stagingCanonicalSemanticRepair.js";

const commit="a".repeat(40);
const canonical={workspace_id:"b50db01b-617e-4b7a-8bda-6bf4876f754f",tenant_id:"00000000-0000-0000-0000-000000000000",workspace_key:"platform_repo_governance_zero",
  display_name:"Platform Admin",workspace_type:"brand",bootstrap_status:"ready",config_json:JSON.stringify({authority_scope_key:"platform:root",platform_admin_workspace:true})};

function executorFor(state){return{async query(sql){const source=String(sql).trim();if(source.includes("information_schema.tables"))return[[{count:state.tableExists?1:0}]];
  if(source==="SELECT COUNT(*) AS count FROM workspace_registry")return[[{count:state.totalRows??state.candidateRows.length}]];
  if(source.includes("FROM workspace_registry"))return[state.candidateRows];
  if(["START TRANSACTION","COMMIT","ROLLBACK"].includes(source)){state.transactionLog??=[];state.transactionLog.push(source);return[[]];}
  if(/^(?:INSERT|UPDATE)\b/iu.test(source)){if(state.mutationError)throw new Error("transport interrupted after dispatch");if(state.candidateRows.length===0){state.totalRows=(state.totalRows??0)+1;state.candidateRows=[canonical];}return[{affectedRows:1}];}
  throw new Error(`Unexpected query: ${sql}`);}};}

function ledgerFor(){const records=new Map();return{records,async reserve(input){if(records.has(input.plan_sha256))throw Object.assign(new Error("consumed"),{code:"STAGING_CANONICAL_REPAIR_PLAN_ALREADY_CONSUMED"});records.set(input.plan_sha256,{...input,state:"reserved"});},async markExecuting(plan,details){records.set(plan,{...records.get(plan),...details,state:"executing"});},async markSucceeded(plan,details){records.set(plan,{...records.get(plan),...details,state:"succeeded"});},async markUnknown(plan,details){records.set(plan,{...records.get(plan),...details,state:"unknown_outcome"});}};}

assert.equal(STAGING_CANONICAL_SEMANTIC_REPAIR_ARTIFACT.seed_sha256,"4fb41955ae3ab5a6748c795c6f3291a49c58cf62bf2f84c411cd559059e66e4e");
assert.equal(STAGING_CANONICAL_SEMANTIC_REPAIR_ARTIFACT.statement_count,2);
assert.equal(STAGING_CANONICAL_SEMANTIC_REPAIR_ARTIFACT.artifact.artifact_key,"platform_admin_workspace");
assert.ok(STAGING_CANONICAL_SEMANTIC_REPAIR_ARTIFACT.semantic_artifact_registry_sha256);

const missingState={tableExists:true,totalRows:9,candidateRows:[]};const executor=executorFor(missingState);
const inspection=await inspectStagingCanonicalSemanticRepair({executor});assert.equal(inspection.status,"missing");assert.equal(inspection.repair_allowed,true);
assert.equal(inspection.evidence.row_count,9);assert.equal(inspection.evidence.relevant_row_count,0);
const plan=await planStagingCanonicalSemanticRepair({executor,expected_commit:commit,actual_commit:commit});
assert.equal(plan.contract,"mad4b.staging.canonical-semantic-repair-plan.v2");assert.equal(plan.plan_schema_version,2);assert.equal(plan.repair_allowed,true);
assert.equal(plan.artifact.target_role,"runtime");assert.equal(plan.artifact.replay_modes.includes("in_place_semantic_repair"),true);assert.equal(plan.caller_sql_forbidden,true);
assert.equal(plan.caller_target_forbidden,true);assert.equal(plan.acknowledgement_is_execution_authority,false);assert.equal(plan.same_cycle_readback_required,true);

const ledger=ledgerFor();
const result=await applyStagingCanonicalSemanticRepair({executor,plan,confirmation:plan.required_confirmation,actual_commit:commit,ledger});
assert.deepEqual(missingState.transactionLog,["START TRANSACTION","COMMIT"]);assert.equal(ledger.records.get(plan.plan_sha256).state,"succeeded");assert.equal(result.artifact_sha256,STAGING_CANONICAL_SEMANTIC_REPAIR_ARTIFACT.seed_sha256);assert.equal(result.status,"repaired");assert.equal(result.exact_row_count,1);
assert.equal(result.resolver_candidate_count,1);assert.notEqual(result.semantic_fingerprint_before,result.semantic_fingerprint_after);assert.equal(result.provider_mutation_performed,false);assert.equal(result.production_mutation_performed,false);

const reconciled=await reconcileStagingCanonicalSemanticRepair({executor,plan,actual_commit:commit});assert.equal(reconciled.status,"already_satisfied");assert.equal(reconciled.mutation_performed,false);assert.equal(reconciled.mutation_retry_allowed,false);

for(const candidateRows of [[{...canonical,workspace_key:"wrong-key"}],[{...canonical,workspace_id:"11111111-1111-4111-8111-111111111111"}],[{...canonical,bootstrap_status:"pending"}],
  [canonical,{...canonical,workspace_id:"22222222-2222-4222-8222-222222222222",workspace_key:"platform_admin_workspace"}]]){
  const caseInspection=await inspectStagingCanonicalSemanticRepair({executor:executorFor({tableExists:true,totalRows:candidateRows.length,candidateRows})});
  assert.equal(caseInspection.repair_allowed,false);assert.ok(["identity_conflict","ambiguous","not_ready"].includes(caseInspection.status));}

const malformed=await inspectStagingCanonicalSemanticRepair({executor:executorFor({tableExists:true,totalRows:1,candidateRows:[{...canonical,config_json:"{bad-json"}]})});
assert.equal(malformed.status,"malformed_config_json");assert.equal(malformed.repair_allowed,false);
const missingTable=await inspectStagingCanonicalSemanticRepair({executor:executorFor({tableExists:false,totalRows:0,candidateRows:[]})});assert.equal(missingTable.status,"workspace_registry_missing");assert.equal(missingTable.repair_allowed,false);
await assert.rejects(planStagingCanonicalSemanticRepair({executor,expected_commit:commit,actual_commit:"b".repeat(40)}),(error)=>error?.code==="STAGING_CANONICAL_REPAIR_COMMIT_MISMATCH");

const staleState={tableExists:true,totalRows:3,candidateRows:[]};const staleExecutor=executorFor(staleState);
const stalePlan=await planStagingCanonicalSemanticRepair({executor:staleExecutor,expected_commit:commit,actual_commit:commit});staleState.candidateRows=[{...canonical,workspace_key:"wrong-key"}];staleState.totalRows=4;
await assert.rejects(applyStagingCanonicalSemanticRepair({executor:staleExecutor,plan:stalePlan,confirmation:stalePlan.required_confirmation,actual_commit:commit,ledger:ledgerFor()}),
  (error)=>error?.code==="STAGING_CANONICAL_REPAIR_PRECONDITION_CHANGED");

const unknownState={tableExists:true,totalRows:7,candidateRows:[],mutationError:true};const unknownExecutor=executorFor(unknownState);
const unknownPlan=await planStagingCanonicalSemanticRepair({executor:unknownExecutor,expected_commit:commit,actual_commit:commit});
await assert.rejects(applyStagingCanonicalSemanticRepair({executor:unknownExecutor,plan:unknownPlan,confirmation:unknownPlan.required_confirmation,actual_commit:commit,ledger:ledgerFor()}),
  (error)=>error?.code==="STAGING_CANONICAL_REPAIR_RECONCILIATION_REQUIRED"&&error?.details?.status==="unknown_outcome"&&error?.details?.mutation_retry_allowed===false);

await assert.rejects(applyStagingCanonicalSemanticRepair({executor:unknownExecutor,plan:{...unknownPlan,expected_commit:"b".repeat(40)},confirmation:unknownPlan.required_confirmation,actual_commit:commit}),
  (error)=>["STAGING_CANONICAL_REPAIR_STALE_PLAN","STAGING_CANONICAL_REPAIR_PLAN_HASH_MISMATCH"].includes(error?.code));

await assert.rejects(applyStagingCanonicalSemanticRepair({executor:unknownExecutor,plan:{...unknownPlan,required_confirmation:"REPAIR_STAGING_CANONICAL_DATA_ATTACKER"},confirmation:"REPAIR_STAGING_CANONICAL_DATA_ATTACKER",actual_commit:commit}),
  (error)=>error?.code==="STAGING_CANONICAL_REPAIR_CONFIRMATION_REQUIRED");
await assert.rejects(applyStagingCanonicalSemanticRepair({executor:unknownExecutor,plan:{...unknownPlan,expected_repository:"attacker/repository"},confirmation:unknownPlan.required_confirmation,actual_commit:commit}),
  (error)=>error?.code==="STAGING_CANONICAL_REPAIR_TARGET_AUTHORITY_MISMATCH");
await assert.rejects(applyStagingCanonicalSemanticRepair({executor:unknownExecutor,plan:{...unknownPlan,target_environment:"production"},confirmation:unknownPlan.required_confirmation,actual_commit:commit}),
  (error)=>error?.code==="STAGING_CANONICAL_REPAIR_TARGET_AUTHORITY_MISMATCH");

console.log("Staging canonical semantic repair artifact/plan/reconciliation tests passed");
