-- Sprint 68: MariaDB activation authorized-surface join-key collation alignment.
-- Migration 271 creates activation readback views that compare relationship keys
-- across the legacy app-integration tables. Earlier ordered repairs leave
-- user_app_connections on utf8mb4_unicode_ci while app_action_grants may retain
-- the MariaDB uca1400 default, which fails closed at CREATE VIEW with ER 1267.
-- Align only non-secret relationship keys before the first 271 view. No JSON,
-- encrypted credential, token, or secret payload columns are modified.

ALTER TABLE `app_integrations`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY `app_key` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;

ALTER TABLE `user_app_connections`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY `connection_id` VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY `app_key` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;

ALTER TABLE `app_action_grants`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY `connection_id` VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY `app_key` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;

ALTER TABLE `tenant_integration_policies`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY `app_key` VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;

ALTER TABLE `workflows`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY `workflow_key` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL;

ALTER TABLE `workflow_runtime_bindings`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY `workflow_key` VARCHAR(190) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;

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
