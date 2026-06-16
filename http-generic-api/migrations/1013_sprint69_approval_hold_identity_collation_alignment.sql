-- 1013_sprint69_approval_hold_identity_collation_alignment.sql
-- Root-cause repair: align all varchar(36) Approval Hold identity join keys to the
-- database-standard utf8mb4_unicode_ci collation and expose a blocking readiness guard.
--
-- Safety markers:
-- no_provider_call
-- no_credential_payload_read
-- no_raw_secrets
-- no_external_send
-- no_external_write
-- secrets_included=false
--
-- Scope: internal schema/data repair only. No provider request, credential read,
-- external send/write, repository mutation, deployment action, or secret payload access.
-- Indexes, lengths, defaults, and nullability are preserved.
--
-- Rollback (schema only, if explicitly required after readback):
--   ALTER TABLE approval_holds
--     MODIFY hold_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL;
--   ALTER TABLE local_gateway_tool_call_log
--     MODIFY approval_hold_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NULL DEFAULT NULL;
--   ALTER TABLE repository_advisory_comment_plans
--     MODIFY approval_hold_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NULL DEFAULT NULL;
--   ALTER TABLE ticket_workflow_links
--     MODIFY approval_hold_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NULL DEFAULT NULL;
-- The expired smoke-test orphan repaired below records its previous hold id in decision_note.

UPDATE execution_enablement_requests r
LEFT JOIN approval_holds h
  ON CONVERT(h.hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
   = CONVERT(r.approval_hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
SET r.decision_note = CONCAT_WS(
      ' | ',
      NULLIF(r.decision_note, ''),
      CONCAT('migration_1013_expired_orphan_hold=', r.approval_hold_id)
    ),
    r.approval_hold_id = NULL,
    r.request_status = 'expired'
WHERE r.approval_hold_id IS NOT NULL
  AND h.hold_id IS NULL
  AND r.request_status = 'pending_approval'
  AND DATE_ADD(r.created_at, INTERVAL r.ttl_hours HOUR) < UTC_TIMESTAMP();

SET @approval_hold_active_orphan_count := (
  SELECT COALESCE(SUM(orphan_count), 0)
  FROM (
    SELECT COUNT(*) AS orphan_count
    FROM ads_provider_profile_onboarding_requests c
    LEFT JOIN approval_holds h
      ON CONVERT(h.hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
       = CONVERT(c.approval_hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
    WHERE c.approval_hold_id IS NOT NULL AND h.hold_id IS NULL
    UNION ALL
    SELECT COUNT(*) FROM execution_enablement_requests c
    LEFT JOIN approval_holds h
      ON CONVERT(h.hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
       = CONVERT(c.approval_hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
    WHERE c.approval_hold_id IS NOT NULL AND h.hold_id IS NULL
    UNION ALL
    SELECT COUNT(*) FROM growth_intelligence_actions c
    LEFT JOIN approval_holds h
      ON CONVERT(h.hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
       = CONVERT(c.approval_hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
    WHERE c.approval_hold_id IS NOT NULL AND h.hold_id IS NULL
    UNION ALL
    SELECT COUNT(*) FROM local_gateway_tool_call_log c
    LEFT JOIN approval_holds h
      ON CONVERT(h.hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
       = CONVERT(c.approval_hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
    WHERE c.approval_hold_id IS NOT NULL AND h.hold_id IS NULL
    UNION ALL
    SELECT COUNT(*) FROM repository_advisory_comment_plans c
    LEFT JOIN approval_holds h
      ON CONVERT(h.hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
       = CONVERT(c.approval_hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
    WHERE c.approval_hold_id IS NOT NULL AND h.hold_id IS NULL
    UNION ALL
    SELECT COUNT(*) FROM repository_mutation_plans_v6 c
    LEFT JOIN approval_holds h
      ON CONVERT(h.hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
       = CONVERT(c.approval_hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
    WHERE c.approval_hold_id IS NOT NULL AND h.hold_id IS NULL
    UNION ALL
    SELECT COUNT(*) FROM repository_mutation_runs_v6 c
    LEFT JOIN approval_holds h
      ON CONVERT(h.hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
       = CONVERT(c.approval_hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
    WHERE h.hold_id IS NULL
    UNION ALL
    SELECT COUNT(*) FROM tenant_ssh_cli_approval_requests c
    LEFT JOIN approval_holds h
      ON CONVERT(h.hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
       = CONVERT(c.hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
    WHERE h.hold_id IS NULL
    UNION ALL
    SELECT COUNT(*) FROM ticket_workflow_links c
    LEFT JOIN approval_holds h
      ON CONVERT(h.hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
       = CONVERT(c.approval_hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
    WHERE c.approval_hold_id IS NOT NULL AND h.hold_id IS NULL
  ) orphan_counts
);

SET @approval_hold_orphan_guard_sql := IF(
  @approval_hold_active_orphan_count = 0,
  'SELECT 1 AS approval_hold_identity_orphan_check_passed',
  'SIGNAL SQLSTATE ''45000'' SET MESSAGE_TEXT = ''Active Approval Hold identity orphans remain; repair before collation alignment'''
);
PREPARE approval_hold_orphan_guard_stmt FROM @approval_hold_orphan_guard_sql;
EXECUTE approval_hold_orphan_guard_stmt;
DEALLOCATE PREPARE approval_hold_orphan_guard_stmt;

ALTER TABLE local_gateway_tool_call_log
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY approval_hold_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL;

ALTER TABLE repository_advisory_comment_plans
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY approval_hold_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL;

ALTER TABLE ticket_workflow_links
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY approval_hold_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL;

ALTER TABLE approval_holds
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY hold_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;

CREATE OR REPLACE VIEW v_approval_hold_identity_collation_readiness AS
SELECT
  'approval_hold_identity_collation_v1' AS contract_key,
  metrics.expected_column_count,
  metrics.present_column_count,
  metrics.ready_column_count,
  metrics.collation_mismatch_count,
  metrics.orphan_reference_count,
  CASE
    WHEN metrics.expected_column_count = 10
     AND metrics.present_column_count = 10
     AND metrics.ready_column_count = 10
     AND metrics.collation_mismatch_count = 0
     AND metrics.orphan_reference_count = 0
    THEN 'ready'
    ELSE 'blocked'
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
    SUM(c.column_name IS NULL OR c.character_set_name <> 'utf8mb4' OR c.collation_name <> 'utf8mb4_unicode_ci' OR c.column_type <> 'varchar(36)') AS collation_mismatch_count,
    (
      SELECT COALESCE(SUM(orphan_count), 0)
      FROM (
        SELECT COUNT(*) AS orphan_count FROM ads_provider_profile_onboarding_requests c1 LEFT JOIN approval_holds h1 ON CONVERT(h1.hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(c1.approval_hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci WHERE c1.approval_hold_id IS NOT NULL AND h1.hold_id IS NULL
        UNION ALL SELECT COUNT(*) FROM execution_enablement_requests c2 LEFT JOIN approval_holds h2 ON CONVERT(h2.hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(c2.approval_hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci WHERE c2.approval_hold_id IS NOT NULL AND h2.hold_id IS NULL
        UNION ALL SELECT COUNT(*) FROM growth_intelligence_actions c3 LEFT JOIN approval_holds h3 ON CONVERT(h3.hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(c3.approval_hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci WHERE c3.approval_hold_id IS NOT NULL AND h3.hold_id IS NULL
        UNION ALL SELECT COUNT(*) FROM local_gateway_tool_call_log c4 LEFT JOIN approval_holds h4 ON CONVERT(h4.hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(c4.approval_hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci WHERE c4.approval_hold_id IS NOT NULL AND h4.hold_id IS NULL
        UNION ALL SELECT COUNT(*) FROM repository_advisory_comment_plans c5 LEFT JOIN approval_holds h5 ON CONVERT(h5.hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(c5.approval_hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci WHERE c5.approval_hold_id IS NOT NULL AND h5.hold_id IS NULL
        UNION ALL SELECT COUNT(*) FROM repository_mutation_plans_v6 c6 LEFT JOIN approval_holds h6 ON CONVERT(h6.hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(c6.approval_hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci WHERE c6.approval_hold_id IS NOT NULL AND h6.hold_id IS NULL
        UNION ALL SELECT COUNT(*) FROM repository_mutation_runs_v6 c7 LEFT JOIN approval_holds h7 ON CONVERT(h7.hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(c7.approval_hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci WHERE h7.hold_id IS NULL
        UNION ALL SELECT COUNT(*) FROM tenant_ssh_cli_approval_requests c8 LEFT JOIN approval_holds h8 ON CONVERT(h8.hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(c8.hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci WHERE h8.hold_id IS NULL
        UNION ALL SELECT COUNT(*) FROM ticket_workflow_links c9 LEFT JOIN approval_holds h9 ON CONVERT(h9.hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(c9.approval_hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci WHERE c9.approval_hold_id IS NOT NULL AND h9.hold_id IS NULL
      ) orphan_counts
    ) AS orphan_reference_count
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
) metrics;

INSERT INTO execution_policies
  (policy_group, policy_key, policy_value, active, execution_scope, affects_layer, blocking, notes)
SELECT
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
WHERE NOT EXISTS (
  SELECT 1 FROM execution_policies
  WHERE policy_group = 'schema_governance'
    AND policy_key = 'approval_hold_identity_collation_v1'
);

UPDATE execution_policies
SET policy_value = JSON_OBJECT(
      'expected_character_set', 'utf8mb4',
      'expected_collation', 'utf8mb4_unicode_ci',
      'expected_column_type', 'varchar(36)',
      'expected_column_count', 10,
      'readiness_view', 'v_approval_hold_identity_collation_readiness',
      'runtime_compatibility_join_retained_until_verified', true
    ),
    active = 'true',
    execution_scope = 'approval_hold_identity_joins',
    affects_layer = 'approval_hold_governance_and_growth_intelligence',
    blocking = 'true',
    notes = 'Blocking policy: all varchar(36) Approval Hold identity keys must use utf8mb4_unicode_ci with zero active orphans.',
    updated_at = CURRENT_TIMESTAMP
WHERE policy_group = 'schema_governance'
  AND policy_key = 'approval_hold_identity_collation_v1';
