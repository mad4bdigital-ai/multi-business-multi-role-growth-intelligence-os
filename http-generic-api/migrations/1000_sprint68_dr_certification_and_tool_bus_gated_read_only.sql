-- Sprint 68: DR certification evidence + Tool Bus gated read-only pilot.
-- Scope: metadata/config/policy only. No backup material, no secrets, no provider calls, no external writes.
-- Safety: No provider calls. No credential payload reads. No raw secrets. No external send. No external writes. secrets_included=false

INSERT INTO `platform_runtime_config` (`config_key`, `config_json`, `status`, `note`) VALUES
(
  'dr_certification.db_isolated_restore.latest',
  JSON_OBJECT(
    'ok', true,
    'mode', 'isolated_db_restore_mariadb',
    'completed_at', '2026-06-12T11:34:06.364Z',
    'evidence_path', 'D:\\Nagy\\Growth-0s-Backups\\restore-tests\\db-isolated\\growth-os-db-primary-2026-05-17T18-10-17-164Z\\isolated-restore-mariadb-2026-06-12T11-30-55-112Z\\isolated-db-restore-evidence.json',
    'image', 'mariadb:11.4',
    'production_touched', false,
    'ports_published', false,
    'full_import_attempted', true,
    'secrets_included', false,
    'artifact', JSON_OBJECT('checksum_matches', true, 'size_bytes', 4633945),
    'decryption', JSON_OBJECT('ok', true, 'gzip_sha256_matches', true),
    'plaintext', JSON_OBJECT('sql_sha256_matches', true, 'sql_size_bytes', 63802376),
    'recovery_key', JSON_OBJECT('content_read', true, 'content_returned', false),
    'readback', JSON_OBJECT('table_count', 155, 'expected_table_count', 155, 'approximate_rows', 38864, 'expected_manifest_rows', 39515),
    'cleanup', JSON_OBJECT('container_removed', true, 'plaintext_sql_removed', true)
  ),
  'active',
  'Latest local isolated MariaDB restore certification summary. Contains no recovery key material.'
),
(
  'dr_certification.n8n_isolated_restore_boot.latest',
  JSON_OBJECT(
    'ok', true,
    'mode', 'isolated_n8n_restore_boot',
    'completed_at', '2026-06-12T12:19:43.019Z',
    'evidence_path', 'D:\\Nagy\\Growth-0s-Backups\\restore-tests\\n8n-local\\growth-os-n8n-local-2026-05-17T18-25-41-880Z\\isolated-boot-2026-06-12T12-19-16-645Z\\isolated-n8n-restore-boot-evidence.json',
    'port', 5688,
    'broker_port', 5689,
    'listen_address', '127.0.0.1',
    'production_touched', false,
    'secrets_included', false,
    'isolated_boot_attempted', true,
    'artifact', JSON_OBJECT('checksum_matches', true, 'size_bytes', 13098316),
    'decryption', JSON_OBJECT('ok', true, 'zip_size_bytes', 13098316),
    'recovery_key', JSON_OBJECT('content_read', true, 'content_returned', false),
    'structural_restore', JSON_OBJECT('markers', JSON_OBJECT('has_user_folder', true, 'has_database_sqlite', true, 'has_config', true, 'has_nodes_dir', true), 'expected_file_count', 851),
    'health', JSON_OBJECT('ok', true, 'status', 200, 'body', '{"status":"ok"}'),
    'cleanup', JSON_OBJECT('plaintext_zip_removed', true, 'isolated_process_stopped', true, 'extracted_restore_removed', true)
  ),
  'active',
  'Latest local isolated n8n restore boot certification summary. Contains no recovery key material.'
)
ON DUPLICATE KEY UPDATE
  `config_json` = VALUES(`config_json`),
  `status` = VALUES(`status`),
  `note` = VALUES(`note`),
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `execution_policies` (`policy_group`, `policy_key`, `policy_value`, `active`, `execution_scope`, `affects_layer`, `blocking`, `notes`) VALUES
(
  'DR Certification Governance',
  'dr_isolated_restore_certification_policy_v1',
  JSON_OBJECT(
    'db_certification_config_key', 'dr_certification.db_isolated_restore.latest',
    'n8n_certification_config_key', 'dr_certification.n8n_isolated_restore_boot.latest',
    'production_touched_required', false,
    'secrets_included_required', false,
    'evidence_contains_secret_payload', false,
    'cutover_allowed', false,
    'external_write_allowed', false
  ),
  'TRUE',
  'dr_certification|isolated_restore|release_readiness|local_connector',
  'platform_runtime_config|releaseReadiness|dr-certifiers|local_connector',
  'TRUE',
  'DR certification evidence must be metadata-only, isolated, no-cutover, and no secret payload return.'
),
(
  'Tool Bus Governance',
  'tool_bus_gated_read_only_dispatch_policy_v1',
  JSON_OBJECT(
    'allowlisted_tools', JSON_ARRAY('tenant_repository_intelligence_report','tenant_repository_action_planner_dry_run','tenant_repository_intelligence_v3_v4_readiness_smoke'),
    'provider_calls_allowed', false,
    'external_writes_allowed', false,
    'repository_mutations_allowed', false,
    'credential_payload_returned', false,
    'requires_descriptor_resolution', true,
    'requires_policy_validation', true
  ),
  'TRUE',
  'tool_bus|gated_dispatch|read_only|tenant_repository_intelligence|pilot',
  'tool-bus-gated-read-only-dispatch|tenant_platform_endpoint_tools|execution_policies',
  'TRUE',
  'Tool Bus gated read-only dispatch pilot may execute metadata-only read-only registry-backed pilots only.'
)
ON DUPLICATE KEY UPDATE
  `policy_value` = VALUES(`policy_value`),
  `active` = VALUES(`active`),
  `execution_scope` = VALUES(`execution_scope`),
  `affects_layer` = VALUES(`affects_layer`),
  `blocking` = VALUES(`blocking`),
  `notes` = VALUES(`notes`),
  `updated_at` = CURRENT_TIMESTAMP;
