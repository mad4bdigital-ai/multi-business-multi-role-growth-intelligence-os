import {execFileSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {getPool} from "../db.js";
import {applyStagingCanonicalSemanticRepair,planStagingCanonicalSemanticRepair,reconcileStagingCanonicalSemanticRepair} from "../stagingCanonicalSemanticRepair.js";
import {createFileCanonicalSemanticRepairLedger} from "../stagingCanonicalSemanticRepairLedger.js";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..","..");
const args=Object.fromEntries(process.argv.slice(2).map((item)=>{const [key,...rest]=item.replace(/^--/u,"").split("=");return[key,rest.join("=")||true];}));
const action=String(args.action||"plan");
const environment=String(process.env.STAGING_ENVIRONMENT_KEY||"staging_local_windows_docker");
const dbName=String(process.env.DB_NAME||"");
if(!["plan","apply","reconcile"].includes(action))throw Object.assign(new Error("Unsupported canonical semantic repair action."),{code:"STAGING_CANONICAL_REPAIR_ACTION_INVALID"});
if(process.env.NODE_ENV==="production"||environment!=="staging_local_windows_docker"||/(?:production|hostinger)/iu.test(dbName))throw Object.assign(new Error("Canonical semantic repair is restricted to the local Staging Runtime database."),{code:"STAGING_CANONICAL_REPAIR_TARGET_FORBIDDEN"});
const actualCommit=execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim().toLowerCase();
const expectedCommit=String(args["expected-commit"]||process.env.STAGING_CANONICAL_REPAIR_EXPECTED_COMMIT||"").trim().toLowerCase();
if(!expectedCommit||expectedCommit!==actualCommit)throw Object.assign(new Error("Expected commit must equal the exact local checkout."),{code:"STAGING_CANONICAL_REPAIR_COMMIT_MISMATCH"});
const executor=getPool();
const ledgerDirectory=String(process.env.STAGING_CANONICAL_REPAIR_LEDGER_DIR||"").trim();
const ledger=ledgerDirectory?createFileCanonicalSemanticRepairLedger({directory:ledgerDirectory}):null;
try{
  let plan;
  if(action==="plan")plan=await planStagingCanonicalSemanticRepair({executor,expected_commit:expectedCommit,actual_commit:actualCommit});
  else{const planFile=path.resolve(String(args["plan-file"]||""));if(!args["plan-file"]||!fs.existsSync(planFile)||fs.statSync(planFile).size>1024*1024)throw Object.assign(new Error("A bounded immutable repair plan file is required."),{code:"STAGING_CANONICAL_REPAIR_PLAN_FILE_REQUIRED"});const parsed=JSON.parse(fs.readFileSync(planFile,"utf8"));plan=parsed?.plan||parsed;}
  if(action==="plan"){process.stdout.write(JSON.stringify({ok:true,action,plan,database_mutation_performed:false,production_mutation_performed:false,provider_mutation_performed:false,secrets_included:false})+"\n");}
  else if(action==="apply"){
    if(!ledger)throw Object.assign(new Error("STAGING_CANONICAL_REPAIR_LEDGER_DIR is required for apply."),{code:"STAGING_CANONICAL_REPAIR_LEDGER_REQUIRED"});
    const result=await applyStagingCanonicalSemanticRepair({executor,plan,confirmation:String(args.confirm||""),actual_commit:actualCommit,ledger});
    process.stdout.write(JSON.stringify({ok:true,action,result,secrets_included:false})+"\n");
  }else{
    if(!ledger)throw Object.assign(new Error("STAGING_CANONICAL_REPAIR_LEDGER_DIR is required for reconciliation."),{code:"STAGING_CANONICAL_REPAIR_LEDGER_REQUIRED"});
    const result=await reconcileStagingCanonicalSemanticRepair({executor,plan,actual_commit:actualCommit,ledger});
    process.stdout.write(JSON.stringify({ok:true,action,result,secrets_included:false})+"\n");
  }
}finally{await executor.end?.();}
