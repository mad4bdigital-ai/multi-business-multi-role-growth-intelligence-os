import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";
import {createPrivateStagingBackupBrokerChallengeLedger}
  from "./staging-backup-broker-challenge-ledger.mjs";

const SHA="90ef15bae08db12edab6fe17619a1735c6d54359";
const BIN="8771be99cb7a54b58cc7a5ab11fb3dc095429f7c7832b7346981c9921045144a";
const EVIDENCE="a".repeat(64);
const directory=await fs.mkdtemp(path.join(os.tmpdir(),"mad4b-staging-only-challenge-"));
await fs.chmod(directory,0o700);
const acl=async()=>true; // synthetic Windows ACL predicate, NEVER runtime authority
let now=Date.now();
const ledger=await createPrivateStagingBackupBrokerChallengeLedger({
  stateDir:directory,assertPrivateWindowsAcl:acl,clock:()=>now
});
const options={expected_staging_sha:SHA,expected_binary_sha256:BIN,evidence_sha256:EVIDENCE};
const ch=await ledger.issue({staging_sha:SHA,binary_sha256:BIN,ttl_ms:300000});
assert.equal(ch.staging_sha,SHA);
assert.match(ch.nonce,/^[a-f0-9]{64}$/);
assert.equal(ch.expires_at_ms-ch.issued_at_ms,300000);
assert.equal(ledger.externally_custodied,false);
assert.equal(ledger.immutable_external_audit,false);
assert.equal(ledger.db_admin_authorized,false);
assert.equal(ledger.operational_broker_certified,false);
assert.equal(ledger.production_mutation,false);
await assert.rejects(()=>ledger.consumeOnce(ch,{...options,expected_staging_sha:"f".repeat(40)}),
  /BROKER_CHALLENGE_EXACT_BINDING_MISMATCH/);
await assert.rejects(()=>ledger.consumeOnce(ch,{...options,expected_binary_sha256:"b".repeat(64)}),
  /BROKER_CHALLENGE_EXACT_BINDING_MISMATCH/);
await assert.rejects(()=>ledger.consumeOnce({...ch,nonce:"b".repeat(64)},options),
  /BROKER_CHALLENGE_NOT_DURABLY_ISSUED/);
await assert.rejects(()=>ledger.consumeOnce({...ch,owner_operation_approved:true},options),
  /BROKER_CHALLENGE_CONSUME_SCOPE_INVALID/);
await assert.rejects(()=>ledger.issue({staging_sha:"f".repeat(40),binary_sha256:BIN,ttl_ms:700000}),
  /BROKER_CHALLENGE_ISSUE_SCOPE_INVALID/);
// Eight *separate OS processes* race to consume the same challenge.
const thisModule=fileURLToPath(import.meta.url);
const childSource=[
  "import {createPrivateStagingBackupBrokerChallengeLedger as mk} from './staging-backup-broker-challenge-ledger.mjs';",
  "let input=\"\";for await (const chunk of process.stdin)input+=chunk;",
  "const args=JSON.parse(input);",
  "const ledger=await mk({stateDir:args.dir,assertPrivateWindowsAcl:async()=>true});",
  "const result=await ledger.consumeOnce(args.challenge,args.options);",
  "process.stdout.write(String(result));"
].join("\n");
const spawnChild=()=>new Promise((resolve,reject)=>{
  const proc=spawn(process.execPath,["--input-type=module","-e",childSource],{
    cwd:path.dirname(thisModule),windowsHide:true,
    stdio:["pipe","pipe","pipe"]
  });
  proc.stdin.end(JSON.stringify({dir:directory,challenge:ch,options}));
  let output="",errors="";
  proc.stdout.on("data",c=>output+=c);
  proc.stderr.on("data",c=>errors+=c);
  proc.on("error",reject);
  proc.on("close",code=>code===0?resolve(output.trim()):
    reject(new Error("TEST_CHILD_FAILED:"+code+":"+errors.slice(0,400))));
});
const outcomes=await Promise.all(Array.from({length:8},()=>spawnChild()));
assert.equal(outcomes.filter(x=>x==="true").length,1,JSON.stringify(outcomes));
assert.equal(outcomes.filter(x=>x==="false").length,7,JSON.stringify(outcomes));
// Restarting the local service does not free the consumed challenge.
const restarted=await createPrivateStagingBackupBrokerChallengeLedger({
  stateDir:directory,assertPrivateWindowsAcl:acl,clock:()=>now
});
assert.equal(await restarted.consumeOnce(ch,options),false);
const expired=await ledger.issue({staging_sha:SHA,binary_sha256:BIN,ttl_ms:1000});
now+=1200;
await assert.rejects(()=>restarted.consumeOnce(expired,options),
  /BROKER_CHALLENGE_EXPIRED_OR_CLOCK_INVALID/);
await assert.rejects(()=>restarted.consumeOnce({...expired,nonce:"d".repeat(64)},options),
  /BROKER_CHALLENGE_NOT_DURABLY_ISSUED|BROKER_CHALLENGE_EXPIRED_OR_CLOCK_INVALID/);
const files=await fs.readdir(directory);
assert(files.filter(n=>n.startsWith("issued-")).length>=2);
assert.equal(files.filter(n=>n.startsWith("consumed-")).length,1);
await assert.rejects(()=>createPrivateStagingBackupBrokerChallengeLedger({
  stateDir:path.join(directory,"does-not-exist"),assertPrivateWindowsAcl:acl
}),/BROKER_CHALLENGE_PRIVATE_STAGING_DIR_REQUIRED/);
await assert.rejects(()=>createPrivateStagingBackupBrokerChallengeLedger({
  stateDir:"relative-challenge-state",assertPrivateWindowsAcl:acl
}),/BROKER_CHALLENGE_PRIVATE_STAGING_DIR_REQUIRED/);
const symlink=path.join(os.tmpdir(),"mad4b-test-challenge-symlink-"+process.pid);
try{
  await fs.symlink(directory,symlink,"dir");
  await assert.rejects(()=>createPrivateStagingBackupBrokerChallengeLedger({
    stateDir:symlink,assertPrivateWindowsAcl:acl
  }),/BROKER_CHALLENGE_PRIVATE_STAGING_DIR_REQUIRED/);
}catch(e){if(e.code!=="EPERM"&&e.code!=="EACCES")throw e;}
finally{await fs.rm(symlink,{force:true}).catch(()=>{});}
await fs.rm(directory,{recursive:true,force:true});
console.log(JSON.stringify({
  contract:"mad4b.staging.backup-broker.challenge-ledger.test.v1",
  passed:true,issued:true,durable_restart_replay_denied:true,
  concurrent_processes:8,concurrent_winners:1,
  expired_and_forged_denied:true,
  independent_custody:false,immutable_external_audit:false,
  operational_authority:false,production_mutation:false
}));
