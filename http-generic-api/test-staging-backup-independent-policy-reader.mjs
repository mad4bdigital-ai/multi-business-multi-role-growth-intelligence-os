import assert from "node:assert/strict";
import fs from "node:fs";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {
  resolveStagingBackupPolicyReaderConfig,
  verifyBackupPolicyReaderGrants,
  openStagingBackupPolicyReader,
} from "./stagingBackupPolicyReader.mjs";

const SHA="9".repeat(40);
const base={
  NODE_ENV:"staging",DEPLOYMENT_ENVIRONMENT:"staging_local_windows_docker",
  STAGING_BACKUP_POLICY_READER_ENABLED:"true",
  STAGING_BACKUP_POLICY_READER_HOST:"runtime-db",
  STAGING_BACKUP_POLICY_READER_DATABASE:"growth_runtime",
  STAGING_BACKUP_POLICY_READER_USER:"backup_policy_reader",
  STAGING_BACKUP_POLICY_READER_PASSWORD:"test-only-secret",
  DB_HOST:"runtime-db",DB_NAME:"growth_runtime",DB_USER:"runtime_app",
  CONTROL_PLANE_WRITE_DB_USER:"control_plane_writer",DEPLOY_COMMIT:SHA,
};
function rejected(run,code){
  assert.throws(run,(e)=>e.code===code,code);
}
assert.equal(resolveStagingBackupPolicyReaderConfig(base).user,"backup_policy_reader");
for(const [patch,code] of [
  [{NODE_ENV:"production"},"BACKUP_READER_STAGING_IDENTITY_REQUIRED"],
  [{DEPLOYMENT_ENVIRONMENT:"production"},"BACKUP_READER_STAGING_IDENTITY_REQUIRED"],
  [{STAGING_BACKUP_POLICY_READER_ENABLED:"false"},"BACKUP_POLICY_READER_NOT_CONFIGURED"],
  [{STAGING_BACKUP_POLICY_READER_HOST:"auth.mad4b.com"},"BACKUP_POLICY_READER_INDEPENDENT_IDENTITY_REQUIRED"],
  [{STAGING_BACKUP_POLICY_READER_DATABASE:"other_runtime"},"BACKUP_POLICY_READER_INDEPENDENT_IDENTITY_REQUIRED"],
  [{STAGING_BACKUP_POLICY_READER_USER:"runtime_app"},"BACKUP_POLICY_READER_INDEPENDENT_IDENTITY_REQUIRED"],
  [{STAGING_BACKUP_POLICY_READER_USER:"control_plane_writer"},"BACKUP_POLICY_READER_INDEPENDENT_IDENTITY_REQUIRED"],
  [{STAGING_BACKUP_POLICY_READER_USER:"root"},"BACKUP_POLICY_READER_INDEPENDENT_IDENTITY_REQUIRED"],
  [{STAGING_BACKUP_POLICY_READER_PASSWORD:""},"BACKUP_POLICY_READER_INDEPENDENT_IDENTITY_REQUIRED"],
  [{STAGING_BACKUP_POLICY_READER_PASSWORD:"bad\nnewline"},"BACKUP_POLICY_READER_INDEPENDENT_IDENTITY_REQUIRED"],
  [{STAGING_BACKUP_POLICY_READER_PORT:"3307"},"BACKUP_POLICY_READER_INDEPENDENT_IDENTITY_REQUIRED"],
  [{DEPLOY_COMMIT:"invalid"},"BACKUP_POLICY_READER_EXACT_SOURCE_REQUIRED"],
]){
  rejected(()=>resolveStagingBackupPolicyReaderConfig({...base,...patch}),code);
}
const targetTables=["platform_backup_policies","platform_backup_approvals","platform_backup_runs","platform_copy_locations"];
const grants=[
  {"Grants for backup_policy_reader@%":"GRANT USAGE ON *.* TO `backup_policy_reader`@`%`"},
  ...targetTables.map(t=>({"Grants for backup_policy_reader@%":`GRANT SELECT ON \`growth_runtime\`.\`${t}\` TO \`backup_policy_reader\`@\`%\``}))
];
assert.equal(verifyBackupPolicyReaderGrants(grants,"growth_runtime").table_count,4);
rejected(()=>verifyBackupPolicyReaderGrants(grants.slice(0,-1),"growth_runtime"),"BACKUP_POLICY_READER_GRANTS_UNVERIFIED");
rejected(()=>verifyBackupPolicyReaderGrants([...grants,{"grant":"GRANT INSERT ON `growth_runtime`.`platform_backup_runs` TO `backup_policy_reader`@`%`"}],"growth_runtime"),"BACKUP_POLICY_READER_EXCESS_PRIVILEGES");
rejected(()=>verifyBackupPolicyReaderGrants([...grants,{"grant":"GRANT SELECT ON `growth_runtime`.* TO `backup_policy_reader`@`%`"}],"growth_runtime"),"BACKUP_POLICY_READER_EXCESS_PRIVILEGES");
rejected(()=>verifyBackupPolicyReaderGrants([...grants,{"grant":"GRANT SELECT ON `production`.`platform_backup_runs` TO `backup_policy_reader`@`%`"}],"growth_runtime"),"BACKUP_POLICY_READER_EXCESS_PRIVILEGES");

let ended=0;
const pool={
  async query(sql){
    if(sql.startsWith("SELECT DATABASE()"))return [[{database_name:"growth_runtime",principal:"backup_policy_reader@%"}]];
    if(sql==="SHOW GRANTS FOR CURRENT_USER()")return [grants];
    throw new Error("Unexpected SQL");
  },
  async end(){ended++},
};
const driver={createPool:config=>{
  assert.equal(config.connectionLimit,1);
  assert.equal(config.host,"runtime-db");
  assert.equal(config.user,"backup_policy_reader");
  return pool;
}};
assert.equal(await openStagingBackupPolicyReader({env:base,driver}),pool);
assert.equal(ended,0);
await assert.rejects(
  openStagingBackupPolicyReader({env:base,driver:{createPool:()=>({
    async query(){return [[{database_name:"production",principal:"root@%"}]]},
    async end(){ended++},
  })}}),
  e=>e.code==="BACKUP_POLICY_READER_LIVE_IDENTITY_MISMATCH"
);
assert.equal(ended,1);
const readinessPath=fileURLToPath(new URL("./scripts/staging-backup-restore-readiness.mjs",import.meta.url));
const source=fs.readFileSync(readinessPath,"utf8");
assert.doesNotMatch(source,/import\s*\{\s*getPool\s*\}/);
assert.match(source,/openStagingBackupPolicyReader/);
const denied=spawnSync(process.execPath,[readinessPath,"--expected-source-sha="+SHA],{
  encoding:"utf8",env:{...process.env,NODE_ENV:"staging",DEPLOYMENT_ENVIRONMENT:"staging_local_windows_docker",
  DEPLOY_COMMIT:SHA,STAGING_BACKUP_POLICY_READER_ENABLED:"false"}
});
assert.equal(denied.status,2);
const parsed=JSON.parse(denied.stdout);
assert(parsed.blockers.includes("BACKUP_POLICY_READER_NOT_CONFIGURED"));
assert(parsed.blockers.includes("BACKUP_POLICY_INVENTORY_UNVERIFIED"));
assert(!parsed.blockers.includes("DATABASE_BACKUP_POLICY_MISSING"));
assert.equal(parsed.policy_inventory_verified,false);
assert.equal(parsed.existing_policy_count,null);
assert.equal(parsed.qa_fixture_write_authorized,false);
assert.equal(parsed.production_promotion_authorized,false);
assert.doesNotMatch(denied.stdout,/test-only-secret|root@/i);
console.log(JSON.stringify({
  contract:"mad4b.staging-independent-backup-reader.test.v1",passed:true,
  cases:20,production_mutation:false,grants_applied:false,
  real_backup_executed:false,secrets_included:false
}));
