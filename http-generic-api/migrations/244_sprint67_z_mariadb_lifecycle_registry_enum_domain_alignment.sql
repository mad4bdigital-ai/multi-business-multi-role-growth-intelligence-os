-- Align lifecycle registry enum domains before the first ordered writes that use
-- the newer registry semantics. Existing values are preserved verbatim.
-- Additive metadata-domain alignment only; no table lifecycle action is executed.

ALTER TABLE database_table_lifecycle_registry
  MODIFY COLUMN authority_model ENUM(
    'canonical','derived','mirror','legacy','transitional',
    'append_only','append_only_receipt','registry_primary'
  ) NOT NULL DEFAULT 'canonical',
  MODIFY COLUMN usage_status ENUM(
    'runtime_canonical','runtime_derived','runtime_registry','runtime_log',
    'runtime_unclassified','audit_log','session_log','telemetry_log',
    'backup_snapshot','repair_snapshot','planned_placeholder','deprecated',
    'archive_candidate','manual_review','runtime_audit','active'
  ) NOT NULL DEFAULT 'manual_review',
  MODIFY COLUMN write_strategy ENUM(
    'platform_primary','legacy_primary','dual_write','read_only','platform_only','append_only'
  ) NOT NULL DEFAULT 'platform_primary';
