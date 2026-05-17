-- Sprint 61: Essam local backup destination
--
-- Registers the local encrypted-backup destination selected by the admin and
-- links existing draft policies to it. This migration does not execute backups,
-- dump databases, copy files, upload artifacts, or run restore tests.
--
-- Idempotent. No DELETE/TRUNCATE/DROP.

INSERT INTO platform_copy_locations
  (location_id, location_key, location_type, owner_scope, tenant_id, user_id, device_id, provider,
   path_or_ref, branch_name, host_name, is_source_of_truth, allowed_operations_json, risk_level,
   status, last_validated_at, validation_json, notes, created_by, updated_by)
VALUES
  (UUID(), 'local:Essam:growth-os-backups', 'local_device_path', 'platform',
   '00000000-0000-0000-0000-000000000000', NULL, 'Essam', 'local_connector',
   'D:\\Nagy\\Growth-0s-Backups', NULL, 'Essam', 0,
   JSON_ARRAY('encrypted_backup_destination','write_approved_backup_artifacts','read_for_restore_test','list_manifests'),
   'critical', 'active', CURRENT_TIMESTAMP,
   JSON_OBJECT('exists', true, 'is_directory', true, 'validated_by', 'local_connector'),
   'Local encrypted backup destination on Essam device. Admin/platform only. Not a backup until policy apply run succeeds with checksum and restore test.',
   'migration_084', 'migration_084')
ON DUPLICATE KEY UPDATE
  location_type=VALUES(location_type), owner_scope=VALUES(owner_scope), tenant_id=VALUES(tenant_id),
  user_id=VALUES(user_id), device_id=VALUES(device_id), provider=VALUES(provider), path_or_ref=VALUES(path_or_ref),
  branch_name=VALUES(branch_name), host_name=VALUES(host_name), is_source_of_truth=VALUES(is_source_of_truth),
  allowed_operations_json=VALUES(allowed_operations_json), risk_level=VALUES(risk_level), status=VALUES(status),
  last_validated_at=VALUES(last_validated_at), validation_json=VALUES(validation_json),
  notes=VALUES(notes), updated_by=VALUES(updated_by);

UPDATE platform_backup_policies p
JOIN platform_copy_locations d ON d.location_key='local:Essam:growth-os-backups'
SET p.destination_location_id=d.location_id,
    p.policy_json=JSON_SET(
      COALESCE(p.policy_json, JSON_OBJECT()),
      '$.destination_location_key', 'local:Essam:growth-os-backups',
      '$.destination_path', 'D:\\Nagy\\Growth-0s-Backups',
      '$.destination_validated', true,
      '$.execution_blocked_until_approved', true
    ),
    p.status='draft',
    p.updated_by='migration_084'
WHERE p.policy_key IN ('policy:platform-db-primary:manual-draft','policy:platform-code-main:snapshot-draft');

UPDATE platform_restore_tests t
JOIN platform_backup_runs r ON r.run_id=t.backup_run_id
JOIN platform_backup_policies p ON p.policy_id=r.policy_id
SET t.restore_target = CASE
      WHEN p.policy_key='policy:platform-db-primary:manual-draft'
        THEN 'D:\\Nagy\\Growth-0s-Backups\\restore-tests\\db-isolated'
      WHEN p.policy_key='policy:platform-code-main:snapshot-draft'
        THEN 'D:\\Nagy\\Growth-0s-Backups\\restore-tests\\code-clean-checkout'
      ELSE t.restore_target
    END,
    t.notes=CONCAT('Restore-test plan only for draft policy ', p.policy_key,
      ' using local destination D:\\Nagy\\Growth-0s-Backups. No restore executed.')
WHERE p.policy_key IN ('policy:platform-db-primary:manual-draft','policy:platform-code-main:snapshot-draft')
  AND t.status='planned';
