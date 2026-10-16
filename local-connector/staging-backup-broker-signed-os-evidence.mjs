// Pure, offline Ed25519 verification for Staging OS evidence.
// A caller-supplied key is NOT independent key custody. This module can NEVER
// grant DBA, execute backups or turn its own result into an authority ticket.
import {
  createHash,createPublicKey,verify as verifySignature,timingSafeEqual
} from "node:crypto";

const HEX40=/^[a-f0-9]{40}$/;
const HEX64=/^[a-f0-9]{64}$/;
const B64=/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const NONCE=/^[a-f0-9]{64}$/;
const DOMAIN=Buffer.from("MAD4B/STAGING/BROKER/OS-EVIDENCE/V1\n","utf8");
const ENVELOPE="mad4b.staging.backup-broker.signed-os-evidence.v1";
const PAYLOAD="mad4b.staging.backup-broker.signed-os-evidence-payload.v1";
const EVIDENCE="mad4b.staging.backup-broker.os-evidence.v1";
const HOST="DESKTOP-91FDEFP";
const SERVICE="Mad4B-Staging-Backup-Db-Broker";
const ACCOUNT="NT SERVICE\\Mad4B-Staging-Backup-Db-Broker";
const AUDIENCE="mad4b.staging.backup-broker.os-evidence-check";
const SAFE_FALSE=[
  "independently_signed","externally_custodied","operational_broker_certified",
  "db_admin_authorized","backup_executed","restore_executed","production_mutation"
];
const EVIDENCE_FIELDS=[
  "contract","mode","device_id","exact_staging_sha","service_name",
  "service_pid","service_running","start_mode","service_virtual_identity",
  "service_sid_type","binary_sha256","directory_acl_protected",
  "directory_acl_exact_three_principals","binary_acl_no_unexpected_principals",
  "os_evidence_checks_passed","generated_at_utc",...SAFE_FALSE
].sort().join("|");
function isPlain(o){return o!==null&&typeof o==="object"&&!Array.isArray(o)&&
 Object.getPrototypeOf(o)===Object.prototype;}
function canonical(o){
  if(o===null)return "null";
  if(typeof o==="string"||typeof o==="boolean")return JSON.stringify(o);
  if(typeof o==="number"&&Number.isSafeInteger(o))return JSON.stringify(o);
  if(Array.isArray(o))return "["+o.map(canonical).join(",")+"]";
  if(isPlain(o)){
    const keys=Object.keys(o).sort();
    if(keys.some(k=>k==="__proto__"||k==="constructor"||k==="prototype"))throw Error("UNSAFE_JSON_KEY");
    return "{"+keys.map(k=>JSON.stringify(k)+":"+canonical(o[k])).join(",")+"}";
  }
  throw Error("NON_CANONICAL_JSON_TYPE");
}
function exactBase64(v,min,max){
  if(typeof v!=="string"||v.length<min||v.length>max||!B64.test(v))throw Error("INVALID_BASE64");
  const b=Buffer.from(v,"base64");
  if(b.toString("base64")!==v)throw Error("NONCANONICAL_BASE64");
  return b;
}
function hexEq(a,b){
  if(typeof a!=="string"||typeof b!=="string"||!HEX64.test(a)||!HEX64.test(b))return false;
  return timingSafeEqual(Buffer.from(a,"hex"),Buffer.from(b,"hex"));
}
function hash(b){return createHash("sha256").update(b).digest("hex");}
function deny(blockers,extra={}){
  return Object.freeze({
    contract:"mad4b.staging.backup-broker.signature-verification.v1",
    cryptographic_signature_valid:false,
    os_evidence_bindings_valid:false,
    trusted_key_custody_verified:false,
    immutable_external_audit_verified:false,
    replay_registry_verified:false,
    independently_attested:false,
    broker_operationally_certified:false,
    owner_operation_approved:false,
    db_admin_authorized:false,
    backup_executed:false,restore_executed:false,production_mutation:false,
    ...extra,blockers:[...new Set(blockers)].sort()
  });
}
export function canonicalSignedPayload(payload){return canonical(payload);}
export function signedMessage(payloadBytes){return Buffer.concat([DOMAIN,payloadBytes]);}
export function verifyStagingBrokerSignedOsEvidence({envelope,expected,pin,nowMs=Date.now()}={}){
  const blockers=[];
  if(!isPlain(envelope)||envelope.contract!==ENVELOPE||
     Object.keys(envelope).sort().join("|")!==
       ["contract","payload_b64","signature_b64","signer_key_id"].sort().join("|"))
    blockers.push("BROKER_SIGNED_ENVELOPE_SCHEMA_INVALID");
  if(!isPlain(expected)||!HEX40.test(expected.commit||"")||
     !HEX64.test(expected.binary_sha256||"")||!NONCE.test(expected.challenge_nonce||""))
    blockers.push("BROKER_TRUSTED_EXPECTATIONS_REQUIRED");
  if(!isPlain(pin)||typeof pin.signer_key_id!=="string"||
     !/^[a-z0-9._-]{8,96}$/.test(pin.signer_key_id)||
     !HEX64.test(pin.spki_sha256||"")||
     typeof pin.spki_der_b64!=="string")
    blockers.push("BROKER_PINNED_ED25519_KEY_REQUIRED");
  if(!Number.isFinite(nowMs)||nowMs<0)blockers.push("BROKER_TRUSTED_CLOCK_REQUIRED");
  if(blockers.length)return deny(blockers);
  try{
    if(envelope.signer_key_id!==pin.signer_key_id)
      blockers.push("BROKER_SIGNER_KEY_ID_MISMATCH");
    const spki=exactBase64(pin.spki_der_b64,40,256);
    if(!hexEq(hash(spki),pin.spki_sha256))
      blockers.push("BROKER_PIN_FINGERPRINT_MISMATCH");
    const pub=createPublicKey({key:spki,format:"der",type:"spki"});
    if(pub.asymmetricKeyType!=="ed25519"||
       !pub.export({format:"der",type:"spki"}).equals(spki))
      blockers.push("BROKER_SIGNER_ED25519_KEY_UNVERIFIED");
    const bytes=exactBase64(envelope.payload_b64,20,32768);
    const sig=exactBase64(envelope.signature_b64,84,100);
    if(sig.length!==64)blockers.push("BROKER_ED25519_SIGNATURE_SIZE_INVALID");
    const payload=JSON.parse(bytes.toString("utf8"));
    if(!isPlain(payload)||Buffer.compare(Buffer.from(canonical(payload),"utf8"),bytes)!==0)
      blockers.push("BROKER_SIGNED_PAYLOAD_NONCANONICAL");
    if(!isPlain(payload)||payload.contract!==PAYLOAD||
       payload.audience!==AUDIENCE||
       Object.keys(payload).sort().join("|")!==
         ["audience","challenge_nonce","contract","os_evidence"].sort().join("|"))
      blockers.push("BROKER_SIGNED_PAYLOAD_SCHEMA_INVALID");
    if(payload?.challenge_nonce!==expected.challenge_nonce)
      blockers.push("BROKER_UNISSUED_OR_STALE_CHALLENGE");
    const ev=payload?.os_evidence;
    if(!isPlain(ev)||Object.keys(ev).sort().join("|")!==EVIDENCE_FIELDS||
       ev.contract!==EVIDENCE||ev.mode!=="elevated_local_os_read_only"||
       ev.device_id!==HOST||ev.exact_staging_sha!==expected.commit||
       ev.service_name!==SERVICE||ev.service_virtual_identity!==ACCOUNT||
       ev.service_running!==true||!Number.isSafeInteger(ev.service_pid)||
       ev.service_pid<1||ev.start_mode!=="Manual"||
       ev.service_sid_type!=="UNRESTRICTED"||
       !hexEq(ev.binary_sha256,expected.binary_sha256)||
       ev.directory_acl_protected!==true||
       ev.directory_acl_exact_three_principals!==true||
       ev.binary_acl_no_unexpected_principals!==true||
       ev.os_evidence_checks_passed!==true||
       SAFE_FALSE.some(k=>ev[k]!==false))
      blockers.push("BROKER_SIGNED_OS_EVIDENCE_SCOPE_INVALID");
    const at=Date.parse(ev?.generated_at_utc||"");
    if(!Number.isFinite(at)||!String(ev?.generated_at_utc).match(/[+-]\d\d:\d\d$|Z$/)||
       at>nowMs+60000||at<nowMs-600000)
      blockers.push("BROKER_OS_EVIDENCE_FRESHNESS_INVALID");
    if(!verifySignature(null,signedMessage(bytes),pub,sig))
      blockers.push("BROKER_ED25519_SIGNATURE_INVALID");
    // A caller can supply ANY key; verifying such a signature is not the
    // same as an independently approved public-key pin or immutable receipt.
    if(blockers.length)return deny(blockers);
    return deny([
      "BROKER_TRUSTED_OUT_OF_BAND_PIN_NOT_PROVISIONED",
      "BROKER_EXTERNAL_IMMUTABLE_AUDIT_REQUIRED",
      "BROKER_TRUSTED_REPLAY_REGISTRY_REQUIRED"
    ],{
      cryptographic_signature_valid:true,
      os_evidence_bindings_valid:true,
      signing_key_fingerprint:pin.spki_sha256,
      evidence_sha256:hash(bytes)
    });
  }catch{
    return deny(["BROKER_SIGNED_EVIDENCE_MALFORMED_OR_UNVERIFIED"]);
  }
}
