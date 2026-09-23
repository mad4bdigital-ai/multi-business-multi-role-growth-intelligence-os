import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {applyStagingCanonicalSemanticRepair,inspectStagingCanonicalSemanticRepair,planStagingCanonicalSemanticRepair,reconcileStagingCanonicalSemanticRepair,STAGING_CANONICAL_SEMANTIC_REPAIR_ARTIFACT} from "./stagingCanonicalSemanticRepair.js";

const commit="a".repeat(40);
const canonical={workspace_id:"b50db01b-617e-4b7a-8bda-6bf4876f754f",tenant_id:"00000000-0000-0000-0000-000000000000",workspace_key:"platform_repo_governance_zero",
  display_name:"Platform Admin",workspace_type:"brand",bootstrap_status:"ready",config_json:JSON.stringify({authority_scope_key:"platform:root",platform_admin_workspace:true})};

function executorFor(state){return{async query(sql){const source=String(sql).trim();const command=source.replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/u,"").trim();if(source.includes("information_schema.tables"))return[[{count:state.tableExists?1:0}]];
  if(source==="SELECT COUNT(*) AS count FROM workspace_registry")return[[{count:state.totalRows??state.candidateRows.length}]];
  if(["START TRANSACTION","COMMIT","ROLLBACK"].includes(source)){state.transactionLog??=[];state.transactionLog.push(source);return[[]];}
  if(/^(?:INSERT|UPDATE)\b/iu.test(command)){if(state.mutationError)throw new Error("transport interrupted after dispatch");if(state.candidateRows.length===0){state.totalRows=(state.totalRows??0)+1;state.candidateRows=[canonical];}return[{affectedRows:1}];}
  if(source.includes("FROM workspace_registry"))return[state.candidateRows];
  throw new Error(`Unexpected query: ${sql}`);}};}

function ledgerFor(){const records=new Map();return{records,async reserve(input){if(records.has(input.plan_sha256))throw Object.assign(new Error("consumed"),{code:"STAGING_CANONICAL_REPAIR_PLAN_ALREADY_CONSUMED"});records.set(input.plan_sha256,{...input,state:"reserved"});},async markExecuting(plan,details){records.set(plan,{...records.get(plan),...details,state:"executing"});},async markSucceeded(plan,details){records.set(plan,{...records.get(plan),...details,state:"succeeded"});},async markUnknown(plan,details){records.set(plan,{...records.get(plan),...details,state:"unknown_outcome"});},async markKnownNotApplied(plan,details){records.set(plan,{...records.get(plan),...details,state:"known_not_applied"});},async markReconciledNoMutation(plan,details){records.set(plan,{...records.get(plan),...details,state:"reconciled_no_mutation"});},async read(plan){return records.get(plan)||null;}};}

const apiRoot=path.dirname(fileURLToPath(import.meta.url));
const seedRelativePath=STAGING_CANONICAL_SEMANTIC_REPAIR_ARTIFACT.artifact.file.replace(/^http-generic-api\//u,"");
const expectedSeedSha256=crypto.createHash("sha256").update(fs.readFileSync(path.join(apiRoot,seedRelativePath))).digest("hex");
assert.equal(STAGING_CANONICAL_SEMANTIC_REPAIR_ARTIFACT.seed_sha256,expectedSeedSha256);
assert.equal(STAGING_CANONICAL_SEMANTIC_REPAIR_ARTIFACT.statement_count,2);
assert.equal(STAGING_CANONICAL_SEMANTIC_REPAIR_ARTIFACT.artifact.artifact_key,"platform_admin_workspace");
assert.ok(STAGING_CANONICAL_SEMANTIC_REPAIR_ARTIFACT.semantic_artifact_registry_sha256);

const missingState={tableExists:true,totalRows:9,candidateRows:[]};const executor=executorFor(missingState);
const inspection=await inspectStagingCanonicalSemanticRepair({executor});assert.equal(inspection.status,"missing");assert.equal(inspection.repair_allowed,true);
assert.equal(inspection.evidence.row_count,9);assert.equal(inspection.evidence.relevant_row_count,0);
const plan=await planStagingCanonicalSemanticRepair({executor,expected_commit:commit,actual_commit:commit});
assert.equal(plan.contract,"mad4b.staging.canonical-semantic-repair-plan.v3");assert.equal(plan.plan_schema_version,3);assert.equal(plan.repair_allowed,true);
assert.equal(plan.execution_authority,"repository_bound_local_staging_canonical_repair");assert.equal(plan.repair_generation,1);
assert.equal(plan.artifact.target_role,"runtime");assert.equal(plan.artifact.replay_modes.includes("in_place_semantic_repair"),true);assert.equal(plan.caller_sql_forbidden,true);
assert.equal(plan.caller_target_forbidden,true);assert.equal(plan.acknowledgement_is_execution_authority,false);assert.equal(plan.same_cycle_readback_required,true);

const ledger=ledgerFor();
const result=await applyStagingCanonicalSemanticRepair({executor,plan,confirmation:plan.required_confirmation,actual_commit:commit,ledger});
assert.deepEqual(missingState.transactionLog,["START TRANSACTION","COMMIT"]);assert.equal(ledger.records.get(plan.plan_sha256).state,"succeeded");assert.equal(result.artifact_sha256,STAGING_CANONICAL_SEMANTIC_REPAIR_ARTIFACT.seed_sha256);assert.equal(result.status,"repaired");assert.equal(result.exact_row_count,1);
assert.equal(result.resolver_candidate_count,1);assert.notEqual(result.semantic_fingerprint_before,result.semantic_fingerprint_after);assert.equal(result.provider_mutation_performed,false);assert.equal(result.production_mutation_performed,false);

const reconciled=await reconcileStagingCanonicalSemanticRepair({executor,plan,actual_commit:commit,ledger});assert.equal(reconciled.status,"already_satisfied");assert.equal(reconciled.mutation_performed,false);assert.equal(reconciled.mutation_retry_allowed,false);

for(const candidateRows of [[{...canonical,workspace_key:"wrong-key"}],[{...canonical,workspace_id:"11111111-1111-4111-8111-111111111111"}],[{...canonical,bootstrap_status:"pending"}],
  [canonical,{...canonical,workspace_id:"22222222-2222-4222-8222-222222222222",workspace_key:"platform_admin_workspace"}]]){
  const caseInspection=await inspectStagingCanonicalSemanticRepair({executor:executorFor({tableExists:true,totalRows:candidateRows.length,candidateRows})});
  assert.equal(caseInspection.repair_allowed,false);assert.ok(["identity_conflict","ambiguous","not_ready"].includes(caseInspection.status));}

const malformed=await inspectStagingCanonicalSemanticRepair({executor:executorFor({tableExists:true,totalRows:1,candidateRows:[{...canonical,config_json:"{bad-json"}]})});
assert.equal(malformed.status,"malformed_config_json");assert.equal(malformed.repair_allowed,false);
const missingTable=await inspectStagingCanonicalSemanticRepair({executor:executorFor({tableExists:false,totalRows:0,candidateRows:[]})});assert.equal(missingTable.status,"workspace_registry_missing");assert.equal(missingTable.repair_allowed,false);
await assert.rejects(planStagingCanonicalSemanticRepair({executor,expected_commit:commit,actual_commit:"b".repeat(40)}),(error)=>error?.code==="STAGING_CANONICAL_REPAIR_COMMIT_MISMATCH");

const staleState={tableExists:true,totalRows:3,candidateRows:[]};const staleExecutor=executorFor(staleState);
const stalePlan=await planStagingCanonicalSemanticRepair({executor:staleExecutor,expected_commit:commit,actual_commit:commit});staleState.candidateRows=[{...canonical,workspace_key:"wrong-key"}];staleState.totalRows=4;const staleLedger=ledgerFor();
await assert.rejects(applyStagingCanonicalSemanticRepair({executor:staleExecutor,plan:stalePlan,confirmation:stalePlan.required_confirmation,actual_commit:commit,ledger:staleLedger}),
  (error)=>error?.code==="STAGING_CANONICAL_REPAIR_PRECONDITION_CHANGED");
assert.equal(staleLedger.records.size,0);

const deniedState={tableExists:true,totalRows:7,candidateRows:[],mutationError:true};const deniedExecutor=executorFor(deniedState);
const unknownPlan=await planStagingCanonicalSemanticRepair({executor:deniedExecutor,expected_commit:commit,actual_commit:commit});const deniedLedger=ledgerFor();
await assert.rejects(applyStagingCanonicalSemanticRepair({executor:deniedExecutor,plan:unknownPlan,confirmation:unknownPlan.required_confirmation,actual_commit:commit,ledger:deniedLedger}),
  (error)=>error?.code==="STAGING_CANONICAL_REPAIR_KNOWN_NOT_APPLIED"&&error?.details?.status==="known_not_applied"&&error?.details?.statement_success_count===0&&error?.details?.rollback_confirmed===true&&error?.details?.reconciliation_required===false);
assert.equal(deniedLedger.records.get(unknownPlan.plan_sha256).state,"known_not_applied");

const partialState={tableExists:true,totalRows:7,candidateRows:[],mutationCount:0};
const partialExecutor={async query(sql){const source=String(sql).trim();const command=source.replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/u,"").trim();if(source.includes("information_schema.tables"))return[[{count:1}]];if(source==="SELECT COUNT(*) AS count FROM workspace_registry")return[[{count:7}]];if(source==="START TRANSACTION"||source==="ROLLBACK")return[[]];if(source==="COMMIT")return[[]];if(/^(?:INSERT|UPDATE)\b/iu.test(command)){partialState.mutationCount++;if(partialState.mutationCount===2)throw new Error("transport lost after first mutation");return[{affectedRows:1}];}if(source.includes("FROM workspace_registry"))return[partialState.candidateRows];throw new Error(`Unexpected query: ${sql}`);}};
const partialPlan=await planStagingCanonicalSemanticRepair({executor:partialExecutor,expected_commit:commit,actual_commit:commit});const partialLedger=ledgerFor();
await assert.rejects(applyStagingCanonicalSemanticRepair({executor:partialExecutor,plan:partialPlan,confirmation:partialPlan.required_confirmation,actual_commit:commit,ledger:partialLedger}),
  (error)=>error?.code==="STAGING_CANONICAL_REPAIR_RECONCILIATION_REQUIRED"&&error?.details?.status==="unknown_outcome"&&error?.details?.statement_success_count===1);
assert.equal(partialLedger.records.get(partialPlan.plan_sha256).state,"unknown_outcome");
partialState.mutationCount=0;
const reconciledNoMutation=await reconcileStagingCanonicalSemanticRepair({executor:partialExecutor,plan:partialPlan,actual_commit:commit,ledger:partialLedger});
assert.equal(reconciledNoMutation.status,"reconciled_no_mutation");assert.equal(partialLedger.records.get(partialPlan.plan_sha256).state,"reconciled_no_mutation");assert.ok(reconciledNoMutation.reconciliation_evidence_hash);
const generationTwo=await planStagingCanonicalSemanticRepair({executor:partialExecutor,expected_commit:commit,actual_commit:commit,repair_generation:2,supersedes_plan_sha256:partialPlan.plan_sha256,reconciliation_evidence_hash:reconciledNoMutation.reconciliation_evidence_hash,previous_outcome:"reconciled_no_mutation"});
assert.equal(generationTwo.repair_generation,2);assert.equal(generationTwo.supersedes_plan_sha256,partialPlan.plan_sha256);assert.notEqual(generationTwo.plan_sha256,partialPlan.plan_sha256);

await assert.rejects(applyStagingCanonicalSemanticRepair({executor:deniedExecutor,plan:{...unknownPlan,expected_commit:"b".repeat(40)},confirmation:unknownPlan.required_confirmation,actual_commit:commit}),
  (error)=>["STAGING_CANONICAL_REPAIR_STALE_PLAN","STAGING_CANONICAL_REPAIR_PLAN_HASH_MISMATCH"].includes(error?.code));

await assert.rejects(applyStagingCanonicalSemanticRepair({executor:deniedExecutor,plan:{...unknownPlan,required_confirmation:"REPAIR_STAGING_CANONICAL_DATA_ATTACKER"},confirmation:"REPAIR_STAGING_CANONICAL_DATA_ATTACKER",actual_commit:commit}),
  (error)=>error?.code==="STAGING_CANONICAL_REPAIR_CONFIRMATION_REQUIRED");
await assert.rejects(applyStagingCanonicalSemanticRepair({executor:deniedExecutor,plan:{...unknownPlan,expected_repository:"attacker/repository"},confirmation:unknownPlan.required_confirmation,actual_commit:commit}),
  (error)=>error?.code==="STAGING_CANONICAL_REPAIR_TARGET_AUTHORITY_MISMATCH");
await assert.rejects(applyStagingCanonicalSemanticRepair({executor:deniedExecutor,plan:{...unknownPlan,target_environment:"production"},confirmation:unknownPlan.required_confirmation,actual_commit:commit}),
  (error)=>error?.code==="STAGING_CANONICAL_REPAIR_TARGET_AUTHORITY_MISMATCH");

const receiptState={tableExists:true,totalRows:4,candidateRows:[]};const receiptExecutor=executorFor(receiptState);
const receiptPlan=await planStagingCanonicalSemanticRepair({executor:receiptExecutor,expected_commit:commit,actual_commit:commit});const receiptLedger=ledgerFor();let receiptUnknown=false;
receiptLedger.markSucceeded=async()=>{throw new Error("durable store unavailable");};receiptLedger.markUnknown=async(planSha,details)=>{receiptUnknown=true;receiptLedger.records.set(planSha,{...receiptLedger.records.get(planSha),...details,state:"unknown_outcome"});};
await assert.rejects(applyStagingCanonicalSemanticRepair({executor:receiptExecutor,plan:receiptPlan,confirmation:receiptPlan.required_confirmation,actual_commit:commit,ledger:receiptLedger}),
  (error)=>error?.code==="STAGING_CANONICAL_REPAIR_RECONCILIATION_REQUIRED"&&error?.details?.status==="unknown_outcome"&&error?.details?.mutation_retry_allowed===false);
assert.equal(receiptUnknown,true);assert.equal(receiptState.candidateRows.length,1);

console.log("Staging canonical semantic repair artifact/plan/reconciliation tests passed");
