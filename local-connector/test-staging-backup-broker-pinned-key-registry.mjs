import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createHash,generateKeyPairSync} from "node:crypto";
import {readProtectedStagingBrokerPublicKeyRegistry as load}
  from "./staging-backup-broker-pinned-key-registry.mjs";
const dir=await fs.mkdtemp(path.join(os.tmpdir(),"mad4b-staging-public-pin-"));
await fs.chmod(dir,0o700);
const f=path.join(dir,"trusted-key-registry.json");
const makeKey=(role)=>{
  const {publicKey}=generateKeyPairSync("ed25519");
  const der=publicKey.export({format:"der",type:"spki"});
  return {
    role,key_id:role+"-ephemeral-key-for-offline-test",
    spki_der_b64:der.toString("base64"),
    spki_sha256:createHash("sha256").update(der).digest("hex")
  };
};
const owner=makeKey("owner"),witness=makeKey("witness");
const doc={
  contract:"mad4b.staging.backup-broker.public-keys.v1",
  environment:"staging_local_os_only",device_id:"DESKTOP-91FDEFP",
  keys:[owner,witness]
};
let aclPass=true;
const acl=async()=>aclPass;
const digest=b=>createHash("sha256").update(b).digest("hex");
async function write(value){const buf=Buffer.from(JSON.stringify(value)+"\n");await fs.writeFile(f,buf,{mode:0o600});await fs.chmod(f,0o600);return digest(buf);}
const pinHash=await write(doc);
const valid=await load({registryFile:f,expected_registry_sha256:pinHash,assertPrivateWindowsAcl:acl});
assert.equal(valid.owner.signer_key_id,owner.key_id);
assert.equal(valid.witness.witness_key_id,witness.key_id);
assert.equal(valid.registry_digest_matched,true);
for(const key of ["independently_approved_anchor","independent_custody_verified",
 "external_immutable_audit_verified","broker_operationally_certified",
 "db_admin_authorized","production_mutation"])assert.equal(valid[key],false,key);
await assert.rejects(()=>load({
 registryFile:f,expected_registry_sha256:"b".repeat(64),assertPrivateWindowsAcl:acl
}),/BROKER_PIN_REGISTRY_DIGEST_MISMATCH/);
if(process.platform==="win32")await assert.rejects(()=>load({
 registryFile:f,expected_registry_sha256:pinHash
}),/BROKER_PIN_WINDOWS_ACL_UNVERIFIED|BROKER_PIN_REGISTRY_/);
aclPass=false;
if(process.platform==="win32"){
 await assert.rejects(()=>load({
   registryFile:f,expected_registry_sha256:pinHash,assertPrivateWindowsAcl:acl
 }),/BROKER_PIN_WINDOWS_ACL_UNVERIFIED/);
}
aclPass=true;
const modifications=[
 {...doc,keys:[owner,owner]},
 {...doc,keys:[owner,{...witness,spki_sha256:owner.spki_sha256}]},
 {...doc,environment:"production"},
 {...doc,keys:[owner,witness],db_admin_authorized:true},
 {...doc,keys:[owner,{...witness,spki_der_b64:owner.spki_der_b64}]},
 {...doc,keys:[owner,{...witness,spki_sha256:"c".repeat(64)}]},
];
let negatives=0;
for(const mutation of modifications){
  const sha=await write(mutation);
  await assert.rejects(()=>load({
    registryFile:f,expected_registry_sha256:sha,assertPrivateWindowsAcl:acl
  }),/BROKER_PIN_/);
  negatives++;
}
await write(doc);
await assert.rejects(()=>load({registryFile:path.join(dir,"bad.json"),
  expected_registry_sha256:pinHash,assertPrivateWindowsAcl:acl}),
 /BROKER_PIN_PROTECTED_REGISTRY_PATH_REQUIRED/);
if(process.platform!=="win32"){
  await fs.chmod(f,0o644);
  await assert.rejects(()=>load({registryFile:f,
    expected_registry_sha256:pinHash,assertPrivateWindowsAcl:acl}),
   /BROKER_PIN_REGISTRY_ACL_OR_FILE_INVALID/);
  await fs.chmod(f,0o600);
}
await fs.rm(dir,{recursive:true,force:true});
console.log(JSON.stringify({
 contract:"mad4b.staging.backup-broker.public-key-registry.test.v1",
 passed:true,independent_public_key_roles:2,adversarial_cases:negatives+2,
 private_keys_persisted:false,out_of_band_anchor_provisioned:false,
 independently_approved:false,db_admin_authorized:false,production_mutation:false
}));
