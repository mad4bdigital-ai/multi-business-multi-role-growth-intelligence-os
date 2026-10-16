// Staging-only *cryptographic consistency* of an external witness receipt.
// DO NOT accept this as an independently custodied or immutable audit record.
// No signing, key generation, network, filesystem, SQL or authority transitions.
import {createHash,createPublicKey,timingSafeEqual,verify as edVerify} from "node:crypto";
import {canonicalSignedPayload,verifyStagingBrokerSignedOsEvidence}
  from "./staging-backup-broker-signed-os-evidence.mjs";

const EVIDENCE_CONTRACT="mad4b.staging.backup-broker.signed-os-evidence.v1";
const RECEIPT_CONTRACT="mad4b.staging.backup-broker.witness-receipt.v1";
const PAYLOAD_CONTRACT="mad4b.staging.backup-broker.witness-payload.v1";
const DOMAIN=Buffer.from("MAD4B/STAGING/BROKER/WITNESS-RECEIPT/V1\n","utf8");
const HEX40=/^[0-9a-f]{40}$/;
const HEX64=/^[0-9a-f]{64}$/;
const KEY_ID=/^[a-z0-9._-]{8,96}$/;
const B64=/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const hasOnly=(o,keys)=>plain(o)&&Object.keys(o).sort().join("|")===keys.slice().sort().join("|");
const plain=(o)=>o!==null&&typeof o==="object"&&!Array.isArray(o)&&Object.getPrototypeOf(o)===Object.prototype;
const sha256=(b)=>createHash("sha256").update(b).digest("hex");
function decode64(s,min,max){
  if(typeof s!=="string"||s.length<min||s.length>max||!B64.test(s))throw Error("BAD_CANONICAL_BASE64");
  const b=Buffer.from(s,"base64");
  if(b.toString("base64")!==s)throw Error("BAD_CANONICAL_BASE64");
  return b;
}
function equalHex(a,b){
  return typeof a==="string"&&typeof b==="string"&&HEX64.test(a)&&HEX64.test(b)&&
    timingSafeEqual(Buffer.from(a,"hex"),Buffer.from(b,"hex"));
}
function denied(blockers,extra={}){
  return Object.freeze({
    contract:"mad4b.staging.backup-broker.witness-verification.v1",
    signed_os_evidence_valid:false,
    witness_signature_valid:false,
    witness_bindings_valid:false,
    external_custody_verified:false,
    immutable_external_audit_verified:false,
    replay_registry_verified:false,
    owner_public_key_independently_pinned:false,
    independently_attested:false,
    broker_operationally_certified:false,
    owner_operation_approved:false,
    db_admin_authorized:false,
    backup_executed:false,
    restore_executed:false,
    production_mutation:false,
    ...extra,
    blockers:[...new Set(blockers)].sort()
  });
}
export function witnessReceiptBytes(payload){
  return Buffer.from(canonicalSignedPayload(payload),"utf8");
}
export function witnessSigningMessage(payloadBytes){
  return Buffer.concat([DOMAIN,payloadBytes]);
}
// Explicit arguments are caller-controlled test data, not independently
// established root trust. Never feed any result into the operational broker.
export function verifyStagingBrokerWitnessReceipt({
  osEnvelope,osPin,witnessEnvelope,witnessPin,expected,nowMs=Date.now()
}={}){
  const blockers=[];
  const original=verifyStagingBrokerSignedOsEvidence({
    envelope:osEnvelope,pin:osPin,expected,nowMs
  });
  if(original.cryptographic_signature_valid!==true||
     original.os_evidence_bindings_valid!==true)
    blockers.push("BROKER_SIGNED_OS_EVIDENCE_NOT_VERIFIED");
  if(!hasOnly(witnessEnvelope,["contract","payload_b64","signature_b64","witness_key_id"])||
     witnessEnvelope.contract!==RECEIPT_CONTRACT)
    blockers.push("BROKER_WITNESS_ENVELOPE_SCHEMA_INVALID");
  if(!plain(witnessPin)||!KEY_ID.test(witnessPin.witness_key_id||"")||
     !HEX64.test(witnessPin.spki_sha256||"")||
     typeof witnessPin.spki_der_b64!=="string")
    blockers.push("BROKER_WITNESS_PIN_FORMAT_INVALID");
  if(!plain(expected)||!HEX40.test(expected.commit||"")||
     !HEX64.test(expected.binary_sha256||"")||
     !HEX64.test(expected.challenge_nonce||""))
    blockers.push("BROKER_WITNESS_TRUSTED_EXPECTATIONS_REQUIRED");
  if(!Number.isFinite(nowMs)||nowMs<0)
    blockers.push("BROKER_WITNESS_CLOCK_REQUIRED");
  if(blockers.length)return denied(blockers);
  try{
    const bytes=decode64(witnessEnvelope.payload_b64,100,16384);
    const sig=decode64(witnessEnvelope.signature_b64,84,100);
    const keyBytes=decode64(witnessPin.spki_der_b64,40,256);
    if(sig.length!==64)blockers.push("BROKER_WITNESS_SIGNATURE_SIZE_INVALID");
    if(witnessEnvelope.witness_key_id!==witnessPin.witness_key_id)
      blockers.push("BROKER_WITNESS_KEY_ID_MISMATCH");
    if(!equalHex(sha256(keyBytes),witnessPin.spki_sha256))
      blockers.push("BROKER_WITNESS_KEY_PIN_MISMATCH");
    if(equalHex(witnessPin.spki_sha256,osPin?.spki_sha256))
      blockers.push("BROKER_WITNESS_MUST_USE_DISTINCT_KEY");
    const key=createPublicKey({key:keyBytes,format:"der",type:"spki"});
    if(key.asymmetricKeyType!=="ed25519"||
       !key.export({format:"der",type:"spki"}).equals(keyBytes))
      blockers.push("BROKER_WITNESS_ED25519_SPKI_INVALID");
    // Canonical signed bytes reject duplicate JSON keys, noncanonical
    // strings or unexpected fields, including any claimed DBA authority.
    const parsed=JSON.parse(bytes.toString("utf8"));
    if(Buffer.compare(witnessReceiptBytes(parsed),bytes)!==0)
      blockers.push("BROKER_WITNESS_PAYLOAD_NONCANONICAL");
    if(!hasOnly(parsed,[
      "contract","scope","receipt_id","os_evidence_sha256",
      "os_signer_spki_sha256","witness_nonce","staging_sha",
      "broker_binary_sha256","witnessed_at_utc"
    ])||parsed.contract!==PAYLOAD_CONTRACT||
       parsed.scope!=="staging_os_evidence_read_only"||
       !HEX64.test(parsed.receipt_id||"")||
       !equalHex(parsed.os_evidence_sha256,original.evidence_sha256)||
       !equalHex(parsed.os_signer_spki_sha256,original.signing_key_fingerprint)||
       parsed.witness_nonce!==expected.challenge_nonce||
       parsed.staging_sha!==expected.commit||
       !equalHex(parsed.broker_binary_sha256,expected.binary_sha256))
      blockers.push("BROKER_WITNESS_EVIDENCE_BINDING_MISMATCH");
    const witnessed=Date.parse(parsed.witnessed_at_utc||"");
    if(!Number.isFinite(witnessed)||
       !/(Z|[+-]\d\d:\d\d)$/.test(parsed.witnessed_at_utc||"")||
       witnessed<nowMs-600000||witnessed>nowMs+60000)
      blockers.push("BROKER_WITNESS_TIMESTAMP_INVALID");
    if(!edVerify(null,witnessSigningMessage(bytes),key,sig))
      blockers.push("BROKER_WITNESS_SIGNATURE_INVALID");
    if(blockers.length)return denied(blockers,{
      signed_os_evidence_valid:original.cryptographic_signature_valid===true
    });
    return denied([
      "BROKER_WITNESS_KEY_EXTERNAL_PIN_CUSTODY_REQUIRED",
      "BROKER_EXTERNAL_IMMUTABLE_AUDIT_REQUIRED",
      "BROKER_CHALLENGE_ISSUANCE_AND_REPLAY_REGISTRY_REQUIRED"
    ],{
      signed_os_evidence_valid:true,
      witness_signature_valid:true,
      witness_bindings_valid:true,
      os_evidence_sha256:original.evidence_sha256,
      witness_receipt_sha256:sha256(bytes),
      os_signer_key_fingerprint:original.signing_key_fingerprint,
      witness_key_fingerprint:witnessPin.spki_sha256
    });
  }catch{
    return denied(["BROKER_WITNESS_MALFORMED_OR_UNVERIFIED"],{
      signed_os_evidence_valid:original.cryptographic_signature_valid===true
    });
  }
}
