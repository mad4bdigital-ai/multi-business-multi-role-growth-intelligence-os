// No host, network, or synthetic evidence can mint an operational certificate.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {assessStagingBackupBrokerHostDiscovery as assess} from "./staging-backup-db-broker-host-discovery.mjs";

const SHA="4e13688c12b7406e3b65d231bc125e0d3b91ce9c";
const base={
  expected_sha:SHA,app_source_sha:SHA,device_id:"DESKTOP-91FDEFP",
  network:"http-generic-api_default",subnet:"172.18.0.0/16",
  app_network:"http-generic-api_default",
  runtime_db_network:"http-generic-api_default",
  runtime_db_host_port_exposed:false,
  containers:{"app":true,"redis":true,"governance-db":true,
    "persistence-db":true,"runtime-db":true},
  windows_service_present:false,docker_sidecar_present:false,
};
const x=assess(base);
assert.equal(x.topology_observed,true);
assert.equal(x.broker_candidate_found,false);
assert.equal(x.broker_candidate_running,false);
assert.equal(x.broker_operationally_certified,false);
assert.equal(x.db_admin_operation_authorized,false);
assert.equal(x.owner_operation_approved,false);
assert.equal(x.production_mutation,false);
assert.equal(x.secrets_included,false);
assert(x.blockers.includes("INDEPENDENT_BROKER_PROCESS_NOT_DISCOVERED"));
for(const change of [
  {app_source_sha:"c6d9ce770f2784abfed0a947e90e5c788b3f3d41"},
  {device_id:"untrusted-device"},
  {subnet:"10.0.0.0/24"},
  {runtime_db_host_port_exposed:true},
  {containers:{...base.containers,"runtime-db":false}},
]){
  const r=assess({...base,...change});
  assert.equal(r.topology_observed,false);
  assert.equal(r.broker_operationally_certified,false);
}
const stoppedService=assess({...base,windows_service_present:true,
  windows_service_running:false,windows_service_account:"STAGING\\svc_backup_broker"});
assert.equal(stoppedService.broker_candidate_found,true);
assert.equal(stoppedService.broker_candidate_running,false);
assert(stoppedService.blockers.includes("WINDOWS_BROKER_SERVICE_NOT_RUNNING"));
assert.equal(stoppedService.broker_operationally_certified,false);
const runningService=assess({...base,windows_service_present:true,
  windows_service_running:true,windows_service_account:"STAGING\\svc_backup_broker"});
assert.equal(runningService.broker_candidate_found,true);
assert.equal(runningService.broker_candidate_running,true);
assert.equal(runningService.broker_operationally_certified,false);
const service=assess({...base,windows_service_present:true,windows_service_running:true,
  windows_service_account:"LocalSystem"});
assert(service.blockers.includes("WINDOWS_BROKER_DEDICATED_OS_ACCOUNT_UNVERIFIED"));
assert.equal(service.broker_operationally_certified,false);
const candidate=assess({...base,docker_sidecar_present:true,docker_sidecar_running:true});
assert.equal(candidate.broker_candidate_found,true);
assert.equal(candidate.broker_candidate_running,true);
assert(candidate.blockers.includes("BROKER_CANDIDATE_SANDBOX_UNVERIFIED"));
const isolated=assess({...base,docker_sidecar_present:true,
  docker_sidecar_running:true,docker_sidecar_sandbox_verified:true});
assert.equal(isolated.broker_candidate_found,true);
assert.equal(isolated.broker_candidate_running,true);
assert(!isolated.blockers.includes("BROKER_CANDIDATE_SANDBOX_UNVERIFIED"));
assert.equal(isolated.broker_operationally_certified,false);
assert.equal(isolated.owner_operation_approved,false);
assert(isolated.blockers.includes("BROKER_ONE_SHOT_SIGNED_OPERATION_APPROVAL_REQUIRED"));
assert(candidate.blockers.includes("BROKER_ACTUAL_DB_ENDPOINT_ATTESTATION_REQUIRED"));
assert.equal(candidate.db_admin_operation_authorized,false);
const cli=spawnSync(process.execPath,[fileURLToPath(new URL(
  "./staging-backup-db-broker-host-discovery.mjs",import.meta.url))],{
  input:JSON.stringify(base),encoding:"utf8"});
assert.equal(cli.status,2);
assert.equal(JSON.parse(cli.stdout).broker_operationally_certified,false);
const bad=spawnSync(process.execPath,[fileURLToPath(new URL(
  "./staging-backup-db-broker-host-discovery.mjs",import.meta.url))],{
  input:"not JSON",encoding:"utf8"});
assert.equal(bad.status,2);
assert(JSON.parse(bad.stdout).blockers.includes("STAGING_HOST_DISCOVERY_INPUT_INVALID"));
console.log(JSON.stringify({contract:"mad4b.staging.backup-db-broker-host-discovery.test.v1",
 passed:true,synthetic_only:true,no_admin_sql:true,
 real_db_mutation:false,production_mutation:false}));
