import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import mysql from "mysql2/promise";
import { DEVICE_LINK_COLUMNS,evaluateDeviceLinkSchema } from "./localManagerSchemaReadiness.js";
import { requireLocalManagerDevice,pollDeviceLinkSession,_testingLocalManagerDeviceLink as pairing } from "./services/localManagerDeviceLinkService.js";
import { resolveLocalManagerWriteDbConfig,assertLocalManagerWritePrivilegeReadiness,_testingLocalManagerWriteAuthority as writer } from "./localManagerWriteAuthority.js";
import { latestLocalManagerWindowsRelease } from "./localManagerReleaseRegistry.js";
import { getRuntimeBootstrapStatus } from "./runtimeBootstrapStatus.js";
import { buildLocalConnectorInstallRoutes } from "./routes/localConnectorInstallRoutes.js";
const columns=Object.entries(DEVICE_LINK_COLUMNS).map(([COLUMN_NAME,[type,CHARACTER_MAXIMUM_LENGTH,IS_NULLABLE]])=>({COLUMN_NAME,DATA_TYPE:type.split("|")[0],CHARACTER_MAXIMUM_LENGTH,IS_NULLABLE,COLUMN_TYPE:COLUMN_NAME==="status"?"enum('pending','approved','completed','expired','revoked')":type}));
const indexes=["session_id","display_code_hash","poll_token_hash"].map(COLUMN_NAME=>({INDEX_NAME:COLUMN_NAME,COLUMN_NAME,NON_UNIQUE:0,SUB_PART:null,SEQ_IN_INDEX:1}));
const hash=value=>crypto.createHash("sha256").update(value).digest("hex");
const secret="local-manager-test-only-secret-32-characters";
const savedEnv={...process.env}, savedCreatePool=mysql.createPool;
let query;
mysql.createPool=()=>({query:(...args)=>query(...args)});
test.beforeEach(()=>{
  for(const key of ["PLATFORM_JWT_ISSUER","DEPLOYMENT_ENVIRONMENT","REMOTE_MCP_ENVIRONMENT"]) delete process.env[key];
  Object.assign(process.env,{NODE_ENV:"test",DB_HOST:"fixture",DB_NAME:"runtime",DB_USER:"reader",DB_PASSWORD:"fixture",LOCAL_MANAGER_DEVICE_JWT_SECRET:secret});
  query=async()=>{throw new Error("Unexpected DB access");};
});
test.after(()=>{mysql.createPool=savedCreatePool;process.env=savedEnv;});
test("schema rejects every missing field, truncation and missing/composite uniqueness",()=>{
  assert.equal(evaluateDeviceLinkSchema(columns,indexes).ready,true);
  for(const row of columns) assert.equal(evaluateDeviceLinkSchema(columns.filter(item=>item!==row),indexes).ready,false,row.COLUMN_NAME);
  assert.equal(evaluateDeviceLinkSchema(columns.map(row=>row.COLUMN_NAME==="hostname"?{...row,CHARACTER_MAXIMUM_LENGTH:16}:row),indexes).ready,false);
  assert.equal(evaluateDeviceLinkSchema(columns,indexes.slice(1)).ready,false);
  assert.equal(evaluateDeviceLinkSchema(columns,[...indexes,{...indexes[1],COLUMN_NAME:"status",SEQ_IN_INDEX:2}]).ready,false);
  assert.equal(evaluateDeviceLinkSchema(columns.map(row=>row.COLUMN_NAME==="metadata_json"?{...row,DATA_TYPE:"longtext"}:row),indexes).ready,true);
});
test("signing configuration is 503 while invalid JWT is 401",async()=>{
  for(const value of ["","short","x".repeat(4097)]) {
    process.env.LOCAL_MANAGER_DEVICE_JWT_SECRET=value;
    await assert.rejects(requireLocalManagerDevice({headers:{authorization:"Bearer invalid"}}),e=>e.status===503&&e.code==="local_manager_device_jwt_unavailable");
  }
  process.env.LOCAL_MANAGER_DEVICE_JWT_SECRET=secret;
  await assert.rejects(requireLocalManagerDevice({headers:{authorization:"Bearer invalid"}}),e=>e.status===401&&e.code==="invalid_device_token");
});
test("issuers and bootstrap branches distinguish Production and staging",()=>{
  for(const [env,branch,issuer] of [["production","Production","https://auth.mad4b.com"],["staging","main","https://dev.mad4b.com"]]) {
    assert.equal(pairing.localManagerJwtIssuer({NODE_ENV:env}),issuer);
    const result=getRuntimeBootstrapStatus({NODE_ENV:env});
    assert.equal(result.source_binding.branch,branch);
    assert.equal(result.database_readiness,"not_checked");
    assert.equal(result.database_connection_performed,false);
  }
  assert.equal(getRuntimeBootstrapStatus({}).source_binding.branch,null);
  assert.throws(()=>pairing.localManagerJwtIssuer({NODE_ENV:"staging",PLATFORM_JWT_ISSUER:"https://auth.mad4b.com"}),{code:"local_manager_jwt_environment_mismatch"});
});
test("production credential rejected on staging even under a shared test key",async()=>{
  const token=jwt.sign({purpose:"local_manager_device_access",scope:"local_manager.device"},secret,{issuer:"https://auth.mad4b.com",audience:"mad4b-local-manager-device"});
  process.env.NODE_ENV="staging";
  await assert.rejects(requireLocalManagerDevice({headers:{authorization:`Bearer ${token}`}}),{code:"invalid_device_token"});
});
test("dedicated writer must target this environment's runtime database",async()=>{
  const env={LOCAL_MANAGER_WRITE_AUTHORITY_ENABLED:"true",DB_HOST:"db",DB_NAME:"staging",DB_USER:"reader",LOCAL_MANAGER_WRITE_DB_HOST:"db",LOCAL_MANAGER_WRITE_DB_NAME:"staging",LOCAL_MANAGER_WRITE_DB_USER:"writer",LOCAL_MANAGER_WRITE_DB_PASSWORD:"fixture"};
  assert.equal(resolveLocalManagerWriteDbConfig(env).database,"staging");
  for(const changes of [{LOCAL_MANAGER_WRITE_DB_NAME:"production"},{LOCAL_MANAGER_WRITE_DB_HOST:"production-db"},{LOCAL_MANAGER_WRITE_DB_PORT:"3307"}]) assert.throws(()=>resolveLocalManagerWriteDbConfig({...env,...changes}),{code:"LOCAL_MANAGER_WRITE_DB_TARGET_MISMATCH"});
  await assert.rejects(assertLocalManagerWritePrivilegeReadiness({pool:{query:async()=>[[{current_account:"writer@localhost",current_database:"production"}]]},expectedDatabase:"staging"}),{code:"LOCAL_MANAGER_WRITE_DB_TARGET_MISMATCH"});
});
test("canonical lookup does not adopt an unrelated sole account connector",async()=>{
  let calls=0;
  query=async(sql,values)=>{calls++;assert.match(sql,/LIMIT 2/u);assert.match(sql,/a\.canonical_config_id = c\.config_id/u);assert.match(sql,/a\.tenant_id <=> c\.tenant_id/u);assert.deepEqual(values,["user","tenant","tenant","device","device"]);return [[]];};
  assert.equal(await pairing.resolveCanonicalConnectorConfig({userId:"user",tenantId:"tenant",deviceId:"device",hostname:"device"}),null);
  assert.equal(calls,1);
  query=async()=>[[{config_id:"one"},{config_id:"two"}]];
  await assert.rejects(pairing.resolveCanonicalConnectorConfig({userId:"user",tenantId:"tenant",deviceId:"device"}),{code:"canonical_connector_config_ambiguous"});
});
function fixture() {
  const {publicKey,privateKey}=crypto.generateKeyPairSync("ec",{namedCurve:"prime256v1"});
  const spki=publicKey.export({type:"spki",format:"der"});
  const row={session_id:"session",user_id:"user",tenant_id:"tenant",device_id:"device",hostname:"device",status:"approved",expires_at:new Date(Date.now()+600000),poll_token_hash:hash("poll"),metadata_json:JSON.stringify({device_public_key_spki:spki.toString("base64"),device_public_key_fingerprint_sha256:hash(spki),device_proof_challenge_sha256:hash("challenge")})};
  const canonical=["mad4b.local-manager.device-proof.v1","session","ABCD-EFGH",hash("poll"),"challenge"].join("\n");
  const req={body:{device_code:"ABCD-EFGH",poll_token:"poll",device_proof_challenge:"challenge",device_proof:crypto.sign("sha256",Buffer.from(canonical),privateKey).toString("base64")}};
  const res=()=>({status(value){this.code=value;return this;},json(value){this.body=value;return this;}});
  let updates=0;
  query=async(sql,values)=>{
    if(sql.includes("information_schema.COLUMNS")) return [columns];
    if(sql.includes("information_schema.STATISTICS")) return [indexes];
    if(sql.includes("local_connector_user_configs")) return [[{config_id:"config",device_id:"device"}]];
    if(sql.startsWith("UPDATE")) {updates++;Object.assign(row,{status:"completed",completed_at:new Date(),device_token_jti:values[0],device_token_issued_at:new Date()});return [{affectedRows:1}];}
    return [[{...row}]];
  };
  return {row,req,res,updates:()=>updates};
}
test("signing outage does not consume approval; retry issues once with idempotent replay",async()=>{
  const f=fixture();process.env.LOCAL_MANAGER_DEVICE_JWT_SECRET="";
  const outage=f.res();await pollDeviceLinkSession(f.req,outage);assert.equal(outage.code,503);assert.equal(f.updates(),0);
  process.env.LOCAL_MANAGER_DEVICE_JWT_SECRET=secret;
  const first=f.res(),replay=f.res();await pollDeviceLinkSession(f.req,first);await pollDeviceLinkSession(f.req,replay);
  assert.equal(first.code,200);assert.equal(replay.code,200);assert.equal(f.updates(),1);assert.equal(first.body.device_access_token,replay.body.device_access_token);
});
test("first device waits for explicit user provisioning and then completes the same approval",async()=>{
  const f=fixture(),original=query;
  query=(sql,values)=>sql.includes("local_connector_user_configs")?Promise.resolve([[]]):original(sql,values);
  const result=f.res();await pollDeviceLinkSession(f.req,result);
  assert.equal(result.code,409);assert.equal(result.body.connector_alias.device_token_repair_available,false);assert.equal(f.updates(),0);assert.equal(result.body.device_access_token,undefined);
  query=original;const recovered=f.res();await pollDeviceLinkSession(f.req,recovered);assert.equal(recovered.code,200);assert.equal(f.updates(),1);
});
test("duplicate pairing codes fail before issuance",async()=>{
  const f=fixture(),original=query;
  query=(sql,values)=>sql.includes("WHERE display_code_hash")?Promise.resolve([[f.row,f.row]]):original(sql,values);
  const result=f.res();await pollDeviceLinkSession(f.req,result);assert.equal(result.code,409);assert.equal(result.body.error.code,"local_manager_device_link_cardinality_conflict");assert.equal(f.updates(),0);
});
test("repair ignores tenant overrides and denies ambiguous configs without writes",async()=>{
  const f=fixture();Object.assign(f.row,{status:"completed",device_token_jti:"jti",device_token_issued_at:new Date(),completed_at:new Date()});
  const token=jwt.sign({user_id:"user",tenant_id:"tenant",device_id:"device",session_id:"session",purpose:"local_manager_device_access",scope:"local_manager.device"},secret,{issuer:"https://auth.mad4b.com",audience:"mad4b-local-manager-device",jwtid:"jti"});
  const router=buildLocalConnectorInstallRoutes({requireBackendApiKey:(_req,_res,next)=>next()});
  const handler=router.stack.find(layer=>layer.route?.path==="/local-connector/install/device-download-link").route.stack[0].handle;
  const original=query;
  for(const count of [0,2]) {
    query=(sql,values)=>{assert.doesNotMatch(sql,/^(UPDATE|INSERT|DELETE)/u);if(sql.includes("local_connector_user_configs")){assert.match(sql,/c\.tenant_id <=> \?/u);assert.match(sql,/a\.tenant_id <=> c\.tenant_id/u);assert.deepEqual(values,["user","tenant","device","device"]);return Promise.resolve([Array.from({length:count},(_,i)=>({config_id:`config-${i}`,tenant_id:"tenant",device_id:"device"}))]);}return original(sql,values);};
    const result=f.res();await handler({headers:{authorization:`Bearer ${token}`},body:{tenant_id:"other"},auth:{is_admin:true}},result);assert.equal(result.code,count?409:404);assert.equal(result.body.download_url,undefined);
  }
});
test("staging release never falls back to a production executable",async()=>{
  const env={NODE_ENV:"staging"};
  for(const pool of [{query:async()=>[[]]},{query:async()=>{throw new Error("offline");}},{query:async()=>[[{artifact_url:"https://github.com/example/production.exe",sha256:"a".repeat(64)}]]}]) await assert.rejects(latestLocalManagerWindowsRelease({env,pool}),{code:"local_manager_staging_release_unavailable"});
  const release=await latestLocalManagerWindowsRelease({env,pool:{query:async(_sql,params)=>{assert.deepEqual(params,["latest-staging"]);return [[{version:"0.2.31",artifact_url:"https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/releases/download/local-manager-windows-staging/setup.exe",sha256:"a".repeat(64)}]];}}});
  assert.equal(release.source,"db");assert.equal(release.registry_degraded,false);
});
test("lost commit acknowledgment remains unknown and failed begin releases the connection",async()=>{
  for(const phase of ["begin","commit"]) {
    let released=false,rolledBack=false;
    const tx={beginTransaction:async()=>{if(phase==="begin")throw new Error("fixture");},commit:async()=>{throw new Error("lost ack");},rollback:async()=>{rolledBack=true;},release:()=>{released=true;}};
    await assert.rejects(writer.withDedicatedWriteTransaction({getConnection:async()=>tx},async()=>({ok:true})),error=>{assert.equal(error.mutation_outcome,phase==="commit"?"unknown":undefined);return true;});
    assert.equal(released,true);assert.equal(rolledBack,true);
  }
});
