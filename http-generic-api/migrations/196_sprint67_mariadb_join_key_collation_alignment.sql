-- Sprint 67: MariaDB ordered-chain join-key collation alignment.
-- MariaDB 10.10+/11.x defaults new utf8mb4 tables to utf8mb4_uca1400_ai_ci.
-- Earlier plugin repairs intentionally used utf8mb4_unicode_ci for selected
-- connection columns; align only non-secret relationship keys before migration
-- 197 creates workspace authority views. No JSON or encrypted credential
-- payload columns are modified.

ALTER TABLE user_app_connections
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci,
  MODIFY connection_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  MODIFY user_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  MODIFY tenant_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  MODIFY app_key VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  MODIFY status ENUM('active','expired','revoked','error') CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL DEFAULT 'active';

-- corrective_migration=true
-- original_migration_immutable=true
-- partial_state_safe=true
-- narrow_column_collation_alignment=true
-- whole_table_convert=false
-- binary_comparison_workaround=false
-- encrypted_payload_columns_modified=false
-- json_payload_columns_modified=false
-- same_cycle_schema_readback_required=true
-- provider_calls=false
-- external_writes=false
-- secrets_included=false
