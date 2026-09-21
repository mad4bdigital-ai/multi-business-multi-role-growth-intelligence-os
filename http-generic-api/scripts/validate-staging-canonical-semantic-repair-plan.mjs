import fs from "node:fs";
import path from "node:path";
import {validateStagingCanonicalSemanticRepairPlan} from "../stagingCanonicalSemanticRepair.js";

const args=Object.fromEntries(process.argv.slice(2).map((item)=>{const [key,...rest]=item.replace(/^--/u,"").split("=");return[key,rest.join("=")||true];}));
const planFile=path.resolve(String(args["plan-file"]||""));
if(!args["plan-file"]||!fs.existsSync(planFile)||fs.statSync(planFile).size>1024*1024)throw Object.assign(new Error("A bounded immutable repair plan file is required."),{code:"STAGING_CANONICAL_REPAIR_PLAN_FILE_REQUIRED"});
const parsed=JSON.parse(fs.readFileSync(planFile,"utf8"));const plan=parsed?.plan||parsed;
const validation=validateStagingCanonicalSemanticRepairPlan({plan,actual_commit:String(args["actual-commit"]||"")});
process.stdout.write(JSON.stringify({ok:true,plan,validation,secrets_included:false})+"\n");
