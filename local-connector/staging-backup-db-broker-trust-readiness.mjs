// Staging Broker trust-boundary discovery only. Caller observations are not
// credentials, installation evidence, or an independently trusted authority.
import {pathToFileURL} from "node:url";
const SHA40=/^[0-9a-f]{40}$/i;
const SHA256=/^[0-9a-f]{64}$/i;
const DEVICE="DESKTOP-91FDEFP";
const IMAGE_MEASUREMENT_STATUSES=new Set([
  "service_not_running","process_metadata_unavailable",
  "process_path_not_disclosed","process_image_unreadable",
  "os_access_denied","measurement_failed","measured_from_process_path"
]);
const NOT_PRIVATE=/^(?:LocalSystem|NT AUTHORITY\\(?:SYSTEM|LOCAL SERVICE|NETWORK SERVICE)|LocalService|NetworkService)$/i;
export function assessStagingBrokerTrustReadiness(e={}){
  const blockers=new Set();
  const exactSha=SHA40.test(String(e.expected_sha||"")) &&
    e.app_source_sha===e.expected_sha;
  if(!exactSha)blockers.add("BROKER_STAGING_EXACT_RUNTIME_SHA_REQUIRED");
  if(e.device_id!==DEVICE||e.topology_observed!==true)
    blockers.add("BROKER_INDEPENDENT_HOST_TOPOLOGY_UNVERIFIED");
  if(e.broker_candidate_running===true)
    blockers.add("BROKER_INERT_CANDIDATE_NOT_OPERATIONAL_SERVICE");
  if(e.windows_service_present!==true)
    blockers.add("BROKER_DEDICATED_WINDOWS_SERVICE_NOT_FOUND");
  else{
    if(e.windows_service_running!==true||!Number.isSafeInteger(e.windows_service_pid)||
      e.windows_service_pid<1)blockers.add("BROKER_DEDICATED_WINDOWS_SERVICE_NOT_RUNNING");
    const account=String(e.windows_service_account||"");
    if(!account||NOT_PRIVATE.test(account)||/^(?:\.\\)?(?:administrator|admin)$/i.test(account))
      blockers.add("BROKER_DEDICATED_OS_ACCOUNT_UNVERIFIED");
    if(!SHA256.test(String(e.process_image_sha256||"")))
      blockers.add("BROKER_PROCESS_IMAGE_DIGEST_NOT_MEASURED");
  }
  // Deliberately not clearable via this discovery API. Actual trust requires
  // independent OS/operator attestations, pinned keys, and audit custody.
  for(const b of [
    "BROKER_OS_BINARY_AND_ACL_INDEPENDENT_ATTESTATION_REQUIRED",
    "BROKER_DB_ENDPOINT_AND_ADMIN_PRINCIPAL_INDEPENDENT_ATTESTATION_REQUIRED",
    "BROKER_ADMIN_SECRET_CUSTODY_REQUIRED",
    "BROKER_OWNER_ED25519_PUBLIC_KEY_PIN_REQUIRED",
    "BROKER_EXTERNAL_IMMUTABLE_AUDIT_REQUIRED",
    "BROKER_ONE_SHOT_SIGNED_OPERATION_APPROVAL_REQUIRED",
    "BROKER_BACKUP_POLICY_READER_PROVISIONING_NOT_AUTHORIZED"
  ])blockers.add(b);
  return Object.freeze({
    contract:"mad4b.staging.backup-broker.trust-readiness.v1",
    mode:"read_only_no_credentials",
    expected_sha:SHA40.test(String(e.expected_sha||""))?e.expected_sha:null,
    device_id:e.device_id===DEVICE?DEVICE:null,
    observed_exact_staging_release:exactSha,
    host_topology_observed:e.topology_observed===true,
    dedicated_service_observed:e.windows_service_present===true,
    dedicated_service_running:e.windows_service_present===true&&
      e.windows_service_running===true,
    process_image_digest_observed:SHA256.test(String(e.process_image_sha256||"")),
    process_image_measurement_status:IMAGE_MEASUREMENT_STATUSES.has(
      e.process_image_measurement_status)?e.process_image_measurement_status:
      "unreported_or_invalid",
    process_image_measurement_needs_privileged_readonly_probe:
      e.windows_service_running===true&&
      !SHA256.test(String(e.process_image_sha256||"")),
    service_identity_independently_attested:false,
    broker_operationally_certified:false,
    owner_operation_approved:false,
    db_admin_operation_authorized:false,
    reader_provisioned:false,
    backup_executed:false,
    restore_executed:false,
    production_mutation:false,
    secrets_included:false,
    blockers:[...blockers].sort()
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    let input="";
    for await(const chunk of process.stdin){
      input+=chunk;
      if(input.length>262144)throw Error("UNTRUSTED_EVIDENCE_TOO_LARGE");
    }
    process.stdout.write(JSON.stringify(assessStagingBrokerTrustReadiness(
      JSON.parse(input)))+"\n");
  }catch{
    process.stdout.write(JSON.stringify({
      contract:"mad4b.staging.backup-broker.trust-readiness.v1",
      mode:"read_only_no_credentials",broker_operationally_certified:false,
      db_admin_operation_authorized:false,production_mutation:false,
      secrets_included:false,blockers:["BROKER_DISCOVERY_INPUT_INVALID"]
    })+"\n");
  }
  process.exitCode=2; // Never treats caller-provided evidence as certification.
}
