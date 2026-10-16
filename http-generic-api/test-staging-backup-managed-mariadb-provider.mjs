import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {createManagedStagingBackupReaderAdapters,runWithIndependentStagingBackupBroker} from "./stagingBackupManagedMariaDbProvider.mjs";
import {
  planStagingBackupReaderGrant,runGovernedStagingBackupReaderCensus,
  STAGING_BACKUP_READER_TABLES,
} from "./stagingBackupReaderGrantLifecycle.mjs";

const sha="d".repeat(40);
const device="local-certified-staging-device";
const runId="managed-reader-census-fixture-00001";
const tables=[...STAGING_BACKUP_READER_TABLES].sort();
const measured={deployment_environment:"staging_local_windows_docker",
  local_connector_verified:true,device_id:device,source_sha:sha,
  docker_network:"http-generic-api_default",docker_subnet:"172.18.0.0/16",
  db_host:"runtime-db",db_schema:"growth_runtime",production_mutation:false};
const plan=planStagingBackupReaderGrant({measured,expectedSha:sha,runId});
const keys=generateKeyPairSync("ed25519");
const issued=Date.now()-1000;
const token={
  contract:"mad4b.staging.backup-reader-grant-approval.v1",
  operation:"provision_census_revoke",owner_gate:"OWNER_ATTEST_SINGLE_OWNER",
  plan_sha256:plan.plan_sha256,source_sha:sha,device_id:device,run_id:runId,
  issued_at_ms:issued,expires_at_ms:issued+90_000,
};
const approval={...token,signature_b64:sign(null,Buffer.from(JSON.stringify(token)),
  keys.privateKey).toString("base64")};
function fixture(opts={}){
  const st={user:opts.existingUser===true,grants:[],statements:[],events:[],issued:new Set(),
    dbAccount:opts.account??"backup_grant_service",closedPools:0,created:0,
    dropped:0,provisionedSecret:null,readerConnections:0};
  const grants=()=>[
    {grant:"GRANT USAGE ON *.* TO `backup_policy_reader`@`172.18.%`"},
    ...st.grants.map(t=>({grant:
      `GRANT SELECT ON \`growth_runtime\`.\`${t}\` TO \`backup_policy_reader\`@\`172.18.%\`` })),
    ...(opts.excessGrant?[{grant:"GRANT INSERT ON `growth_runtime`.* TO `backup_policy_reader`@`172.18.%`"}]:[]),
  ];
  const adminSession={
    authority:{
      capability_key:"staging.backup.reader.provision-census-revoke",
      environment:"staging_local_windows_docker",source_sha:sha,device_id:device,
      db_host:"runtime-db",db_schema:"growth_runtime",
      network:"http-generic-api_default",
      no_production_mutation:true,independent_owner_signature_verified:true,
      redacts_query_parameters:true,single_use_ephemeral_session:true,
      ...(opts.badAuthority||{}),
    },
    async query(sql,args=[]){
      st.statements.push({sql,arg_count:args.length});
      if(sql==="SELECT DATABASE() AS database_name,CURRENT_USER() AS identity")
        return [[{database_name:"growth_runtime",identity:st.dbAccount+"@172.18.%"}]];
      if(sql.startsWith("SELECT TABLE_NAME AS name FROM information_schema.TABLES"))
        return [(opts.missingTable?tables.slice(1):tables).map(name=>({name}))];
      if(sql.startsWith("SELECT COUNT(*) AS total FROM mysql.user"))
        return [[{total:Number(st.user)}]];
      if(sql.startsWith("CREATE USER ")){
        st.created++;st.user=true;st.provisionedSecret=args[0];
        if(opts.createThrows)throw new Error("synthetic create failure");
        return [[],[]];
      }
      if(sql.startsWith("GRANT SELECT ON ")){
        if(opts.grantThrows && st.grants.length===2)throw new Error("synthetic grant failure");
        st.grants.push(tables.find(t=>sql.includes("`"+t+"`")));
        return [[],[]];
      }
      if(sql.startsWith("SHOW GRANTS FOR "))return [grants()];
      if(sql.startsWith("DROP USER IF EXISTS ")){
        st.dropped++;
        if(opts.dropThrows)throw new Error("synthetic revoke failure");
        st.user=false;st.grants=[];return [[],[]];
      }
      throw new Error("UNEXPECTED_SQL_IN_TEST "+sql);
    },
  };
  const readerDriver={
    createPool({host,database,user,password,connectionLimit}){
      assert.equal(host,"runtime-db");
      assert.equal(database,"growth_runtime");
      assert.equal(user,"backup_policy_reader");
      assert.equal(connectionLimit,1);
      assert.equal(password,st.provisionedSecret);
      st.readerConnections++;
      return {
        async query(sql,args=[]){
          if(opts.readerThrows)throw new Error("synthetic reader disconnect");
          if(sql.startsWith("SELECT DATABASE()"))return [[{
            database_name:"growth_runtime",principal:"backup_policy_reader@172.18.%"}]];
          if(sql==="SHOW GRANTS FOR CURRENT_USER()")return [grants()];
          if(sql.startsWith("SELECT policy_key,backup_kind"))
            return [Array.from({length:opts.policyCount??0},()=>({
              policy_key:"policy:staging-qa-db:approved",backup_kind:"database"}))];
          throw new Error("UNEXPECTED_READ_SQL");
        },
        async end(){st.closedPools++},
      };
    },
  };
  const ledger={async consumeOnce(id){
    if(st.issued.has(id))return false;st.issued.add(id);return true;
  }};
  const audit={async append(e){st.events.push(e)}};
  return {st,adminSession,readerDriver,ledger,audit};
}
async function execute(f,extras={}){
  const adapter=await createManagedStagingBackupReaderAdapters({
    adminSession:f.adminSession,readerDriver:f.readerDriver,
    expectedSourceSha:sha,deviceId:device,
  });
  return await runGovernedStagingBackupReaderCensus({
    measuredIdentity:async()=>measured,expectedSha:sha,runId,approval,
    trustedOwnerPublicKey:keys.publicKey,...adapter,
    ledger:f.ledger,audit:f.audit,...extras,
  });
}
const accepted=fixture();
const result=await execute(accepted);
assert.equal(result.ok,true);
assert.equal(result.policy_inventory_verified,true);
assert.equal(result.existing_policy_count,0);
assert.equal(result.reader_revoked,true);
assert.equal(accepted.st.user,false);
assert.equal(accepted.st.created,1);
assert.equal(accepted.st.dropped,1);
assert.equal(accepted.st.grants.length,0);
assert.equal(accepted.st.closedPools,1);
assert.equal(accepted.st.readerConnections,1);
assert.equal(accepted.st.events.length,2);
assert.equal(accepted.st.statements.filter(s=>s.sql.startsWith("GRANT SELECT")).length,4);
assert(!JSON.stringify(result).includes(accepted.st.provisionedSecret));
assert(!JSON.stringify(accepted.st.statements).includes(accepted.st.provisionedSecret));
await assert.rejects(execute(accepted),e=>e.code==="READER_GRANT_REPLAY_BLOCKED");
assert.equal(accepted.st.created,1);
for(const [name,options,expectedCode,createCount,dropCount] of [
  ["absent-table",{missingTable:true},"READER_GRANT_ADMIN_PREFLIGHT_BLOCKED",0,0],
  ["preexisting-reader",{existingUser:true},"READER_GRANT_ADMIN_PREFLIGHT_BLOCKED",0,0],
  ["existing-account",{account:"runtime_app"},"MANAGED_READER_ADMIN_PRINCIPAL_NOT_INDEPENDENT",0,0],
  ["partial-create",{createThrows:true},"READER_GRANT_EXECUTION_FAILED",1,1],
  ["partial-grant",{grantThrows:true},"READER_GRANT_EXECUTION_FAILED",1,1],
  ["excess-grant",{excessGrant:true},"BACKUP_POLICY_READER_EXCESS_PRIVILEGES",1,1],
  ["reader-error",{readerThrows:true},"BACKUP_POLICY_READER_CONNECTION_OR_GRANTS_UNVERIFIED",1,1],
  ["revocation-error",{dropThrows:true},"READER_GRANT_CLEANUP_UNVERIFIED",1,1],
]){
  const f=fixture(options);
  if(name==="existing-account"){
    await assert.rejects(execute(f),e=>e.code===expectedCode,name);
  }else{
    const actual=await execute(f);
    assert.equal(actual.ok,false,name);
    assert.equal(actual.blocker,expectedCode,name);
    assert.equal(actual.policy_inventory_verified,false,name);
  }
  assert.equal(f.st.created,createCount,name);
  assert.equal(f.st.dropped,dropCount,name);
}
for(const altered of [
  {source_sha:"b".repeat(40)},
  {reader_user:"runtime_app"},
  {db_schema:"production"},
  {tables:tables.slice(1)},
  {privileges:["SELECT","UPDATE"]},
  {account_host_pattern:"%"},
]){
  const f=fixture();
  const a=await createManagedStagingBackupReaderAdapters({
    adminSession:f.adminSession,readerDriver:f.readerDriver,
    expectedSourceSha:sha,deviceId:device,
  });
  await assert.rejects(a.admin.inspect({...plan.binding,...altered}),
    e=>e.code==="MANAGED_READER_EXACT_BINDING_REQUIRED");
  assert.equal(f.st.created,0);
}
const bad=fixture({badAuthority:{no_production_mutation:false}});
await assert.rejects(createManagedStagingBackupReaderAdapters({
  adminSession:bad.adminSession,readerDriver:bad.readerDriver,
  expectedSourceSha:sha,deviceId:device,
}),e=>e.code==="MANAGED_READER_BROKER_AUTHORITY_UNVERIFIED");
assert.equal(bad.st.statements.length,0);
// Exercise the new purpose-scoped broker handoff. These are synthetic broker
// objects; they do NOT claim a live installed DBA service or grant authority.
function brokerFixture(ticketPatch={},options={}){
  const f=fixture();
  let opened=0,closed=0;
  const issued=Date.now();
  const session={
    ...f.adminSession,
    authority:{...f.adminSession.authority,run_id:runId,
      plan_sha256:plan.plan_sha256,issued_at_ms:issued-1000,
      expires_at_ms:issued+90_000,...ticketPatch},
    async close(){closed++;if(options.closeFails)throw new Error("synthetic close failure");},
  };
  const broker={async openOneShotSession(request){
    opened++;
    assert.equal(request.capability_key,"staging.backup.reader.provision-census-revoke");
    assert.equal(request.plan.plan_sha256,plan.plan_sha256);
    return session;
  }};
  return {f,broker,session,get opened(){return opened;},
    get closed(){return closed;}};
}
function invokeBroker(v,overrides={}){
  return runWithIndependentStagingBackupBroker({
    broker:v.broker,measuredIdentity:async()=>measured,expectedSha:sha,
    runId,approval,trustedOwnerPublicKey:keys.publicKey,
    readerDriver:v.f.readerDriver,ledger:v.f.ledger,audit:v.f.audit,
    ...overrides,
  });
}
const composed=brokerFixture();
const brokerResult=await invokeBroker(composed);
assert.equal(brokerResult.ok,true);
assert.equal(composed.opened,1);
assert.equal(composed.closed,1);
assert.equal(composed.f.st.created,1);
assert.equal(composed.f.st.dropped,1);
assert.equal(composed.f.st.user,false);
assert.equal(composed.f.st.events.length,2);
assert.equal(composed.f.st.events.at(-1).status,"census_verified");
assert.equal(composed.f.st.events.at(-1).broker_session_closed,true);
const unsigned=brokerFixture();
await assert.rejects(invokeBroker(unsigned,{approval:{...approval,plan_sha256:"f".repeat(64)}}),
  e=>e.code==="READER_GRANT_OWNER_APPROVAL_REQUIRED");
assert.equal(unsigned.opened,0);
assert.equal(unsigned.f.st.created,0);
for(const patch of [
  {plan_sha256:"f".repeat(64)},
  {run_id:"different-operation-001"},
  {source_sha:"f".repeat(40)},
  {issued_at_ms:Date.now()+60_000},
  {expires_at_ms:Date.now()-1000},
  {single_use_ephemeral_session:false},
]){
  const v=brokerFixture(patch);
  await assert.rejects(invokeBroker(v),
    e=>e.code==="MANAGED_READER_BROKER_OPERATION_TICKET_UNVERIFIED");
  assert.equal(v.opened,1);
  assert.equal(v.closed,1);
  assert.equal(v.f.st.created,0);
}
const closing=brokerFixture({}, {closeFails:true});
await assert.rejects(invokeBroker(closing),
  e=>e.code==="MANAGED_READER_BROKER_SESSION_CLOSE_UNVERIFIED");
assert.equal(closing.f.st.created,1);
assert.equal(closing.f.st.dropped,1);
assert.equal(closing.f.st.user,false);
assert.equal(closing.closed,1);
assert.equal(closing.f.st.events.at(-1).status,"blocked");
assert.equal(closing.f.st.events.at(-1).broker_session_closed,false);
const noBroker=brokerFixture();
await assert.rejects(invokeBroker(noBroker,{broker:{}}),
  e=>e.code==="INDEPENDENT_STAGING_BACKUP_BROKER_REQUIRED");
assert.equal(noBroker.f.st.created,0);
console.log(JSON.stringify({
  contract:"mad4b.staging-managed-db-reader-provider.test.v1",
  passed:true,synthetic_only:true,
  end_to_end_census:true,grant_statements:4,
  tested_fail_closed_variants:8,
  privilege_scope_fixed:true,owner_signature_required:true,
  principal_revoke_on_partial_error:true,production_mutation:false,
  live_database_unchanged:true,
}));
