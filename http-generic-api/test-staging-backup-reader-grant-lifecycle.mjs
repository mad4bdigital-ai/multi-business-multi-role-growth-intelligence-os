import assert from "node:assert/strict";
import {generateKeyPairSync, sign} from "node:crypto";
import {
  STAGING_BACKUP_READER_TABLES,planStagingBackupReaderGrant,
  verifySignedReaderGrantApproval,runGovernedStagingBackupReaderCensus,
} from "./stagingBackupReaderGrantLifecycle.mjs";

const SHA="d".repeat(40);
const measured=Object.freeze({
  deployment_environment:"staging_local_windows_docker",
  local_connector_verified:true,device_id:"authorized-staging-device",
  source_sha:SHA,docker_network:"http-generic-api_default",
  docker_subnet:"172.18.0.0/16",db_host:"runtime-db",
  db_schema:"growth_runtime",production_mutation:false,
});
const keys=generateKeyPairSync("ed25519");
const runId="reader-grant-test-cycle-00001";
const plan=planStagingBackupReaderGrant({measured,expectedSha:SHA,runId});
assert.equal(plan.mode,"plan_only");
assert.deepEqual(plan.binding.tables,STAGING_BACKUP_READER_TABLES);
assert.equal(plan.binding.account_host_pattern,"172.18.%");
assert.equal(plan.binding.reader_user,"backup_policy_reader");
assert.equal(plan.production_mutation,false);
function approvalFor(p=plan,patch={}){
  const base={
    contract:"mad4b.staging.backup-reader-grant-approval.v1",
    operation:"provision_census_revoke",owner_gate:"OWNER_ATTEST_SINGLE_OWNER",
    plan_sha256:p.plan_sha256,source_sha:p.binding.source_sha,
    device_id:p.binding.device_id,run_id:p.binding.run_id,
    issued_at_ms:Date.now()-1_000,expires_at_ms:Date.now()+120_000,...patch,
  };
  return {...base,signature_b64:sign(null,Buffer.from(JSON.stringify(base)),
    keys.privateKey).toString("base64")};
}
const approval=approvalFor();
assert.equal(verifySignedReaderGrantApproval({
  plan,approval,trustedOwnerPublicKey:keys.publicKey,
}),true);
function rejects(fn,code){assert.throws(fn,e=>e?.code===code,code)}
rejects(()=>planStagingBackupReaderGrant({
  measured:{...measured,deployment_environment:"production"},
  expectedSha:SHA,runId}),"READER_GRANT_MEASURED_STAGING_REQUIRED");
for(const patch of [
  {db_host:"production-db"},{db_schema:"other_runtime"},
  {docker_subnet:"10.0.0.0/8"},{docker_network:"production_default"},
  {local_connector_verified:false},{production_mutation:true},
  {source_sha:"e".repeat(40)},{device_id:undefined},
]){
  rejects(()=>planStagingBackupReaderGrant({
    measured:{...measured,...patch},expectedSha:SHA,runId,
  }),"READER_GRANT_MEASURED_STAGING_REQUIRED");
}
rejects(()=>verifySignedReaderGrantApproval({
  plan,approval:{...approval,expires_at_ms:Date.now()-1},
  trustedOwnerPublicKey:keys.publicKey,
}),"READER_GRANT_OWNER_APPROVAL_REQUIRED");
rejects(()=>verifySignedReaderGrantApproval({
  plan,approval:{...approval,plan_sha256:"0".repeat(64)},
  trustedOwnerPublicKey:keys.publicKey,
}),"READER_GRANT_OWNER_APPROVAL_REQUIRED");
rejects(()=>verifySignedReaderGrantApproval({
  plan,approval:{...approval,signature_b64:"abcd"},
  trustedOwnerPublicKey:keys.publicKey,
}),"READER_GRANT_OWNER_SIGNATURE_INVALID");
rejects(()=>verifySignedReaderGrantApproval({
  plan,approval:approvalFor(plan,{expires_at_ms:Date.now()+900_000}),
  trustedOwnerPublicKey:keys.publicKey,
}),"READER_GRANT_OWNER_APPROVAL_REQUIRED");

const grants=[
  {g:"GRANT USAGE ON *.* TO `backup_policy_reader`@`172.18.%`"},
  ...STAGING_BACKUP_READER_TABLES.map(table=>({
    g:`GRANT SELECT ON \`growth_runtime\`.\`${table}\` TO \`backup_policy_reader\`@\`172.18.%\``,
  })),
];
function sandbox(opts={}){
  const state={created:false,revoked:false,reserved:new Set(),events:[],
    create_calls:0,census_calls:0};
  const admin={
    async inspect(){return {
      database:"growth_runtime",
      tables:opts.missingTable?STAGING_BACKUP_READER_TABLES.slice(0,-1):
        STAGING_BACKUP_READER_TABLES,
      reader_absent:opts.existingPrincipal!==true,
    }},
    async provisionTemporaryReader(){
      state.created=true;state.create_calls++;
      if(opts.createThrows)throw Object.assign(new Error("synthetic"),{code:"SYNTHETIC_CREATE_ERROR"});
      return Object.freeze({lease:"synthetic-opaque",no_password_in_result:true});
    },
    async readReaderGrants(){if(opts.wrongPrincipal)return grants.map(r=>({g:r.g.replaceAll("backup_policy_reader","unrelated_reader")}));return opts.extraPrivilege?
      [...grants,{g:"GRANT INSERT ON `growth_runtime`.* TO `backup_policy_reader`@'172.18.%'"}]:
      grants},
    async revokeTemporaryReader(){
      if(opts.cleanupThrows)throw new Error("synthetic cleanup failure");
      state.revoked=true;state.created=false;
    },
    async readerAbsent(){return !state.created},
  };
  const reader={async census(){
    state.census_calls++;
    if(opts.censusThrows)throw new Error("synthetic reader failure");
    if(opts.badCensus)return {policy_inventory_verified:false};
    return {policy_inventory_verified:true,existing_policy_count:opts.policyCount??0};
  }};
  const ledger={async consumeOnce(id){
    if(state.reserved.has(id))return false;
    state.reserved.add(id);return true;
  }};
  const audit={async append(event){state.events.push(event);if(opts.auditThrows &&
    event.event==="reader_grant_completed")throw new Error("audit failed")}};
  return {state,admin,reader,ledger,audit,measuredIdentity:async()=>measured};
}
async function execute(s,overrides={}){
  return runGovernedStagingBackupReaderCensus({
    ...s,expectedSha:SHA,runId,approval,trustedOwnerPublicKey:keys.publicKey,
    ...overrides,
  });
}
const pass=sandbox();
const ok=await execute(pass);
assert.equal(ok.ok,true);
assert.equal(ok.policy_inventory_verified,true);
assert.equal(ok.existing_policy_count,0);
assert.equal(ok.reader_revoked,true);
assert.equal(ok.backup_executed,false);
assert.equal(ok.qa_fixture_write_authorized,false);
assert.equal(ok.production_mutation,false);
assert.equal(pass.state.events.length,2);
assert.equal(pass.state.created,false);
assert.equal(pass.state.revoked,true);
assert.equal(pass.state.census_calls,1);
assert(!JSON.stringify(ok).includes("synthetic-opaque"));
await assert.rejects(execute(pass),e=>e.code==="READER_GRANT_REPLAY_BLOCKED");
assert.equal(pass.state.create_calls,1);
for(const [name,options,code,created] of [
  ["existing-principal",{existingPrincipal:true},"READER_GRANT_ADMIN_PREFLIGHT_BLOCKED",false],
  ["missing-table",{missingTable:true},"READER_GRANT_ADMIN_PREFLIGHT_BLOCKED",false],
  ["excess-rights",{extraPrivilege:true},"BACKUP_POLICY_READER_EXCESS_PRIVILEGES",true],
  ["wrong-account",{wrongPrincipal:true},"READER_GRANT_PRINCIPAL_IDENTITY_MISMATCH",true],
  ["failed-create",{createThrows:true},"SYNTHETIC_CREATE_ERROR",true],
  ["failed-census",{censusThrows:true},"READER_GRANT_EXECUTION_FAILED",true],
  ["unverified-census",{badCensus:true},"READER_POLICY_CENSUS_UNVERIFIED",true],
]){
  const s=sandbox(options);
  const result=await execute(s);
  assert.equal(result.ok,false,name);
  assert.equal(result.blocker,code,name);
  assert.equal(result.reader_revoked,true,name);
  assert.equal(s.state.created,false,name);
  assert.equal(s.state.create_calls,created?1:0,name);
}
const badCleanup=sandbox({cleanupThrows:true});
const badResult=await execute(badCleanup);
assert.equal(badResult.ok,false);
assert.equal(badResult.reader_revoked,false);
assert.equal(badResult.blocker,"READER_GRANT_CLEANUP_UNVERIFIED");
assert.equal(badResult.policy_inventory_verified,false);
const badAudit=sandbox({auditThrows:true});
const failAudit=await execute(badAudit);
assert.equal(failAudit.ok,false);
assert.equal(failAudit.blocker,"READER_GRANT_AUDIT_UNVERIFIED");
assert.equal(failAudit.reader_revoked,true);
const noAdapter=sandbox();
await assert.rejects(execute({...noAdapter,admin:null}),
  e=>e.code==="TRUSTED_STAGING_DB_ADMIN_CONNECTOR_REQUIRED");
assert.equal(noAdapter.state.create_calls,0);
console.log(JSON.stringify({
  contract:"mad4b.staging-backup-reader-grant-lifecycle.test.v1",
  passed:true,synthetic_only:true,
  cases:24,invalid_authority_rejected:true,atomic_replay_guard:true,
  creator_failures_revoke:true,cleanup_fail_closed:true,
  credential_values_logged:false,database_mutation:false,
  production_mutation:false,
}));
