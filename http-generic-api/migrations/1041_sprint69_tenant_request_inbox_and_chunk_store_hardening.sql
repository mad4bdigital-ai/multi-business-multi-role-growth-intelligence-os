-- 1041_sprint69_tenant_request_inbox_and_chunk_store_hardening.sql
-- Purpose: add an explicit ticket-to-resolution-case link, bounded inbox indexes,
-- and reconcile the durable response chunk columns used by runtime listing surfaces.
-- Safety: additive/idempotent; no provider calls, credential reads, external sends,
-- destructive DDL, or guessed non-ticket backfill. secrets_included=false.

SET @resolution_ticket_id_sql := (
  SELECT CASE WHEN COUNT(*) = 0
    THEN 'ALTER TABLE tenant_resolution_cases ADD COLUMN ticket_id CHAR(36) NULL AFTER tenant_id'
    ELSE 'SELECT 1 AS tenant_resolution_cases_ticket_id_present' END
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'tenant_resolution_cases'
    AND column_name = 'ticket_id'
);
PREPARE resolution_ticket_id_stmt FROM @resolution_ticket_id_sql;
EXECUTE resolution_ticket_id_stmt;
DEALLOCATE PREPARE resolution_ticket_id_stmt;

-- Backfill only the canonical ticket://<uuid> relation already written by the ticket router.
-- Other resource refs remain untouched and continue to use the compatibility fallback.
UPDATE tenant_resolution_cases
   SET ticket_id = SUBSTRING(resource_ref, 10)
 WHERE ticket_id IS NULL
   AND resource_ref REGEXP '^ticket://[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

SET @tickets_inbox_index_sql := (
  SELECT CASE WHEN COUNT(*) = 0
    THEN 'ALTER TABLE tickets ADD KEY idx_tickets_tenant_status_last_seen (tenant_id, status, last_seen_at, ticket_id)'
    ELSE 'SELECT 1 AS tickets_inbox_index_present' END
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'tickets'
    AND index_name = 'idx_tickets_tenant_status_last_seen'
);
PREPARE tickets_inbox_index_stmt FROM @tickets_inbox_index_sql;
EXECUTE tickets_inbox_index_stmt;
DEALLOCATE PREPARE tickets_inbox_index_stmt;

SET @resolution_inbox_index_sql := (
  SELECT CASE WHEN COUNT(*) = 0
    THEN 'ALTER TABLE tenant_resolution_cases ADD KEY idx_resolution_cases_ticket_status_updated (tenant_id, ticket_id, status, updated_at)'
    ELSE 'SELECT 1 AS resolution_inbox_index_present' END
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'tenant_resolution_cases'
    AND index_name = 'idx_resolution_cases_ticket_status_updated'
);
PREPARE resolution_inbox_index_stmt FROM @resolution_inbox_index_sql;
EXECUTE resolution_inbox_index_stmt;
DEALLOCATE PREPARE resolution_inbox_index_stmt;

-- Reconcile every runtime-referenced chunk ownership column. This intentionally repeats
-- the additive ownership contract so a partially applied legacy environment can recover
-- without changing application data or guessing owners for existing rows.
SET @chunk_owner_tenant_sql_1041 := (
  SELECT CASE WHEN COUNT(*) = 0
    THEN 'ALTER TABLE governed_tool_response_chunks ADD COLUMN owner_tenant_id VARCHAR(64) NULL AFTER source_tool_key'
    ELSE 'SELECT 1 AS governed_chunk_owner_tenant_present' END
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'governed_tool_response_chunks' AND column_name = 'owner_tenant_id'
);
PREPARE chunk_owner_tenant_stmt_1041 FROM @chunk_owner_tenant_sql_1041;
EXECUTE chunk_owner_tenant_stmt_1041;
DEALLOCATE PREPARE chunk_owner_tenant_stmt_1041;

SET @chunk_owner_user_sql_1041 := (
  SELECT CASE WHEN COUNT(*) = 0
    THEN 'ALTER TABLE governed_tool_response_chunks ADD COLUMN owner_user_id VARCHAR(64) NULL AFTER owner_tenant_id'
    ELSE 'SELECT 1 AS governed_chunk_owner_user_present' END
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'governed_tool_response_chunks' AND column_name = 'owner_user_id'
);
PREPARE chunk_owner_user_stmt_1041 FROM @chunk_owner_user_sql_1041;
EXECUTE chunk_owner_user_stmt_1041;
DEALLOCATE PREPARE chunk_owner_user_stmt_1041;

SET @chunk_owner_workspace_sql_1041 := (
  SELECT CASE WHEN COUNT(*) = 0
    THEN 'ALTER TABLE governed_tool_response_chunks ADD COLUMN owner_workspace_id VARCHAR(64) NULL AFTER owner_user_id'
    ELSE 'SELECT 1 AS governed_chunk_owner_workspace_present' END
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'governed_tool_response_chunks' AND column_name = 'owner_workspace_id'
);
PREPARE chunk_owner_workspace_stmt_1041 FROM @chunk_owner_workspace_sql_1041;
EXECUTE chunk_owner_workspace_stmt_1041;
DEALLOCATE PREPARE chunk_owner_workspace_stmt_1041;

SET @chunk_owner_type_sql_1041 := (
  SELECT CASE WHEN COUNT(*) = 0
    THEN 'ALTER TABLE governed_tool_response_chunks ADD COLUMN owner_principal_type VARCHAR(64) NULL AFTER owner_workspace_id'
    ELSE 'SELECT 1 AS governed_chunk_owner_type_present' END
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'governed_tool_response_chunks' AND column_name = 'owner_principal_type'
);
PREPARE chunk_owner_type_stmt_1041 FROM @chunk_owner_type_sql_1041;
EXECUTE chunk_owner_type_stmt_1041;
DEALLOCATE PREPARE chunk_owner_type_stmt_1041;

SET @chunk_owner_principal_sql_1041 := (
  SELECT CASE WHEN COUNT(*) = 0
    THEN 'ALTER TABLE governed_tool_response_chunks ADD COLUMN owner_principal_id VARCHAR(191) NULL AFTER owner_principal_type'
    ELSE 'SELECT 1 AS governed_chunk_owner_principal_present' END
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'governed_tool_response_chunks' AND column_name = 'owner_principal_id'
);
PREPARE chunk_owner_principal_stmt_1041 FROM @chunk_owner_principal_sql_1041;
EXECUTE chunk_owner_principal_stmt_1041;
DEALLOCATE PREPARE chunk_owner_principal_stmt_1041;

SET @chunk_source_surface_sql_1041 := (
  SELECT CASE WHEN COUNT(*) = 0
    THEN 'ALTER TABLE governed_tool_response_chunks ADD COLUMN source_surface VARCHAR(64) NULL AFTER owner_principal_id'
    ELSE 'SELECT 1 AS governed_chunk_source_surface_present' END
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'governed_tool_response_chunks' AND column_name = 'source_surface'
);
PREPARE chunk_source_surface_stmt_1041 FROM @chunk_source_surface_sql_1041;
EXECUTE chunk_source_surface_stmt_1041;
DEALLOCATE PREPARE chunk_source_surface_stmt_1041;

SET @chunk_owner_user_index_sql_1041 := (
  SELECT CASE WHEN COUNT(*) = 0
    THEN 'ALTER TABLE governed_tool_response_chunks ADD KEY idx_governed_chunk_owner_user_expiry (owner_tenant_id, owner_user_id, expires_at)'
    ELSE 'SELECT 1 AS governed_chunk_owner_user_expiry_index_present' END
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'governed_tool_response_chunks'
    AND index_name = 'idx_governed_chunk_owner_user_expiry'
);
PREPARE chunk_owner_user_index_stmt_1041 FROM @chunk_owner_user_index_sql_1041;
EXECUTE chunk_owner_user_index_stmt_1041;
DEALLOCATE PREPARE chunk_owner_user_index_stmt_1041;

SET @chunk_owner_principal_index_sql_1041 := (
  SELECT CASE WHEN COUNT(*) = 0
    THEN 'ALTER TABLE governed_tool_response_chunks ADD KEY idx_governed_chunk_principal_expiry (owner_principal_id, expires_at)'
    ELSE 'SELECT 1 AS governed_chunk_owner_principal_expiry_index_present' END
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'governed_tool_response_chunks'
    AND index_name = 'idx_governed_chunk_principal_expiry'
);
PREPARE chunk_owner_principal_index_stmt_1041 FROM @chunk_owner_principal_index_sql_1041;
EXECUTE chunk_owner_principal_index_stmt_1041;
DEALLOCATE PREPARE chunk_owner_principal_index_stmt_1041;

CREATE OR REPLACE VIEW v_tenant_request_inbox_schema_readiness AS
SELECT
  'tenant_request_inbox_v1' AS contract_key,
  CASE WHEN metrics.ticket_id_column_count = 1
         AND metrics.ticket_index_count = 1
         AND metrics.case_index_count = 1
       THEN 'ready' ELSE 'blocked' END AS readiness_status,
  metrics.ticket_id_column_count,
  metrics.ticket_index_count,
  metrics.case_index_count,
  metrics.linked_case_count,
  0 AS provider_calls,
  0 AS credential_payload_reads,
  0 AS external_sends,
  0 AS external_writes,
  0 AS secrets_included
FROM (
  SELECT
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'tenant_resolution_cases' AND column_name = 'ticket_id') AS ticket_id_column_count,
    (SELECT COUNT(DISTINCT index_name) FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'tickets' AND index_name = 'idx_tickets_tenant_status_last_seen') AS ticket_index_count,
    (SELECT COUNT(DISTINCT index_name) FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'tenant_resolution_cases' AND index_name = 'idx_resolution_cases_ticket_status_updated') AS case_index_count,
    (SELECT COUNT(*) FROM tenant_resolution_cases WHERE ticket_id IS NOT NULL) AS linked_case_count
) metrics;

CREATE OR REPLACE VIEW v_governed_response_chunk_runtime_schema_readiness AS
SELECT
  'governed_response_chunk_runtime_columns_v1' AS contract_key,
  metrics.required_column_count,
  metrics.present_column_count,
  CASE WHEN metrics.present_column_count = metrics.required_column_count THEN 'ready' ELSE 'blocked' END AS readiness_status,
  0 AS provider_calls,
  0 AS credential_payload_reads,
  0 AS external_sends,
  0 AS external_writes,
  0 AS secrets_included
FROM (
  SELECT 16 AS required_column_count,
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'governed_tool_response_chunks'
        AND column_name IN (
          'chunk_id','source_tool_key','response_sha256','response_bytes','response_json',
          'cursor_policy','redaction_status','secrets_included','owner_tenant_id','owner_user_id',
          'owner_workspace_id','owner_principal_type','owner_principal_id','source_surface',
          'created_at','expires_at'
        )) AS present_column_count
) metrics;
