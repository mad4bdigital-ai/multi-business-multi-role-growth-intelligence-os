// Staging Backup metadata reader lifecycle. This is an injected local connector
// composition contract, NOT an HTTP route, database administrator, or CLI grant.
// Only an independently trusted Staging DB-admin connector may supply adapters.
import {createHash, verify as verifySignature} from "node:crypto";
import {verifyBackupPolicyReaderGrants} from "./stagingBackupPolicyReader.mjs";

export const STAGING_BACKUP_READER_TABLES=Object.freeze([
  "platform_backup_approvals","platform_backup_policies",
  "platform_backup_runs","platform_copy_locations",
]);
const SHA40=/^[0-9a-f]{40}$/i;
const RUN_ID=/^[a-z0-9][a-z0-9_-]{7,80}$/i;
const PLAN_CONTRACT="mad4b.staging.backup-reader-grant-plan.v1";
const APPROVAL_CONTRACT="mad4b.staging.backup-reader-grant-approval.v1";
const REPORT_CONTRACT="mad4b.staging.backup-reader-grant-run.v1";
const NETWORK="http-generic-api_default";
const CIDR="172.18.0.0/16";
function fail(code){const e=new Error(code);e.code=code;throw e;}
function hash(value){return createHash("sha256").update(JSON.stringify(value)).digest("hex");}
function sameArray(a,b){return Array.isArray(a)&&a.length===b.length&&
  [...a].sort().every((x,i)=>x===[...b].sort()[i]);}

// This must be fed by a measured Local Connector; never request JSON.
// The exact release and network identity are part of the grant's authority.
export function planStagingBackupReaderGrant({measured,expectedSha,runId}={}){
  if(!SHA40.test(String(expectedSha||""))||!RUN_ID.test(String(runId||""))||
    measured?.deployment_environment!=="staging_local_windows_docker"||
    measured?.local_connector_verified!==true||
    typeof measured?.device_id!=="string"||measured.device_id.length<3||
    measured?.source_sha!==expectedSha||
    measured?.docker_network!==NETWORK||
    measured?.docker_subnet!==CIDR||
    measured?.db_host!=="runtime-db"||
    measured?.db_schema!=="growth_runtime"||
    measured?.production_mutation!==false)
    fail("READER_GRANT_MEASURED_STAGING_REQUIRED");
  const binding=Object.freeze({
    source_sha:expectedSha,device_id:measured.device_id,run_id:runId,
    network:NETWORK,subnet:CIDR,db_host:"runtime-db",
    db_schema:"growth_runtime",reader_user:"backup_policy_reader",
    account_host_pattern:"172.18.%",
    tables:[...STAGING_BACKUP_READER_TABLES],
    privileges:["SELECT"],no_schema_wide_privileges:true,
    no_grant_option:true,cleanup_required:true,
  });
  const plan={contract:PLAN_CONTRACT,mode:"plan_only",binding};
  return Object.freeze({...plan,plan_sha256:hash(plan),
    credentials_included:false,production_mutation:false});
}

export function verifySignedReaderGrantApproval({plan,approval,
  trustedOwnerPublicKey,nowMs=Date.now()}={}){
  if(plan?.contract!==PLAN_CONTRACT||!trustedOwnerPublicKey||
    approval?.contract!==APPROVAL_CONTRACT||
    approval?.operation!=="provision_census_revoke"||
    approval?.plan_sha256!==plan.plan_sha256||
    approval?.source_sha!==plan.binding.source_sha||
    approval?.run_id!==plan.binding.run_id||
    approval?.device_id!==plan.binding.device_id||
    approval?.owner_gate!=="OWNER_ATTEST_SINGLE_OWNER"||
    !Number.isSafeInteger(approval.issued_at_ms)||
    !Number.isSafeInteger(approval.expires_at_ms)||
    approval.issued_at_ms>nowMs||approval.expires_at_ms<=nowMs||
    approval.expires_at_ms-approval.issued_at_ms>600_000||
    typeof approval.signature_b64!=="string"||!approval.signature_b64)
    fail("READER_GRANT_OWNER_APPROVAL_REQUIRED");
  const {signature_b64,...signed}=approval;
  if(!verifySignature(null,Buffer.from(JSON.stringify(signed)),
    trustedOwnerPublicKey,Buffer.from(signature_b64,"base64")))
    fail("READER_GRANT_OWNER_SIGNATURE_INVALID");
  return true;
}
function assertAdapters({measuredIdentity,admin,reader,ledger,audit}){
  if(typeof measuredIdentity!=="function"||
    typeof admin?.inspect!=="function"||
    typeof admin?.provisionTemporaryReader!=="function"||
    typeof admin?.readReaderGrants!=="function"||
    typeof admin?.revokeTemporaryReader!=="function"||
    typeof admin?.readerAbsent!=="function"||
    typeof reader?.census!=="function"||
    typeof ledger?.consumeOnce!=="function"||
    typeof audit?.append!=="function")
    fail("TRUSTED_STAGING_DB_ADMIN_CONNECTOR_REQUIRED");
}
function goodCensus(census){
  if(census?.policy_inventory_verified!==true||
    !Number.isSafeInteger(census.existing_policy_count)||
    census.existing_policy_count<0||census.existing_policy_count>1)
    fail("READER_POLICY_CENSUS_UNVERIFIED");
}
// The admin adapter generates/holds the ephemeral password and returns an opaque
// reader lease. It must never put the password in audit events, PRs or app env.
// No SQL is assembled or sent here; no direct device/root fallback is possible.
export async function runGovernedStagingBackupReaderCensus({
  measuredIdentity,expectedSha,runId,approval,trustedOwnerPublicKey,
  admin,reader,ledger,audit,
}={}){
  assertAdapters({measuredIdentity,admin,reader,ledger,audit});
  const measured=await measuredIdentity();
  const plan=planStagingBackupReaderGrant({measured,expectedSha,runId});
  verifySignedReaderGrantApproval({plan,approval,trustedOwnerPublicKey});
  const auditRef=plan.plan_sha256;
  // A durable, atomic replay ledger is required; a failed run consumes its ID.
  await audit.append({event:"reader_grant_attempt",audit_ref:auditRef,run_id:runId});
  if(await ledger.consumeOnce(runId,auditRef)!==true)
    fail("READER_GRANT_REPLAY_BLOCKED");
  let attempt=false,cleanupVerified=false,confirmed=false;
  let blocker=null,policyCount=null;
  try{
    const pre=await admin.inspect(plan.binding);
    if(pre?.database!=="growth_runtime"||
      !sameArray(pre?.tables,STAGING_BACKUP_READER_TABLES)||
      pre?.reader_absent!==true)
      fail("READER_GRANT_ADMIN_PREFLIGHT_BLOCKED");
    // Set BEFORE calling the adapter: even partial create failures get cleanup.
    attempt=true;
    const lease=await admin.provisionTemporaryReader(plan.binding);
    if(!lease)fail("READER_GRANT_LEASE_UNVERIFIED");
    const grants=await admin.readReaderGrants(plan.binding);
    // Do not accept evidence belonging to an arbitrary account even if the
    // underlying grants are otherwise SELECT-only.
    if(!Array.isArray(grants)||grants.some(row=>{
      const statement=String(Object.values(row??{})[0]??"");
      return !/\bTO\s+([`\x27])?backup_policy_reader\1@([`\x27])?172\.18\.%\2\s*$/i.test(statement);
    }))fail("READER_GRANT_PRINCIPAL_IDENTITY_MISMATCH");
    const verification=verifyBackupPolicyReaderGrants(grants,"growth_runtime");
    if(verification.table_count!==4||verification.read_only!==true)
      fail("READER_GRANT_EFFECTIVE_PRIVILEGES_INVALID");
    const census=await reader.census({lease,source_sha:expectedSha,
      expected_policy_key:"policy:staging-qa-db:approved"});
    goodCensus(census);
    policyCount=census.existing_policy_count;
    confirmed=true;
  }catch(e){blocker=String(e?.code||"READER_GRANT_EXECUTION_FAILED")}
  finally{
    if(attempt){
      try{
        await admin.revokeTemporaryReader(plan.binding);
        cleanupVerified=await admin.readerAbsent(plan.binding)===true;
      }catch{cleanupVerified=false;}
    }else cleanupVerified=true;
    try{
      await audit.append({event:"reader_grant_completed",audit_ref:auditRef,
        run_id:runId,status:confirmed&&cleanupVerified?"census_verified":"blocked",
        reader_revoked:cleanupVerified});
    }catch{blocker="READER_GRANT_AUDIT_UNVERIFIED";}
  }
  const ok=confirmed&&cleanupVerified&&!blocker;
  return Object.freeze({
    contract:REPORT_CONTRACT,ok,mode:"one_shot_governed_staging",
    source_sha:expectedSha,policy_inventory_verified:ok,
    existing_policy_count:ok?policyCount:null,
    reader_revoked:cleanupVerified,
    blocker:ok?null:(!cleanupVerified?"READER_GRANT_CLEANUP_UNVERIFIED":
      blocker||"READER_GRANT_EXECUTION_FAILED"),
    backup_executed:false,restore_attested:false,
    qa_fixture_write_authorized:false,production_mutation:false,
    credentials_included:false,
  });
}
