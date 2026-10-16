import assert from "node:assert/strict";
import {createHash,generateKeyPairSync,randomBytes,sign} from "node:crypto";
import {canonicalSignedPayload,signedMessage}
  from "./staging-backup-broker-signed-os-evidence.mjs";
import {verifyStagingBrokerWitnessReceipt as check,witnessReceiptBytes,witnessSigningMessage}
  from "./staging-backup-broker-witness-receipt.mjs";

const now=Date.now();
const sha="57680a406f1d29610dfaf901c06330c0bf491866";
const exe="8771be99cb7a54b58cc7a5ab11fb3dc095429f7c7832b7346981c9921045144a";
const nonce=randomBytes(32).toString("hex");
const expected={commit:sha,binary_sha256:exe,challenge_nonce:nonce};
function makeKeys(role){
  const {privateKey,publicKey}=generateKeyPairSync("ed25519");
  const spki=publicKey.export({format:"der",type:"spki"});
  return {privateKey,pin:{
    spki_der_b64:spki.toString("base64"),
    spki_sha256:createHash("sha256").update(spki).digest("hex"),
    ...(role==="os"?{signer_key_id:"os-signing-ephemeral-test"}:
      {witness_key_id:"audit-witness-ephemeral-test"})
  }};
}
const os=makeKeys("os"),witness=makeKeys("witness");
const evidence={
  contract:"mad4b.staging.backup-broker.os-evidence.v1",
  mode:"elevated_local_os_read_only",
  device_id:"DESKTOP-91FDEFP",exact_staging_sha:sha,
  service_name:"Mad4B-Staging-Backup-Db-Broker",
  service_pid:18316,service_running:true,start_mode:"Manual",
  service_virtual_identity:"NT SERVICE\\Mad4B-Staging-Backup-Db-Broker",
  service_sid_type:"UNRESTRICTED",binary_sha256:exe,
  directory_acl_protected:true,directory_acl_exact_three_principals:true,
  binary_acl_no_unexpected_principals:true,os_evidence_checks_passed:true,
  independently_signed:false,externally_custodied:false,
  operational_broker_certified:false,db_admin_authorized:false,
  backup_executed:false,restore_executed:false,production_mutation:false,
  generated_at_utc:new Date(now-40000).toISOString()
};
const payload={
  contract:"mad4b.staging.backup-broker.signed-os-evidence-payload.v1",
  audience:"mad4b.staging.backup-broker.os-evidence-check",
  challenge_nonce:nonce,os_evidence:evidence
};
const rawOs=Buffer.from(canonicalSignedPayload(payload),"utf8");
const osEnvelope={
  contract:"mad4b.staging.backup-broker.signed-os-evidence.v1",
  signer_key_id:os.pin.signer_key_id,
  payload_b64:rawOs.toString("base64"),
  signature_b64:sign(null,signedMessage(rawOs),os.privateKey).toString("base64")
};
const osHash=createHash("sha256").update(rawOs).digest("hex");
const witnessPayload={
  contract:"mad4b.staging.backup-broker.witness-payload.v1",
  scope:"staging_os_evidence_read_only",receipt_id:randomBytes(32).toString("hex"),
  os_evidence_sha256:osHash,
  os_signer_spki_sha256:os.pin.spki_sha256,
  witness_nonce:nonce,staging_sha:sha,broker_binary_sha256:exe,
  witnessed_at_utc:new Date(now-15000).toISOString()
};
function wrap(data=witnessPayload,key=witness.privateKey){
  const raw=witnessReceiptBytes(data);
  return {contract:"mad4b.staging.backup-broker.witness-receipt.v1",
    witness_key_id:witness.pin.witness_key_id,
    payload_b64:raw.toString("base64"),
    signature_b64:sign(null,witnessSigningMessage(raw),key).toString("base64")
  };
}
const args={osEnvelope,osPin:os.pin,witnessEnvelope:wrap(),
  witnessPin:witness.pin,expected,nowMs:now};
const good=check(args);
assert.equal(good.signed_os_evidence_valid,true);
assert.equal(good.witness_signature_valid,true);
assert.equal(good.witness_bindings_valid,true);
assert.equal(good.immutable_external_audit_verified,false);
assert.equal(good.replay_registry_verified,false);
assert.equal(good.independently_attested,false);
assert.equal(good.broker_operationally_certified,false);
assert.equal(good.db_admin_authorized,false);
assert.equal(good.production_mutation,false);
assert(good.blockers.includes("BROKER_WITNESS_KEY_EXTERNAL_PIN_CUSTODY_REQUIRED"));
assert(good.blockers.includes("BROKER_EXTERNAL_IMMUTABLE_AUDIT_REQUIRED"));
assert(good.blockers.includes("BROKER_CHALLENGE_ISSUANCE_AND_REPLAY_REGISTRY_REQUIRED"));

let negative=0;
function deny(change,name,blocker){
  const r=check({...args,...change});
  assert.equal(r.witness_signature_valid,false,name);
  assert.equal(r.independently_attested,false,name);
  assert.equal(r.db_admin_authorized,false,name);
  assert.equal(r.production_mutation,false,name);
  if(blocker)assert(r.blockers.includes(blocker),name+":"+r.blockers.join(","));
  negative++;
}
deny({expected:{...expected,commit:"f".repeat(40)}},"wrong commit","BROKER_SIGNED_OS_EVIDENCE_NOT_VERIFIED");
deny({expected:{...expected,binary_sha256:"0".repeat(64)}},"wrong binary","BROKER_SIGNED_OS_EVIDENCE_NOT_VERIFIED");
deny({expected:{...expected,challenge_nonce:"e".repeat(64)}},"wrong nonce","BROKER_SIGNED_OS_EVIDENCE_NOT_VERIFIED");
deny({witnessPin:os.pin},"same signer pin","BROKER_WITNESS_PIN_FORMAT_INVALID");
deny({witnessPin:{...witness.pin,spki_sha256:os.pin.spki_sha256}},"same signer digest","BROKER_WITNESS_KEY_PIN_MISMATCH");
deny({witnessPin:{...witness.pin,witness_key_id:"wrong-key-id"}},"key identifier","BROKER_WITNESS_KEY_ID_MISMATCH");
deny({witnessEnvelope:{...args.witnessEnvelope,signature_b64:"x"}},"invalid signature");
const outsider=makeKeys("witness");
deny({witnessEnvelope:wrap(witnessPayload,outsider.privateKey)},"wrong key","BROKER_WITNESS_SIGNATURE_INVALID");
deny({witnessEnvelope:wrap({...witnessPayload,scope:"staging_db_admin"})},"privilege escalation","BROKER_WITNESS_EVIDENCE_BINDING_MISMATCH");
deny({witnessEnvelope:wrap({...witnessPayload,production_mutation:true})},"forged claims","BROKER_WITNESS_EVIDENCE_BINDING_MISMATCH");
deny({witnessEnvelope:wrap({...witnessPayload,receipt_id:"bad"})},"bad receipt id","BROKER_WITNESS_EVIDENCE_BINDING_MISMATCH");
deny({witnessEnvelope:wrap({...witnessPayload,os_evidence_sha256:"a".repeat(64)})},"swapped evidence","BROKER_WITNESS_EVIDENCE_BINDING_MISMATCH");
deny({witnessEnvelope:wrap({...witnessPayload,os_signer_spki_sha256:"b".repeat(64)})},"swapped signer","BROKER_WITNESS_EVIDENCE_BINDING_MISMATCH");
deny({witnessEnvelope:wrap({...witnessPayload,witness_nonce:"f".repeat(64)})},"unissued nonce","BROKER_WITNESS_EVIDENCE_BINDING_MISMATCH");
deny({witnessEnvelope:wrap({...witnessPayload,staging_sha:"a".repeat(40)})},"changed sha","BROKER_WITNESS_EVIDENCE_BINDING_MISMATCH");
deny({witnessEnvelope:wrap({...witnessPayload,broker_binary_sha256:"c".repeat(64)})},"changed exe","BROKER_WITNESS_EVIDENCE_BINDING_MISMATCH");
deny({witnessEnvelope:wrap({...witnessPayload,witnessed_at_utc:new Date(now-720000).toISOString()})},"expired","BROKER_WITNESS_TIMESTAMP_INVALID");
deny({witnessEnvelope:wrap({...witnessPayload,witnessed_at_utc:new Date(now+120000).toISOString()})},"future","BROKER_WITNESS_TIMESTAMP_INVALID");
deny({osEnvelope:{...osEnvelope,signature_b64:"a".repeat(88)}},"forged OS evidence","BROKER_SIGNED_OS_EVIDENCE_NOT_VERIFIED");
deny({witnessEnvelope:{...args.witnessEnvelope,external_custody_verified:true}},"caller self attest","BROKER_WITNESS_ENVELOPE_SCHEMA_INVALID");
const badBytes=Buffer.from(JSON.stringify(witnessPayload),"utf8");
assert.notEqual(badBytes.toString("utf8"),witnessReceiptBytes(witnessPayload).toString("utf8"));
deny({witnessEnvelope:{...args.witnessEnvelope,
  payload_b64:badBytes.toString("base64"),
  signature_b64:sign(null,witnessSigningMessage(badBytes),witness.privateKey).toString("base64")
}},"noncanonical","BROKER_WITNESS_PAYLOAD_NONCANONICAL");
assert(negative>=20);
console.log(JSON.stringify({
  contract:"mad4b.staging.backup-broker.witness-verification.test.v1",
  passed:true,synthetic_ephemeral_keys_only:true,
  adversarial_cases:negative,dual_signature_consistency:true,
  independent_custody:false,immutable_external_audit:false,
  durable_replay_protection:false,operational_broker_authority:false,
  production_mutation:false
}));
