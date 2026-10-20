// Staging-only Local Connector authority adapter. No HTTP route, SQL writes,
// credential reads, approval issuance, deploy, or Production mutation.
import {createHash,timingSafeEqual} from "node:crypto";
import {assessGovernedStagingBackup,executeGovernedStagingBackup,STAGING_QA_POLICY_KEY} from "./stagingGovernedEncryptedBackup.mjs";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{40}$/i;
function fail(code){const e=new Error(code);e.code=code;throw e;}
function one(rows,missing,ambiguous){
  if(!Array.isArray(rows)||rows.length===0)fail(missing);
  if(rows.length!==1)fail(ambiguous);
  // Uniqueness is enforced before destructuring; no arbitrary-first selection.
  const [uniqueRow]=rows;
  return uniqueRow;
}
function resultRows(value){if(!Array.isArray(value)||!Array.isArray(value[0]))fail("LOCAL_AUTHORITY_QUERY_INVALID");return value[0];}
function jsonOps(value){try{const a=typeof value==="string"?JSON.parse(value):value;if(!Array.isArray(a)||a.some(x=>typeof x!=="string"))throw 0;return a;}catch{fail("DESTINATION_OPERATION_POLICY_INVALID");}}
function iso(value){if(value instanceof Date)return value.toISOString();if(typeof value==="string"&&/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value))return value.replace(" ","T")+"Z";return String(value??"");}
function snapshotSha(snapshot){return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");}
function sameDigest(a,b){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
function verifyMeasuredIdentity(i,sha){
  if(i?.deployment_environment!=="staging_local_windows_docker"||
    i?.runtime_class!=="local_windows_docker"||i?.executor!=="local_connector"||
    i?.local_connector_verified!==true||!SHA.test(String(sha||""))||i.source_sha!==sha||
    typeof i.device_id!=="string"||i.device_id.length<3||
    !/^[a-z][a-z0-9_]{0,62}$/i.test(String(i.database_name||""))||
    !/^(127\.0\.0\.1|localhost|staging[.-][a-z0-9.-]+)$/i.test(String(i.source_endpoint_family||""))||
    !String(i.source_location_key||"").startsWith("database:staging:")||
    !String(i.destination_location_key||"").startsWith("local:")||
    typeof i.destination_path!=="string"||!i.destination_path)
    fail("MEASURED_STAGING_CONNECTOR_IDENTITY_REQUIRED");
}
const POLICY_SQL=[
  "SELECT p.policy_id,p.policy_key,p.backup_kind,p.status,p.activation_gate_status,",
  "p.allowed_executor,p.artifact_format,p.encryption_scheme,p.checksum_algorithm,",
  "p.approval_required,p.restore_test_required,",
  "s.location_key AS source_key,s.location_type AS source_type,s.status AS source_status,",
  "d.location_id AS destination_id,d.location_key AS destination_key,",
  "d.location_type AS destination_type,d.provider AS destination_provider,",
  "d.status AS destination_status,d.device_id AS destination_device_id,",
  "d.path_or_ref AS destination_path,d.allowed_operations_json AS destination_ops",
  "FROM platform_backup_policies p",
  "JOIN platform_copy_locations s ON s.location_id=p.source_location_id",
  "JOIN platform_copy_locations d ON d.location_id=p.destination_location_id",
  "WHERE p.policy_key=? LIMIT 2"
].join(" ");
const APPROVAL_SQL=[
  "SELECT approval_id,policy_id,approval_type,status,approved_by,decision_source,decided_at,expires_at",
  "FROM platform_backup_approvals",
  "WHERE approval_id=? AND policy_id=? AND approval_type='backup_apply' LIMIT 2"
].join(" ");
const RUN_SQL="SELECT run_id,policy_id,run_mode,status FROM platform_backup_runs WHERE run_id=? LIMIT 2";

// Strict SELECT-only SQL. The caller's DB handle must be provisioned independently
// by a measured local connector with least-privileged Staging grants.
export async function readLocalStagingBackupAuthority({db,identityProvider,expectedSourceSha,approvalId,keyRef}={}){
  if(typeof db?.query!=="function"||typeof identityProvider!=="function")
    fail("TRUSTED_STAGING_READ_ADAPTERS_REQUIRED");
  const identity=await identityProvider();
  verifyMeasuredIdentity(identity,expectedSourceSha);
  if(!UUID.test(String(approvalId||"")))fail("EXACT_BACKUP_APPLY_APPROVAL_ID_REQUIRED");
  if(!/^local-custody:[a-z0-9][a-z0-9_-]{2,127}$/i.test(String(keyRef||"")))
    fail("INDEPENDENT_KEY_CUSTODY_REFERENCE_REQUIRED");

  let p,a;
  try{p=one(resultRows(await db.query(POLICY_SQL,[STAGING_QA_POLICY_KEY])),
    "STAGING_BACKUP_POLICY_NOT_FOUND","AMBIGUOUS_STAGING_BACKUP_POLICY");}
  catch(e){if(e.code)throw e;fail("STAGING_POLICY_READ_NOT_AUTHORIZED");}
  if(p.source_key!==identity.source_location_key||p.source_type!=="database"||
    p.source_status!=="active"||p.destination_key!==identity.destination_location_key||
    p.destination_path!==identity.destination_path||
    p.destination_device_id!==identity.device_id||
    /(?:^|[^a-z])(production|prod|hostinger)(?:[^a-z]|$)/i.test(p.destination_path))
    fail("STAGING_SOURCE_DESTINATION_BINDING_MISMATCH");
  const ops=jsonOps(p.destination_ops);
  try{a=one(resultRows(await db.query(APPROVAL_SQL,[approvalId,p.policy_id])),
    "BACKUP_APPLY_APPROVAL_NOT_FOUND","AMBIGUOUS_BACKUP_APPLY_APPROVAL");}
  catch(e){if(e.code)throw e;fail("STAGING_APPROVAL_READ_NOT_AUTHORIZED");}
  const result={
    expected_source_sha:expectedSourceSha,key_ref:keyRef,
    policy:{policy_id:p.policy_id,policy_key:p.policy_key,backup_kind:p.backup_kind,
      status:p.status,activation_gate_status:p.activation_gate_status,
      allowed_executor:p.allowed_executor,artifact_format:p.artifact_format,
      encryption_scheme:p.encryption_scheme,checksum_algorithm:p.checksum_algorithm,
      approval_required:Number(p.approval_required)===1,
      restore_test_required:Number(p.restore_test_required),
      source_status:p.source_status,destination_status:p.destination_status},
    approval:{approval_id:a.approval_id,policy_id:a.policy_id,approval_type:a.approval_type,
      status:a.status,approved_by:a.approved_by,decision_source:a.decision_source,
      decided_at:iso(a.decided_at),expires_at:iso(a.expires_at)},
    source:{environment:"staging",database_name:identity.database_name,
      endpoint_family:identity.source_endpoint_family},
    destination:{location_id:p.destination_id,location_key:p.destination_key,
      location_type:p.destination_type,provider:p.destination_provider,
      status:p.destination_status,path_or_ref:p.destination_path,allowed_operations:ops},
    runtime:{deployment_environment:identity.deployment_environment,
      runtime_class:identity.runtime_class,executor:identity.executor,
      local_connector_verified:identity.local_connector_verified,
      device_id:identity.device_id,source_sha:identity.source_sha}
  };
  const x=result.policy,dec=result.approval,d=result.destination;
  if(dec.approval_id!==approvalId||dec.policy_id!==x.policy_id)
    fail("BACKUP_APPLY_APPROVAL_IDENTITY_MISMATCH");
  if(x.policy_key!==STAGING_QA_POLICY_KEY||x.status!=="active"||
    x.activation_gate_status!=="active"||x.allowed_executor!=="local_connector"||
    x.backup_kind!=="database"||x.artifact_format!=="sql_dump"||
    x.encryption_scheme!=="platform_managed"||x.checksum_algorithm!=="sha256"||
    !x.approval_required||x.restore_test_required!==1||
    d.location_type!=="local_device_path"||d.provider!=="local_connector"||
    d.status!=="active"||!ops.includes("write_approved_backup_artifacts"))
    fail("APPROVED_STAGING_BACKUP_POLICY_NOT_ACTIVE");
  if(dec.status!=="approved"||dec.approval_type!=="backup_apply"||
    !["admin_session","external_ticket"].includes(dec.decision_source)||
    !dec.approved_by||!Number.isFinite(Date.parse(dec.decided_at))||
    Date.parse(dec.decided_at)>Date.now()||Date.parse(dec.expires_at)<=Date.now())
    fail("BACKUP_APPLY_APPROVAL_NOT_CURRENT");
  return result;
}
export async function planLocalStagingBackup(options={}){
  try{
    const s=await readLocalStagingBackupAuthority(options);
    return {contract:"mad4b.staging-local-backup-plan.v1",ok:true,mode:"read_only",
      source_sha:s.expected_source_sha,policy_key:STAGING_QA_POLICY_KEY,
      approval_id:s.approval.approval_id,destination_key:s.destination.location_key,
      snapshot_sha256:snapshotSha(s),backup_executed:false,restore_attested:false,
      qa_fixture_write_authorized:false,production_mutation:false};
  }catch(e){
    return {contract:"mad4b.staging-local-backup-plan.v1",ok:false,mode:"read_only",
      blockers:[e.code||"STAGING_READINESS_UNAVAILABLE"],backup_executed:false,
      restore_attested:false,qa_fixture_write_authorized:false,production_mutation:false};
  }
}

// Privileged composition seam, NEVER an HTTP/remote API or approval issuer.
// A trustworthy Local Connector must inject a pinned signing key and private
// run-ledger, ACL, key-store, streaming dump and signer implementations.
export async function executeWithTrustedLocalConnector({
  db,identityProvider,expectedSourceSha,approvalId,keyRef,
  signedEnvelope,signature_b64,trustedOwnerPublicKey,localAdapters,executionIntent
}={}){
  if(executionIntent!=="explicit_owner_approved_staging_backup_apply"||
     !trustedOwnerPublicKey||typeof localAdapters?.open_dump!=="function"||
     typeof localAdapters?.read_key!=="function"||
     typeof localAdapters?.sign_manifest!=="function"||
     typeof localAdapters?.assert_private_acl!=="function"||
     typeof localAdapters?.destination_dir!=="string"||
     typeof localAdapters?.ledger_dir!=="string")
    fail("TRUSTED_LOCAL_APPLY_COMPOSITION_NOT_READY");
  const opts={db,identityProvider,expectedSourceSha,approvalId,keyRef};
  const initial=await readLocalStagingBackupAuthority(opts);
  if(!UUID.test(String(signedEnvelope?.run_id||"")))fail("SIGNED_BACKUP_RUN_ID_REQUIRED");
  const runId=signedEnvelope.run_id;
  const run=one(resultRows(await db.query(RUN_SQL,[runId])),
    "APPROVED_BACKUP_RUN_RECORD_MISSING","AMBIGUOUS_BACKUP_RUN_RECORD");
  if(run.run_id!==runId||run.policy_id!==initial.policy.policy_id||
    run.run_mode!=="apply"||run.status!=="planned")
    fail("APPROVED_BACKUP_RUN_NOT_PREPARED");
  const digest=snapshotSha(initial);
  const verify_authority_snapshot=async()=>{
    const current=await readLocalStagingBackupAuthority(opts);
    const currentRun=one(resultRows(await db.query(RUN_SQL,[runId])),
      "APPROVED_BACKUP_RUN_RECORD_MISSING","AMBIGUOUS_BACKUP_RUN_RECORD");
    return sameDigest(digest,snapshotSha(current))&&
      currentRun.run_id===runId&&currentRun.policy_id===initial.policy.policy_id&&
      currentRun.run_mode==="apply"&&
      currentRun.status==="planned";
  };
  return executeGovernedStagingBackup(
    {...initial,envelope:signedEnvelope,signature_b64},
    {...localAdapters,trusted_owner_public_key_pem:trustedOwnerPublicKey,verify_authority_snapshot}
  );
}
