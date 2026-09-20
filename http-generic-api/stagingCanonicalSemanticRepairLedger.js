import fs from "node:fs/promises";
import path from "node:path";

const PLAN=/^[a-f0-9]{64}$/u;
const STATES=new Set(["reserved","executing","succeeded","unknown_outcome"]);

function cleanPlan(value){const plan=String(value||"").trim().toLowerCase();if(!PLAN.test(plan))throw Object.assign(new Error("Invalid canonical repair plan identity."),{code:"STAGING_CANONICAL_REPAIR_LEDGER_PLAN_INVALID"});return plan;}
function publicRecord(record){return Object.freeze({...record,secrets_included:false});}

export function createFileCanonicalSemanticRepairLedger({directory,now=()=>new Date()}={}){
  const root=path.resolve(String(directory||"").trim());
  if(!directory||root===path.parse(root).root)throw Object.assign(new Error("A bounded canonical repair ledger directory is required."),{code:"STAGING_CANONICAL_REPAIR_LEDGER_DIRECTORY_INVALID"});
  const fileFor=(plan)=>path.join(root,`${cleanPlan(plan)}.json`);
  async function read(plan){try{const value=JSON.parse(await fs.readFile(fileFor(plan),"utf8"));return publicRecord(value);}catch(error){if(error?.code==="ENOENT")return null;throw error;}}
  async function writeAtomic(plan,record){await fs.mkdir(root,{recursive:true,mode:0o700});const target=fileFor(plan);const temp=`${target}.${process.pid}.${Date.now()}.tmp`;await fs.writeFile(temp,JSON.stringify(record,null,2)+"\n",{mode:0o600,flag:"wx"});await fs.rename(temp,target);return publicRecord(record);}
  async function transition(plan,next,details={}){
    const current=await read(plan);if(!current)throw Object.assign(new Error("Canonical repair ledger reservation is missing."),{code:"STAGING_CANONICAL_REPAIR_LEDGER_RESERVATION_MISSING"});
    if(current.state==="succeeded"||(current.state==="unknown_outcome"&&next!=="succeeded"))throw Object.assign(new Error("Canonical repair plan is terminal and cannot be reused outside reconciliation."),{code:"STAGING_CANONICAL_REPAIR_PLAN_ALREADY_CONSUMED",details:{state:current.state}});
    if(next==="executing"&&current.state!=="reserved")throw Object.assign(new Error("Canonical repair plan is not reserved."),{code:"STAGING_CANONICAL_REPAIR_LEDGER_STATE_INVALID"});
    if(!STATES.has(next))throw new TypeError("Invalid canonical repair ledger state.");
    return writeAtomic(plan,{...current,...details,state:next,updated_at:now().toISOString(),secrets_included:false});
  }
  return Object.freeze({
    async reserve({plan_sha256,expected_commit,artifact_sha256,precondition_fingerprint}={}){
      const plan=cleanPlan(plan_sha256);await fs.mkdir(root,{recursive:true,mode:0o700});const target=fileFor(plan);
      const record={contract:"mad4b.staging.canonical-semantic-repair-ledger.v1",plan_sha256:plan,expected_commit:String(expected_commit||""),artifact_sha256:String(artifact_sha256||""),precondition_fingerprint:String(precondition_fingerprint||""),state:"reserved",created_at:now().toISOString(),updated_at:now().toISOString(),mutation_retry_allowed:false,secrets_included:false};
      try{const handle=await fs.open(target,"wx",0o600);try{await handle.writeFile(JSON.stringify(record,null,2)+"\n");}finally{await handle.close();}return publicRecord(record);}
      catch(error){if(error?.code==="EEXIST"){const existing=await read(plan);throw Object.assign(new Error("Canonical repair plan already has a durable ledger record."),{code:"STAGING_CANONICAL_REPAIR_PLAN_ALREADY_CONSUMED",details:{state:existing?.state||"unknown"}});}throw error;}
    },
    markExecuting:(plan,details)=>transition(plan,"executing",details),
    markSucceeded:(plan,details)=>transition(plan,"succeeded",details),
    markUnknown:(plan,details)=>transition(plan,"unknown_outcome",details),
    read,
  });
}
