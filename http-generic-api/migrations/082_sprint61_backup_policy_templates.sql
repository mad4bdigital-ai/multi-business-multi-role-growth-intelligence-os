-- Sprint 61: Backup policy draft templates
--
-- Adds draft-only backup policy templates and logical copy locations.
-- This migration does not execute backups, dump databases, copy files, upload
-- artifacts, or schedule jobs.
--
-- Idempotent. No DELETE/TRUNCATE/DROP.

INSERT INTO platform_copy_locations
  (location_id, location_key, location_type, owner_scope, tenant_id, user_id, device_id, provider,
   path_or_ref, branch_name, host_name, is_source_of_truth, allowed_operations_json, risk_level,
   status, notes, created_by, updated_by)
VALUES
  (UUID(), 'database:mysql:auth-runtime-primary', 'database', 'platform', NULL, NULL, NULL, 'mysql',
   'mysql://<redacted-host>/u338416126_growthOS', NULL, 'auth.mad4b.com', 1,
   JSON_ARRAY('schema_census','approved_dump_only','restore_test_required'), 'critical', 'pending_validation',
   'Logical primary runtime database source. Credentials must never be stored here. Backup execution requires approved policy and encrypted destination.',
   'migration_082', 'migration_082'),
  (UUID(), 'object-storage:pending:encrypted-backups', 'object_storage', 'platform', NULL, NULL, NULL, 'pending',
   'pending://encrypted-backup-destination', NULL, NULL, 0,
   JSON_ARRAY('encrypted_backup_destination_candidate'), 'critical', 'pending_validation',
   'Placeholder destination only. Must be replaced with an approved encrypted destination before any apply-mode backup.',
   'migration_082', 'migration_082')
ON DUPLICATE KEY UPDATE
  location_type=VALUES(location_type), owner_scope=VALUES(owner_scope), tenant_id=VALUES(tenant_id),
  user_id=VALUES(user_id), device_id=VALUES(device_id), provider=VALUES(provider), path_or_ref=VALUES(path_or_ref),
  branch_name=VALUES(branch_name), host_name=VALUES(host_name), is_source_of_truth=VALUES(is_source_of_truth),
  allowed_operations_json=VALUES(allowed_operations_json), risk_level=VALUES(risk_level), status=VALUES(status),
  notes=VALUES(notes), updated_by=VALUES(updated_by);

-- Draft DB backup policy. Destination intentionally points to a pending placeholder,
-- so the policy cannot be treated as approved or executable.
INSERT INTO platform_backup_policies
  (policy_id, policy_key, policy_label, scope, source_location_id, destination_location_id, backup_kind,
   mode, frequency_cron, retention_days, encryption_required, checksum_required, approval_required,
   restore_test_required, allowed_executor, forbidden_content_json, policy_json, status, created_by, updated_by)
SELECT UUID(), 'policy:platform-db-primary:manual-draft', 'Platform primary DB manual backup draft', 'platform',
       src.location_id, dst.location_id, 'database', 'manual', NULL, 7,
       1, 1, 1, 1, 'none',
       JSON_ARRAY('plaintext_env','provider_credentials','oauth_refresh_tokens','api_keys','service_account_json','unencrypted_db_dump'),
       JSON_OBJECT(
         'phase', 'draft_only',
         'database_name', 'u338416126_growthOS',
         'requires_encrypted_destination', true,
         'requires_restore_test_plan', true,
         'requires_admin_approval_in_session', true,
         'execution_blocked_until_approved', true
       ),
       'draft', 'migration_082', 'migration_082'
FROM platform_copy_locations src
LEFT JOIN platform_copy_locations dst ON dst.location_key='object-storage:pending:encrypted-backups'
WHERE src.location_key='database:mysql:auth-runtime-primary'
ON DUPLICATE KEY UPDATE
  policy_label=VALUES(policy_label), scope=VALUES(scope), source_location_id=VALUES(source_location_id),
  destination_location_id=VALUES(destination_location_id), backup_kind=VALUES(backup_kind), mode=VALUES(mode),
  retention_days=VALUES(retention_days), encryption_required=VALUES(encryption_required),
  checksum_required=VALUES(checksum_required), approval_required=VALUES(approval_required),
  restore_test_required=VALUES(restore_test_required), allowed_executor=VALUES(allowed_executor),
  forbidden_content_json=VALUES(forbidden_content_json), policy_json=VALUES(policy_json),
  status='draft', updated_by=VALUES(updated_by);

-- Draft code snapshot policy. GitHub remains the source of truth; this is a
-- metadata template for future release/archive snapshots, not a repo backup.
INSERT INTO platform_backup_policies
  (policy_id, policy_key, policy_label, scope, source_location_id, destination_location_id, backup_kind,
   mode, frequency_cron, retention_days, encryption_required, checksum_required, approval_required,
   restore_test_required, allowed_executor, forbidden_content_json, policy_json, status, created_by, updated_by)
SELECT UUID(), 'policy:platform-code-main:snapshot-draft', 'Platform code main branch snapshot draft', 'platform',
       src.location_id, NULL, 'code', 'manual', NULL, 30,
       0, 1, 1, 1, 'github_actions',
       JSON_ARRAY('db_dumps','plaintext_env','provider_credentials','oauth_refresh_tokens','api_keys','service_account_json'),
       JSON_OBJECT(
         'phase', 'draft_only',
         'source_of_truth_remains_github', true,
         'suggested_snapshot_ref', 'signed_tag_or_release_asset',
         'execution_blocked_until_approved', true
       ),
       'draft', 'migration_082', 'migration_082'
FROM platform_copy_locations src
WHERE src.location_key='repo:main:growth-intelligence-os'
ON DUPLICATE KEY UPDATE
  policy_label=VALUES(policy_label), scope=VALUES(scope), source_location_id=VALUES(source_location_id),
  destination_location_id=VALUES(destination_location_id), backup_kind=VALUES(backup_kind), mode=VALUES(mode),
  retention_days=VALUES(retention_days), encryption_required=VALUES(encryption_required),
  checksum_required=VALUES(checksum_required), approval_required=VALUES(approval_required),
  restore_test_required=VALUES(restore_test_required), allowed_executor=VALUES(allowed_executor),
  forbidden_content_json=VALUES(forbidden_content_json), policy_json=VALUES(policy_json),
  status='draft', updated_by=VALUES(updated_by);
