import assert from "node:assert/strict";
import {createHash,generateKeyPairSync,randomBytes,sign} from "node:crypto";
import {canonicalSignedPayload,signedMessage}
  from "./staging-backup-broker-signed-os-evidence.mjs";
import {witnessReceiptBytes,witnessSigningMessage,
  verifyStagingBrokerWitnessReceipt}
  from "./staging-backup-broker-witness-receipt.mjs";
import {verifyStagingBrokerExternalAuditReadback as verify}
  from "./staging-backup-broker-audit-readback.mjs";
const sha256=b=>createHash("sha256").update(b).digest("hex");
const now=Date.now();
const commit="e2f2ff7dee1f8c39cebfbc2e853a10e643d1b577";
const binary="8771be99cb7a54b58cc7a5ab11fb3dc095429f7c7832b7346981c9921045144a";
const nonce=randomBytes(32).toString("hex");
const expected={commit,binary_sha256:binary,challenge_nonce:nonce,provider_id:"separate-audit-provider-test"};
function keys(role){
  const {publicKey,privateKey}=generateKeyPairSync("ed25519");
  const der=publicKey.export({format:"der",type:"spki"});
  const b64=der.toString("base64"),digest=sha256(der);
  return {privateKey,pin:role==="owner"?
    {signer_key_id:"owner-ephemeral-test-key",spki_der_b64:b64,spki_sha256:digest}:
    role==="witness"?
    {witness_key_id:"witness-ephemeral-test-key",spki_der_b64:b64,spki_sha256:digest}:
    {provider_key_id:"provider-ephemeral-test-key",spki_der_b64:b64,spki_sha256:digest}};
}
const os=keys("owner"),witness=keys("witness"),provider=keys("provider");
const osEvidence={
  contract:"mad4b.staging.backup-broker.os-evidence.v1",
  mode:"elevated_local_os_read_only",device_id:"DESKTOP-91FDEFP",
  exact_staging_sha:commit,service_name:"Mad4B-Staging-Backup-Db-Broker",
  service_pid:18316,service_running:true,start_mode:"Manual",
  service_virtual_identity:"NT SERVICE\\Mad4B-Staging-Backup-Db-Broker",
  service_sid_type:"UNRESTRICTED",binary_sha256:binary,
  directory_acl_protected:true,directory_acl_exact_three_principals:true,
  binary_acl_no_unexpected_principals:true,os_evidence_checks_passed:true,
  independently_signed:false,externally_custodied:false,
  operational_broker_certified:false,db_admin_authorized:false,
  backup_executed:false,restore_executed:false,production_mutation:false,
  generated_at_utc:new Date(now-45000).toISOString()
};
const osPayload={
  contract:"mad4b.staging.backup-broker.signed-os-evidence-payload.v1",
  audience:"mad4b.staging.backup-broker.os-evidence-check",
  challenge_nonce:nonce,os_evidence:osEvidence
};
const osBytes=Buffer.from(canonicalSignedPayload(osPayload),"utf8");
const osEnvelope={
  contract:"mad4b.staging.backup-broker.signed-os-evidence.v1",
  signer_key_id:os.pin.signer_key_id,payload_b64:osBytes.toString("base64"),
  signature_b64:sign(null,signedMessage(osBytes),os.privateKey).toString("base64")
};
const witnessPayload={
  contract:"mad4b.staging.backup-broker.witness-payload.v1",
  scope:"staging_os_evidence_read_only",receipt_id:randomBytes(32).toString("hex"),
  os_evidence_sha256:sha256(osBytes),os_signer_spki_sha256:os.pin.spki_sha256,
  witness_nonce:nonce,staging_sha:commit,broker_binary_sha256:binary,
  witnessed_at_utc:new Date(now-18000).toISOString()
};
const witnessBytes=witnessReceiptBytes(witnessPayload);
const witnessEnvelope={
  contract:"mad4b.staging.backup-broker.witness-receipt.v1",
  witness_key_id:witness.pin.witness_key_id,
  payload_b64:witnessBytes.toString("base64"),
  signature_b64:sign(null,witnessSigningMessage(witnessBytes),
    witness.privateKey).toString("base64")
};
const pair=verifyStagingBrokerWitnessReceipt({
  osEnvelope,osPin:os.pin,witnessEnvelope,witnessPin:witness.pin,expected,nowMs:now
});
assert.equal(pair.witness_signature_valid,true);
const readbackBytes=Buffer.from(canonicalSignedPayload(witnessEnvelope),"utf8");
const auditPayload={
  contract:"mad4b.staging.backup-broker.audit-provider-payload.v1",
  scope:"staging_os_evidence_witness_receipt",
  provider_id:expected.provider_id,
  provider_object_key:"staging/backup-broker/witness/"+sha256(readbackBytes)+".json",
  object_version:"version-immutable-test-001",
  retention_mode:"COMPLIANCE",
  retain_until_utc:new Date(now+31*86400000).toISOString(),
  readback_sha256:sha256(readbackBytes),
  witness_payload_sha256:pair.witness_receipt_sha256,
  challenge_nonce:nonce,staging_sha:commit,
  issued_at_utc:new Date(now-15000).toISOString()
};
const domain=Buffer.from("MAD4B/STAGING/BROKER/EXTERNAL-AUDIT-READBACK/V1\n","utf8");
function signedEnvelope(payload=auditPayload,privateKey=provider.privateKey){
  const bytes=Buffer.from(canonicalSignedPayload(payload),"utf8");
  return {
    contract:"mad4b.staging.backup-broker.audit-provider-receipt.v1",
    provider_key_id:provider.pin.provider_key_id,
    payload_b64:bytes.toString("base64"),
    signature_b64:sign(null,Buffer.concat([domain,bytes]),privateKey).toString("base64")
  };
}
const args={osEnvelope,osPin:os.pin,witnessEnvelope,witnessPin:witness.pin,
  providerEnvelope:signedEnvelope(),providerPin:provider.pin,readbackBytes,
  expected,nowMs:now};
const passed=verify(args);
assert.equal(passed.os_witness_pair_consistent,true);
assert.equal(passed.provider_signature_valid,true);
assert.equal(passed.provider_retention_claim_consistent,true);
assert.equal(passed.readback_bytes_identical,true);
for(const k of ["external_custody_verified","externally_immutable_audit_verified",
  "external_retention_policy_independently_measured",
  "external_readback_independently_authenticated",
  "trusted_provider_key_independently_pinned",
  "replay_registry_externally_controlled",
  "broker_operationally_certified","db_admin_authorized","production_mutation"])
  assert.equal(passed[k],false,k);
assert(passed.blockers.includes("BROKER_AUDIT_REMOTE_WORM_RETENTION_VERIFICATION_REQUIRED"));
let negatives=0;
function deny(changes,reason){
  const result=verify({...args,...changes});
  assert.equal(result.provider_signature_valid,false,reason);
  assert.equal(result.externally_immutable_audit_verified,false,reason);
  assert.equal(result.db_admin_authorized,false,reason);
  assert(result.blockers.length>0,reason);
  negatives++;
}
const spoof=k=>signedEnvelope({...auditPayload,...k});
deny({expected:{...expected,commit:"a".repeat(40)}},"stale source");
deny({expected:{...expected,challenge_nonce:"a".repeat(64)}},"nonce swap");
deny({expected:{...expected,binary_sha256:"a".repeat(64)}},"binary mismatch");
deny({expected:{...expected,provider_id:"other-provider"}},"provider mismatch");
deny({readbackBytes:Buffer.from("modified-audit-contents","utf8")},"readback modification");
deny({readbackBytes:Buffer.concat([readbackBytes,Buffer.from(" ")])},"trailing bytes");
deny({providerEnvelope:spoof({retention_mode:"GOVERNANCE"})},"retention downgrade");
deny({providerEnvelope:spoof({retain_until_utc:new Date(now+60000).toISOString()})},"short retention");
deny({providerEnvelope:spoof({readback_sha256:"b".repeat(64)})},"provider claim changed");
deny({providerEnvelope:spoof({witness_payload_sha256:"c".repeat(64)})},"witness changed");
deny({providerEnvelope:spoof({provider_object_key:"production/forged"})},"production object path");
deny({providerEnvelope:spoof({staging_sha:"b".repeat(40)})},"cross-release");
deny({providerEnvelope:spoof({challenge_nonce:"d".repeat(64)})},"receipt rebind");
deny({providerEnvelope:spoof({db_admin_authorized:true})},"authority injection");
deny({providerEnvelope:{...args.providerEnvelope,signature_b64:"x"}},"forged signature");
deny({providerEnvelope:signedEnvelope(auditPayload,keys("provider").privateKey)},"different key");
deny({providerPin:{...provider.pin,spki_sha256:os.pin.spki_sha256}},"wrong provider key pin");
deny({providerPin:{...provider.pin,spki_sha256:witness.pin.spki_sha256}},"reused witness pin");
deny({providerEnvelope:{...args.providerEnvelope,external_custody_verified:true}},"caller self-certification");
deny({providerEnvelope:spoof({issued_at_utc:new Date(now-720000).toISOString()})},"stale receipt");
deny({providerEnvelope:spoof({issued_at_utc:new Date(now+120000).toISOString()})},"future receipt");
const normalJSON=Buffer.from(JSON.stringify(auditPayload),"utf8");
assert.notEqual(normalJSON.toString("utf8"),
  canonicalSignedPayload(auditPayload));
deny({providerEnvelope:{
 ...args.providerEnvelope,
 payload_b64:normalJSON.toString("base64"),
 signature_b64:sign(null,Buffer.concat([domain,normalJSON]),provider.privateKey).toString("base64")
}},"noncanonical signed bytes");
assert(negatives>=22);
console.log(JSON.stringify({
  contract:"mad4b.staging.backup-broker.audit-readback.test.v1",
  passed:true,cryptographic_witness_and_provider_consistency:true,
  adversarial_cases:negatives,
  synthetic_ephemeral_signers_only:true,
  real_provider_connected:false,independent_worm_attested:false,
  operational_broker_certified:false,db_admin_authorized:false,
  backup_executed:false,restore_executed:false,production_mutation:false
}));
