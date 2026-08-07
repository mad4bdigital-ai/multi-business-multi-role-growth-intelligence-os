-- 1050_workspace_asset_provenance_content_identity.sql
-- Purpose: add durable, queryable provenance/content-identity fields required by the
-- Brand Core -> workspace asset materialization lifecycle without rewriting legacy rows.
-- Safety: additive and idempotent. No provider calls, credential reads, external sends,
-- destructive DDL, live content fetch, or secret-bearing payloads. secrets_included=false.
-- This migration is repository delivery only; apply requires the normal governed DB path.
-- no_provider_call
-- no_credential_payload_read
-- no_raw_secrets
-- no_external_send
-- no_external_write
-- secrets_included_false

SET @wa_workspace_id_sql := (
  SELECT CASE WHEN COUNT(*) = 0
    THEN 'ALTER TABLE workspace_assets ADD COLUMN workspace_id VARCHAR(64) NULL AFTER tenant_id'
    ELSE 'SELECT 1 AS workspace_asset_workspace_id_present' END
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'workspace_assets' AND column_name = 'workspace_id'
);
PREPARE wa_workspace_id_stmt FROM @wa_workspace_id_sql;
EXECUTE wa_workspace_id_stmt;
DEALLOCATE PREPARE wa_workspace_id_stmt;

SET @wa_source_type_sql := (
  SELECT CASE WHEN COUNT(*) = 0
    THEN 'ALTER TABLE workspace_assets ADD COLUMN source_type VARCHAR(64) NULL AFTER session_ref'
    ELSE 'SELECT 1 AS workspace_asset_source_type_present' END
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'workspace_assets' AND column_name = 'source_type'
);
PREPARE wa_source_type_stmt FROM @wa_source_type_sql;
EXECUTE wa_source_type_stmt;
DEALLOCATE PREPARE wa_source_type_stmt;

SET @wa_source_ref_sql := (
  SELECT CASE WHEN COUNT(*) = 0
    THEN 'ALTER TABLE workspace_assets ADD COLUMN source_ref VARCHAR(512) NULL AFTER source_type'
    ELSE 'SELECT 1 AS workspace_asset_source_ref_present' END
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'workspace_assets' AND column_name = 'source_ref'
);
PREPARE wa_source_ref_stmt FROM @wa_source_ref_sql;
EXECUTE wa_source_ref_stmt;
DEALLOCATE PREPARE wa_source_ref_stmt;

SET @wa_source_revision_sql := (
  SELECT CASE WHEN COUNT(*) = 0
    THEN 'ALTER TABLE workspace_assets ADD COLUMN source_revision VARCHAR(191) NULL AFTER source_ref'
    ELSE 'SELECT 1 AS workspace_asset_source_revision_present' END
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'workspace_assets' AND column_name = 'source_revision'
);
PREPARE wa_source_revision_stmt FROM @wa_source_revision_sql;
EXECUTE wa_source_revision_stmt;
DEALLOCATE PREPARE wa_source_revision_stmt;

SET @wa_source_updated_at_sql := (
  SELECT CASE WHEN COUNT(*) = 0
    THEN 'ALTER TABLE workspace_assets ADD COLUMN source_updated_at DATETIME NULL AFTER source_revision'
    ELSE 'SELECT 1 AS workspace_asset_source_updated_at_present' END
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'workspace_assets' AND column_name = 'source_updated_at'
);
PREPARE wa_source_updated_at_stmt FROM @wa_source_updated_at_sql;
EXECUTE wa_source_updated_at_stmt;
DEALLOCATE PREPARE wa_source_updated_at_stmt;

SET @wa_source_validation_sql := (
  SELECT CASE WHEN COUNT(*) = 0
    THEN 'ALTER TABLE workspace_assets ADD COLUMN source_validation_status VARCHAR(64) NULL AFTER source_updated_at'
    ELSE 'SELECT 1 AS workspace_asset_source_validation_status_present' END
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'workspace_assets' AND column_name = 'source_validation_status'
);
PREPARE wa_source_validation_stmt FROM @wa_source_validation_sql;
EXECUTE wa_source_validation_stmt;
DEALLOCATE PREPARE wa_source_validation_stmt;

SET @wa_provenance_sha_sql := (
  SELECT CASE WHEN COUNT(*) = 0
    THEN 'ALTER TABLE workspace_assets ADD COLUMN provenance_sha256 CHAR(64) NULL AFTER source_validation_status'
    ELSE 'SELECT 1 AS workspace_asset_provenance_sha256_present' END
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'workspace_assets' AND column_name = 'provenance_sha256'
);
PREPARE wa_provenance_sha_stmt FROM @wa_provenance_sha_sql;
EXECUTE wa_provenance_sha_stmt;
DEALLOCATE PREPARE wa_provenance_sha_stmt;

SET @wa_content_sha_sql := (
  SELECT CASE WHEN COUNT(*) = 0
    THEN 'ALTER TABLE workspace_assets ADD COLUMN content_sha256 CHAR(64) NULL AFTER provenance_sha256'
    ELSE 'SELECT 1 AS workspace_asset_content_sha256_present' END
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'workspace_assets' AND column_name = 'content_sha256'
);
PREPARE wa_content_sha_stmt FROM @wa_content_sha_sql;
EXECUTE wa_content_sha_stmt;
DEALLOCATE PREPARE wa_content_sha_stmt;

SET @wa_provenance_index_sql := (
  SELECT CASE WHEN COUNT(*) = 0
    THEN 'ALTER TABLE workspace_assets ADD UNIQUE KEY uq_workspace_asset_provenance (tenant_id, brand_ref, source_type, source_ref)'
    ELSE 'SELECT 1 AS workspace_asset_provenance_index_present' END
  FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'workspace_assets' AND index_name = 'uq_workspace_asset_provenance'
);
PREPARE wa_provenance_index_stmt FROM @wa_provenance_index_sql;
EXECUTE wa_provenance_index_stmt;
DEALLOCATE PREPARE wa_provenance_index_stmt;

SET @wa_content_index_sql := (
  SELECT CASE WHEN COUNT(*) = 0
    THEN 'ALTER TABLE workspace_assets ADD KEY idx_workspace_asset_content_sha256 (tenant_id, content_sha256)'
    ELSE 'SELECT 1 AS workspace_asset_content_sha256_index_present' END
  FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'workspace_assets' AND index_name = 'idx_workspace_asset_content_sha256'
);
PREPARE wa_content_index_stmt FROM @wa_content_index_sql;
EXECUTE wa_content_index_stmt;
DEALLOCATE PREPARE wa_content_index_stmt;

CREATE OR REPLACE VIEW v_workspace_asset_provenance_schema_readiness AS
SELECT
  'workspace_asset_provenance_v1' AS contract_key,
  8 AS required_column_count,
  metrics.present_column_count,
  CASE WHEN metrics.present_column_count = 8 AND metrics.provenance_index_count = 1
       THEN 'ready' ELSE 'blocked' END AS readiness_status,
  metrics.provenance_index_count,
  metrics.content_index_count,
  0 AS provider_calls,
  0 AS credential_payload_reads,
  0 AS external_sends,
  0 AS external_writes,
  0 AS secrets_included
FROM (
  SELECT
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'workspace_assets'
        AND column_name IN (
          'workspace_id','source_type','source_ref','source_revision','source_updated_at',
          'source_validation_status','provenance_sha256','content_sha256'
        )) AS present_column_count,
    (SELECT COUNT(DISTINCT index_name) FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'workspace_assets'
        AND index_name = 'uq_workspace_asset_provenance') AS provenance_index_count,
    (SELECT COUNT(DISTINCT index_name) FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'workspace_assets'
        AND index_name = 'idx_workspace_asset_content_sha256') AS content_index_count
) metrics;
