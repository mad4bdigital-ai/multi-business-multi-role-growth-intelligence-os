// Read-only, fail-closed gate. Not a backup executor or QA-fixture activation authority.
// No credential, token, source path, subject ID or recovery-key content is returned.
const hex64 = /^[a-f0-9]{64}$/i;
const sha40 = /^[a-f0-9]{40}$/i;
const integer = x => Number.isSafeInteger(Number(x)) && Number(x) >= 0 ? Number(x) : 0;
export function assessStagingBackupAuthority(input={}) {
  const runtime = String(input.environment || "").toLowerCase();
  const staging = runtime.includes("staging") && !runtime.includes("production") && !runtime.includes("prod_");
  // Unknown inventory is not evidence that a policy is absent. Only a
  // successful privileged SELECT census can certify a zero-policy result.
  const inventoryVerified = input.policy_inventory_verified === true;
  const p = input.policy || null;
  const backup = input.backup || null;
  const restore = input.restore || null;
  const expectedHead = String(input.expected_source_sha || "");
  const blockers = [];
  if (!staging) blockers.push("STAGING_RUNTIME_NOT_ATTESTED");
  if (!sha40.test(expectedHead)) blockers.push("EXACT_SOURCE_SHA_NOT_ATTESTED");
  if (!p) blockers.push(inventoryVerified ? "DATABASE_BACKUP_POLICY_MISSING" : "BACKUP_POLICY_INVENTORY_UNVERIFIED");
  else {
    if (!inventoryVerified) blockers.push("BACKUP_POLICY_INVENTORY_UNVERIFIED");
    if (p.backup_kind !== "database") blockers.push("DATABASE_POLICY_KIND_INVALID");
    if (p.status !== "active" || p.activation_gate_status !== "active") blockers.push("BACKUP_POLICY_NOT_ACTIVE");
    if (p.allowed_executor !== "local_connector") blockers.push("LOCAL_CONNECTOR_EXECUTOR_REQUIRED");
    if (p.source_status !== "active" || p.destination_status !== "active") blockers.push("SOURCE_OR_DESTINATION_NOT_ACTIVE");
    if (p.artifact_format !== "sql_dump" || p.checksum_algorithm !== "sha256") blockers.push("BACKUP_ARTIFACT_CONTRACT_INVALID");
    if (p.encryption_scheme !== "platform_managed") blockers.push("PLATFORM_ENCRYPTION_CONTRACT_NOT_ACTIVATED");
    if (integer(p.approved_count) < 1 || !p.approval_required) blockers.push("POLICY_OWNER_APPROVAL_MISSING");
    if (Number(p.restore_test_required) !== 1) blockers.push("RESTORE_TEST_NOT_REQUIRED_BY_POLICY");
  }
  if (!backup) blockers.push("FRESH_ENCRYPTED_BACKUP_NOT_VERIFIED");
  else {
    if (backup.status !== "succeeded" || backup.encryption_scheme !== "aes-256-gcm"
       || backup.checksum_algorithm !== "sha256" || !hex64.test(String(backup.artifact_sha256 || ""))
       || backup.checksum_verified !== true || backup.secret_bearing_urls_included === true) {
      blockers.push("ENCRYPTED_BACKUP_INTEGRITY_UNVERIFIED");
    }
    if (backup.source_sha !== expectedHead) blockers.push("BACKUP_SOURCE_SHA_MISMATCH");
  }
  if (!restore) blockers.push("ISOLATED_RESTORE_NOT_ATTESTED");
  else {
    if (restore.ok !== true || restore.mode !== "isolated_db_restore_mariadb"
        || restore.ports_published !== false || restore.network_isolated !== true
        || restore.production_touched !== false || restore.full_import_attempted !== true
        || restore.cleanup?.container_removed !== true || restore.cleanup?.plaintext_sql_removed !== true) {
      blockers.push("RESTORE_ISOLATION_OR_CLEANUP_UNVERIFIED");
    }
    if (restore.source_sha !== expectedHead || !hex64.test(String(restore.artifact_sha256 || ""))
        || !backup || restore.artifact_sha256 !== backup.artifact_sha256) {
      blockers.push("RESTORE_ARTIFACT_SOURCE_IDENTITY_MISMATCH");
    }
  }
  // Separate owner-approved QA fixture plan/apply/verify/cleanup and complete OA/MC
  // runtime evidence are never implied by this preflight, even if backup checks pass.
  const blocked = [...new Set(blockers)];
  return {
    contract:"mad4b.staging.backup-restore-preflight.v1",
    environment_valid:staging,
    backup_restore_prerequisites_satisfied:blocked.length===0,
    blockers:blocked,
    policy_inventory_verified:inventoryVerified,
    existing_policy_count:inventoryVerified ? integer(input.policy_count) : null,
    approved_backup_count:integer(input.approved_backup_count),
    verified_isolated_restore_count:integer(input.verified_restore_count),
    qa_fixture_write_authorized:false,
    production_promotion_authorized:false,
    production_mutation:false,
    backup_executed:false,
    secrets_included:false,
  };
}
