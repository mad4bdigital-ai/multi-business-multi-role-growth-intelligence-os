import fs from "node:fs";
import {getPool} from "../db.js";
import {assertStagingCanonicalSemanticRepairPrecondition,inspectStagingCanonicalSemanticRepair,planStagingCanonicalSemanticRepair,validateStagingCanonicalSemanticRepairPlan} from "../stagingCanonicalSemanticRepair.js";

const args=Object.fromEntries(process.argv.slice(2).map((item)=>{const [key,...rest]=item.replace(/^--/u,"").split("=");return[key,rest.join("=")||true];}));
const action=String(args.action||"");const actualCommit=String(args["actual-commit"]||"").trim().toLowerCase();
if(!["plan","precondition","readback"].includes(action))throw Object.assign(new Error("Unsupported Runtime repair check action."),{code:"STAGING_CANONICAL_REPAIR_RUNTIME_CHECK_ACTION_INVALID"});
if(!/^[a-f0-9]{40}$/u.test(actualCommit))throw Object.assign(new Error("An exact Runtime commit is required."),{code:"STAGING_CANONICAL_REPAIR_RUNTIME_COMMIT_REQUIRED"});
const deploymentManifest=JSON.parse(fs.readFileSync("/app/deployment-manifest.json","utf8"));
const deployedCommit=String(deploymentManifest?.commit_sha||"").trim().toLowerCase();
const envCommit=String(process.env.DEPLOY_COMMIT||"").trim().toLowerCase();
if(deploymentManifest?.repository!=="mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os"||deploymentManifest?.secrets_included!==false||deployedCommit!==actualCommit||envCommit!==actualCommit){
  throw Object.assign(new Error("Runtime deployment provenance does not match the requested repair commit."),{code:"STAGING_CANONICAL_REPAIR_RUNTIME_PROVENANCE_MISMATCH"});
}
const executor=getPool();
try{
  if(action==="plan"){
    const plan=await planStagingCanonicalSemanticRepair({executor,expected_commit:actualCommit,actual_commit:actualCommit});
    process.stdout.write(JSON.stringify({ok:true,action:"plan",plan,runtime_provenance:{repository:deploymentManifest.repository,commit_sha:deployedCommit,branch:deploymentManifest.branch||null,secrets_included:false},database_mutation_performed:false,production_mutation_performed:false,provider_mutation_performed:false,secrets_included:false})+"\n");
  }else{
    let input="";for await(const chunk of process.stdin){input+=chunk;if(input.length>1024*1024)throw Object.assign(new Error("Repair plan input exceeds the bounded size."),{code:"STAGING_CANONICAL_REPAIR_PLAN_TOO_LARGE"});}
    const parsed=JSON.parse(input.replace(/^\uFEFF/u,"").trim());const plan=parsed?.plan||parsed;validateStagingCanonicalSemanticRepairPlan({plan,actual_commit:actualCommit});
    if(action==="precondition")process.stdout.write(JSON.stringify(await assertStagingCanonicalSemanticRepairPrecondition({executor,plan,actual_commit:actualCommit}))+"\n");
    else{const inspection=await inspectStagingCanonicalSemanticRepair({executor});const verified=inspection.status==="resolved"&&inspection.evidence.canonical_ready_count===1&&inspection.evidence.ready_candidate_count===1;if(!verified)throw Object.assign(new Error("Runtime identity did not verify the canonical semantic repair postcondition."),{code:"STAGING_CANONICAL_REPAIR_POSTCONDITION_UNVERIFIED",details:{status:inspection.status,canonical_ready_count:inspection.evidence.canonical_ready_count,ready_candidate_count:inspection.evidence.ready_candidate_count}});process.stdout.write(JSON.stringify({contract:"mad4b.staging.canonical-semantic-repair-runtime-readback.v1",status:"resolved",plan_sha256:plan.plan_sha256,exact_row_count:1,resolver_candidate_count:1,mutation_performed:false,secrets_included:false})+"\n");}
  }
}finally{await executor.end?.();}
