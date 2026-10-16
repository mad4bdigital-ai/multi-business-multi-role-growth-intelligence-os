// Read public verification keys from an independently provisioned protected
// registry. This does not create keys or claim an independent trust anchor.
// Expected registry digest MUST be obtained via a separately secured channel.
import fs from "node:fs/promises";
import path from "node:path";
import {createHash,createPublicKey,timingSafeEqual} from "node:crypto";
const H64=/^[0-9a-f]{64}$/;
const KEY_ID=/^[a-z0-9._-]{8,96}$/;
const BASE64=/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const FIELDS=["contract","environment","device_id","keys"].sort().join("|");
const KEY_FIELDS=["role","key_id","spki_der_b64","spki_sha256"].sort().join("|");
const fault=code=>{throw Object.assign(new Error(code),{code});};
function equalHex(a,b){
  return typeof a==="string"&&typeof b==="string"&&H64.test(a)&&H64.test(b)&&
    timingSafeEqual(Buffer.from(a,"hex"),Buffer.from(b,"hex"));
}
function plain(o){return o!==null&&typeof o==="object"&&!Array.isArray(o)&&
  Object.getPrototypeOf(o)===Object.prototype;}
function exact(o,fields){return plain(o)&&Object.keys(o).sort().join("|")===fields;}
function decode(b64){
  if(typeof b64!=="string"||b64.length<40||b64.length>256||!BASE64.test(b64))
    fault("BROKER_PIN_SPKI_ENCODING_INVALID");
  const buf=Buffer.from(b64,"base64");
  if(buf.toString("base64")!==b64)fault("BROKER_PIN_SPKI_ENCODING_INVALID");
  return buf;
}
export async function readProtectedStagingBrokerPublicKeyRegistry({
  registryFile,expected_registry_sha256,assertPrivateWindowsAcl
}={}){
  if(typeof registryFile!=="string"||!path.isAbsolute(registryFile)||
     /(?:^|[\\/])(prod|production|hostinger)(?:[\\/]|$)/i.test(registryFile)||
     path.basename(registryFile)!=="trusted-key-registry.json")
    fault("BROKER_PIN_PROTECTED_REGISTRY_PATH_REQUIRED");
  if(!H64.test(expected_registry_sha256||""))
    fault("BROKER_PIN_OUT_OF_BAND_REGISTRY_DIGEST_REQUIRED");
  let dir,stat,canonical,raw;
  try{
    dir=path.dirname(registryFile);
    const ds=await fs.lstat(dir);
    stat=await fs.lstat(registryFile);
    canonical=await fs.realpath(registryFile);
    if(!ds.isDirectory()||ds.isSymbolicLink()||!stat.isFile()||
       stat.isSymbolicLink()||stat.size>8192||stat.size<50||
       path.resolve(canonical)!==path.resolve(registryFile)||
       (process.platform!=="win32"&&((stat.mode&0o077)!==0||(ds.mode&0o077)!==0)))
      fault("BROKER_PIN_REGISTRY_ACL_OR_FILE_INVALID");
    if(process.platform==="win32"&&(
      typeof assertPrivateWindowsAcl!=="function"||
      await assertPrivateWindowsAcl(dir)!==true||
      await assertPrivateWindowsAcl(registryFile)!==true))
      fault("BROKER_PIN_WINDOWS_ACL_UNVERIFIED");
    raw=await fs.readFile(registryFile);
  }catch(e){fault(e.code?.startsWith?.("BROKER_")?e.code:
    "BROKER_PIN_REGISTRY_UNAVAILABLE");}
  if(raw.length>8192||!equalHex(
    createHash("sha256").update(raw).digest("hex"),expected_registry_sha256))
    fault("BROKER_PIN_REGISTRY_DIGEST_MISMATCH");
  let doc;
  try{doc=JSON.parse(raw.toString("utf8"));}
  catch{fault("BROKER_PIN_REGISTRY_JSON_INVALID");}
  if(!exact(doc,FIELDS)||
     doc.contract!=="mad4b.staging.backup-broker.public-keys.v1"||
     doc.environment!=="staging_local_os_only"||
     doc.device_id!=="DESKTOP-91FDEFP"||
     !Array.isArray(doc.keys)||doc.keys.length!==2)
    fault("BROKER_PIN_REGISTRY_SCOPE_INVALID");
  const result={};
  const ids=new Set(),fingerprints=new Set();
  for(const key of doc.keys){
    if(!exact(key,KEY_FIELDS)||!["owner","witness"].includes(key.role)||
       !KEY_ID.test(key.key_id||"")||!H64.test(key.spki_sha256||"")||
       result[key.role]||ids.has(key.key_id)||
       fingerprints.has(key.spki_sha256))
      fault("BROKER_PIN_REGISTRY_KEY_SCOPE_INVALID");
    let spki,k;
    try{
      spki=decode(key.spki_der_b64);
      k=createPublicKey({key:spki,format:"der",type:"spki"});
      if(k.asymmetricKeyType!=="ed25519"||
         !k.export({format:"der",type:"spki"}).equals(spki))
        fault("BROKER_PIN_REGISTRY_KEY_TYPE_DENIED");
    }catch{fault("BROKER_PIN_REGISTRY_KEY_INVALID");}
    if(!equalHex(createHash("sha256").update(spki).digest("hex"),
       key.spki_sha256))
      fault("BROKER_PIN_REGISTRY_KEY_FINGERPRINT_MISMATCH");
    result[key.role]=Object.freeze({...key});
    ids.add(key.key_id);fingerprints.add(key.spki_sha256);
  }
  if(!result.owner||!result.witness)
    fault("BROKER_PIN_REGISTRY_DISTINCT_SIGNERS_REQUIRED");
  return Object.freeze({
    contract:"mad4b.staging.backup-broker.public-key-readback.v1",
    owner:Object.freeze({
      signer_key_id:result.owner.key_id,
      spki_der_b64:result.owner.spki_der_b64,
      spki_sha256:result.owner.spki_sha256
    }),
    witness:Object.freeze({
      witness_key_id:result.witness.key_id,
      spki_der_b64:result.witness.spki_der_b64,
      spki_sha256:result.witness.spki_sha256
    }),
    registry_digest_matched:true,
    independently_approved_anchor:false,
    independent_custody_verified:false,
    external_immutable_audit_verified:false,
    broker_operationally_certified:false,
    db_admin_authorized:false,production_mutation:false
  });
}
