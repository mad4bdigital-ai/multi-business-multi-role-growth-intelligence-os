import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileStagingRuntimeRegistryReconciliationLedger } from "./stagingRuntimeRegistryReconciliationLedger.js";

const root=await mkdtemp(join(tmpdir(),"staging-registry-reconciliation-ledger-"));
try{
  const ledger=createFileStagingRuntimeRegistryReconciliationLedger({directory:root});
  const plan="a".repeat(64);
  await ledger.reserve({plan_sha256:plan,expected_commit:"b".repeat(40),artifact_sha256:"c".repeat(64),precondition_fingerprint:"d".repeat(64)});
  assert.equal((await ledger.read(plan)).state,"reserved");
  await ledger.markExecuting(plan,{selected_statement_count:2});
  assert.equal((await ledger.read(plan)).state,"executing");
  await ledger.markUnknown(plan,{reason:"transport_interrupted"});
  assert.equal((await ledger.read(plan)).state,"unknown_outcome");
  await ledger.markReconciledNoMutation(plan,{readback_verified:true});
  assert.equal((await ledger.read(plan)).state,"reconciled_no_mutation");
  await assert.rejects(ledger.markExecuting(plan,{}),(error)=>error?.code==="STAGING_REGISTRY_RECONCILIATION_PLAN_ALREADY_CONSUMED");

  const success="e".repeat(64);
  await ledger.reserve({plan_sha256:success});
  await ledger.markExecuting(success,{});
  await ledger.markSucceeded(success,{readback_verified:true});
  assert.equal((await ledger.read(success)).state,"succeeded");

  const known="f".repeat(64);
  await ledger.reserve({plan_sha256:known});
  await ledger.markExecuting(known,{});
  await ledger.markKnownNotApplied(known,{rollback_confirmed:true});
  assert.equal((await ledger.read(known)).state,"known_not_applied");

  const restarted=createFileStagingRuntimeRegistryReconciliationLedger({directory:root});
  assert.equal((await restarted.read(success)).state,"succeeded");
  await assert.rejects(restarted.reserve({plan_sha256:success}),(error)=>error?.code==="STAGING_REGISTRY_RECONCILIATION_PLAN_ALREADY_CONSUMED");
}finally{
  await rm(root,{recursive:true,force:true});
}
console.log("Staging runtime registry reconciliation durable ledger tests passed");
