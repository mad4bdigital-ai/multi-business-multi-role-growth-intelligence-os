-- Sprint 67: align the repository authority relationship key before the
-- 20260725 readiness repair joins it to connected_systems.
-- Only the non-secret system relationship key is changed; metadata_json,
-- credential_ref, and all provider payloads remain untouched.

ALTER TABLE repository_authority_bindings
  MODIFY system_id VARCHAR(36)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL;

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
