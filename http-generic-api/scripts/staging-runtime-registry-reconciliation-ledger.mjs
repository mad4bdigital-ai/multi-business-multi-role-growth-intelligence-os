import fs from "node:fs";
import path from "node:path";
import { createFileStagingRuntimeRegistryReconciliationLedger } from "../stagingRuntimeRegistryReconciliationLedger.js";

const args=Object.fromEntries(process.argv.slice(2).map((item)=>{const [key,...rest]=item.replace(/^--/u,"").split("=");return[key,rest.join("=")||true];}));
const action=String(args.action||"");
const planFile=path.resolve(String(args["plan-file"]||""));
if(!["reserve","mark-executing","mark-succeeded","mark-unknown","mark-known-not-applied","mark-reconciled-no-mutation","read"].includes(action))throw Object.assign(new Error("Unsupported registry reconciliation ledger action."),{code:"STAGING_REGISTRY_RECONCILIATION_LEDGER_ACTION_INVALID"});
if(!args["plan-file"]||!fs.existsSync(planFile)||fs.statSync(planFile).size>2*1024*1024)throw Object.assign(new Error("A bounded immutable registry reconciliation plan file is required."),{code:"STAGING_REGISTRY_RECONCILIATION_PLAN_FILE_REQUIRED"});
const root=String(process.env.STAGING_RUNTIME_REGISTRY_RECONCILIATION_LEDGER_DIR||"").trim();
if(!root)throw Object.assign(new Error("STAGING_RUNTIME_REGISTRY_RECONCILIATION_LEDGER_DIR is required."),{code:"STAGING_REGISTRY_RECONCILIATION_LEDGER_REQUIRED"});
const parsed=JSON.parse(fs.readFileSync(planFile,"utf8").replace(/^\uFEFF/u,""));
const plan=parsed?.plan||parsed;
const ledger=createFileStagingRuntimeRegistryReconciliationLedger({directory:root});
let details={};
if(action!=="reserve"&&action!=="read"){
  let input="";
  for await(const chunk of process.stdin){input+=chunk;if(input.length>128*1024)throw Object.assign(new Error("Ledger transition details exceed bounded size."),{code:"STAGING_REGISTRY_RECONCILIATION_LEDGER_DETAILS_TOO_LARGE"});}
  if(input.trim())details=JSON.parse(input.replace(/^\uFEFF/u,""));
}
let record;
if(action==="reserve")record=await ledger.reserve({plan_sha256:plan.plan_sha256,expected_commit:plan.expected_commit,artifact_sha256:plan.source_artifact?.sha256,precondition_fingerprint:plan.precondition_fingerprint});
else if(action==="mark-executing")record=await ledger.markExecuting(plan.plan_sha256,details);
else if(action==="mark-succeeded")record=await ledger.markSucceeded(plan.plan_sha256,details);
else if(action==="mark-unknown")record=await ledger.markUnknown(plan.plan_sha256,details);
else if(action==="mark-known-not-applied")record=await ledger.markKnownNotApplied(plan.plan_sha256,details);
else if(action==="mark-reconciled-no-mutation")record=await ledger.markReconciledNoMutation(plan.plan_sha256,details);
else record=await ledger.read(plan.plan_sha256);
process.stdout.write(JSON.stringify({ok:true,action,record,secrets_included:false})+"\n");
