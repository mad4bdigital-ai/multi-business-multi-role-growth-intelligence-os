import test from "node:test";
import assert from "node:assert/strict";
import {createCatalogV2SourceCollector} from "./capabilityCatalogToolCollector.js";
const site={tenant_id:"tenant-1",site_id:"website-1",environment:"staging",
 origin_sha256:"a".repeat(64),runtime_generation:"b".repeat(64)};
const rows=[
 {name:"filesystem-list",source_key:"wordpress-1",kind:"connector",connected:true,read_only:true,
 effective_read_authorized:true,effect:"read",status:"active"},
 {name:"catalog-search",source_key:"platform-2",kind:"external_service",connected:true,read_only:true,
 effective_read_authorized:true,effect:"read",status:"active"}
];
const provider=async ({site})=>({site,tools:rows,complete:true,authoritative:true});
const collect=createCatalogV2SourceCollector({getSubjectEffectiveTools:provider});

test("uses Catalog V2 normalized stable source projections",async()=>{
 const a=await collect({site,principal:{tenant_id:"tenant-1"}});
 assert.equal(a.complete,true);assert.equal(a.sources.length,2);
 assert.ok(a.sources.every(x=>x.read_authorized&&!x.credential&&!x.endpoint));
 const reversed=createCatalogV2SourceCollector({getSubjectEffectiveTools:async({site})=>({
  site,tools:[...rows].reverse(),complete:true,authoritative:true
 })});
 const b=await reversed({site,principal:{tenant_id:"tenant-1"}});
 assert.deepEqual(a.sources,b.sources);
});

test("rejects read permission and scope assertion forgery",async()=>{
 for(const change of [
  {effect:"write"},{effective_read_authorized:false},{connected:false},
  {kind:"unknown"},{requires_admin:true},{status:"inactive"}
 ]){
  const reader=createCatalogV2SourceCollector({getSubjectEffectiveTools:async({site})=>({
   site,tools:[{...rows.find(row=>row.name==="filesystem-list"),...change}],complete:true,authoritative:true
  })});
  await assert.rejects(()=>reader({site,principal:{tenant_id:"tenant-1"}}));
 }
 const wrong=createCatalogV2SourceCollector({getSubjectEffectiveTools:async()=>({
  site:{...site,site_id:"other"},tools:rows,complete:true,authoritative:true
 })});
 await assert.rejects(()=>wrong({site,principal:{tenant_id:"tenant-1"}}));
});
test("caps missing, partial and oversized inventories",async()=>{
 const tools=Array.from({length:33},(_,i)=>({...rows.find(row=>row.name==="filesystem-list"),name:"reader-"+i}));
 const reader=createCatalogV2SourceCollector({getSubjectEffectiveTools:async({site})=>({
  site,tools,complete:true,authoritative:true
 })});
 await assert.rejects(()=>reader({site,principal:{id:"operator"}}),/EFFECTIVE_SOURCE_BUDGET_EXCEEDED/);
 const incomplete=createCatalogV2SourceCollector({getSubjectEffectiveTools:async({site})=>({
  site,tools:rows,complete:false,authoritative:true
 })});
 await assert.rejects(()=>incomplete({site,principal:{id:"operator"}}),/EFFECTIVE_SOURCE_SCOPE_INCOMPLETE/);
});
