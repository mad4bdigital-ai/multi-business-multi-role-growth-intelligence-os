-- Corrective repair for the partial application of
-- 20260722_agent_skill_grant_approval_provenance.sql.
--
-- Align only the relationship and scope columns that are compared with
-- agent_skill_grants, agent_skills, and agents. The approval_hold_id column
-- intentionally remains utf8mb4_unicode_ci because that is the approval-ledger
-- convention used by the surrounding platform tables.

ALTER TABLE agent_skill_grant_requests
  MODIFY COLUMN request_id VARCHAR(36)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  MODIFY COLUMN agent_id VARCHAR(36)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  MODIFY COLUMN skill_id VARCHAR(36)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  MODIFY COLUMN tenant_id VARCHAR(36)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NULL,
  MODIFY COLUMN brand_key VARCHAR(128)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NULL;

-- corrective_migration=true
-- original_migration_immutable=true
-- partial_state_safe=true
-- narrow_column_collation_alignment=true
-- whole_table_convert=false
-- binary_comparison_workaround=false
-- same_cycle_schema_readback_required=true
-- provider_calls=false
-- external_writes=false
-- secrets_included=false
