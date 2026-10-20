// No fabricated service/caller JSON can become DBA operational authority.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {assessStagingBrokerTrustReadiness as assess}
  from "./staging-backup-db-broker-trust-readiness.mjs";
const sha="7e70a6b62b189b3962596f3b8cec4a4dfb5f38eb";
const base={
 expected_sha:sha,app_source_sha:sha,device_id:"DESKTOP-91FDEFP",
 topology_observed:true,broker_candidate_found:false,
 broker_candidate_running:false,
 windows_service_present:false,windows_service_running:false,
 windows_service_pid:0,windows_service_account:"",process_image_sha256:""
};
const r=assess(base);
assert.equal(r.observed_exact_staging_release,true);
assert.equal(r.broker_candidate_found,false);
assert.equal(r.broker_candidate_running,false);
assert.equal(r.candidate_is_operational_broker,false);
assert.equal(r.dedicated_service_observed,false);
assert(r.blockers.includes("BROKER_DEDICATED_WINDOWS_SERVICE_NOT_FOUND"));
assert.equal(r.broker_operationally_certified,false);
assert.equal(r.db_admin_operation_authorized,false);
const full={...base,windows_service_present:true,windows_service_running:true,
 windows_service_pid:1450,windows_service_account:"STAGING\\svc_backup_broker",
 broker_candidate_found:true,broker_candidate_running:true,
 process_image_sha256:"f".repeat(64),
 // Even forged caller-side flags must never be trusted.
 isolated_staging_process_attested:true,owner_operation_approved:true,
 db_admin_operation_authorized:true,immutable_audit_proven:true,
 signed_operation_approved:true};
const spoof=assess(full);
assert.equal(spoof.broker_candidate_found,true);
assert.equal(spoof.broker_candidate_running,true);
assert.equal(spoof.candidate_is_operational_broker,false);
assert.equal(spoof.dedicated_service_running,true);
const stopped=assess({...full,windows_service_running:false,
  windows_service_pid:0,broker_candidate_running:false});
assert.equal(stopped.broker_candidate_found,true);
assert.equal(stopped.broker_candidate_running,false);
assert(stopped.blockers.includes("BROKER_INERT_CANDIDATE_NOT_OPERATIONAL_SERVICE"));
assert(stopped.blockers.includes("BROKER_DEDICATED_WINDOWS_SERVICE_NOT_RUNNING"));
assert.equal(stopped.broker_operationally_certified,false);
assert.equal(stopped.db_admin_operation_authorized,false);
assert.equal(spoof.process_image_digest_observed,true);
assert.equal(spoof.process_image_measurement_needs_privileged_readonly_probe,false);
assert.equal(spoof.process_image_measurement_status,"unreported_or_invalid");
for(const status of ["process_path_not_disclosed","os_access_denied",
  "process_metadata_unavailable","measurement_failed"]){
  const diagnosed=assess({...full,process_image_sha256:"",
    process_image_measurement_status:status});
  assert.equal(diagnosed.process_image_digest_observed,false);
  assert.equal(diagnosed.process_image_measurement_status,status);
  assert.equal(diagnosed.process_image_measurement_needs_privileged_readonly_probe,true);
  assert(diagnosed.blockers.includes("BROKER_PROCESS_IMAGE_DIGEST_NOT_MEASURED"));
  assert.equal(diagnosed.broker_operationally_certified,false);
  assert.equal(diagnosed.db_admin_operation_authorized,false);
}
const forgedMeasurementStatus=assess({...full,
  process_image_sha256:"",process_image_measurement_status:"externally_attested",
  independently_signed:true});
assert.equal(forgedMeasurementStatus.process_image_measurement_status,"unreported_or_invalid");
assert.equal(forgedMeasurementStatus.broker_operationally_certified,false);
assert(forgedMeasurementStatus.blockers.includes("BROKER_PROCESS_IMAGE_DIGEST_NOT_MEASURED"));
assert.equal(spoof.service_identity_independently_attested,false);
for(const k of ["broker_operationally_certified","owner_operation_approved",
 "db_admin_operation_authorized","reader_provisioned","backup_executed",
 "restore_executed","production_mutation","secrets_included"])
 assert.equal(spoof[k],false,k);
assert(spoof.blockers.includes("BROKER_ONE_SHOT_SIGNED_OPERATION_APPROVAL_REQUIRED"));
assert(spoof.blockers.includes("BROKER_OWNER_ED25519_PUBLIC_KEY_PIN_REQUIRED"));
assert(spoof.blockers.includes("BROKER_EXTERNAL_IMMUTABLE_AUDIT_REQUIRED"));
for(const patch of [
 {app_source_sha:"a".repeat(40)},
 {device_id:"mohammedlap"},
 {topology_observed:false},
 {windows_service_account:"LocalSystem"},
 {windows_service_running:false},
 {process_image_sha256:"wrong"},
 {broker_candidate_running:true},
]){
 const x=assess({...full,...patch});
 assert.equal(x.broker_operationally_certified,false);
 assert.equal(x.db_admin_operation_authorized,false);
 if(patch.app_source_sha)assert(x.blockers.includes("BROKER_STAGING_EXACT_RUNTIME_SHA_REQUIRED"));
 if(patch.broker_candidate_running)assert(x.blockers.includes("BROKER_INERT_CANDIDATE_NOT_OPERATIONAL_SERVICE"));
 if(patch.windows_service_account)assert(x.blockers.includes("BROKER_DEDICATED_OS_ACCOUNT_UNVERIFIED"));
}
const target=fileURLToPath(new URL("./staging-backup-db-broker-trust-readiness.mjs",import.meta.url));
const cli=spawnSync(process.execPath,[target],{input:JSON.stringify(full),encoding:"utf8"});
assert.equal(cli.status,2);
assert.equal(JSON.parse(cli.stdout).broker_operationally_certified,false);
const bad=spawnSync(process.execPath,[target],{input:"not-json",encoding:"utf8"});
assert.equal(bad.status,2);
assert(JSON.parse(bad.stdout).blockers.includes("BROKER_DISCOVERY_INPUT_INVALID"));
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const script=fs.readFileSync(path.join(root,"autopilot-portable-staging",
 "Inspect-StagingBackupBrokerTrustReadiness.ps1"),"utf8");
for(const str of ["-ExpectedCommit","Get-CimInstance Win32_Service",
 "Get-FileHash","HOST_DISCOVERY_CONTRACT_UNVERIFIED",
 "BROKER_TRUST_DISCOVERY_MUST_FAIL_CLOSED",
 "process_image_measurement_status",
 "process_path_not_disclosed",
 "os_access_denied",
 "broker_candidate_found=($base.broker_candidate_found -eq $true)",
 "broker_candidate_running=($base.broker_candidate_running -eq $true)",
 "Never substitute an SCM ImagePath/build artifact"])
 assert(script.includes(str),str);
for(const forbidden of [/(?:CREATE\s+USER|GRANT\s+SELECT|DROP\s+USER)/i,
 /\bdocker\s+(?:run|create|start|network\s+connect)\b/i,
 /\bGet-Content\s+.*(?:credential|private.key|\.env)/i])
 assert(!forbidden.test(script),"read-only source may not perform DBA or Docker writes");
console.log(JSON.stringify({
 contract:"mad4b.staging.backup-broker.trust-readiness.test.v1",
 passed:true,synthetic_only:true,spoofed_authority_denied:true,
 fail_closed:true,read_only_host_inspection:true,
 actual_dba_installation:false,production_mutation:false
}));
