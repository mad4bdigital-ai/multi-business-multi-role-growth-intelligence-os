import test from "node:test";
import assert from "node:assert/strict";
import {
  createHostingerReadOnlyTransport, previewHostingerRecoveryDatabase,
} from "./hostingerRecoveryReadOnlyPlanner.js";

const account="u123456789";
const database="u123456789_recovery";
const domain="app.example.com";
const token="server-managed-test-credential-not-exposed";
const inventory=(names=[database])=>new Response(JSON.stringify({data:names.map(name=>({name}))}),{
  status:200,headers:{"content-type":"application/json"}
});

test("managed Hostinger inventory only performs exact GET and returns no credential",async()=>{
  const calls=[];
  const provider=createHostingerReadOnlyTransport({
    getManagedToken:async()=>token,
    fetchImpl:async(url,opts)=>{calls.push({url,opts});return inventory();}
  });
  const report=await previewHostingerRecoveryDatabase({
    accountUsername:account,websiteDomain:domain,recoveryDatabaseName:database,provider
  });
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,
    "https://developers.hostinger.com/api/hosting/v1/accounts/u123456789/databases");
  assert.equal(calls[0].opts.method,"GET");
  assert.equal(calls[0].opts.redirect,"manual");
  assert.equal(calls[0].opts.headers.Authorization,`Bearer ${token}`);
  assert.equal(report.provider_inventory_response_accepted,true);
  assert.equal(report.inventory_readback_proven,false);
  assert.equal(report.target_database_exists,true);
  assert.equal(report.plan_allowed,false);
  assert.equal(report.execution_allowed,false);
  assert.equal(report.mutation_performed,false);
  assert(!JSON.stringify(report).includes(token));
  assert(report.blockers.includes("database_already_exists_owner_and_schema_readback_required"));
});

test("missing database proposes an explicit independent approval, never enables create",async()=>{
  const provider=createHostingerReadOnlyTransport({
    getManagedToken:async()=>token,fetchImpl:async()=>inventory(["u123456789_existing"])
  });
  const report=await previewHostingerRecoveryDatabase({
    accountUsername:account,websiteDomain:domain,recoveryDatabaseName:database,provider
  });
  assert.equal(report.target_database_exists,false);
  assert.match(report.plan_sha256,/^[a-f0-9]{64}$/);
  assert.equal(report.suggested_operation,"request_governed_database_create_plan");
  assert.equal(report.certified_executor_registered,false);
  assert.equal(report.execution_allowed,false);
});

test("wrong account, domain, database prefix, or untrusted provider fails before GET",async()=>{
  let calls=0;
  const provider={databaseInventory:async()=>{calls++;return {database_names:[],provider_http_status:200}}};
  for(const x of [
    {accountUsername:"../../evil",websiteDomain:domain,recoveryDatabaseName:database},
    {accountUsername:account,websiteDomain:"127.0.0.1",recoveryDatabaseName:database},
    {accountUsername:account,websiteDomain:domain,recoveryDatabaseName:"other_recovery"}
  ]){
    await assert.rejects(previewHostingerRecoveryDatabase({...x,provider}),e=>Boolean(e.code));
  }
  assert.equal(calls,0);
  await assert.rejects(previewHostingerRecoveryDatabase({
    accountUsername:account,websiteDomain:domain,recoveryDatabaseName:database,
    provider:{}
  }),e=>e.code==="hostinger_provider_inventory_executor_missing");
});

test("provider HTTP 401/403 and redirects cannot be interpreted as capabilities",async()=>{
  for (const status of [401,403,302,503]) {
    const provider=createHostingerReadOnlyTransport({
      getManagedToken:async()=>token,
      fetchImpl:async()=>new Response("",{status,headers:status===302?{location:"https://invalid.test"}:{}})
    });
    await assert.rejects(provider.databaseInventory(account),e=>
      e.code===([401,403].includes(status)
        ?"hostinger_provider_inventory_permission_denied":"hostinger_provider_inventory_failed"));
  }
});

test("malformed, paginated, duplicate or unbounded inventory is never accepted",async()=>{
  for (const data of [
    {items:[{name:database}]},
    {data:[{name:database}],links:{next:"next-page"}},
    {data:[{name:database},{name:database}]},
    {data:[{database_name:database}]}
  ]) {
    const provider=createHostingerReadOnlyTransport({
      getManagedToken:async()=>token,
      fetchImpl:async()=>new Response(JSON.stringify(data),{status:200})
    });
    await assert.rejects(provider.databaseInventory(account),e=>Boolean(e.code));
  }
  const provider=createHostingerReadOnlyTransport({
    getManagedToken:async()=>token,
    fetchImpl:async()=>new Response("x".repeat(300000),{status:200})
  });
  await assert.rejects(provider.databaseInventory(account),
    e=>e.code==="hostinger_inventory_response_unbounded");
});

test("no secret, token or arbitrary endpoint may be returned by preview",async()=>{
  const provider={databaseInventory:async()=>({
    database_names:[],provider_http_status:200,token,secret:"secret",password:"password"
  })};
  const result=await previewHostingerRecoveryDatabase({
    accountUsername:account,websiteDomain:domain,recoveryDatabaseName:database,provider
  });
  for (const secret of [token,"secret","password"]){
    assert(!JSON.stringify(result).includes(secret));
  }
  assert.equal(result.provider_create_entitlement_proven,false);
  assert.equal(result.owner_approval_proven,false);
  assert.equal(result.plan_allowed,false);
  assert.equal(result.execution_allowed,false);
});
