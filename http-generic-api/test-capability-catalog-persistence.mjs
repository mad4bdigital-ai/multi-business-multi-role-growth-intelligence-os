import test from "node:test";
import assert from "node:assert/strict";
import {createMysqlCatalogNonceStore,createMysqlCatalogKeyReader} from "./capabilityCatalogPersistence.js";
const H=x=>x.repeat(64),ts=2000000000;
const receipt={issuer:"mad4b-platform",kid:"key-01",nonce:"nonce-single-use-123456789",
 tenant_id:"tenant-a",site_id:"site-b",environment:"staging",
 origin_sha256:H("a"),runtime_generation:H("b"),expires_at:ts+90};

test("SQL adapter enforces unique consumption even under concurrent requests",async()=>{
 const consumed=new Set();
 const execute=async(sql,params)=>{
  assert.match(sql,/INSERT INTO platform_capability_catalog_consumed_nonces/);
  const digest=params[0];assert.match(digest,/^[a-f0-9]{64}$/);
  if(consumed.has(digest)){const e=Error("duplicate");e.code="ER_DUP_ENTRY";throw e;}
  consumed.add(digest);return [{affectedRows:1}];
 };
 const s=createMysqlCatalogNonceStore({execute,clock:()=>ts});
 const results=await Promise.all(Array.from({length:20},()=>s.consumeNonce(receipt)));
 assert.equal(results.filter(Boolean).length,1);
 assert.equal(await s.consumeNonce(receipt),false);
 assert.equal(await s.consumeNonce({...receipt,nonce:"another-unique-nonce-12345"}),true);
 assert.equal(await s.consumeNonce({...receipt,expires_at:ts-1,nonce:"expired-new-nonce-12345"}),false);
 assert.equal(await s.consumeNonce({...receipt,tenant_id:"wrong@tenant"}),false);
});
test("SQL failure or no result never counts as a consumed nonce",async()=>{
 const store=createMysqlCatalogNonceStore({clock:()=>ts,execute:async()=>{throw Error("DB_DOWN")}});
 assert.equal(await store.consumeNonce(receipt),false);
 const empty=createMysqlCatalogNonceStore({clock:()=>ts,execute:async()=>[{affectedRows:0}]});
 assert.equal(await empty.consumeNonce(receipt),false);
});
test("key metadata lookup uses bound site and a separate secret manager",async()=>{
 let called=null;
 const execute=async(sql,params)=>{
  assert.match(sql,/tenant_id=\?/);
  assert.deepEqual(params,["tenant-a","site-b","staging","capability.catalog.attestation"]);
  return [[{kid:"key-01",issuer:"platform",key_ref:"opaque-secret-ref",
   public_key_pem:"server-owned-public-key",not_before_epoch:ts-10,not_after_epoch:ts+90,
   status:"active",revoked:0}]];
 };
 const read=createMysqlCatalogKeyReader({
  execute,keyHandleReader:async record=>{called=record;return {sign:()=>Buffer.alloc(64)}}
 });
 const site={tenant_id:"tenant-a",site_id:"site-b",environment:"staging",origin_sha256:H("a"),runtime_generation:H("b")};
 const key=await read({site,purpose:"capability.catalog.attestation"});
 assert.equal(key.kid,"key-01");
 assert.equal(called.trusted_key_ref,"opaque-secret-ref");
 assert.equal(Object.hasOwn(key,"private_key"),false);
 await assert.rejects(()=>read({site,purpose:"other.purpose"}),/KEY_QUERY_SCOPE_INVALID/);
});
test("multiple simultaneously active key candidates require explicit rotation state",async()=>{
 const read=createMysqlCatalogKeyReader({
  execute:async()=>[[{kid:"a"},{kid:"b"}]],keyHandleReader:async()=>({sign:()=>{}})
 });
 await assert.rejects(()=>read({site:{tenant_id:"tenant-a",site_id:"site-b",environment:"staging"},
  purpose:"capability.catalog.attestation"}),/KEY_ROTATION_AMBIGUOUS_OR_UNAVAILABLE/);
});
