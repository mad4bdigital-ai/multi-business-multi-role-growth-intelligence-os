import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assessStagingBackupAuthority } from "./stagingBackupRestoreAuthority.js";
const source="a".repeat(40), hash="b".repeat(64);
const approved={
  environment:"staging_local_docker",
  expected_source_sha:source,
  policy_inventory_verified:true,policy_count:1,approved_backup_count:1,verified_restore_count:1,
  policy:{backup_kind:"database",status:"active",activation_gate_status:"active",allowed_executor:"local_connector",source_status:"active",destination_status:"active",artifact_format:"sql_dump",checksum_algorithm:"sha256",encryption_scheme:"platform_managed",approved_count:1,approval_required:true,restore_test_required:true},
  backup:{status:"succeeded",encryption_scheme:"aes-256-gcm",checksum_algorithm:"sha256",artifact_sha256:hash,checksum_verified:true,secret_bearing_urls_included:false,source_sha:source},
  restore:{ok:true,mode:"isolated_db_restore_mariadb",ports_published:false,network_isolated:true,production_touched:false,full_import_attempted:true,cleanup:{container_removed:true,plaintext_sql_removed:true},source_sha:source,artifact_sha256:hash},
};
const absent=assessStagingBackupAuthority({environment:"staging",expected_source_sha:source,policy_inventory_verified:true,policy_count:0});
assert(absent.blockers.includes("DATABASE_BACKUP_POLICY_MISSING"));
assert(absent.blockers.includes("FRESH_ENCRYPTED_BACKUP_NOT_VERIFIED"));
assert(absent.blockers.includes("ISOLATED_RESTORE_NOT_ATTESTED"));
assert.equal(absent.qa_fixture_write_authorized,false);
assert.equal(absent.production_promotion_authorized,false);
assert.equal(absent.policy_inventory_verified,true);
assert.equal(absent.existing_policy_count,0);
const unknown=assessStagingBackupAuthority({environment:"staging",expected_source_sha:source});
assert(unknown.blockers.includes("BACKUP_POLICY_INVENTORY_UNVERIFIED"));
assert(!unknown.blockers.includes("DATABASE_BACKUP_POLICY_MISSING"));
assert.equal(unknown.existing_policy_count,null);
assert.equal(unknown.policy_inventory_verified,false);
assert.equal(unknown.backup_restore_prerequisites_satisfied,false);
const forgedEvidence=assessStagingBackupAuthority({...approved,policy_inventory_verified:false});
assert(forgedEvidence.blockers.includes("BACKUP_POLICY_INVENTORY_UNVERIFIED"));
assert.equal(forgedEvidence.backup_restore_prerequisites_satisfied,false);
const good=assessStagingBackupAuthority(approved);
assert.equal(good.backup_restore_prerequisites_satisfied,true);
assert.deepEqual(good.blockers,[]);
assert.equal(good.qa_fixture_write_authorized,false);
assert.equal(good.production_promotion_authorized,false);
const check=(patch,reason)=>{
 const v=assessStagingBackupAuthority({...approved,...patch});
 assert(v.blockers.includes(reason),reason);
 assert.equal(v.production_promotion_authorized,false);
};
check({environment:"production_hostinger"},"STAGING_RUNTIME_NOT_ATTESTED");
check({expected_source_sha:"not-a-sha"},"EXACT_SOURCE_SHA_NOT_ATTESTED");
check({policy:{...approved.policy,allowed_executor:"manual"}},"LOCAL_CONNECTOR_EXECUTOR_REQUIRED");
check({policy:{...approved.policy,approved_count:0}},"POLICY_OWNER_APPROVAL_MISSING");
check({backup:{...approved.backup,artifact_sha256:"e".repeat(64)}},"RESTORE_ARTIFACT_SOURCE_IDENTITY_MISMATCH");
check({backup:{...approved.backup,source_sha:"f".repeat(40)}},"BACKUP_SOURCE_SHA_MISMATCH");
check({backup:{...approved.backup,secret_bearing_urls_included:true}},"ENCRYPTED_BACKUP_INTEGRITY_UNVERIFIED");
check({restore:{...approved.restore,network_isolated:false}},"RESTORE_ISOLATION_OR_CLEANUP_UNVERIFIED");
check({restore:{...approved.restore,cleanup:{container_removed:false,plaintext_sql_removed:true}}},"RESTORE_ISOLATION_OR_CLEANUP_UNVERIFIED");
check({restore:{...approved.restore,artifact_sha256:"c".repeat(64)}},"RESTORE_ARTIFACT_SOURCE_IDENTITY_MISMATCH");
assert.doesNotMatch(JSON.stringify(good),/recovery.key|password|refresh_token|bearer/i);
const nonStaging=spawnSync(process.execPath,[
  fileURLToPath(new URL("./scripts/staging-backup-restore-readiness.mjs",import.meta.url)),
  "--expected-source-sha="+source,
],{encoding:"utf8",env:{...process.env,DEPLOYMENT_ENVIRONMENT:"production"}});
assert.equal(nonStaging.status,2);
const denied=JSON.parse(nonStaging.stdout);
assert.equal(denied.qa_fixture_write_authorized,false);
assert.equal(denied.production_promotion_authorized,false);
assert(denied.blockers.includes("NO_DATABASE_ACCESS_NON_STAGING"));
const policy=JSON.parse(readFileSync(new URL("./config/deployment-branch-policy.json",import.meta.url),"utf8"));
const classified=policy.environment_impact.path_classes.find(x=>x.id==="shared_runtime");
assert(classified,"Shared runtime class missing");
for(const path of ["http-generic-api/scripts/dr-certifiers/db-isolated-restore-certifier.mjs",
  "http-generic-api/scripts/dr-certifiers/isolatedRestoreSafety.mjs"]){
 assert(classified.patterns.includes(path),"Isolated restore source must be explicitly classified");
}
console.log(JSON.stringify({contract:"mad4b.staging.backup-restore-preflight.test.v1",pass:true,cases:13,fixture_write_authorized:false,production_mutation:false}));
