-- Long-term hardening for credential-intake platform-secret promotion.
ALTER TABLE secret_references MODIFY COLUMN secret_key VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;

UPDATE secret_references sr
JOIN platform_secrets ps ON ps.secret_key = sr.secret_key AND ps.status = 'active' AND ps.storage_backend = 'db_encrypted' AND ps.value_ciphertext IS NOT NULL AND ps.value_sha256 IS NOT NULL
SET sr.store_type = 'db_encrypted', sr.env_var_name = NULL, sr.vault_path = NULL,
    sr.rotation_status = CASE WHEN sr.rotation_status IN ('validated','rotated') THEN sr.rotation_status ELSE 'provisioned_pending_validation' END,
    sr.validation_status = CASE WHEN sr.validation_status = 'validated' THEN sr.validation_status ELSE 'stored' END,
    sr.status = 'active'
WHERE sr.owner_type = 'platform';

CREATE OR REPLACE VIEW v_platform_secret_promotion_monitoring AS
SELECT ps.secret_key, ps.secret_type, ps.storage_backend, ps.status AS platform_secret_status,
  ps.value_ciphertext IS NOT NULL AS has_value_ciphertext, ps.value_sha256 IS NOT NULL AS has_value_sha256,
  JSON_UNQUOTE(JSON_EXTRACT(ps.metadata_json, '$.source')) AS metadata_source,
  JSON_UNQUOTE(JSON_EXTRACT(ps.metadata_json, '$.connection_id')) AS connection_id,
  JSON_UNQUOTE(JSON_EXTRACT(ps.metadata_json, '$.target_key')) AS target_key,
  c.tenant_id AS source_tenant_id, c.user_id AS source_user_id, c.app_key AS source_app_key, c.auth_type AS source_auth_type,
  c.status AS source_connection_status, c.validation_status AS source_connection_validation_status,
  (SELECT COUNT(*) FROM secret_references sr WHERE sr.secret_key = ps.secret_key AND sr.owner_type = 'platform') AS platform_secret_reference_count,
  (SELECT COUNT(*) FROM secret_references sr WHERE sr.secret_key = ps.secret_key AND sr.owner_type = 'platform' AND sr.store_type = 'db_encrypted'
    AND sr.status = 'active' AND sr.rotation_status IN ('provisioned_pending_validation','validated','rotated')
    AND sr.validation_status IN ('stored','validated') AND sr.env_var_name IS NULL AND sr.vault_path IS NULL) AS valid_platform_secret_reference_count,
  CASE
    WHEN ps.storage_backend <> 'db_encrypted' OR ps.status <> 'active' OR ps.value_ciphertext IS NULL OR ps.value_sha256 IS NULL THEN 'platform_secret_storage_invalid'
    WHEN (SELECT COUNT(*) FROM secret_references sr WHERE sr.secret_key = ps.secret_key AND sr.owner_type = 'platform') = 0 THEN 'missing_platform_secret_reference'
    WHEN (SELECT COUNT(*) FROM secret_references sr WHERE sr.secret_key = ps.secret_key AND sr.owner_type = 'platform') > 1 THEN 'ambiguous_platform_secret_reference'
    WHEN (SELECT COUNT(*) FROM secret_references sr WHERE sr.secret_key = ps.secret_key AND sr.owner_type = 'platform' AND sr.store_type = 'db_encrypted'
      AND sr.status = 'active' AND sr.rotation_status IN ('provisioned_pending_validation','validated','rotated')
      AND sr.validation_status IN ('stored','validated') AND sr.env_var_name IS NULL AND sr.vault_path IS NULL) = 0 THEN 'platform_secret_reference_provisioning_state_stale'
    WHEN JSON_UNQUOTE(JSON_EXTRACT(ps.metadata_json, '$.connection_id')) IS NULL THEN 'source_connection_id_missing'
    WHEN c.connection_id IS NULL THEN 'source_connection_missing'
    WHEN c.validation_status <> 'promoted_to_platform_secrets' THEN 'source_connection_not_marked_promoted'
    ELSE NULL END AS issue_code,
  CAST(JSON_OBJECT('secret_key', ps.secret_key, 'storage_backend', ps.storage_backend, 'platform_secret_status', ps.status,
    'connection_id', JSON_UNQUOTE(JSON_EXTRACT(ps.metadata_json, '$.connection_id')), 'source_connection_validation_status', c.validation_status,
    'secret_reference_count', (SELECT COUNT(*) FROM secret_references sr WHERE sr.secret_key = ps.secret_key AND sr.owner_type = 'platform'),
    'valid_secret_reference_count', (SELECT COUNT(*) FROM secret_references sr WHERE sr.secret_key = ps.secret_key AND sr.owner_type = 'platform' AND sr.store_type = 'db_encrypted'
      AND sr.status = 'active' AND sr.rotation_status IN ('provisioned_pending_validation','validated','rotated')
      AND sr.validation_status IN ('stored','validated') AND sr.env_var_name IS NULL AND sr.vault_path IS NULL), 'secrets_included', false)
    AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS evidence_json
FROM platform_secrets ps
LEFT JOIN user_app_connections c ON c.connection_id COLLATE utf8mb4_unicode_ci = JSON_UNQUOTE(JSON_EXTRACT(ps.metadata_json, '$.connection_id')) COLLATE utf8mb4_unicode_ci
WHERE JSON_VALID(ps.metadata_json) AND JSON_UNQUOTE(JSON_EXTRACT(ps.metadata_json, '$.source')) IN ('credential_intake_platform_secret_promotion','credential_intake_auto_platform_secret_promotion');

CREATE OR REPLACE VIEW v_platform_secret_promotion_monitoring_issues AS SELECT * FROM v_platform_secret_promotion_monitoring WHERE issue_code IS NOT NULL;
CREATE OR REPLACE VIEW v_platform_secret_promotion_monitoring_summary AS
SELECT COUNT(*) AS promoted_secret_rows,
  COALESCE(SUM(issue_code IS NULL),0) AS passing_rows,
  COALESCE(SUM(issue_code IS NOT NULL),0) AS issue_rows,
  COALESCE(SUM(issue_code = 'platform_secret_storage_invalid'),0) AS storage_issue_rows,
  COALESCE(SUM(issue_code IN ('missing_platform_secret_reference','ambiguous_platform_secret_reference','platform_secret_reference_provisioning_state_stale')),0) AS reference_issue_rows,
  COALESCE(SUM(issue_code IN ('source_connection_id_missing','source_connection_missing','source_connection_not_marked_promoted')),0) AS source_connection_issue_rows
FROM v_platform_secret_promotion_monitoring;
