import assert from "node:assert/strict";
import {createHash,generateKeyPairSync,randomBytes,sign} from "node:crypto";
import {
  canonicalSignedPayload,signedMessage,verifyStagingBrokerSignedOsEvidence as verify
} from "./staging-backup-broker-signed-os-evidence.mjs";
const sha="375983266da6130a569afc6c4e5e5b28003823ef";
const digest="8771be99cb7a54b58cc7a5ab11fb3dc095429f7c7832b7346981c9921045144a";
const nonce=randomBytes(32).toString("hex");
const now=Date.now();
const ev={
  contract:"mad4b.staging.backup-broker.os-evidence.v1",
  mode:"elevated_local_os_read_only",device_id:"DESKTOP-91FDEFP",
  exact_staging_sha:sha,service_name:"Mad4B-Staging-Backup-Db-Broker",
  service_pid:18316,service_running:true,start_mode:"Manual",
  service_virtual_identity:"NT SERVICE\\Mad4B-Staging-Backup-Db-Broker",
  service_sid_type:"UNRESTRICTED",binary_sha256:digest,
  directory_acl_protected:true,directory_acl_exact_three_principals:true,
  binary_acl_no_unexpected_principals:true,os_evidence_checks_passed:true,
  independently_signed:false,externally_custodied:false,
  operational_broker_certified:false,db_admin_authorized:false,
  backup_executed:false,restore_executed:false,production_mutation:false,
  generated_at_utc:new Date(now-30000).toISOString()
};
const {privateKey,publicKey}=generateKeyPairSync("ed25519");
const spki=publicKey.export({format:"der",type:"spki"});
const pin={
  signer_key_id:"owner-lab-ephemeral-ci-only",spki_der_b64:spki.toString("base64"),
  spki_sha256:createHash("sha256").update(spki).digest("hex")
};
const expected={commit:sha,binary_sha256:digest,challenge_nonce:nonce};
function mk(payload,sk=privateKey){
  const bytes=Buffer.from(canonicalSignedPayload(payload),"utf8");
  return {contract:"mad4b.staging.backup-broker.signed-os-evidence.v1",
    signer_key_id:pin.signer_key_id,payload_b64:bytes.toString("base64"),
    signature_b64:sign(null,signedMessage(bytes),sk).toString("base64")};
}
const payload={
  contract:"mad4b.staging.backup-broker.signed-os-evidence-payload.v1",
  audience:"mad4b.staging.backup-broker.os-evidence-check",
  challenge_nonce:nonce,os_evidence:ev
};
const envelope=mk(payload);
const good=verify({envelope,expected,pin,nowMs:now});
assert.equal(good.cryptographic_signature_valid,true);
assert.equal(good.os_evidence_bindings_valid,true);
assert.match(good.evidence_sha256,/^[a-f0-9]{64}$/);
for(const k of ["trusted_key_custody_verified","immutable_external_audit_verified",
  "replay_registry_verified","independently_attested","broker_operationally_certified",
  "db_admin_authorized","backup_executed","restore_executed","production_mutation"])
 assert.equal(good[k],false,k);
assert(good.blockers.includes("BROKER_TRUSTED_OUT_OF_BAND_PIN_NOT_PROVISIONED"));
assert(good.blockers.includes("BROKER_EXTERNAL_IMMUTABLE_AUDIT_REQUIRED"));
assert(good.blockers.includes("BROKER_TRUSTED_REPLAY_REGISTRY_REQUIRED"));
function denied(options,label){
  const result=verify({envelope,expected,pin,nowMs:now,...options});
  assert.equal(result.cryptographic_signature_valid,false,label);
  assert.equal(result.broker_operationally_certified,false,label);
  assert.equal(result.db_admin_authorized,false,label);
  return result;
}
assert(denied({expected:{...expected,commit:"a".repeat(40)}},"commit")
  .blockers.includes("BROKER_SIGNED_OS_EVIDENCE_SCOPE_INVALID"));
assert(denied({expected:{...expected,binary_sha256:"b".repeat(64)}},"hash")
  .blockers.includes("BROKER_SIGNED_OS_EVIDENCE_SCOPE_INVALID"));
assert(denied({expected:{...expected,challenge_nonce:"b".repeat(64)}},"challenge")
  .blockers.includes("BROKER_UNISSUED_OR_STALE_CHALLENGE"));
assert(denied({envelope:{...envelope,signer_key_id:"swapped-key-id"}},"key id")
  .blockers.includes("BROKER_SIGNER_KEY_ID_MISMATCH"));
assert(denied({pin:{...pin,spki_sha256:"c".repeat(64)}},"pin")
  .blockers.includes("BROKER_PIN_FINGERPRINT_MISMATCH"));
const wrongKey=generateKeyPairSync("ed25519");
assert(denied({envelope:mk(payload,wrongKey.privateKey)},"wrong key")
  .blockers.includes("BROKER_ED25519_SIGNATURE_INVALID"));
assert(denied({envelope:{...envelope,payload_b64:Buffer.from("tampered").toString("base64")}},"tamper"));
assert(denied({envelope:{...envelope,signature_b64:"e".repeat(96)}},"signature format"));
assert(denied({envelope:{...envelope,trust_me:true}},"untrusted extra envelope"));
assert(denied({expected:{commit:sha,binary_sha256:digest}},"no challenge"));
assert(denied({pin:{...pin,signer_key_id:"x"}},"bad keyid"));
assert(denied({nowMs:now+700000},"stale")
  .blockers.includes("BROKER_OS_EVIDENCE_FRESHNESS_INVALID"));
assert(denied({nowMs:now-120000},"future")
  .blockers.includes("BROKER_OS_EVIDENCE_FRESHNESS_INVALID"));
for(const [label,patch] of Object.entries({
  operational_claim:{operational_broker_certified:true},
  db_claim:{db_admin_authorized:true},
  independent_claim:{independently_signed:true},
  production_claim:{production_mutation:true},
  invalid_acl:{directory_acl_exact_three_principals:false},
  wrong_host:{device_id:"other-host"},
  wrong_identity:{service_virtual_identity:"NT AUTHORITY\\SYSTEM"},
  wrong_pid:{service_pid:0},
  unset_hash:{binary_sha256:"0".repeat(64)},
  wrong_release:{exact_staging_sha:"f".repeat(40)},
  restore_claim:{restore_executed:true},
  injected_extra_field:{untrusted_admin_ticket:true},
})){
  assert(denied({envelope:mk({...payload,os_evidence:{...ev,...patch}})},label)
    .blockers.includes("BROKER_SIGNED_OS_EVIDENCE_SCOPE_INVALID"),label);
}
const noncanonical=Buffer.from('{"z":5,"a":4}');
assert(denied({envelope:{
 ...envelope,payload_b64:noncanonical.toString("base64"),
 signature_b64:sign(null,signedMessage(noncanonical),privateKey).toString("base64")
}},"noncanonical").blockers.includes("BROKER_SIGNED_PAYLOAD_NONCANONICAL"));
const extra=mk({...payload,extra:1});
assert(denied({envelope:extra},"unexpected payload key")
 .blockers.includes("BROKER_SIGNED_PAYLOAD_SCHEMA_INVALID"));
console.log(JSON.stringify({
  contract:"mad4b.staging.backup-broker.signed-os-evidence.test.v1",
  passed:true,positive_ephemeral_ed25519_verified:true,
  forged_claims_denied:true,nonce_and_exact_sha_bound:true,
  operator_key_provisioned:false,independent_custody:false,
  operational_authority:false,no_secrets_persisted:true
}));
