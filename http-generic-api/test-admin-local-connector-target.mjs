import test from "node:test";
import assert from "node:assert/strict";
import {
  adminConnectorScope, chooseDevice, describeDevice,
  adminConnectorInventory, resolveAdminConnectorTarget,
} from "./adminLocalConnectorTarget.js";

const user="user-a",tenant="tenant-a",now=Date.parse("2026-10-08T20:00:00Z");
const fresh=()=>({
  config_id:"config-a",user_id:user,tenant_id:tenant,device_id:"current-pc",
  is_enabled:1,lifecycle_state:"active",archived_at:null,revoked_at:null,
  last_health_at:new Date(now-30000).toISOString(),tunnel_url:"https://current.example.test",
  connector_secret:"SENSITIVE_DEVICE",cf_token:"SENSITIVE_CF",
});
const scope={user_id:user,tenant_id:tenant};
function mockDb(rows=[fresh()],aliases=[]) {
  const calls=[];
  return {calls,async query(sql,params){
    calls.push({sql,params});
    if(sql.includes("local_connector_device_aliases"))return [aliases];
    if(sql.includes("config_id = ?"))return [rows.filter(r=>r.config_id===params[0]&&
      r.user_id===params[1]&&r.tenant_id===params[2]&&r.device_id===params[3])];
    return [rows.filter(r=>r.user_id===params[0]&&r.tenant_id===params[1])];
  }};
}
const fails=(p,code)=>assert.rejects(p,e=>e.code===code);

test("tenant identity cannot be supplied by a foreign user",()=>{
  assert.throws(()=>adminConnectorScope({auth:{mode:"user_jwt",user_id:user,tenant_id:tenant}},
    {tenant_id:"other"}),e=>e.code==="device_scope_mismatch");
  assert.throws(()=>adminConnectorScope({},{user_id:user}),
    e=>e.code==="device_tenant_scope_required");
});
test("single active fresh target auto-selects; multiple active targets do not",()=>{
  assert.equal(chooseDevice([fresh()],"",now).selection_source,"unique_fresh_device");
  assert.throws(()=>chooseDevice([fresh(),{...fresh(),device_id:"second-pc",config_id:"b"}],"",now),
    e=>e.code==="device_target_ambiguous");
});
test("revoked, archived, disabled and stale heartbeat deny both implicit and explicit selection",()=>{
  const changes=[
    {lifecycle_state:"revoked"},{lifecycle_state:"archived"},{is_enabled:0},
    {last_health_at:new Date(now-11*60000).toISOString()},
    {last_health_at:new Date(now+60000).toISOString()},
  ];
  for(const change of changes){
    const row={...fresh(),...change};
    assert.notEqual(describeDevice(row,now).state,"ACTIVE");
    assert.throws(()=>chooseDevice([row],"current-pc",now),e=>e.code==="device_target_not_trusted");
  }
});
test("globally scoped legacy aliases are checked without user/tenant authority escalation",async()=>{
  const p=mockDb([fresh()],[{canonical_device_id:"current-pc"}]);
  await fails(resolveAdminConnectorTarget({pool:p,scope,requestedDeviceId:"mohammedlap",now}),
    "historical_device_alias");
  assert(p.calls[0].sql.includes("user_id IS NULL"));
  assert(p.calls[0].sql.includes("tenant_id IS NULL"));
});
test("tenant-scoped caller without signed user or tenant cannot inherit platform defaults",()=>{
  assert.throws(()=>adminConnectorScope({auth:{mode:"user_jwt",user_id:user}},{}),
    e=>e.code==="device_signed_identity_missing");
});

test("historical alias refuses silent privileged rebinding",async()=>{
  const p=mockDb([fresh()],[{canonical_device_id:"current-pc"}]);
  await fails(resolveAdminConnectorTarget({pool:p,scope,requestedDeviceId:"mohammedlap",now}),
    "historical_device_alias");
  assert.equal(p.calls.length,1);
});
test("cross-tenant device cannot be used as target",async()=>{
  const p=mockDb([{...fresh(),tenant_id:"tenant-b"}]);
  await fails(resolveAdminConnectorTarget({pool:p,scope,now}),"device_target_unavailable");
  assert.deepEqual(p.calls[0].params,[user,tenant]);
});
test("DB outage does not activate an environment credential fallback",async()=>{
  await assert.rejects(resolveAdminConnectorTarget({
    pool:{query:async()=>{throw Error("db down");}},scope,now,includeCredentials:true}),/db down/);
});
test("scoped second read uses exact user tenant device config and only SELECT",async()=>{
  const p=mockDb();
  const r=await resolveAdminConnectorTarget({pool:p,scope,now,includeCredentials:true});
  assert.equal(r.credentials.connector_secret,"SENSITIVE_DEVICE");
  assert.equal(p.calls.length,2);
  assert(p.calls.every(x=>x.sql.trimStart().startsWith("SELECT")));
  assert(p.calls[1].sql.includes("archived_at IS NULL"));
  assert.deepEqual(p.calls[1].params,["config-a",user,tenant,"current-pc"]);
});
test("inventory is credential-free, even with secret-bearing source rows",async()=>{
  const p=mockDb();
  const inventory=await adminConnectorInventory({pool:p,scope,now});
  assert.equal(inventory.devices[0].state,"ACTIVE");
  assert(!JSON.stringify(inventory).includes("SENSITIVE_"));
});
test("missing scoped device secret or route denies materialization",async()=>{
  for(const [change,code] of [[{connector_secret:null},"device_credential_missing"],
    [{tunnel_url:null},"device_route_missing"]]){
    await fails(resolveAdminConnectorTarget({pool:mockDb([{...fresh(),...change}]),
      scope,now,includeCredentials:true}),code);
  }
});
test("lifecycle changing after target resolution denies credential retrieval",async()=>{
  let reads=0;
  const p={async query(){
    const row=reads++===0?fresh():{...fresh(),lifecycle_state:"revoked"};
    return [[row]];
  }};
  await fails(resolveAdminConnectorTarget({pool:p,scope,now,includeCredentials:true}),
    "device_target_not_trusted");
});
