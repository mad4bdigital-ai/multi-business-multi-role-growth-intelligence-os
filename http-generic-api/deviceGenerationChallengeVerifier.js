// Server-only cryptographic proof of possession of a registered device generation.
// Signature verification is NOT hardware/TPM attestation and does not certify
// that a key is non-exportable. No caller boolean may promote RECOVERED.
import {createPublicKey,verify} from "node:crypto";

const verifiedReceipts=new WeakSet();
const IDENT=/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{1,127}$/;
const NONCE=/^[A-Za-z0-9_-]{22,128}$/;
const MAX_AGE_MS=120000;
const fields=["user_id","tenant_id","device_id","config_id","generation_id"];
function deny(code){const error=new Error(code);error.code=code;error.status=403;return error;}
function canonical(expected,challenge) {
  return [
    "mad4b.local-connector.generation-possession.v1",
    ...fields.map(field=>expected[field]),
    challenge.id,challenge.nonce,String(challenge.issued_at_ms),
    String(challenge.expires_at_ms)
  ].join("\n");
}
export async function verifyBoundDeviceGenerationChallenge({
  expected,claimed,challenge,signature_der_base64,
  lookupRegisteredGeneration,consumeNonce,now=Date.now()
}={}) {
  if(!expected||!claimed||fields.some(field=>
    typeof expected[field]!=="string"||!IDENT.test(expected[field])||
    claimed[field]!==expected[field]))throw deny("device_generation_identity_mismatch");
  if(!challenge||typeof challenge.id!=="string"||!IDENT.test(challenge.id)||
     typeof challenge.nonce!=="string"||!NONCE.test(challenge.nonce)||
     !Number.isSafeInteger(challenge.issued_at_ms)||
     !Number.isSafeInteger(challenge.expires_at_ms)||
     !Number.isSafeInteger(now)||challenge.issued_at_ms>now||
     challenge.expires_at_ms<=now||
     challenge.expires_at_ms-challenge.issued_at_ms>MAX_AGE_MS)
    throw deny("device_generation_challenge_expired_or_invalid");
  if(typeof signature_der_base64!=="string"||
     !/^(?:[A-Za-z0-9+/]{4}){8,48}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(signature_der_base64))
    throw deny("device_generation_signature_invalid");
  if(typeof consumeNonce!=="function")throw deny("device_generation_nonce_store_unavailable");
  if(typeof lookupRegisteredGeneration!=="function")
    throw deny("device_generation_registered_key_lookup_unavailable");
  // Public keys supplied by the claimant are never authoritative.
  // A trusted server-side registry lookup must bind the key to ALL five
  // identity dimensions and show that this generation is still active.
  let registration;
  try {registration=await lookupRegisteredGeneration({...expected});}
  catch {throw deny("device_generation_registered_key_lookup_unavailable");}
  if(!registration || fields.some(field=>registration[field]!==expected[field])||
     registration.status!=="active" || registration.is_enabled!==true ||
     registration.revoked_at!==null || registration.archived_at!==null ||
     typeof registration.public_key_pem!=="string")
    throw deny("device_generation_registered_key_not_trusted");
  let publicKey;
  try {
    publicKey=createPublicKey(registration.public_key_pem);
    if(publicKey.asymmetricKeyType!=="ec"||
       publicKey.asymmetricKeyDetails?.namedCurve!=="prime256v1")
      throw Error("Invalid curve");
  }catch{throw deny("device_generation_registered_key_invalid");}
  const payload=canonical(expected,challenge);
  const signature=Buffer.from(signature_der_base64,"base64");
  if(signature.length<64||signature.length>80||
     signature.toString("base64")!==signature_der_base64)
    throw deny("device_generation_signature_invalid");
  let passed=false;
  try {passed=verify("sha256",Buffer.from(payload,"utf8"),{
    key:publicKey,dsaEncoding:"der"
  },signature);} catch {}
  if(!passed)throw deny("device_generation_signature_invalid");
  // The storage implementation must atomically compare-and-consume the
  // challenge ID/nonce under the exact registered scope, with durable replay
  // resistance across processes. This is injected by the governed DB service.
  if(await consumeNonce({challenge_id:challenge.id,nonce:challenge.nonce,
    expected_scope:{...expected},expires_at_ms:challenge.expires_at_ms})!==true)
    throw deny("device_generation_challenge_replayed_or_uncommitted");
  const result=Object.freeze({
    contract:"mad4b.device-generation-possession-receipt.v1",
    ...Object.fromEntries(fields.map(f=>[f,expected[f]])),
    challenge_id:challenge.id,nonce_consumed:true,signature_verified:true,
    hardware_nonexportability_verified:false,
    execution_allowed:false,recovered:false,secrets_included:false
  });
  verifiedReceipts.add(result);
  return result;
}
export function isTrustedDeviceGenerationReceipt(receipt,scope={}) {
  return Boolean(receipt&&verifiedReceipts.has(receipt)&&
    fields.every(field=>receipt[field]===scope[field])&&
    receipt.signature_verified===true&&receipt.nonce_consumed===true);
}
