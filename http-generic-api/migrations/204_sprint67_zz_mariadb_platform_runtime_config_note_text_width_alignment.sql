-- Sprint 67: MariaDB text-width alignment for platform runtime audit notes.
-- The original platform_runtime_config.note contract is VARCHAR(255), while
-- ordered policy writers append lossless audit text. Widen before the first
-- append/long-note writer; no provider call, credential read, or data export.

ALTER TABLE platform_runtime_config
  MODIFY COLUMN note TEXT NULL;

ALTER TABLE execution_policies
  MODIFY COLUMN execution_scope TEXT NULL,
  MODIFY COLUMN affects_layer TEXT NULL;
