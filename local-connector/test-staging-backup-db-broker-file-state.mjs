import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createPrivateStagingBackupBrokerFileState}
  from "./staging-backup-db-broker-file-state.mjs";

const root=await fs.mkdtemp(path.join(os.tmpdir(),"staging-broker-ledger-test-"));
const ledgerDir=path.join(root,"ledger"),auditDir=path.join(root,"audit");
await fs.mkdir(ledgerDir,{mode:0o700});
await fs.mkdir(auditDir,{mode:0o700});
const args={ledgerDir,auditDir,assertPrivateWindowsAcl:async()=>true};
try{
  const runtime=await createPrivateStagingBackupBrokerFileState(args);
  const runId="broker-ledger-synthetic-run-0001",hash="b".repeat(64);
  assert.equal(await runtime.reservation.consumeOnce(runId,hash),true);
  assert.equal(await runtime.reservation.consumeOnce(runId,hash),false);
  const restarted=await createPrivateStagingBackupBrokerFileState(args);
  assert.equal(await restarted.reservation.consumeOnce(runId,hash),false);
  await assert.rejects(
    restarted.reservation.consumeOnce("../escape","a".repeat(64)),
    e=>e.code==="BROKER_RESERVATION_INVALID");
  await assert.rejects(
    restarted.reservation.consumeOnce("valid-run-0001","bad"),
    e=>e.code==="BROKER_RESERVATION_INVALID");
  await Promise.all([
    runtime.audit.append({event:"broker_open_attempt",run_id:runId,audit_ref:hash}),
    runtime.audit.append({event:"broker_sql_operation",run_id:runId,audit_ref:hash,
      operation:"create_fixed_reader"}),
    runtime.audit.append({event:"broker_session_closed",run_id:runId,audit_ref:hash,
      reader_absent:true}),
  ]);
  assert.throws(()=>
    runtime.audit.append({event:"broker_sql_operation",run_id:runId,audit_ref:hash,
      sql:"DROP USER root"}),
    e=>e.code==="BROKER_AUDIT_UNREDACTED_PAYLOAD_DENIED");
  assert.throws(()=>
    runtime.audit.append({event:"broker_sql_operation",run_id:runId,audit_ref:hash,
      operation:"query_all_users"}),
    e=>e.code==="BROKER_AUDIT_OPERATION_DENIED");
  await assert.rejects(
    createPrivateStagingBackupBrokerFileState({...args,auditDir:ledgerDir}),
    e=>e.code==="BROKER_SEPARATE_LEDGER_AND_AUDIT_REQUIRED");
  const rows=(await fs.readFile(path.join(auditDir,
    "staging-backup-broker.ndjson"),"utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(rows.length,3);
  assert(rows.every(row=>row.utc&&row.audit_ref===hash));
  assert(!JSON.stringify(rows).includes("DROP USER root"));
  assert(!JSON.stringify(rows).includes("query_all_users"));
  const ledger=JSON.parse(await fs.readFile(
    path.join(ledgerDir,"broker-grant-"+runId+".json"),"utf8"));
  assert.equal(ledger.run_id,runId);
  assert.equal(ledger.plan_sha256,hash);
  console.log(JSON.stringify({
    contract:"mad4b.private-staging-backup-broker-file-state.test.v1",
    passed:true,synthetic_only:true,
    persistent_replay_blocked:true,
    atomic_exclusive_ledger:true,
    redacted_append_only_audit:true,
    separate_private_directories:true,
    no_db_mutation:true,production_mutation:false
  }));
}finally{await fs.rm(root,{recursive:true,force:true});}
