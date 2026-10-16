// Actual durable Staging-only challenge issuance + atomic one-time consumption.
// File-system durability is NOT independent custody, audit WORM, key trust or DBA.
// No network, DB client, route, secrets, service start, or production writes.
import fs from "node:fs/promises";
import path from "node:path";
import {randomBytes,createHash,timingSafeEqual} from "node:crypto";
const SHA40=/^[a-f0-9]{40}$/;
const SHA64=/^[a-f0-9]{64}$/;
const CONTR="mad4b.staging.backup-broker.challenge.v1";
const KEYSET=[
  "contract","nonce","staging_sha","binary_sha256",
  "issued_at_ms","expires_at_ms"
].sort().join("|");
function fault(code){throw Object.assign(new Error(code),{code});}
function sha(b){return createHash("sha256").update(b).digest("hex");}
function same(a,b){return typeof a==="string"&&typeof b==="string"&&SHA64.test(a)&&SHA64.test(b)&&
  timingSafeEqual(Buffer.from(a,"hex"),Buffer.from(b,"hex"));}
function isPlain(o){return o!==null&&typeof o==="object"&&!Array.isArray(o)&&
  Object.getPrototypeOf(o)===Object.prototype;}
function exactChallenge(c){
  return isPlain(c)&&Object.keys(c).sort().join("|")===KEYSET&&
    c.contract===CONTR&&SHA64.test(c.nonce)&&SHA40.test(c.staging_sha)&&
    SHA64.test(c.binary_sha256)&&Number.isSafeInteger(c.issued_at_ms)&&
    Number.isSafeInteger(c.expires_at_ms)&&c.expires_at_ms>c.issued_at_ms&&
    c.expires_at_ms-c.issued_at_ms<=600000;
}
async function privateDirectory(stateDir,assertPrivateWindowsAcl){
  if(typeof stateDir!=="string"||!path.isAbsolute(stateDir)||
     /(?:^|[\\/])(production|prod|hostinger)(?:[\\/]|$)/i.test(stateDir))
    fault("BROKER_CHALLENGE_PRIVATE_STAGING_DIR_REQUIRED");
  let st,real;
  try{
    st=await fs.lstat(stateDir);
    real=await fs.realpath(stateDir);
  }catch{fault("BROKER_CHALLENGE_PRIVATE_STAGING_DIR_REQUIRED");}
  if(!st.isDirectory()||st.isSymbolicLink()||
     path.resolve(real)!==path.resolve(stateDir))
    fault("BROKER_CHALLENGE_PRIVATE_STAGING_DIR_REQUIRED");
  if(process.platform==="win32"){
    if(typeof assertPrivateWindowsAcl!=="function"||
       await assertPrivateWindowsAcl(stateDir)!==true)
      fault("BROKER_CHALLENGE_PRIVATE_WINDOWS_ACL_REQUIRED");
  }else if((st.mode&0o077)!==0)
    fault("BROKER_CHALLENGE_PRIVATE_POSIX_MODE_REQUIRED");
  return real;
}
async function readStrictFile(name){
  const st=await fs.lstat(name);
  if(!st.isFile()||st.isSymbolicLink()||st.size>1024||
     (process.platform!=="win32"&&(st.mode&0o077)!==0))
    fault("BROKER_CHALLENGE_FILE_NOT_PRIVATE");
  const contents=await fs.readFile(name,"utf8");
  if(Buffer.byteLength(contents)>1024)fault("BROKER_CHALLENGE_FILE_TOO_LARGE");
  return JSON.parse(contents);
}
async function exclusiveJson(name,payload){
  // "wx" wins only for one competing process on the same volume. A crash
  // leaving a partial file is fail-closed; never delete or retry the nonce.
  let handle;
  try{
    handle=await fs.open(name,"wx",0o600);
    await handle.writeFile(JSON.stringify(payload)+"\n");
    await handle.sync();
    return true;
  }catch(e){
    if(e.code==="EEXIST")return false;
    fault("BROKER_CHALLENGE_DURABLE_COMMIT_FAILED");
  }finally{
    if(handle)await handle.close();
  }
}
export async function createPrivateStagingBackupBrokerChallengeLedger({
  stateDir,assertPrivateWindowsAcl,clock=Date.now
}={}){
  // Provision stateDir with appropriate ACL *outside* this module.
  // The service must have exclusive ownership; do not point to a repo
  // checkout, user-writable folder, Production mount or synced folder.
  const directory=await privateDirectory(stateDir,assertPrivateWindowsAcl);
  if(typeof clock!=="function")fault("BROKER_CHALLENGE_CLOCK_REQUIRED");
  return Object.freeze({
    contract:"mad4b.staging.backup-broker.challenge-ledger.v1",
    environment:"staging_local_os_only",
    local_atomic_replay_guard:true,
    externally_custodied:false,immutable_external_audit:false,
    trusted_signing_keys_installed:false,operational_broker_certified:false,
    db_admin_authorized:false,production_mutation:false,
    async issue({staging_sha,binary_sha256,ttl_ms=300000}={}){
      // Re-evaluate the protected mount and ACL on every operation, not just
      // at constructor time: an ACL/symlink change must fail closed.
      await privateDirectory(stateDir,assertPrivateWindowsAcl);
      if(!SHA40.test(staging_sha||"")||!SHA64.test(binary_sha256||"")||
         !Number.isSafeInteger(ttl_ms)||ttl_ms<1000||ttl_ms>600000)
        fault("BROKER_CHALLENGE_ISSUE_SCOPE_INVALID");
      const now=clock();
      if(!Number.isSafeInteger(now)||now<1||now>Number.MAX_SAFE_INTEGER-ttl_ms)
        fault("BROKER_CHALLENGE_CLOCK_INVALID");
      const challenge=Object.freeze({
        contract:CONTR,
        nonce:randomBytes(32).toString("hex"),
        staging_sha,binary_sha256,
        issued_at_ms:now,expires_at_ms:now+ttl_ms
      });
      const filename=path.join(directory,"issued-"+sha(challenge.nonce)+".json");
      if(!await exclusiveJson(filename,challenge))
        fault("BROKER_CHALLENGE_NONCE_COLLISION");
      return challenge;
    },
    async consumeOnce(challenge,{expected_staging_sha,expected_binary_sha256,
      evidence_sha256}={}){
      await privateDirectory(stateDir,assertPrivateWindowsAcl);
      if(!exactChallenge(challenge)||!SHA40.test(expected_staging_sha||"")||
         !SHA64.test(expected_binary_sha256||"")||!SHA64.test(evidence_sha256||""))
        fault("BROKER_CHALLENGE_CONSUME_SCOPE_INVALID");
      if(challenge.staging_sha!==expected_staging_sha||
         !same(challenge.binary_sha256,expected_binary_sha256))
        fault("BROKER_CHALLENGE_EXACT_BINDING_MISMATCH");
      const now=clock();
      if(!Number.isSafeInteger(now)||now<challenge.issued_at_ms||
         now>=challenge.expires_at_ms)
        fault("BROKER_CHALLENGE_EXPIRED_OR_CLOCK_INVALID");
      const identifier=sha(challenge.nonce);
      let original;
      try{
        original=await readStrictFile(path.join(directory,"issued-"+identifier+".json"));
      }catch{fault("BROKER_CHALLENGE_NOT_DURABLY_ISSUED");}
      if(JSON.stringify(original)!==JSON.stringify(challenge)||
         !exactChallenge(original))
        fault("BROKER_CHALLENGE_ORIGIN_FILE_MISMATCH");
      const spent=path.join(directory,"consumed-"+identifier+".json");
      const written=await exclusiveJson(spent,{
        contract:"mad4b.staging.backup-broker.challenge-consumed.v1",
        nonce_sha256:identifier,staging_sha:challenge.staging_sha,
        evidence_sha256,consumed_at_ms:now
      });
      // On EEXIST, including after process restart, deny replay.
      // A write error remains blocked: never remove partial spent files.
      return written;
    }
  });
}
