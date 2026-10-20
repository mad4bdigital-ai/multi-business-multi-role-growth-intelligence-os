// Synthetic, source-only Host Discovery -> Trust Readiness handoff regression.
// This test intentionally cannot sign, provision a reader, run SQL, or certify
// a live Broker. Its CLI instances must both exit 2 (read-only discovery).
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {assessStagingBackupBrokerHostDiscovery as discover} from
  "./staging-backup-db-broker-host-discovery.mjs";
import {assessStagingBrokerTrustReadiness as trust} from
  "./staging-backup-db-broker-trust-readiness.mjs";

const sha="7ade100bd65f4d8bed98fa16fed16f0a501ae5bb";
const base={
  expected_sha:sha,app_source_sha:sha,device_id:"DESKTOP-91FDEFP",
  network:"http-generic-api_default",subnet:"172.18.0.0/16",
  runtime_db_network:"http-generic-api_default",
  app_network:"http-generic-api_default",
  runtime_db_host_port_exposed:false,
  containers:{"app":true,"redis":true,"governance-db":true,
    "persistence-db":true,"runtime-db":true},
};
const cases=[
 {name:"no candidate",patch:{},found:false,running:false},
 {name:"stopped inert Windows host",
  patch:{windows_service_present:true,windows_service_running:false,
    windows_service_account:"NT SERVICE\\Mad4B-Staging-Backup-Db-Broker"},
  found:true,running:false},
 {name:"running inert Windows host",
  patch:{windows_service_present:true,windows_service_running:true,
    windows_service_account:"NT SERVICE\\Mad4B-Staging-Backup-Db-Broker"},
  found:true,running:true},
 {name:"stopped inert Docker sidecar",
  patch:{docker_sidecar_present:true,docker_sidecar_running:false},
  found:true,running:false},
 {name:"running inert Docker sidecar",
  patch:{docker_sidecar_present:true,docker_sidecar_running:true,
    docker_sidecar_sandbox_verified:true},
  found:true,running:true},
];
function cli(file,e,expectedContract){
  const proc=spawnSync(process.execPath,[fileURLToPath(new URL(file,import.meta.url))],{
    input:JSON.stringify(e),encoding:"utf8",timeout:5000,
  });
  assert.equal(proc.status,2,`${file} must fail closed`);
  const report=JSON.parse(proc.stdout);
  assert.equal(report.contract,expectedContract);
  assert.equal(report.broker_operationally_certified,false);
  assert.equal(report.db_admin_operation_authorized,false);
  assert.equal(report.production_mutation,false);
  return report;
}
for(const c of cases){
  const e={...base,...c.patch};
  const host=discover(e);
  assert.equal(host.topology_observed,true,c.name);
  assert.equal(host.broker_candidate_found,c.found,c.name);
  assert.equal(host.broker_candidate_running,c.running,c.name);
  assert.equal(host.broker_operationally_certified,false,c.name);
  const next={
    expected_sha:sha,
    app_source_sha:host.topology_observed?sha:"",
    device_id:e.device_id,
    topology_observed:host.topology_observed,
    broker_candidate_found:host.broker_candidate_found,
    broker_candidate_running:host.broker_candidate_running,
    windows_service_present:e.windows_service_present===true,
    windows_service_running:e.windows_service_running===true,
    windows_service_pid:e.windows_service_running===true?1450:0,
    windows_service_account:e.windows_service_account||"",
    process_image_sha256:e.windows_service_running===true?"a".repeat(64):"",
    process_image_measurement_status:e.windows_service_running===true
      ?"measured_from_process_path":"service_not_running",
    // Attempts to invent operational certification must always be ignored.
    independently_signed:true,owner_operation_approved:true,
    db_admin_operation_authorized:true,operational_broker_certified:true,
    backup_executed:true,restore_executed:true,
  };
  const t=trust(next);
  assert.equal(t.host_topology_observed,true,c.name);
  assert.equal(t.broker_candidate_found,c.found,c.name);
  assert.equal(t.broker_candidate_running,c.running,c.name);
  assert.equal(t.candidate_is_operational_broker,false,c.name);
  assert.equal(t.broker_operationally_certified,false,c.name);
  assert.equal(t.db_admin_operation_authorized,false,c.name);
  assert.equal(t.owner_operation_approved,false,c.name);
  assert.equal(t.reader_provisioned,false,c.name);
  assert.equal(t.backup_executed,false,c.name);
  assert.equal(t.restore_executed,false,c.name);
  assert.equal(t.production_mutation,false,c.name);
  assert.equal(t.secrets_included,false,c.name);
  if(c.found){
    assert(t.blockers.includes("BROKER_INERT_CANDIDATE_NOT_OPERATIONAL_SERVICE"),c.name);
  }else{
    assert(t.blockers.includes("BROKER_DEDICATED_WINDOWS_SERVICE_NOT_FOUND"),c.name);
  }
  for(const required of [
    "BROKER_OWNER_ED25519_PUBLIC_KEY_PIN_REQUIRED",
    "BROKER_EXTERNAL_IMMUTABLE_AUDIT_REQUIRED",
    "BROKER_ONE_SHOT_SIGNED_OPERATION_APPROVAL_REQUIRED",
    "BROKER_BACKUP_POLICY_READER_PROVISIONING_NOT_AUTHORIZED",
  ])assert(t.blockers.includes(required),`${c.name} ${required}`);
  const hosted=cli("./staging-backup-db-broker-host-discovery.mjs",e,
    "mad4b.staging.backup-db-broker-host-discovery.v1");
  assert.equal(hosted.broker_candidate_running,c.running,c.name);
  const trusted=cli("./staging-backup-db-broker-trust-readiness.mjs",next,
    "mad4b.staging.backup-broker.trust-readiness.v1");
  assert.equal(trusted.broker_candidate_running,c.running,c.name);
}
console.log(JSON.stringify({
  contract:"mad4b.staging.backup-broker.candidate-handoff.test.v1",
  scenarios:cases.length,passed:true,synthetic_only:true,
  service_start_performed:false,docker_mutation:false,
  sql_or_grants_performed:false,backup_or_restore_performed:false,
  broker_operationally_certified:false,production_mutation:false,
}));
