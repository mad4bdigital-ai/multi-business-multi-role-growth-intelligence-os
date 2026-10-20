// Discovery-only assessment of the Staging DB broker host. Inputs are
// observations, never trust roots: this function cannot authorize DBA/backup.
import {pathToFileURL} from "node:url";

const SHA=/^[a-f0-9]{40}$/i;
const EXPECTED_NETWORK="http-generic-api_default";
const EXPECTED_SUBNET="172.18.0.0/16";
const REQUIRED=["app","redis","governance-db","persistence-db","runtime-db"];
export function assessStagingBackupBrokerHostDiscovery(e={}){
  const blockers=new Set();
  const exactSha=typeof e.expected_sha==="string"&&SHA.test(e.expected_sha)&&
    e.app_source_sha===e.expected_sha;
  if(!exactSha)blockers.add("STAGING_EXACT_RUNTIME_SHA_UNVERIFIED");
  if(e.device_id!=="DESKTOP-91FDEFP")
    blockers.add("STAGING_DEVICE_IDENTITY_UNVERIFIED");
  if(e.network!==EXPECTED_NETWORK||e.subnet!==EXPECTED_SUBNET||
    e.runtime_db_network!==EXPECTED_NETWORK||e.app_network!==EXPECTED_NETWORK)
    blockers.add("STAGING_DOCKER_NETWORK_UNVERIFIED");
  if(!e.containers||REQUIRED.some(k=>e.containers[k]!==true))
    blockers.add("STAGING_CONTAINER_HEALTH_UNVERIFIED");
  if(e.runtime_db_host_port_exposed!==false)
    blockers.add("STAGING_DB_PORT_ISOLATION_UNVERIFIED");
  const found=e.windows_service_present===true||e.docker_sidecar_present===true;
  if(!found)blockers.add("INDEPENDENT_BROKER_PROCESS_NOT_DISCOVERED");
  else blockers.add("INDEPENDENT_BROKER_PROCESS_ATTESTATION_REQUIRED");
  if(e.windows_service_present===true){
    if(e.windows_service_running!==true)
      blockers.add("WINDOWS_BROKER_SERVICE_NOT_RUNNING");
    if(!e.windows_service_account||/^(localsystem|localservice|networkservice)$/i.test(e.windows_service_account))
      blockers.add("WINDOWS_BROKER_DEDICATED_OS_ACCOUNT_UNVERIFIED");
  }
  if(e.docker_sidecar_present===true){
    if(e.docker_sidecar_running!==true)
      blockers.add("CONTAINER_BROKER_NOT_RUNNING");
    if(e.docker_sidecar_sandbox_verified!==true)
      blockers.add("BROKER_CANDIDATE_SANDBOX_UNVERIFIED");
  }
  // These cannot be cleared by discovery: require external, independent evidence.
  for(const code of [
    "BROKER_OS_ISOLATION_AND_ACL_ATTESTATION_REQUIRED",
    "BROKER_ACTUAL_DB_ENDPOINT_ATTESTATION_REQUIRED",
    "BROKER_DBA_PRINCIPAL_AND_SECRET_CUSTODY_REQUIRED",
    "BROKER_INDEPENDENT_OWNER_TRUST_KEY_REQUIRED",
    "BROKER_IMMUTABLE_AUDIT_EVIDENCE_REQUIRED",
    "BROKER_ONE_SHOT_SIGNED_OPERATION_APPROVAL_REQUIRED",
  ])blockers.add(code);
  return Object.freeze({
    contract:"mad4b.staging.backup-db-broker-host-discovery.v1",
    mode:"read_only_discovery",
    expected_sha:SHA.test(String(e.expected_sha||""))?e.expected_sha:null,
    device_id:e.device_id==="DESKTOP-91FDEFP"?e.device_id:null,
    topology_observed:exactSha&&e.device_id==="DESKTOP-91FDEFP"&&
      e.network===EXPECTED_NETWORK&&e.subnet===EXPECTED_SUBNET&&
      e.runtime_db_network===EXPECTED_NETWORK&&e.app_network===EXPECTED_NETWORK&&
      REQUIRED.every(k=>e.containers?.[k]===true)&&
      e.runtime_db_host_port_exposed===false,
    broker_candidate_found:found,
    broker_operationally_certified:false,
    owner_operation_approved:false,
    db_admin_operation_authorized:false,
    backup_executed:false,
    production_mutation:false,
    secrets_included:false,
    blockers:[...blockers].sort(),
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    let input="";
    for await(const chunk of process.stdin)input+=chunk;
    const report=assessStagingBackupBrokerHostDiscovery(JSON.parse(input));
    process.stdout.write(JSON.stringify(report)+"\n");
    process.exitCode=2; // discovery is never a broker installation certificate
  }catch{
    process.stdout.write(JSON.stringify({
      contract:"mad4b.staging.backup-db-broker-host-discovery.v1",
      mode:"read_only_discovery",broker_operationally_certified:false,
      db_admin_operation_authorized:false,production_mutation:false,
      blockers:["STAGING_HOST_DISCOVERY_INPUT_INVALID"]
    })+"\n");
    process.exitCode=2;
  }
}
