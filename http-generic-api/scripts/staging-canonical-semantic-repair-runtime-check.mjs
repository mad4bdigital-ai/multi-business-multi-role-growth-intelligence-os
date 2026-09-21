import {getPool} from "../db.js";
import {assertStagingCanonicalSemanticRepairPrecondition,inspectStagingCanonicalSemanticRepair,validateStagingCanonicalSemanticRepairPlan} from "../stagingCanonicalSemanticRepair.js";

const args=Object.fromEntries(process.argv.slice(2).map((item)=>{const [key,...rest]=item.replace(/^--/u,"").split("=");return[key,rest.join("=")||true];}));
const action=String(args.action||"");const actualCommit=String(args["actual-commit"]||"").trim().toLowerCase();
if(!["precondition","readback"].includes(action))throw Object.assign(new Error("Unsupported Runtime repair check action."),{code:"STAGING_CANONICAL_REPAIR_RUNTIME_CHECK_ACTION_INVALID"});
let input="";for await(const chunk of process.stdin){input+=chunk;if(input.length>1024*1024)throw Object.assign(new Error("Repair plan input exceeds the bounded size."),{code:"STAGING_CANONICAL_REPAIR_PLAN_TOO_LARGE"});}
const parsed=JSON.parse(input.replace(/^\uFEFF/u,"").trim());const plan=parsed?.plan||parsed;validateStagingCanonicalSemanticRepairPlan({plan,actual_commit:actualCommit});
const executor=getPool();
try{
  if(action==="precondition")process.stdout.write(JSON.stringify(await assertStagingCanonicalSemanticRepairPrecondition({executor,plan,actual_commit:actualCommit}))+"\n");
  else{const inspection=await inspectStagingCanonicalSemanticRepair({executor});const verified=inspection.status==="resolved"&&inspection.evidence.canonical_ready_count===1&&inspection.evidence.ready_candidate_count===1;if(!verified)throw Object.assign(new Error("Runtime identity did not verify the canonical semantic repair postcondition."),{code:"STAGING_CANONICAL_REPAIR_POSTCONDITION_UNVERIFIED",details:{status:inspection.status,canonical_ready_count:inspection.evidence.canonical_ready_count,ready_candidate_count:inspection.evidence.ready_candidate_count}});process.stdout.write(JSON.stringify({contract:"mad4b.staging.canonical-semantic-repair-runtime-readback.v1",status:"resolved",plan_sha256:plan.plan_sha256,exact_row_count:1,resolver_candidate_count:1,mutation_performed:false,secrets_included:false})+"\n");}
}finally{await executor.end?.();}
