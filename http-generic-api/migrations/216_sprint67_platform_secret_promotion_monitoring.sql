-- Sprint 67: Platform secret promotion monitoring.
-- Additive/idempotent diagnostics only. No destructive SQL.
-- Monitors dynamic platform secret promotion without exposing secret values.

CREATE OR REPLACE VIEW v_platform_secret_promotion_monitoring AS
SELECT
  ps.secret_key,
  ps.secret_type,
  ps.storage_backend,
  ps.status AS platform_secret_status,
  ps.value_ciphertext IS NOT NULL AS has_value_ciphertext,
  ps.value_sha256 IS NOT NULL AS has_value_sha256,
  CASE WHEN JSON_VALID(ps.metadata_json) THEN JSON_UNQUOTE(JSON_EXTRACT(ps.metadata_json, '$.source')) ELSE NULL END AS metadata_source,
  CASE WHEN JSON_VALID(ps.metadata_json) THEN JSON_UNQUOTE(JSON_EXTRACT(ps.metadata_json, '$.connection_id')) ELSE NULL END AS connection_id,
  CASE WHEN JSON_VALID(ps.metadata_json) THEN JSON_UNQUOTE(JSON_EXTRACT(ps.metadata_json, '$.target_key')) ELSE NULL END AS target_key,
  CASE WHEN JSON_VALID(ps.metadata_json) THEN JSON_UNQUOTE(JSON_EXTRACT(ps.metadata_json, '$.credential_type')) ELSE NULL END AS metadata_credential_type,
  c.tenant_id AS source_tenant_id,
  c.user_id AS source_user_id,
  c.app_key AS source_app_key,
  c.auth_type AS source_auth_type,
  c.status AS source_connection_status,
  c.validation_status AS source_connection_validation_status,
  (
    SELECT COUNT(*)
      FROM secret_references sr
     WHERE sr.secret_key COLLATE utf8mb4_unicode_ci = ps.secret_key COLLATE utf8mb4_unicode_ci
       AND sr.owner_type = 'platform'
  ) AS platform_secret_reference_count,
  (
    SELECT COUNT(*)
      FROM secret_references sr
     WHERE sr.secret_key COLLATE utf8mb4_unicode_ci = ps.secret_key COLLATE utf8mb4_unicode_ci
       AND sr.owner_type = 'platform'
       AND sr.store_type = 'db_encrypted'
       AND sr.status = 'active'
       AND sr.env_var_name IS NULL
       AND sr.vault_path IS NULL
  ) AS valid_platform_secret_reference_count,
  CASE
    WHEN ps.storage_backend <> 'db_encrypted'
      OR ps.status <> 'active'
      OR ps.value_ciphertext IS NULL
      OR ps.value_sha256 IS NULL
      THEN 'platform_secret_storage_invalid'
    WHEN (
      SELECT COUNT(*)
        FROM secret_references sr
       WHERE sr.secret_key COLLATE utf8mb4_unicode_ci = ps.secret_key COLLATE utf8mb4_unicode_ci
         AND sr.owner_type = 'platform'
    ) = 0
      THEN 'missing_platform_secret_reference'
    WHEN (
      SELECT COUNT(*)
        FROM secret_references sr
       WHERE sr.secret_key COLLATE utf8mb4_unicode_ci = ps.secret_key COLLATE utf8mb4_unicode_ci
         AND sr.owner_type = 'platform'
         AND sr.store_type = 'db_encrypted'
         AND sr.status = 'active'
         AND sr.env_var_name IS NULL
         AND sr.vault_path IS NULL
    ) = 0
      THEN 'platform_secret_reference_invalid'
    WHEN (CASE WHEN JSON_VALID(ps.metadata_json) THEN JSON_UNQUOTE(JSON_EXTRACT(ps.metadata_json, '$.connection_id')) ELSE NULL END) IS NULL
      THEN 'source_connection_id_missing'
    WHEN c.connection_id IS NULL
      THEN 'source_connection_missing'
    WHEN c.validation_status <> 'promoted_to_platform_secrets'
      THEN 'source_connection_not_marked_promoted'
    ELSE NULL
  END AS issue_code,
  CAST(JSON_OBJECT(
    'secret_key', ps.secret_key,
    'storage_backend', ps.storage_backend,
    'platform_secret_status', ps.status,
    'connection_id', CASE WHEN JSON_VALID(ps.metadata_json) THEN JSON_UNQUOTE(JSON_EXTRACT(ps.metadata_json, '$.connection_id')) ELSE NULL END,
    'source_connection_validation_status', c.validation_status,
    'secret_reference_count', (
      SELECT COUNT(*)
        FROM secret_references sr
       WHERE sr.secret_key COLLATE utf8mb4_unicode_ci = ps.secret_key COLLATE utf8mb4_unicode_ci
         AND sr.owner_type = 'platform'
    ),
    'valid_secret_reference_count', (
      SELECT COUNT(*)
        FROM secret_references sr
       WHERE sr.secret_key COLLATE utf8mb4_unicode_ci = ps.secret_key COLLATE utf8mb4_unicode_ci
         AND sr.owner_type = 'platform'
         AND sr.store_type = 'db_encrypted'
         AND sr.status = 'active'
         AND sr.env_var_name IS NULL
         AND sr.vault_path IS NULL
    ),
    'secrets_included', false
  ) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS evidence_json
FROM platform_secrets ps
LEFT JOIN user_app_connections c
  ON c.connection_id COLLATE utf8mb4_unicode_ci = (CASE WHEN JSON_VALID(ps.metadata_json) THEN JSON_UNQUOTE(JSON_EXTRACT(ps.metadata_json, '$.connection_id')) ELSE NULL END) COLLATE utf8mb4_unicode_ci
WHERE JSON_VALID(ps.metadata_json)
  AND JSON_UNQUOTE(JSON_EXTRACT(ps.metadata_json, '$.source')) = 'credential_intake_platform_secret_promotion';

CREATE OR REPLACE VIEW v_platform_secret_promotion_monitoring_issues AS
SELECT *
  FROM v_platform_secret_promotion_monitoring
 WHERE issue_code IS NOT NULL;

CREATE OR REPLACE VIEW v_platform_secret_promotion_monitoring_summary AS
SELECT
  COUNT(*) AS promoted_secret_rows,
  COALESCE(SUM(CASE WHEN issue_code IS NULL THEN 1 ELSE 0 END), 0) AS passing_rows,
  COALESCE(SUM(CASE WHEN issue_code IS NOT NULL THEN 1 ELSE 0 END), 0) AS issue_rows,
  COALESCE(SUM(CASE WHEN issue_code = 'platform_secret_storage_invalid' THEN 1 ELSE 0 END), 0) AS storage_issue_rows,
  COALESCE(SUM(CASE WHEN issue_code IN ('missing_platform_secret_reference','platform_secret_reference_invalid') THEN 1 ELSE 0 END), 0) AS reference_issue_rows,
  COALESCE(SUM(CASE WHEN issue_code IN ('source_connection_id_missing','source_connection_missing','source_connection_not_marked_promoted') THEN 1 ELSE 0 END), 0) AS source_connection_issue_rows
FROM v_platform_secret_promotion_monitoring;
