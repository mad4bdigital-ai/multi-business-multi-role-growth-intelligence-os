-- 1048_transport_response_chunk_schema_recovery.sql
-- Purpose: recover the durable governed response-chunk transport schema independently
-- from tenant inbox or unrelated application migrations.
-- Safety: additive and idempotent. No provider calls, credential reads, external sends,
-- destructive DDL, data backfill, or secret-bearing payloads. secrets_included=false.
-- no_provider_call
-- no_credential_payload_read
-- no_raw_secrets
-- no_external_send
-- no_external_write
-- secrets_included_false

CREATE TABLE IF NOT EXISTS governed_tool_response_chunks (
  chunk_id VARCHAR(64) NOT NULL,
  source_tool_key VARCHAR(191) NULL,
  owner_tenant_id VARCHAR(64) NULL,
  owner_user_id VARCHAR(64) NULL,
  owner_workspace_id VARCHAR(64) NULL,
  owner_principal_type VARCHAR(64) NULL,
  owner_principal_id VARCHAR(191) NULL,
  source_surface VARCHAR(64) NULL,
  response_sha256 CHAR(64) NOT NULL,
  response_bytes BIGINT UNSIGNED NOT NULL,
  response_json LONGTEXT NOT NULL,
  cursor_policy VARCHAR(64) NOT NULL DEFAULT 'utf16_code_unit_cursor_v1',
  redaction_status VARCHAR(64) NOT NULL DEFAULT 'redacted_or_non_secret',
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (chunk_id),
  KEY idx_governed_tool_response_chunks_expires_at (expires_at),
  KEY idx_governed_chunk_owner_user_expiry (owner_tenant_id, owner_user_id, expires_at),
  KEY idx_governed_chunk_principal_expiry (owner_principal_id, expires_at),
  CONSTRAINT chk_governed_tool_response_chunks_no_secrets CHECK (secrets_included = 0),
  CONSTRAINT chk_governed_tool_response_chunks_sha256 CHECK (response_sha256 REGEXP '^[0-9a-f]{64}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A legacy environment can already have the original table while missing the ownership
-- columns required by the current runtime. Reconcile each column independently so this
-- migration remains safe after a partial earlier rollout.
SET @transport_chunk_owner_tenant_sql := (
  SELECT CASE WHEN COUNT(*) = 0
    THEN 'ALTER TABLE governed_tool_response_chunks ADD COLUMN owner_tenant_id VARCHAR(64) NULL AFTER source_tool_key'
    ELSE 'SELECT 1 AS governed_chunk_owner_tenant_present' END
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'governed_tool_response_chunks'
    AND column_name = 'owner_tenant_id'
);
PREPARE transport_chunk_owner_tenant_stmt FROM @transport_chunk_owner_tenant_sql;
EXECUTE transport_chunk_owner_tenant_stmt;
DEALLOCATE PREPARE transport_chunk_owner_tenant_stmt;

SET @transport_chunk_owner_user_sql := (
  SELECT CASE WHEN COUNT(*) = 0
    THEN 'ALTER TABLE governed_tool_response_chunks ADD COLUMN owner_user_id VARCHAR(64) NULL AFTER owner_tenant_id'
    ELSE 'SELECT 1 AS governed_chunk_owner_user_present' END
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'governed_tool_response_chunks'
    AND column_name = 'owner_user_id'
);
PREPARE transport_chunk_owner_user_stmt FROM @transport_chunk_owner_user_sql;
EXECUTE transport_chunk_owner_user_stmt;
DEALLOCATE PREPARE transport_chunk_owner_user_stmt;

SET @transport_chunk_owner_workspace_sql := (
  SELECT CASE WHEN COUNT(*) = 0
    THEN 'ALTER TABLE governed_tool_response_chunks ADD COLUMN owner_workspace_id VARCHAR(64) NULL AFTER owner_user_id'
    ELSE 'SELECT 1 AS governed_chunk_owner_workspace_present' END
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'governed_tool_response_chunks'
    AND column_name = 'owner_workspace_id'
);
PREPARE transport_chunk_owner_workspace_stmt FROM @transport_chunk_owner_workspace_sql;
EXECUTE transport_chunk_owner_workspace_stmt;
DEALLOCATE PREPARE transport_chunk_owner_workspace_stmt;

SET @transport_chunk_owner_type_sql := (
  SELECT CASE WHEN COUNT(*) = 0
    THEN 'ALTER TABLE governed_tool_response_chunks ADD COLUMN owner_principal_type VARCHAR(64) NULL AFTER owner_workspace_id'
    ELSE 'SELECT 1 AS governed_chunk_owner_type_present' END
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'governed_tool_response_chunks'
    AND column_name = 'owner_principal_type'
);
PREPARE transport_chunk_owner_type_stmt FROM @transport_chunk_owner_type_sql;
EXECUTE transport_chunk_owner_type_stmt;
DEALLOCATE PREPARE transport_chunk_owner_type_stmt;

SET @transport_chunk_owner_principal_sql := (
  SELECT CASE WHEN COUNT(*) = 0
    THEN 'ALTER TABLE governed_tool_response_chunks ADD COLUMN owner_principal_id VARCHAR(191) NULL AFTER owner_principal_type'
    ELSE 'SELECT 1 AS governed_chunk_owner_principal_present' END
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'governed_tool_response_chunks'
    AND column_name = 'owner_principal_id'
);
PREPARE transport_chunk_owner_principal_stmt FROM @transport_chunk_owner_principal_sql;
EXECUTE transport_chunk_owner_principal_stmt;
DEALLOCATE PREPARE transport_chunk_owner_principal_stmt;

SET @transport_chunk_source_surface_sql := (
  SELECT CASE WHEN COUNT(*) = 0
    THEN 'ALTER TABLE governed_tool_response_chunks ADD COLUMN source_surface VARCHAR(64) NULL AFTER owner_principal_id'
    ELSE 'SELECT 1 AS governed_chunk_source_surface_present' END
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'governed_tool_response_chunks'
    AND column_name = 'source_surface'
);
PREPARE transport_chunk_source_surface_stmt FROM @transport_chunk_source_surface_sql;
EXECUTE transport_chunk_source_surface_stmt;
DEALLOCATE PREPARE transport_chunk_source_surface_stmt;

SET @transport_chunk_owner_user_index_sql := (
  SELECT CASE WHEN COUNT(*) = 0
    THEN 'ALTER TABLE governed_tool_response_chunks ADD KEY idx_governed_chunk_owner_user_expiry (owner_tenant_id, owner_user_id, expires_at)'
    ELSE 'SELECT 1 AS governed_chunk_owner_user_expiry_index_present' END
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'governed_tool_response_chunks'
    AND index_name = 'idx_governed_chunk_owner_user_expiry'
);
PREPARE transport_chunk_owner_user_index_stmt FROM @transport_chunk_owner_user_index_sql;
EXECUTE transport_chunk_owner_user_index_stmt;
DEALLOCATE PREPARE transport_chunk_owner_user_index_stmt;

SET @transport_chunk_owner_principal_index_sql := (
  SELECT CASE WHEN COUNT(*) = 0
    THEN 'ALTER TABLE governed_tool_response_chunks ADD KEY idx_governed_chunk_principal_expiry (owner_principal_id, expires_at)'
    ELSE 'SELECT 1 AS governed_chunk_owner_principal_expiry_index_present' END
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'governed_tool_response_chunks'
    AND index_name = 'idx_governed_chunk_principal_expiry'
);
PREPARE transport_chunk_owner_principal_index_stmt FROM @transport_chunk_owner_principal_index_sql;
EXECUTE transport_chunk_owner_principal_index_stmt;
DEALLOCATE PREPARE transport_chunk_owner_principal_index_stmt;

CREATE OR REPLACE VIEW v_governed_response_chunk_transport_schema_readiness AS
SELECT
  'governed_response_chunk_transport_schema_v1' AS contract_key,
  metrics.required_column_count,
  metrics.present_column_count,
  CASE
    WHEN metrics.present_column_count = metrics.required_column_count THEN 'ready'
    ELSE 'blocked'
  END AS readiness_status,
  0 AS provider_calls,
  0 AS credential_payload_reads,
  0 AS external_sends,
  0 AS external_writes,
  0 AS secrets_included
FROM (
  SELECT
    16 AS required_column_count,
    (
      SELECT COUNT(*)
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'governed_tool_response_chunks'
        AND column_name IN (
          'chunk_id', 'source_tool_key', 'response_sha256', 'response_bytes',
          'response_json', 'cursor_policy', 'redaction_status', 'secrets_included',
          'owner_tenant_id', 'owner_user_id', 'owner_workspace_id',
          'owner_principal_type', 'owner_principal_id', 'source_surface',
          'created_at', 'expires_at'
        )
    ) AS present_column_count
) metrics;
