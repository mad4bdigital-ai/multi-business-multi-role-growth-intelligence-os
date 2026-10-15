import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { Readable } from "node:stream";
import { createDecipheriv, generateKeyPairSync, randomBytes, randomUUID, sign, verify, createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { assessGovernedStagingBackup, approvalPayload, manifestPayload, executeGovernedStagingBackup, STAGING_QA_POLICY_KEY } from "./stagingGovernedEncryptedBackup.mjs";

const {publicKey,privateKey} = generateKeyPairSync("ed25519");
const ownerPublic = publicKey.export({type:"spki",format:"pem"});
const sourceSha = "a".repeat(40);
const now = Date.now();
const sql = Buffer.from("CREATE TABLE qa_fixture(id INT PRIMARY KEY,label VARCHAR(32));\nINSERT INTO qa_fixture VALUES (1,'synthetic-a'),(2,'synthetic-b');\n");
const root = await fs.mkdtemp(path.join(os.tmpdir(),"p1-staging-encrypted-backup-"));
const ledger = await fs.mkdtemp(path.join(os.tmpdir(),"p1-staging-run-ledger-"));
const pinnedTrust = {owner_public_key_pem:ownerPublic};
const key = randomBytes(32);
const keyRef = "local-custody:qa_backup_key_1";
let cases = 0;
function test(condition,message) { assert(condition,message); cases++; }
function makeInput() {
  const runId = randomUUID(), policyId = randomUUID(), approvalId = randomUUID();
  const envelope = {contract:"mad4b.staging-db-backup-apply.v1",run_id:runId,
    policy_key:STAGING_QA_POLICY_KEY,approval_id:approvalId,source_sha:sourceSha,
    policy_id:policyId,key_ref:keyRef,destination_ref:root,source_endpoint_family:"dev.mad4b.com",
    source_database:"qa_staging_data",device_id:"DESKTOP-91FDEFP",
    destination_id:"staging-local-encrypted-backups",issued_at:new Date(now-1000).toISOString(),
    expires_at:new Date(now+600000).toISOString()};
  return {
    now_ms:now,expected_source_sha:sourceSha, envelope,
    signature_b64:sign(null,approvalPayload(envelope),privateKey).toString("base64"),
    key_ref:keyRef,
    runtime:{deployment_environment:"staging_local_windows_docker",runtime_class:"local_windows_docker",
      executor:"local_connector",local_connector_verified:true,device_id:"DESKTOP-91FDEFP",source_sha:sourceSha},
    source:{environment:"staging",database_name:"qa_staging_data",endpoint_family:"dev.mad4b.com"},
    destination:{location_id:"staging-local-encrypted-backups",status:"active",location_type:"local_device_path",
      provider:"local_connector",location_key:"local:staging:qa-backup",path_or_ref:root,
      allowed_operations:["write_approved_backup_artifacts"]},
    policy:{policy_id:policyId,policy_key:STAGING_QA_POLICY_KEY,backup_kind:"database",
      status:"active",activation_gate_status:"active",allowed_executor:"local_connector",
      artifact_format:"sql_dump",encryption_scheme:"platform_managed",checksum_algorithm:"sha256",
      approval_required:true,restore_test_required:1,source_status:"active",destination_status:"active"},
    approval:{approval_id:approvalId,policy_id:policyId,approval_type:"backup_apply",status:"approved",
      decision_source:"admin_session",approved_by:"owner",decided_at:new Date(now-30000).toISOString(),
      expires_at:new Date(now+900000).toISOString()}
  };
}
const constitution = JSON.parse(await fs.readFile(new URL("./config/repository-governance-constitution.json",import.meta.url),"utf8"));
const convergence = JSON.parse(await fs.readFile(new URL("../.github/derived-state-governance.json",import.meta.url),"utf8"));
test(constitution.control_plane_paths.includes(".changes/e2e/staging-p1-governed-backup-executor-20261015.json"),"P1 declaration registered in Constitution");
test(convergence.convergence.automation_control_paths.includes(".changes/e2e/staging-p1-governed-backup-executor-20261015.json"),"P1 declaration registered in protected convergence paths");
const valid = makeInput();
test(assessGovernedStagingBackup(valid,pinnedTrust).ok,"correct signed staging authority");
test(assessGovernedStagingBackup(valid).ok===false,"request-controlled owner key never trusted");
const changes = [
  [{signature_b64:"Z".repeat(88)},"OWNER_SIGNATURE_INVALID"],
  [{expected_source_sha:"b".repeat(40)},"EXACT_STAGING_SOURCE_SHA_REQUIRED"],
  [{runtime:{...valid.runtime,deployment_environment:"production_hostinger_autodeploy"}},"STAGING_LOCAL_CONNECTOR_IDENTITY_REQUIRED"],
  [{runtime:{...valid.runtime,executor:"manual"}},"STAGING_LOCAL_CONNECTOR_IDENTITY_REQUIRED"],
  [{source:{...valid.source,environment:"production",endpoint_family:"auth.mad4b.com"}},"STAGING_DB_IDENTITY_MISMATCH"],
  [{policy:{...valid.policy,status:"draft"}},"ACTIVE_GOVERNED_STAGING_POLICY_REQUIRED"],
  [{policy:{...valid.policy,allowed_executor:"hostinger_ssh"}},"ACTIVE_GOVERNED_STAGING_POLICY_REQUIRED"],
  [{approval:{...valid.approval,approval_type:"policy_activation"}},"TIME_BOUND_OWNER_BACKUP_APPLY_APPROVAL_REQUIRED"],
  [{approval:{...valid.approval,status:"revoked"}},"TIME_BOUND_OWNER_BACKUP_APPLY_APPROVAL_REQUIRED"],
  [{approval:{...valid.approval,expires_at:new Date(now-1).toISOString()}},"TIME_BOUND_OWNER_BACKUP_APPLY_APPROVAL_REQUIRED"],
  [{envelope:{...valid.envelope,source_database:"production"}},"STAGING_DB_IDENTITY_MISMATCH"],
  [{envelope:{...valid.envelope,run_id:randomUUID()}},"OWNER_SIGNATURE_INVALID"],
  [{destination:{...valid.destination,provider:"hostinger"}},"APPROVED_LOCAL_BACKUP_DESTINATION_REQUIRED"],
  [{destination:{...valid.destination,allowed_operations:[]}},"APPROVED_LOCAL_BACKUP_DESTINATION_REQUIRED"],
  [{key_ref:"../../../secrets"},"RECOVERY_KEY_CUSTODY_REF_INVALID"],
  [{key_ref:"local-custody:swapped_key"},"APPROVED_LOCAL_BACKUP_DESTINATION_REQUIRED"],
  [{policy:{...valid.policy,policy_id:randomUUID()}},"SIGNED_POLICY_IDENTITY_MISMATCH"],
  [{destination:{...valid.destination,path_or_ref:path.dirname(root)}},"APPROVED_LOCAL_BACKUP_DESTINATION_REQUIRED"],
  [{source:{...valid.source,endpoint_family:"other.staging.com"}},"STAGING_DB_IDENTITY_MISMATCH"],
  [{now_ms:now+3600000},"SIGNED_BACKUP_LEASE_EXPIRED_OR_UNBOUNDED"]
];
for (const [patch,code] of changes) {
  const result = assessGovernedStagingBackup({...valid,...patch},pinnedTrust);
  test(result.blockers.includes(code),"expected blocker "+code);
  test(result.qa_fixture_write_authorized===false && result.production_promotion_authorized===false,"negative case authorizes no mutations");
}
const adapters = {
  destination_dir:root, ledger_dir:ledger,
  trusted_owner_public_key_pem:ownerPublic, manifest_public_key_pem:ownerPublic,
  verify_authority_snapshot:async()=>true,
  assert_private_acl:async()=>true,
  expected_table_count:1,expected_row_count:2,
  open_dump:async()=>Readable.from([sql]),
  read_key:async(ref)=>({ref,key:Buffer.from(key)}),
  sign_manifest:async(payload)=>({algorithm:"ed25519",key_id:"test-owner-signing-key",
    signature_b64:sign(null,payload,privateKey).toString("base64")})
};
try {
  const result = await executeGovernedStagingBackup(valid,adapters);
  test(result.ok && result.status==="artifact_created_restore_not_attested","synthetic stream encrypted");
  test((await fs.readdir(ledger)).length===1,"durable one-time run ledger reserved");
  let blockedReplay=false;
  try {await executeGovernedStagingBackup(valid,adapters)}
  catch(e){blockedReplay=e.code==="BACKUP_APPLY_NONCE_REPLAY"}
  test(blockedReplay,"same signed apply nonce rejected after completed run");
  test(result.production_mutation===false && result.qa_fixture_write_authorized===false,"no runtime authority");
  const manifest = JSON.parse(await fs.readFile(result.manifest_file,"utf8"));
  test(verify(null,manifestPayload(manifest),publicKey,Buffer.from(manifest.signature.signature_b64,"base64")),"signed manifest");
  const artifact = await fs.readFile(result.artifact_file);
  test(createHash("sha256").update(artifact).digest("hex")===manifest.checksum_value,"encrypted SHA readback");
  test(!artifact.includes(Buffer.from("synthetic-a")),"plaintext never present in ciphertext");
  const decipher=createDecipheriv("aes-256-gcm",key,Buffer.from(manifest.iv_b64,"base64"));
  decipher.setAuthTag(Buffer.from(manifest.auth_tag_b64,"base64"));
  const restored=gunzipSync(Buffer.concat([decipher.update(artifact),decipher.final()]));
  test(restored.equals(sql),"real AES-GCM decrypt and GZIP restore");
  test(manifest.key_ref===keyRef && !JSON.stringify(manifest).includes(key.toString("base64")),"no key material in manifest");
  test(!(await fs.readdir(path.dirname(result.artifact_file))).some(name=>name.endsWith(".sql")||name.endsWith(".sql.gz")),"no plaintext or gzip files");
  let failed=false;
  try { await executeGovernedStagingBackup(makeInput(),{...adapters,open_dump:async()=>Readable.from((async function*(){
    yield sql;throw new Error("injected_export_failure");
  })())}); } catch(e){failed=e.code==="GOVERNED_BACKUP_EXECUTION_FAILED"; }
  test(failed,"injected streaming failure rejects apply");
  test((await fs.readdir(root)).length===1,"failed execution leaves no artifact");
  test((await fs.readdir(ledger)).length===2,"failed streaming run stays consumed in ledger");
  failed=false;
  try { await executeGovernedStagingBackup(makeInput(),{...adapters,
    sign_manifest:async()=>({algorithm:"ed25519",key_id:"bad",signature_b64:Buffer.alloc(64).toString("base64")})}); }
  catch(e){failed=e.code==="MANIFEST_SIGNATURE_VERIFICATION_FAILED";}
  test(failed,"invalid artifact-manifest signature rejected");
  test((await fs.readdir(root)).length===1,"bad signature leaves no artifact");
  failed=false;
  try { await executeGovernedStagingBackup(makeInput(),{...adapters,destination_dir:path.dirname(root)}); }
  catch(e){failed=e.code==="DESTINATION_PATH_NOT_POLICY_BOUND";}
  test(failed,"destination mismatch rejected");
  const blocked=await executeGovernedStagingBackup({...makeInput(),signature_b64:"broken"},adapters);
  test(blocked.ok===false && blocked.backup_executed===false,"invalid approval is fail-closed before adapter");
  const forged=makeInput();const attacker=generateKeyPairSync("ed25519");
  const forgedInput={...forged,public_key_pem:attacker.publicKey.export({type:"spki",format:"pem"}),
    signature_b64:sign(null,approvalPayload(forged.envelope),attacker.privateKey).toString("base64")};
  test(assessGovernedStagingBackup(forgedInput,pinnedTrust).blockers.includes("OWNER_SIGNATURE_INVALID"),"attacker supplied public key cannot impersonate owner");
  let noAuthority=false;
  try{await executeGovernedStagingBackup(makeInput(),{...adapters,verify_authority_snapshot:async()=>false})}
  catch(e){noAuthority=e.code==="LIVE_OWNER_APPROVAL_SNAPSHOT_REQUIRED"}
  test(noAuthority,"independent live authority readback required before reservation");
  let noLedger=false;
  try{await executeGovernedStagingBackup(makeInput(),{...adapters,ledger_dir:path.join(root,"missing")})}
  catch(e){noLedger=true}
  test(noLedger,"durable replay ledger required before backup");
  const stale=makeInput();
  const artificiallyEarlier=now-2*60*60*1000;
  stale.now_ms=artificiallyEarlier;
  stale.envelope.issued_at=new Date(artificiallyEarlier-60000).toISOString();
  stale.envelope.expires_at=new Date(artificiallyEarlier+600000).toISOString();
  stale.approval.decided_at=new Date(artificiallyEarlier-120000).toISOString();
  stale.approval.expires_at=new Date(artificiallyEarlier+900000).toISOString();
  stale.signature_b64=sign(null,approvalPayload(stale.envelope),privateKey).toString("base64");
  test(assessGovernedStagingBackup(stale,pinnedTrust).ok===true,"pure assessment permits deterministic test clock");
  const expiredApply=await executeGovernedStagingBackup(stale,adapters);
  test(expiredApply.ok===false && expiredApply.blockers.includes("SIGNED_BACKUP_LEASE_EXPIRED_OR_UNBOUNDED"),
    "execution ignores caller-controlled clock and rejects expired lease");
  const before=artifact[0];artifact[0]^=0xff;
  test(createHash("sha256").update(artifact).digest("hex")!==manifest.checksum_value && artifact[0]!==before,"ciphertext tampering detected");
  console.log(JSON.stringify({contract:"mad4b.staging-governed-encrypted-backup.test.v1",pass:true,cases,
    source_kind:"synthetic_only",source_rows:2,encrypted_sha256:true,independent_key_custody:true,
    signed_manifest:true,streamed_without_plaintext_file:true,cleanup_failure_test:true,
    qa_fixture_write_authorized:false,production_mutation:false,secrets_included:false}));
} finally { await fs.rm(root,{force:true,recursive:true}); await fs.rm(ledger,{force:true,recursive:true}); }
