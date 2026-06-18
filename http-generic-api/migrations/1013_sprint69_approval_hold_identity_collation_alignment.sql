-- 1013_sprint69_approval_hold_identity_collation_alignment.sql
-- Root-cause repair for Approval Hold identity joins.
-- no_provider_call
-- no_credential_payload_read
-- no_raw_secrets
-- no_external_send
-- no_external_write
-- secrets_included=false
--
-- Scope: internal SQL schema/data repair only. No provider request, credential read,
-- external send/write, repository mutation, deployment action, or secret payload access.
-- Column lengths, nullability, defaults, and existing indexes are preserved.
--
-- Rollback (schema only, after explicit readback review):
-- ALTER TABLE approval_holds MODIFY hold_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL;
-- ALTER TABLE local_gateway_tool_call_log MODIFY approval_hold_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NULL DEFAULT NULL;
-- ALTER TABLE repository_advisory_comment_plans MODIFY approval_hold_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NULL DEFAULT NULL;
-- ALTER TABLE ticket_workflow_links MODIFY approval_hold_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NULL DEFAULT NULL;

-- Repair only expired pending requests whose temporary smoke/test hold has already
-- been cleaned up. The previous reference is preserved in decision_note.
UPDATE execution_enablement_requests r
LEFT JOIN approval_holds h
  ON CONVERT(h.hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
   = CONVERT(r.approval_hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
SET r.decision_note = CONCAT_WS(
      ' | ', NULLIF(r.decision_note, ''),
      CONCAT('migration_1013_expired_orphan_hold=', r.approval_hold_id)
    ),
    r.approval_hold_id = NULL,
    r.request_status = 'expired'
WHERE r.approval_hold_id IS NOT NULL
  AND h.hold_id IS NULL
  AND r.request_status = 'pending_approval'
  AND DATE_ADD(r.created_at, INTERVAL r.ttl_hours HOUR) < UTC_TIMESTAMP();

-- Fail closed if any Approval Hold reference remains orphaned.
CREATE TEMPORARY TABLE tmp_approval_hold_identity_orphans AS
SELECT 'ads_provider_profile_onboarding_requests' AS source_table, CONVERT(c.approval_hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci AS hold_id
FROM ads_provider_profile_onboarding_requests c
LEFT JOIN approval_holds h ON CONVERT(h.hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(c.approval_hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
WHERE c.approval_hold_id IS NOT NULL AND h.hold_id IS NULL
UNION ALL
SELECT 'execution_enablement_requests', CONVERT(c.approval_hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci AS hold_id
FROM execution_enablement_requests c
LEFT JOIN approval_holds h ON CONVERT(h.hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(c.approval_hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
WHERE c.approval_hold_id IS NOT NULL AND h.hold_id IS NULL
UNION ALL
SELECT 'growth_intelligence_actions', CONVERT(c.approval_hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci AS hold_id
FROM growth_intelligence_actions c
LEFT JOIN approval_holds h ON CONVERT(h.hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(c.approval_hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
WHERE c.approval_hold_id IS NOT NULL AND h.hold_id IS NULL
UNION ALL
SELECT 'local_gateway_tool_call_log', CONVERT(c.approval_hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci AS hold_id
FROM local_gateway_tool_call_log c
LEFT JOIN approval_holds h ON CONVERT(h.hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(c.approval_hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
WHERE c.approval_hold_id IS NOT NULL AND h.hold_id IS NULL
UNION ALL
SELECT 'repository_advisory_comment_plans', CONVERT(c.approval_hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci AS hold_id
FROM repository_advisory_comment_plans c
LEFT JOIN approval_holds h ON CONVERT(h.hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(c.approval_hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
WHERE c.approval_hold_id IS NOT NULL AND h.hold_id IS NULL
UNION ALL
SELECT 'repository_mutation_plans_v6', CONVERT(c.approval_hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci AS hold_id
FROM repository_mutation_plans_v6 c
LEFT JOIN approval_holds h ON CONVERT(h.hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(c.approval_hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
WHERE c.approval_hold_id IS NOT NULL AND h.hold_id IS NULL
UNION ALL
SELECT 'repository_mutation_runs_v6', CONVERT(c.approval_hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci AS hold_id
FROM repository_mutation_runs_v6 c
LEFT JOIN approval_holds h ON CONVERT(h.hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(c.approval_hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
WHERE h.hold_id IS NULL
UNION ALL
SELECT 'tenant_ssh_cli_approval_requests', CONVERT(c.hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci AS hold_id
FROM tenant_ssh_cli_approval_requests c
LEFT JOIN approval_holds h ON CONVERT(h.hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(c.hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
WHERE h.hold_id IS NULL
UNION ALL
SELECT 'ticket_workflow_links', c.approval_hold_id
FROM ticket_workflow_links c
LEFT JOIN approval_holds h ON CONVERT(h.hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(c.approval_hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
WHERE c.approval_hold_id IS NOT NULL AND h.hold_id IS NULL;

SET @approval_hold_orphan_count := (SELECT COUNT(*) FROM tmp_approval_hold_identity_orphans);
SET @approval_hold_orphan_guard := IF(
  @approval_hold_orphan_count = 0,
  'SELECT 1 AS approval_hold_identity_orphan_check_passed',
  'SIGNAL SQLSTATE ''45000'' SET MESSAGE_TEXT = ''Active Approval Hold identity orphans remain; repair before collation alignment'''
);
PREPARE approval_hold_orphan_stmt FROM @approval_hold_orphan_guard;
EXECUTE approval_hold_orphan_stmt;
DEALLOCATE PREPARE approval_hold_orphan_stmt;
DROP TEMPORARY TABLE tmp_approval_hold_identity_orphans;

-- Align only the four mismatched varchar(36) identity columns. Other table defaults
-- and differently-sized identity contracts remain unchanged.
-- Each ALTER is selected through information_schema so an already-aligned rerun
-- becomes a read-only SELECT.
SET @align_local_gateway_approval_hold_sql := (
  SELECT CASE
    WHEN COUNT(*) = 1
     AND MAX(character_set_name = 'utf8mb4') = 1
     AND MAX(collation_name = 'utf8mb4_unicode_ci') = 1
     AND MAX(column_type = 'varchar(36)') = 1
     AND MAX(is_nullable = 'YES') = 1
    THEN 'SELECT 1 AS local_gateway_tool_call_log_approval_hold_id_already_aligned'
    ELSE 'ALTER TABLE local_gateway_tool_call_log MODIFY approval_hold_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL'
  END
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'local_gateway_tool_call_log'
    AND column_name = 'approval_hold_id'
);
PREPARE align_local_gateway_approval_hold_stmt FROM @align_local_gateway_approval_hold_sql;
EXECUTE align_local_gateway_approval_hold_stmt;
DEALLOCATE PREPARE align_local_gateway_approval_hold_stmt;

SET @align_repository_advisory_approval_hold_sql := (
  SELECT CASE
    WHEN COUNT(*) = 1
     AND MAX(character_set_name = 'utf8mb4') = 1
     AND MAX(collation_name = 'utf8mb4_unicode_ci') = 1
     AND MAX(column_type = 'varchar(36)') = 1
     AND MAX(is_nullable = 'YES') = 1
    THEN 'SELECT 1 AS repository_advisory_comment_plans_approval_hold_id_already_aligned'
    ELSE 'ALTER TABLE repository_advisory_comment_plans MODIFY approval_hold_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL'
  END
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'repository_advisory_comment_plans'
    AND column_name = 'approval_hold_id'
);
PREPARE align_repository_advisory_approval_hold_stmt FROM @align_repository_advisory_approval_hold_sql;
EXECUTE align_repository_advisory_approval_hold_stmt;
DEALLOCATE PREPARE align_repository_advisory_approval_hold_stmt;

SET @align_ticket_workflow_approval_hold_sql := (
  SELECT CASE
    WHEN COUNT(*) = 1
     AND MAX(character_set_name = 'utf8mb4') = 1
     AND MAX(collation_name = 'utf8mb4_unicode_ci') = 1
     AND MAX(column_type = 'varchar(36)') = 1
     AND MAX(is_nullable = 'YES') = 1
    THEN 'SELECT 1 AS ticket_workflow_links_approval_hold_id_already_aligned'
    ELSE 'ALTER TABLE ticket_workflow_links MODIFY approval_hold_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL'
  END
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'ticket_workflow_links'
    AND column_name = 'approval_hold_id'
);
PREPARE align_ticket_workflow_approval_hold_stmt FROM @align_ticket_workflow_approval_hold_sql;
EXECUTE align_ticket_workflow_approval_hold_stmt;
DEALLOCATE PREPARE align_ticket_workflow_approval_hold_stmt;

SET @align_approval_holds_hold_id_sql := (
  SELECT CASE
    WHEN COUNT(*) = 1
     AND MAX(character_set_name = 'utf8mb4') = 1
     AND MAX(collation_name = 'utf8mb4_unicode_ci') = 1
     AND MAX(column_type = 'varchar(36)') = 1
     AND MAX(is_nullable = 'NO') = 1
    THEN 'SELECT 1 AS approval_holds_hold_id_already_aligned'
    ELSE 'ALTER TABLE approval_holds MODIFY hold_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL'
  END
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'approval_holds'
    AND column_name = 'hold_id'
);
PREPARE align_approval_holds_hold_id_stmt FROM @align_approval_holds_hold_id_sql;
EXECUTE align_approval_holds_hold_id_stmt;
DEALLOCATE PREPARE align_approval_holds_hold_id_stmt;

CREATE OR REPLACE VIEW v_approval_hold_identity_collation_readiness AS
SELECT
  'approval_hold_identity_collation_v1' AS contract_key,
  schema_metrics.expected_column_count,
  schema_metrics.present_column_count,
  schema_metrics.ready_column_count,
  schema_metrics.collation_mismatch_count,
  orphan_metrics.orphan_reference_count,
  CASE
    WHEN schema_metrics.expected_column_count = 10
     AND schema_metrics.present_column_count = 10
     AND schema_metrics.ready_column_count = 10
     AND schema_metrics.collation_mismatch_count = 0
     AND orphan_metrics.orphan_reference_count = 0
    THEN 'ready' ELSE 'blocked'
  END AS readiness_status,
  0 AS provider_calls,
  0 AS credential_payload_reads,
  0 AS external_sends,
  0 AS external_writes,
  0 AS secrets_included
FROM (
  SELECT
    COUNT(*) AS expected_column_count,
    SUM(c.column_name IS NOT NULL) AS present_column_count,
    SUM(c.character_set_name = 'utf8mb4' AND c.collation_name = 'utf8mb4_unicode_ci' AND c.column_type = 'varchar(36)') AS ready_column_count,
    SUM(c.column_name IS NULL OR c.character_set_name <> 'utf8mb4' OR c.collation_name <> 'utf8mb4_unicode_ci' OR c.column_type <> 'varchar(36)') AS collation_mismatch_count
  FROM (
    SELECT 'approval_holds' AS table_name, 'hold_id' AS column_name
    UNION ALL SELECT 'ads_provider_profile_onboarding_requests', 'approval_hold_id'
    UNION ALL SELECT 'execution_enablement_requests', 'approval_hold_id'
    UNION ALL SELECT 'growth_intelligence_actions', 'approval_hold_id'
    UNION ALL SELECT 'local_gateway_tool_call_log', 'approval_hold_id'
    UNION ALL SELECT 'repository_advisory_comment_plans', 'approval_hold_id'
    UNION ALL SELECT 'repository_mutation_plans_v6', 'approval_hold_id'
    UNION ALL SELECT 'repository_mutation_runs_v6', 'approval_hold_id'
    UNION ALL SELECT 'tenant_ssh_cli_approval_requests', 'hold_id'
    UNION ALL SELECT 'ticket_workflow_links', 'approval_hold_id'
  ) expected
  LEFT JOIN information_schema.columns c
    ON c.table_schema = DATABASE()
   AND c.table_name = expected.table_name
   AND c.column_name = expected.column_name
) schema_metrics
CROSS JOIN (
  SELECT COUNT(*) AS orphan_reference_count
  FROM (
    SELECT c.approval_hold_id AS hold_id FROM ads_provider_profile_onboarding_requests c LEFT JOIN approval_holds h ON h.hold_id = c.approval_hold_id WHERE c.approval_hold_id IS NOT NULL AND h.hold_id IS NULL
    UNION ALL SELECT c.approval_hold_id FROM execution_enablement_requests c LEFT JOIN approval_holds h ON h.hold_id = c.approval_hold_id WHERE c.approval_hold_id IS NOT NULL AND h.hold_id IS NULL
    UNION ALL SELECT c.approval_hold_id FROM growth_intelligence_actions c LEFT JOIN approval_holds h ON h.hold_id = c.approval_hold_id WHERE c.approval_hold_id IS NOT NULL AND h.hold_id IS NULL
    UNION ALL SELECT c.approval_hold_id FROM local_gateway_tool_call_log c LEFT JOIN approval_holds h ON h.hold_id = c.approval_hold_id WHERE c.approval_hold_id IS NOT NULL AND h.hold_id IS NULL
    UNION ALL SELECT c.approval_hold_id FROM repository_advisory_comment_plans c LEFT JOIN approval_holds h ON h.hold_id = c.approval_hold_id WHERE c.approval_hold_id IS NOT NULL AND h.hold_id IS NULL
    UNION ALL SELECT c.approval_hold_id FROM repository_mutation_plans_v6 c LEFT JOIN approval_holds h ON h.hold_id = c.approval_hold_id WHERE c.approval_hold_id IS NOT NULL AND h.hold_id IS NULL
    UNION ALL SELECT c.approval_hold_id FROM repository_mutation_runs_v6 c LEFT JOIN approval_holds h ON h.hold_id = c.approval_hold_id WHERE h.hold_id IS NULL
    UNION ALL SELECT c.hold_id FROM tenant_ssh_cli_approval_requests c LEFT JOIN approval_holds h ON h.hold_id = c.hold_id WHERE h.hold_id IS NULL
    UNION ALL SELECT c.approval_hold_id FROM ticket_workflow_links c LEFT JOIN approval_holds h ON h.hold_id = c.approval_hold_id WHERE c.approval_hold_id IS NOT NULL AND h.hold_id IS NULL
  ) orphan_rows
) orphan_metrics;

INSERT INTO execution_policies
  (policy_group, policy_key, policy_value, active, execution_scope, affects_layer, blocking, notes)
VALUES (
  'schema_governance',
  'approval_hold_identity_collation_v1',
  JSON_OBJECT(
    'expected_character_set', 'utf8mb4',
    'expected_collation', 'utf8mb4_unicode_ci',
    'expected_column_type', 'varchar(36)',
    'expected_column_count', 10,
    'readiness_view', 'v_approval_hold_identity_collation_readiness',
    'runtime_compatibility_join_retained_until_verified', true
  ),
  'true',
  'approval_hold_identity_joins',
  'approval_hold_governance_and_growth_intelligence',
  'true',
  'Blocking policy: all varchar(36) Approval Hold identity keys must use utf8mb4_unicode_ci with zero active orphans.'
)
ON DUPLICATE KEY UPDATE
  policy_value = VALUES(policy_value),
  active = VALUES(active),
  execution_scope = VALUES(execution_scope),
  affects_layer = VALUES(affects_layer),
  blocking = VALUES(blocking),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;
