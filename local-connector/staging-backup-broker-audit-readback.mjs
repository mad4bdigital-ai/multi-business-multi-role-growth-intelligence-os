// Offline verification of a *claim* made by an external retention provider.
// Never accepts this claim as independent WORM attestation or DBA authority.
// No network, secrets, provisioning, file writes or activation paths.
import {createHash,createPublicKey,timingSafeEqual,verify as verifyEd25519} from "node:crypto";
import {canonicalSignedPayload} from "./staging-backup-broker-signed-os-evidence.mjs";
import {verifyStagingBrokerWitnessReceipt}
  from "./staging-backup-broker-witness-receipt.mjs";
const HEX40=/^[0-9a-f]{40}$/;
const HEX64=/^[0-9a-f]{64}$/;
const BASE64=/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const KEY_ID=/^[a-z0-9._-]{8,96}$/;
const PROVIDER=/^[a-z0-9][a-z0-9._-]{3,80}$/;
const KEY=/^staging\/backup-broker\/witness\/[0-9a-f]{64}\.json$/;
const DOMAIN=Buffer.from("MAD4B/STAGING/BROKER/EXTERNAL-AUDIT-READBACK/V1\n","utf8");
const PAYLOAD_FIELDS=["contract","scope","provider_id","provider_object_key",
  "object_version","retention_mode","retain_until_utc","readback_sha256",
  "witness_payload_sha256","challenge_nonce","staging_sha","issued_at_utc"];
const ENVELOPE_FIELDS=["contract","provider_key_id","payload_b64","signature_b64"];
const SCHEMA="mad4b.staging.backup-broker.audit-provider-payload.v1";
const RECEIPT="mad4b.staging.backup-broker.audit-provider-receipt.v1";
const sha256=x=>createHash("sha256").update(x).digest("hex");
const exact=(obj,keys)=>obj!==null&&typeof obj==="object"&&!Array.isArray(obj)&&
  Object.getPrototypeOf(obj)===Object.prototype&&
  Object.keys(obj).sort().join("|")===keys.slice().sort().join("|");
const safeEq=(a,b)=>HEX64.test(a||"")&&HEX64.test(b||"")&&
  timingSafeEqual(Buffer.from(a,"hex"),Buffer.from(b,"hex"));
function dec64(s,min,max){
  if(typeof s!=="string"||s.length<min||s.length>max||!BASE64.test(s))
    throw Error("BROKER_AUDIT_BAD_BASE64");
  const b=Buffer.from(s,"base64");
  if(b.toString("base64")!==s)throw Error("BROKER_AUDIT_NONCANONICAL_BASE64");
  return b;
}
function denied(blockers,extra={}){
  return Object.freeze({
    contract:"mad4b.staging.backup-broker.audit-readback-verification.v1",
    os_witness_pair_consistent:false,
    provider_signature_valid:false,
    provider_retention_claim_consistent:false,
    readback_bytes_identical:false,
    external_custody_verified:false,
    externally_immutable_audit_verified:false,
    external_retention_policy_independently_measured:false,
    external_readback_independently_authenticated:false,
    trusted_provider_key_independently_pinned:false,
    replay_registry_externally_controlled:false,
    broker_operationally_certified:false,
    db_admin_authorized:false,backup_executed:false,restore_executed:false,
    production_mutation:false,
    ...extra,blockers:[...new Set(blockers)].sort()
  });
}
// Caller-supplied bytes and public key are insufficient to prove an actual
// external object-lock configuration. Only a separately trusted remote
// readback and provider-policy attestation can establish that.
export function verifyStagingBrokerExternalAuditReadback({
  osEnvelope,osPin,witnessEnvelope,witnessPin,
  providerEnvelope,providerPin,readbackBytes,expected,nowMs=Date.now()
}={}){
  const blockers=[];
  const original=verifyStagingBrokerWitnessReceipt({
    osEnvelope,osPin,witnessEnvelope,witnessPin,expected,nowMs
  });
  const pair=original.signed_os_evidence_valid===true&&
    original.witness_signature_valid===true&&
    original.witness_bindings_valid===true;
  if(!pair)blockers.push("BROKER_AUDIT_WITNESS_PAIR_NOT_VERIFIED");
  if(!exact(providerEnvelope,ENVELOPE_FIELDS)||
     providerEnvelope.contract!==RECEIPT)
    blockers.push("BROKER_AUDIT_PROVIDER_ENVELOPE_INVALID");
  if(!exact(providerPin,["provider_key_id","spki_der_b64","spki_sha256"])||
     !KEY_ID.test(providerPin.provider_key_id||"")||
     !HEX64.test(providerPin.spki_sha256||""))
    blockers.push("BROKER_AUDIT_PROVIDER_PIN_INVALID");
  if(!exact(expected,["commit","binary_sha256","challenge_nonce","provider_id"])||
     !HEX40.test(expected.commit||"")||
     !HEX64.test(expected.binary_sha256||"")||
     !HEX64.test(expected.challenge_nonce||"")||
     !PROVIDER.test(expected.provider_id||""))
    blockers.push("BROKER_AUDIT_EXPECTED_BINDINGS_REQUIRED");
  if(!Buffer.isBuffer(readbackBytes)||readbackBytes.length<100||
     readbackBytes.length>32768)
    blockers.push("BROKER_AUDIT_RAW_READBACK_REQUIRED");
  if(!Number.isSafeInteger(nowMs)||nowMs<1)
    blockers.push("BROKER_AUDIT_TRUSTED_CLOCK_REQUIRED");
  if(blockers.length)return denied(blockers);
  try{
    // Compare the *entire* read-back signed witness envelope, not just the
    // provider's claimed witness payload digest.
    const originalBytes=Buffer.from(canonicalSignedPayload(witnessEnvelope),"utf8");
    const identical=readbackBytes.equals(originalBytes);
    if(!identical)blockers.push("BROKER_AUDIT_READBACK_BYTES_CHANGED");
    const bytes=dec64(providerEnvelope.payload_b64,120,8192);
    const sig=dec64(providerEnvelope.signature_b64,84,100);
    const der=dec64(providerPin.spki_der_b64,40,256);
    if(sig.length!==64)blockers.push("BROKER_AUDIT_SIGNATURE_LENGTH_INVALID");
    if(providerEnvelope.provider_key_id!==providerPin.provider_key_id)
      blockers.push("BROKER_AUDIT_PROVIDER_KEY_ID_MISMATCH");
    if(!safeEq(providerPin.spki_sha256,sha256(der)))
      blockers.push("BROKER_AUDIT_PROVIDER_KEY_DIGEST_MISMATCH");
    if(safeEq(providerPin.spki_sha256,osPin.spki_sha256)||
       safeEq(providerPin.spki_sha256,witnessPin.spki_sha256))
      blockers.push("BROKER_AUDIT_PROVIDER_KEY_NOT_SEPARATE");
    const key=createPublicKey({key:der,format:"der",type:"spki"});
    if(key.asymmetricKeyType!=="ed25519"||
       !key.export({format:"der",type:"spki"}).equals(der))
      blockers.push("BROKER_AUDIT_PROVIDER_KEY_TYPE_INVALID");
    const parsed=JSON.parse(bytes.toString("utf8"));
    if(!exact(parsed,PAYLOAD_FIELDS)||
       !bytes.equals(Buffer.from(canonicalSignedPayload(parsed),"utf8")))
      blockers.push("BROKER_AUDIT_PROVIDER_PAYLOAD_NONCANONICAL");
    if(parsed?.contract!==SCHEMA||
       parsed.scope!=="staging_os_evidence_witness_receipt"||
       parsed.provider_id!==expected.provider_id||
       parsed.staging_sha!==expected.commit||
       parsed.challenge_nonce!==expected.challenge_nonce||
       !KEY.test(parsed.provider_object_key||"")||
       parsed.provider_object_key!==
         "staging/backup-broker/witness/"+sha256(originalBytes)+".json"||
       typeof parsed.object_version!=="string"||
       !/^[a-zA-Z0-9._-]{1,160}$/.test(parsed.object_version)||
       parsed.retention_mode!=="COMPLIANCE"||
       !safeEq(parsed.readback_sha256,sha256(readbackBytes))||
       !safeEq(parsed.witness_payload_sha256,original.witness_receipt_sha256))
      blockers.push("BROKER_AUDIT_PROVIDER_SCOPE_OR_DIGEST_MISMATCH");
    const issued=Date.parse(parsed.issued_at_utc||"");
    const retain=Date.parse(parsed.retain_until_utc||"");
    if(!Number.isFinite(issued)||!Number.isFinite(retain)||
       !/Z$/.test(parsed.issued_at_utc||"")||
       !/Z$/.test(parsed.retain_until_utc||"")||
       issued<nowMs-600000||issued>nowMs+60000||
       retain<issued+30*86400000)
      blockers.push("BROKER_AUDIT_PROVIDER_RETENTION_CLAIM_INVALID");
    if(!verifyEd25519(null,Buffer.concat([DOMAIN,bytes]),key,sig))
      blockers.push("BROKER_AUDIT_PROVIDER_SIGNATURE_INVALID");
    if(blockers.length)return denied(blockers,{os_witness_pair_consistent:pair,
      readback_bytes_identical:identical});
    return denied([
      "BROKER_AUDIT_PROVIDER_IDENTITY_OUT_OF_BAND_REQUIRED",
      "BROKER_AUDIT_INDEPENDENT_READBACK_REQUIRED",
      "BROKER_AUDIT_REMOTE_WORM_RETENTION_VERIFICATION_REQUIRED",
      "BROKER_AUDIT_EXTERNAL_IMMUTABLE_CUSTODY_UNPROVEN"
    ],{
      os_witness_pair_consistent:true,
      provider_signature_valid:true,
      provider_retention_claim_consistent:true,
      readback_bytes_identical:true,
      provider_receipt_sha256:sha256(bytes),
      readback_sha256:sha256(readbackBytes),
      witness_payload_sha256:original.witness_receipt_sha256
    });
  }catch{
    return denied(["BROKER_AUDIT_MALFORMED_OR_UNVERIFIED"],{
      os_witness_pair_consistent:pair
    });
  }
}
