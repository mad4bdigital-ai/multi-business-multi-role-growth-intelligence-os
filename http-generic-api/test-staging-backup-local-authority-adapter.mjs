import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {Readable} from "node:stream";
import {randomUUID,randomBytes,generateKeyPairSync,sign} from "node:crypto";
import {approvalPayload,manifestPayload,STAGING_QA_POLICY_KEY} from "./stagingGovernedEncryptedBackup.mjs";
import {readLocalStagingBackupAuthority,planLocalStagingBackup,executeWithTrustedLocalConnector} from "./stagingBackupLocalAuthorityAdapter.mjs";

const sha="8b545fe5a2215dd6aba754d2e32afefe19f97cad";
const {privateKey,publicKey}=generateKeyPairSync("ed25519");
const ownerPublic=publicKey.export({type:"spki",format:"pem"});
const keyRef="local-custody:local_test_custody_1";
const approvalId=randomUUID(),policyId=randomUUID(),destinationId=randomUUID(),runId=randomUUID();
const root=await fs.mkdtemp(path.join(os.tmpdir(),"staging-adapter-dest-"));
const ledger=await fs.mkdtemp(path.join(os.tmpdir(),"staging-adapter-ledger-"));
const identity={deployment_environment:"staging_local_windows_docker",runtime_class:"local_windows_docker",
  executor:"local_connector",local_connector_verified:true,source_sha:sha,
  device_id:"DESKTOP-91FDEFP",database_name:"staging_qa_test",
  source_endpoint_family:"localhost",source_location_key:"database:staging:qa",
  destination_location_key:"local:staging:approved-backups",destination_path:root};
const row={
  policy_id:policyId,policy_key:STAGING_QA_POLICY_KEY,backup_kind:"database",
  status:"active",activation_gate_status:"active",allowed_executor:"local_connector",
  artifact_format:"sql_dump",encryption_scheme:"platform_managed",checksum_algorithm:"sha256",
  approval_required:1,restore_test_required:1,
  source_key:identity.source_location_key,source_type:"database",source_status:"active",
  destination_id:destinationId,destination_key:identity.destination_location_key,
  destination_type:"local_device_path",destination_provider:"local_connector",destination_status:"active",
  destination_device_id:identity.device_id,destination_path:root,
  destination_ops:JSON.stringify(["write_approved_backup_artifacts"])
};
const approved={approval_id:approvalId,policy_id:policyId,approval_type:"backup_apply",status:"approved",
  approved_by:"owner",decision_source:"admin_session",decided_at:new Date(Date.now()-40000).toISOString(),
  expires_at:new Date(Date.now()+600000).toISOString()};
const run={run_id:runId,policy_id:policyId,run_mode:"apply",status:"planned"};
let queries=[];
let policyRows=[row],approvalRows=[approved],runRows=[run],dbError=null;
const db={query:async(sql,values)=>{
  queries.push({sql,values});
  if(dbError)throw dbError;
  assert(!/^\s*(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|GRANT|REVOKE)/i.test(sql));
  if(sql.includes("FROM platform_backup_policies"))return [policyRows];
  if(sql.includes("FROM platform_backup_approvals"))return [approvalRows];
  if(sql.includes("FROM platform_backup_runs"))return [runRows];
  throw Error("UNEXPECTED_QUERY");
}};
const identityProvider=async()=>identity;
const opts={db,identityProvider,expectedSourceSha:sha,approvalId,keyRef};
const sql=Buffer.from("CREATE TABLE fixture (id INT); INSERT INTO fixture VALUES (1);");
const key=randomBytes(32);
const localAdapters={
  destination_dir:root,ledger_dir:ledger,expected_table_count:1,expected_row_count:1,
  assert_private_acl:async()=>true,
  open_dump:async()=>Readable.from([sql]),
  read_key:async(ref)=>({ref,key:Buffer.from(key)}),
  sign_manifest:async(message)=>({algorithm:"ed25519",key_id:"owner-test-only",
    signature_b64:sign(null,message,privateKey).toString("base64")}),
  manifest_public_key_pem:ownerPublic
};
let count=0;
function pass(ok,label){assert(ok,label);count++;}
async function rejected(fn,code){
  try{await fn();assert.fail("expected "+code);}
  catch(e){if(e.code!==code)throw e;}
  count++;
}
try{
  const s=await readLocalStagingBackupAuthority(opts);
  pass(s.policy.policy_id===policyId,"policy mapped from SQL");
  pass(s.runtime.source_sha===sha,"measured runtime bound");
  pass(s.destination.path_or_ref===root,"destination path bound");
  pass(queries.length===2 && queries.every(q=>q.sql.includes("LIMIT 2")),"queries bounded");
  pass(queries.every(q=>q.sql.trim().startsWith("SELECT ")),"SELECT only");
  pass(queries[0].values[0]===STAGING_QA_POLICY_KEY && queries[1].values[0]===approvalId,"parameterized policy and approval");
  const p=await planLocalStagingBackup(opts);
  pass(p.ok===true && p.mode==="read_only" && p.backup_executed===false,"plan read only");
  pass(p.qa_fixture_write_authorized===false && p.production_mutation===false,"no authority");
  let noApply=false;
  try{await executeWithTrustedLocalConnector({...opts,localAdapters})}catch(e){noApply=e.code==="TRUSTED_LOCAL_APPLY_COMPOSITION_NOT_READY"}
  pass(noApply,"no implicit apply");
  const envelope={
    contract:"mad4b.staging-db-backup-apply.v1",run_id:runId,
    policy_key:STAGING_QA_POLICY_KEY,approval_id:approvalId,source_sha:sha,
    policy_id:policyId,source_database:identity.database_name,
    source_endpoint_family:identity.source_endpoint_family,device_id:identity.device_id,
    destination_id:destinationId,destination_ref:root,key_ref:keyRef,
    issued_at:new Date(Date.now()-1000).toISOString(),expires_at:new Date(Date.now()+300000).toISOString()
  };
  const signed={
    ...opts,signedEnvelope:envelope,
    signature_b64:sign(null,approvalPayload(envelope),privateKey).toString("base64"),
    trustedOwnerPublicKey:ownerPublic,localAdapters,
    executionIntent:"explicit_owner_approved_staging_backup_apply"
  };
  const ok=await executeWithTrustedLocalConnector(signed);
  pass(ok.ok===true && ok.backup_executed===true,"synthetic adapter streamed encrypted dump");
  pass(ok.production_mutation===false && ok.qa_fixture_write_authorized===false,"no QA or Production");
  pass((await fs.readdir(ledger)).length===1,"replay ledger reserved");
  await rejected(()=>executeWithTrustedLocalConnector(signed),"BACKUP_APPLY_NONCE_REPLAY");
  policyRows=[{...row,status:"draft"}];
  pass((await planLocalStagingBackup(opts)).blockers.includes("APPROVED_STAGING_BACKUP_POLICY_NOT_ACTIVE"),"draft policy blocks");
  policyRows=[row];
  approvalRows=[{...approved,status:"revoked"}];
  pass((await planLocalStagingBackup(opts)).blockers.includes("BACKUP_APPLY_APPROVAL_NOT_CURRENT"),"revoked approval blocks");
  approvalRows=[approved,approved];
  await rejected(()=>readLocalStagingBackupAuthority(opts),"AMBIGUOUS_BACKUP_APPLY_APPROVAL");
  approvalRows=[{...approved,policy_id:randomUUID()}];
  await rejected(()=>readLocalStagingBackupAuthority(opts),"BACKUP_APPLY_APPROVAL_IDENTITY_MISMATCH");
  approvalRows=[approved];
  policyRows=[row,row];
  await rejected(()=>readLocalStagingBackupAuthority(opts),"AMBIGUOUS_STAGING_BACKUP_POLICY");
  policyRows=[row];
  await rejected(()=>readLocalStagingBackupAuthority({...opts,identityProvider:async()=>({...identity,deployment_environment:"production"})}),"MEASURED_STAGING_CONNECTOR_IDENTITY_REQUIRED");
  await rejected(()=>readLocalStagingBackupAuthority({...opts,identityProvider:async()=>({...identity,source_sha:"f".repeat(40)})}),"MEASURED_STAGING_CONNECTOR_IDENTITY_REQUIRED");
  await rejected(()=>readLocalStagingBackupAuthority({...opts,identityProvider:async()=>({...identity,destination_path:"C:\\production-backups"})}),"STAGING_SOURCE_DESTINATION_BINDING_MISMATCH");
  await rejected(()=>readLocalStagingBackupAuthority({...opts,identityProvider:async()=>({...identity,destination_location_key:"local:other"})}),"STAGING_SOURCE_DESTINATION_BINDING_MISMATCH");
  policyRows=[{...row,destination_path:"C:\\production\\backups"}];
  await rejected(()=>readLocalStagingBackupAuthority({...opts,identityProvider:async()=>({...identity,destination_path:"C:\\production\\backups"})}),"STAGING_SOURCE_DESTINATION_BINDING_MISMATCH");
  policyRows=[row];
  await rejected(()=>readLocalStagingBackupAuthority({...opts,approvalId:"../../any"}),"EXACT_BACKUP_APPLY_APPROVAL_ID_REQUIRED");
  runRows=[{...run,status:"succeeded"}];
  await rejected(()=>executeWithTrustedLocalConnector({...signed,signedEnvelope:{...envelope,run_id:randomUUID()}}),"APPROVED_BACKUP_RUN_NOT_PREPARED");
  runRows=[run];
  dbError=Object.assign(new Error("denied"),{code:"ER_TABLEACCESS_DENIED_ERROR"});
  pass((await planLocalStagingBackup(opts)).ok===false,"missing SQL SELECT grant blocks");
  dbError=null;
  approvalRows=[];
  pass((await planLocalStagingBackup(opts)).blockers.includes("BACKUP_APPLY_APPROVAL_NOT_FOUND"),"missing per-run approval blocks");
  approvalRows=[approved];
  pass((await fs.readdir(root)).length===1,"no other unsanctioned artifacts");
  console.log(JSON.stringify({contract:"mad4b.staging-local-authority-adapter-test.v1",pass:true,cases:count,
    source:"synthetic_only",policy_select_only:true,approval_snapshot_revalidated:true,
    owner_signed_envelope:true,replay_blocked:true,no_real_database_export:true,production_mutation:false}));
}finally{
  await fs.rm(root,{recursive:true,force:true});
  await fs.rm(ledger,{recursive:true,force:true});
}
