// Private filesystem ledger and redacted append-only audit for the isolated
// Staging DB broker. No account provisioning, env credential reads or routes.
import fs from "node:fs/promises";
import path from "node:path";
const RUN=/^[a-z0-9][a-z0-9_-]{7,80}$/i;
const HASH=/^[a-f0-9]{64}$/i;
const EVENTS=new Set([
  "reader_grant_attempt","reader_grant_completed",
  "broker_open_attempt","broker_sql_operation",
  "broker_session_closed","reader_broker_session_close_failed"
]);
const OPERATIONS=new Set([
  "identity","table_inventory","reader_presence",
  "create_fixed_reader","grant_fixed_table_select",
  "verify_fixed_grants","drop_fixed_reader"
]);
function fail(code){throw Object.assign(new Error(code),{code});}
async function privateDir(dir,assertPrivateWindowsAcl){
  if(typeof dir!=="string"||!path.isAbsolute(dir)||
    /(?:^|[\\/])(production|prod|hostinger)(?:[\\/]|$)/i.test(dir))
    fail("BROKER_PRIVATE_STAGING_DIRECTORY_REQUIRED");
  let st,canonical;
  try{st=await fs.lstat(dir);canonical=await fs.realpath(dir);}
  catch{fail("BROKER_PRIVATE_STAGING_DIRECTORY_REQUIRED");}
  if(!st.isDirectory()||st.isSymbolicLink()||
    path.resolve(canonical)!==path.resolve(dir)||
    (process.platform!=="win32"&&(st.mode&0o077)!==0))
    fail("BROKER_PRIVATE_STAGING_DIRECTORY_REQUIRED");
  if(process.platform==="win32"&&
    (typeof assertPrivateWindowsAcl!=="function"||
     await assertPrivateWindowsAcl(dir)!==true))
    fail("BROKER_PRIVATE_WINDOWS_ACL_REQUIRED");
  return canonical;
}
async function assertPrivateFile(name){
  try{
    const st=await fs.lstat(name);
    if(!st.isFile()||st.isSymbolicLink()||
      (process.platform!=="win32"&&(st.mode&0o077)!==0))
      fail("BROKER_PRIVATE_FILE_REQUIRED");
  }catch(e){if(e.code!=="ENOENT")throw e;}
}
function auditEvent(value){
  if(!EVENTS.has(value?.event)||!RUN.test(String(value?.run_id||""))||
    !HASH.test(String(value?.audit_ref||"")))
    fail("BROKER_AUDIT_EVENT_INVALID");
  if(value.operation!==undefined&&!OPERATIONS.has(value.operation))
    fail("BROKER_AUDIT_OPERATION_DENIED");
  if(value.status!==undefined&&!["blocked","census_verified"].includes(value.status))
    fail("BROKER_AUDIT_STATUS_DENIED");
  for(const k of ["reader_revoked","broker_session_closed","reader_absent"])
    if(value[k]!==undefined&&typeof value[k]!=="boolean")
      fail("BROKER_AUDIT_VALUE_INVALID");
  const allowed=new Set([
    "event","run_id","audit_ref","operation","status","reader_revoked",
    "broker_session_closed","reader_absent"
  ]);
  if(Object.keys(value).some(k=>!allowed.has(k)))
    fail("BROKER_AUDIT_UNREDACTED_PAYLOAD_DENIED");
  return Object.freeze({
    ...Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))),
    utc:new Date().toISOString(),
  });
}
export async function createPrivateStagingBackupBrokerFileState({
  ledgerDir,auditDir,assertPrivateWindowsAcl,
}={}){
  const [ledgerPath,auditPath]=await Promise.all([
    privateDir(ledgerDir,assertPrivateWindowsAcl),
    privateDir(auditDir,assertPrivateWindowsAcl),
  ]);
  if(ledgerPath===auditPath)
    fail("BROKER_SEPARATE_LEDGER_AND_AUDIT_REQUIRED");
  const journal=path.join(auditPath,"staging-backup-broker.ndjson");
  await assertPrivateFile(journal);
  let appendTail=Promise.resolve();
  const reservation=Object.freeze({
    async consumeOnce(runId,auditRef){
      if(!RUN.test(String(runId||""))||!HASH.test(String(auditRef||"")))
        fail("BROKER_RESERVATION_INVALID");
      const target=path.join(ledgerPath,"broker-grant-"+runId+".json");
      let handle;
      try{
        handle=await fs.open(target,"wx",0o600);
        await handle.writeFile(JSON.stringify({
          contract:"mad4b.staging-broker-replay-ledger.v1",
          run_id:runId,plan_sha256:auditRef,
          reserved_at:new Date().toISOString()
        })+"\n");
        await handle.sync();
        return true;
      }catch(e){
        if(e.code==="EEXIST")return false;
        fail("BROKER_DURABLE_LEDGER_UNAVAILABLE");
      }finally{if(handle)await handle.close();}
    }
  });
  const audit=Object.freeze({
    append(event){
      // Serialize concurrent writes and fsync before acknowledging each event.
      const row=auditEvent(event);
      const task=appendTail.then(async()=>{
        await assertPrivateFile(journal);
        const handle=await fs.open(journal,"a",0o600);
        try{
          await handle.writeFile(JSON.stringify(row)+"\n");
          await handle.sync();
        }finally{await handle.close();}
      });
      appendTail=task.catch(()=>{});
      return task;
    }
  });
  return Object.freeze({reservation,audit,ledger_durable:true,
    append_only_redacted_audit:true,production_mutation:false});
}
