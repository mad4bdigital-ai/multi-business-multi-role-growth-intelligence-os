import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign,verify,createHash} from "node:crypto";
import {createCentralCatalogIssuer,canonicalCatalogJson,publicCatalogTrust,CATALOG_RECEIPT_CONTRACT} from "./capabilityCatalogAuthority.js";

const H=c=>c.repeat(64);
const base={tenant_id:"tenant-01",site_id:"site-a",environment:"staging",
 origin_sha256:H("a"),runtime_generation:H("b")};
const keys=generateKeyPairSync("ed25519");
const clock=()=>2000000000;
const enrolled=()=>({kid:"capcat-key01",issuer:"mad4b-platform",
 purpose:"capability.catalog.attestation",status:"active",revoked:false,
 site:base,not_before:clock()-10,not_after:clock()+800,
 public_key_pem:keys.publicKey.export({type:"spki",format:"pem"}),
 sign:async data=>sign(null,data,keys.privateKey)});
const source=id=>({id,kind:"connector",...base,connected:true,read_authorized:true,lane:"read"});
const authorized=async ({principal,site_id})=>{
 if(principal?.tenant_id!=="tenant-01"||principal?.allowed!==true||site_id!=="site-a")
  throw Error("NOT_ALLOWED");
 return {...base,secret:"NOT_TO_BE_EXPORTED"};
};
const collected=async ({site})=>({
 site,authoritative:true,complete:true,sources:[source("source-b"),source("source-a")]
});
const build=(overrides={})=>createCentralCatalogIssuer({
 getAuthorizedSite:authorized,listAuthorizedSources:collected,
 getSiteSigningKey:async()=>enrolled(),clock,nonce:()=>"opaque-issue-nonce-1234567890",...overrides
});

test("issues a read-only catalog signed with a tenant-bound trusted key",async()=>{
 const issued=await build().issue({principal:{tenant_id:"tenant-01",allowed:true},site_id:"site-a"});
 const body=JSON.parse(issued.receipt.body);
 assert.equal(body.contract,CATALOG_RECEIPT_CONTRACT);
 assert.equal(body.site.tenant_id,"tenant-01");
 assert.deepEqual(body.source_ids,["source-a","source-b"]);
 assert.equal(body.catalog_sha256,createHash("sha256")
  .update(canonicalCatalogJson(issued.catalog)).digest("hex"));
 assert.equal(verify(null,Buffer.from(issued.receipt.body),keys.publicKey,
  Buffer.from(issued.receipt.signature_b64url,"base64url")),true);
 assert.equal(issued.execution_allowed,false);
 assert.equal(issued.authorizing,false);
 assert.equal(JSON.stringify(issued).includes("NOT_TO_BE_EXPORTED"),false);
 assert.equal(issued.catalog.sources.every(x=>x.lane==="read"&&!x.endpoint&&!x.token),true);
 assert.equal(publicCatalogTrust(enrolled(),base).kid,"capcat-key01");
});

test("denies unauthorized tenant, unknown site and forged source tenancy",async()=>{
 await assert.rejects(()=>build().issue({principal:{tenant_id:"tenant-02",allowed:true},site_id:"site-a"}));
 await assert.rejects(()=>build().issue({principal:{tenant_id:"tenant-01",allowed:true},site_id:"site-other"}));
 await assert.rejects(()=>build({listAuthorizedSources:async ({site})=>({
  site,complete:true,authoritative:true,sources:[{...source("s-1"),tenant_id:"tenant-02"}]
 })}).issue({principal:{tenant_id:"tenant-01",allowed:true},site_id:"site-a"}),/CATALOG_UNTRUSTED_SOURCE/);
});

test("coverage cannot certify itself or silently truncate",async()=>{
 await assert.rejects(()=>build({listAuthorizedSources:async({site})=>({site,complete:true,authoritative:false,sources:[]})})
  .issue({principal:{tenant_id:"tenant-01",allowed:true},site_id:"site-a"}),/CATALOG_COVERAGE_NOT_PROVEN/);
 await assert.rejects(()=>build({listAuthorizedSources:async({site})=>({site,complete:true,authoritative:true,
  sources:Array.from({length:33},(_,i)=>source("source-"+i))})})
  .issue({principal:{tenant_id:"tenant-01",allowed:true},site_id:"site-a"}),/CATALOG_SOURCE_BUDGET/);
});

test("revoked, stale, cross-site or wrong signing key refuses issuance",async()=>{
 for(const mutate of [
  k=>({...k,revoked:true}),
  k=>({...k,site:{...base,site_id:"elsewhere"}}),
  k=>({...k,not_after:clock()+50}),
  k=>({...k,purpose:"other.system"})
 ]) {
  await assert.rejects(()=>build({getSiteSigningKey:async()=>mutate(enrolled())})
    .issue({principal:{tenant_id:"tenant-01",allowed:true},site_id:"site-a"}));
 }
 const attacker=generateKeyPairSync("ed25519");
 await assert.rejects(()=>build({getSiteSigningKey:async()=>({
  ...enrolled(),sign:async bytes=>sign(null,bytes,attacker.privateKey)
 })}).issue({principal:{tenant_id:"tenant-01",allowed:true},site_id:"site-a"}),/CATALOG_SIGNER_SELF_CHECK_FAILED/);
});

test("strict canonical encoding rejects unsafe objects and fractional numbers",()=>{
 assert.throws(()=>canonicalCatalogJson({value:1.1}),/UNSAFE_CANONICAL_VALUE/);
 assert.throws(()=>canonicalCatalogJson(Object.fromEntries([["__proto__",5]])),/UNSAFE_CANONICAL_VALUE/);
});
