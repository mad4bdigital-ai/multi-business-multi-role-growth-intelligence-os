import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createFileCanonicalSemanticRepairLedger} from "./stagingCanonicalSemanticRepairLedger.js";

const root=await mkdtemp(join(tmpdir(),"canonical-repair-ledger-"));
const plan="a".repeat(64);
try{
  const ledger=createFileCanonicalSemanticRepairLedger({directory:root,now:()=>new Date("2026-09-20T00:00:00.000Z")});
  const reserved=await ledger.reserve({plan_sha256:plan,expected_commit:"b".repeat(40),artifact_sha256:"c".repeat(64),precondition_fingerprint:"d".repeat(64)});
  assert.equal(reserved.state,"reserved");assert.equal(reserved.secrets_included,false);
  await assert.rejects(ledger.reserve({plan_sha256:plan}),(error)=>error?.code==="STAGING_CANONICAL_REPAIR_PLAN_ALREADY_CONSUMED");
  await ledger.markExecuting(plan,{execution_started:true});assert.equal((await ledger.read(plan)).state,"executing");
  await ledger.markUnknown(plan,{reason:"fault_injection"});assert.equal((await ledger.read(plan)).state,"unknown_outcome");
  const restarted=createFileCanonicalSemanticRepairLedger({directory:root,now:()=>new Date("2026-09-20T00:01:00.000Z")});
  const afterRestart=await restarted.read(plan);assert.equal(afterRestart.state,"unknown_outcome");assert.equal(afterRestart.mutation_retry_allowed,false);
  await assert.rejects(restarted.reserve({plan_sha256:plan}),(error)=>error?.code==="STAGING_CANONICAL_REPAIR_PLAN_ALREADY_CONSUMED");
  await assert.rejects(restarted.markExecuting(plan,{}),(error)=>error?.code==="STAGING_CANONICAL_REPAIR_PLAN_ALREADY_CONSUMED");
  await restarted.markReconciledNoMutation(plan,{reconciled:true});const done=await restarted.read(plan);assert.equal(done.state,"reconciled_no_mutation");assert.equal(done.reconciled,true);
  await assert.rejects(ledger.markExecuting(plan,{}),(error)=>error?.code==="STAGING_CANONICAL_REPAIR_PLAN_ALREADY_CONSUMED");

  const second="e".repeat(64);await ledger.reserve({plan_sha256:second});await ledger.markExecuting(second,{});await ledger.markKnownNotApplied(second,{reason:"permission_denied"});
  assert.equal((await ledger.read(second)).state,"known_not_applied");await assert.rejects(ledger.markExecuting(second,{}),(error)=>error?.code==="STAGING_CANONICAL_REPAIR_PLAN_ALREADY_CONSUMED");
}finally{await rm(root,{recursive:true,force:true});}
console.log("Staging canonical semantic repair durable ledger tests passed");
