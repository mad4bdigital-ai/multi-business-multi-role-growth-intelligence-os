import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {createIndependentStagingBackupDbAdminBroker} from "./staging-backup-db-admin-broker.mjs";
import {planStagingBackupReaderGrant,STAGING_BACKUP_READER_TABLES} from "../http-generic-api/stagingBackupReaderGrantLifecycle.mjs";
import {runWithIndependentStagingBackupBroker} from "../http-generic-api/stagingBackupManagedMariaDbProvider.mjs";

const sha="c".repeat(40),device="local-certified-staging-device";
const runId="staging-broker-synthetic-run-00001";
const measured={deployment_environment:"staging_local_windows_docker",
  local_connector_verified:true,device_id:device,source_sha:sha,
  docker_network:"http-generic-api_default",docker_subnet:"172.18.0.0/16",
  db_host:"runtime-db",db_schema:"growth_runtime",production_mutation:false};
const plan=planStagingBackupReaderGrant({measured,expectedSha:sha,runId});
const keys=generateKeyPairSync("ed25519");
const now=Date.now(),tables=[...STAGING_BACKUP_READER_TABLES].sort();
function approvalOf(overrides={}){
  const signed={contract:"mad4b.staging.backup-reader-grant-approval.v1",
    operation:"provision_census_revoke",owner_gate:"OWNER_ATTEST_SINGLE_OWNER",
    plan_sha256:plan.plan_sha256,source_sha:sha,device_id:device,
    run_id:runId,issued_at_ms:now-500,expires_at_ms:now+90_000,
    ...overrides};
  return {...signed,signature_b64:sign(null,Buffer.from(JSON.stringify(signed)),
    keys.privateKey).toString("base64")};
}
function mock(options={}){
  const st={opened:0,closed:0,queries:[],events:[],used:new Set(),
    hasUser:false,grants:new Set(),secret:null,now,policyCount:0};
  const grantList=()=>[
    {grant:"GRANT USAGE ON *.* TO `backup_policy_reader`@`172.18.%`"},
    ...[...st.grants].map(t=>({grant:`GRANT SELECT ON \`growth_runtime\`.\`${t}\` TO \`backup_policy_reader\`@\`172.18.%\``}))
  ];
  const adminClientFactory=async()=>{
    st.opened++;
    return {
      boundTarget:{host:"runtime-db",port:3306,schema:"growth_runtime",
        network:"http-generic-api_default",
        environment:"staging_local_windows_docker",
        device_id:device,source_sha:sha,
        independently_attested:true,no_production_mutation:true,
        ...(options.boundTargetPatch??{})},
      async query(sql,params=[]){
        st.queries.push({sql,args_count:params.length});
        if(sql.startsWith("SELECT DATABASE()"))
          return [[{database_name:"growth_runtime",identity:(options.principal??"backup_grant_service")+"@172.18.%"}]];
        if(sql.startsWith("SELECT TABLE_NAME"))
          return [tables.map(name=>({name}))];
        if(sql.startsWith("SELECT COUNT(*) FROM mysql.user")||
           sql.startsWith("SELECT COUNT(*) AS total FROM mysql.user"))
          return [[{total:Number(st.hasUser)}]];
        if(sql.startsWith("CREATE USER")){
          st.hasUser=true;st.secret=params[0];return [[],[]];
        }
        if(sql.startsWith("GRANT SELECT")){
          st.grants.add(tables.find(t=>sql.includes("`"+t+"`")));
          return [[],[]];
        }
        if(sql.startsWith("SHOW GRANTS"))return [grantList()];
        if(sql.startsWith("DROP USER")){
          if(options.failDrop)throw Error("synthetic-drop-failure");
          st.hasUser=false;st.grants.clear();return [[],[]];
        }
        throw new Error("TEST_UNEXPECTED_ADMIN_SQL");
      },
      async close(){st.closed++;if(options.failClose)throw Error("synthetic-close-failure");}
    };
  };
  const readerDriver={
    createPool({host,database,user,password,connectionLimit}){
      assert.equal(host,"runtime-db");assert.equal(database,"growth_runtime");
      assert.equal(user,"backup_policy_reader");assert.equal(connectionLimit,1);
      assert.equal(password,st.secret);
      return {
        async query(sql){
          if(sql.startsWith("SELECT DATABASE()"))
            return [[{database_name:"growth_runtime",principal:"backup_policy_reader@172.18.%"}]];
          if(sql==="SHOW GRANTS FOR CURRENT_USER()")return [grantList()];
          if(sql.startsWith("SELECT policy_key,backup_kind"))return [[]];
          throw Error("UNEXPECTED_READER_SQL");
        },
        async end(){}
      };
    }
  };
  const reservation={async consumeOnce(id,hash){
    const key=id+"|"+hash;
    if(st.used.has(key))return false;st.used.add(key);return true;
  }};
  const audit={async append(event){st.events.push(event);}};
  const opts={
    isolatedStagingProcessAttested:true,measureIdentity:async()=>({...measured,...(options.identityPatch??{})}),
    adminClientFactory,reservation,audit,
    pinnedOwnerPublicKey:keys.publicKey,
    sourceSha:sha,clock:()=>st.now
  };
  return {st,readerDriver,opts,broker:()=>createIndependentStagingBackupDbAdminBroker(opts)};
}
async function opens(v,approve=approvalOf(),p=plan){
  return v.broker().openOneShotSession({capability_key:"staging.backup.reader.provision-census-revoke",
    plan:p,approval:approve});
}
const clean=mock();
const broker=clean.broker();
const answer=await runWithIndependentStagingBackupBroker({
  broker,measuredIdentity:async()=>measured,expectedSha:sha,runId,
  approval:approvalOf(),trustedOwnerPublicKey:keys.publicKey,
  readerDriver:clean.readerDriver,ledger:clean.opts.reservation===null?null:{
    async consumeOnce(){return true;}
  },audit:clean.opts.audit,
});
assert.equal(answer.ok,true);
assert.equal(answer.policy_inventory_verified,true);
assert.equal(answer.existing_policy_count,0);
assert.equal(answer.reader_revoked,true);
assert.equal(clean.st.hasUser,false);
assert.equal(clean.st.grants.size,0);
assert.equal(clean.st.opened,1);
assert.equal(clean.st.closed,1);
assert.equal(clean.st.events.at(-1).broker_session_closed,true);
assert.equal(clean.st.events.at(-1).status,"census_verified");
assert.equal(clean.st.queries.filter(x=>x.sql.startsWith("GRANT SELECT")).length,4);
assert(!JSON.stringify(clean.st.events).includes(clean.st.secret));
await assert.rejects(broker.openOneShotSession({capability_key:broker.capability_key,
  plan,approval:approvalOf()}),e=>e.code==="INDEPENDENT_DB_BROKER_OPERATION_REPLAY");
assert.equal(clean.st.opened,1);
for(const [label,mutations,expected] of [
  ["wrong-plan",{plan:{...plan,plan_sha256:"f".repeat(64)}},"INDEPENDENT_DB_BROKER_EXACT_PLAN_REQUIRED"],
  ["expired-signature",{approval:approvalOf({expires_at_ms:now-1})},"READER_GRANT_OWNER_APPROVAL_REQUIRED"],
  ["bad-signer",{approval:{...approvalOf(),signature_b64:Buffer.from("invalid").toString("base64")}},"READER_GRANT_OWNER_SIGNATURE_INVALID"],
  ["wrong-capability",{capability_key:"generic.db_admin"},"INDEPENDENT_DB_BROKER_CAPABILITY_DENIED"],
]){
  const v=mock();
  await assert.rejects(v.broker().openOneShotSession({
    capability_key:"staging.backup.reader.provision-census-revoke",plan,
    approval:approvalOf(),...mutations
  }),e=>e.code===expected,label);
  assert.equal(v.st.opened,0,label);
}
for(const invalid of [mock({boundTargetPatch:{host:"other-db"}})]){
  await assert.rejects(opens(invalid),
    e=>e.code==="INDEPENDENT_DB_BROKER_ENDPOINT_ATTESTATION_REQUIRED");
  assert.equal(invalid.st.closed,1);
  assert.equal(invalid.st.queries.length,0);
}
const badIdentity=mock({principal:"runtime_app"});
await assert.rejects(opens(badIdentity),
  e=>e.code==="INDEPENDENT_DB_BROKER_ADMIN_IDENTITY_DENIED");
assert.equal(badIdentity.st.opened,1);
assert.equal(badIdentity.st.closed,1);
assert.equal(badIdentity.st.queries.length,1);
const badMeasure=mock({identityPatch:{docker_subnet:"10.0.0.0/8"}});
await assert.rejects(opens(badMeasure),
  e=>e.code==="READER_GRANT_MEASURED_STAGING_REQUIRED");
assert.equal(badMeasure.st.opened,0);
const missing=mock();delete missing.opts.adminClientFactory;
assert.throws(()=>missing.broker(),e=>e.code==="INDEPENDENT_DB_BROKER_TRUST_ROOT_REQUIRED");
const restrictive=mock();const session=await opens(restrictive);
await assert.rejects(session.query("SELECT * FROM mysql.user"),e=>e.code==="INDEPENDENT_DB_BROKER_SQL_DENIED");
await assert.rejects(session.query("CREATE USER 'evil'@'%' IDENTIFIED BY ?",["pw"]),
  e=>e.code==="INDEPENDENT_DB_BROKER_SQL_DENIED");
await assert.rejects(session.query("GRANT ALL ON *.* TO 'root'@'%'"),
  e=>e.code==="INDEPENDENT_DB_BROKER_SQL_DENIED");
await assert.rejects(session.query("DROP USER IF EXISTS 'root'@'%'"),
  e=>e.code==="INDEPENDENT_DB_BROKER_SQL_DENIED");
restrictive.st.now=now+90_100;
await assert.rejects(session.query("SELECT DATABASE() AS database_name,CURRENT_USER() AS identity"),
  e=>e.code==="INDEPENDENT_DB_BROKER_SESSION_EXPIRED");
await assert.rejects(session.query("DROP USER IF EXISTS 'backup_policy_reader'@'172.18.%'"),
  e=>e.code==="INDEPENDENT_DB_BROKER_SQL_DENIED");
await session.close();
await assert.rejects(session.query("SELECT DATABASE() AS database_name,CURRENT_USER() AS identity"),
  e=>e.code==="INDEPENDENT_DB_BROKER_SESSION_CLOSED");
assert.equal(restrictive.st.closed,1);
const interrupted=mock();
const interruptedSession=await opens(interrupted);
await interruptedSession.query(
  "CREATE USER 'backup_policy_reader'@'172.18.%' IDENTIFIED BY ?",
  ["s".repeat(72)]);
assert.equal(interrupted.st.hasUser,true);
await interruptedSession.close();
assert.equal(interrupted.st.hasUser,false);
assert.equal(interrupted.st.closed,1);
assert.equal(interrupted.st.events.at(-1).reader_absent,true);
const closeFailure=mock({failClose:true});
const closing=await opens(closeFailure);
await assert.rejects(closing.close(),
  e=>e.code==="INDEPENDENT_DB_BROKER_CLEANUP_UNVERIFIED");
assert.equal(closeFailure.st.opened,1);
assert.equal(closeFailure.st.closed,1);
const revokeFailure=mock({failDrop:true});
const revokeSession=await opens(revokeFailure);
await revokeSession.query(
  "CREATE USER 'backup_policy_reader'@'172.18.%' IDENTIFIED BY ?",
  ["s".repeat(72)]);
await assert.rejects(revokeSession.close(),
  e=>e.code==="INDEPENDENT_DB_BROKER_CLEANUP_UNVERIFIED");
assert.equal(revokeFailure.st.hasUser,true);
assert.equal(revokeFailure.st.closed,1);
console.log(JSON.stringify({
  contract:"mad4b.independent-staging-backup-db-broker.test.v1",
  passed:true,synthetic_only:true,
  no_http_route:true,no_live_admin_credentials:true,
  source_bound_signature_verified:true,
  broker_atomic_replay_reservation:true,
  fixed_sql_allowlist:true,
  cleanup_after_expiry:true,
  account_restriction:true,
  integration_census_verified:true,
  production_mutation:false,real_db_mutation:false
}));
