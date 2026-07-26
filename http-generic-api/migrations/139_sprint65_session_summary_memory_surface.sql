-- Sprint 65: Session Summary memory surface authority.
-- Registers session_summaries as a required SQL-backed memory surface for
-- governed session-summary writes and graph-backed memory reads.

INSERT INTO `registry_surfaces_catalog`
  (`surface_id`, `logical_surface_key`, `surface_name`, `surface_type`, `surface_scope`,
   `storage_type`, `active_status`, `authority_status`, `required_for_execution`,
   `resolution_rule`, `owner_layer`, `schema_ref`, `schema_version`, `binding_mode`,
   `sheet_role`, `backend_type`, `backend_adapter`, `authority_model`, `portability_class`,
   `repair_candidate_types`, `repair_priority`, `notes`, `created_at`, `updated_at`)
VALUES
  ('surface.session_summary_memory', 'surface.session_summary_memory', 'Session Summary Memory',
   'runtime_memory_summary', 'runtime', 'sql_table', 'active', 'authoritative', 'TRUE',
   'sql_primary', 'session_summary_runtime', 'session_summaries', '1',
   'sql_runtime_authority', 'summary_memory_rows', 'sql', 'sessionSummaryService',
   'sql_runtime_authority', 'runtime_memory_summary', 'surface_authority|summary_readback|graph_integrity',
   'high', 'Required execution surface for governed writes and graph-backed reads of session_summaries.',
   NOW(), NOW())
ON DUPLICATE KEY UPDATE
  `logical_surface_key` = VALUES(`logical_surface_key`),
  `surface_name` = VALUES(`surface_name`),
  `surface_type` = VALUES(`surface_type`),
  `surface_scope` = VALUES(`surface_scope`),
  `storage_type` = VALUES(`storage_type`),
  `active_status` = 'active',
  `authority_status` = 'authoritative',
  `required_for_execution` = 'TRUE',
  `resolution_rule` = VALUES(`resolution_rule`),
  `owner_layer` = VALUES(`owner_layer`),
  `schema_ref` = VALUES(`schema_ref`),
  `schema_version` = VALUES(`schema_version`),
  `binding_mode` = VALUES(`binding_mode`),
  `sheet_role` = VALUES(`sheet_role`),
  `backend_type` = VALUES(`backend_type`),
  `backend_adapter` = VALUES(`backend_adapter`),
  `authority_model` = VALUES(`authority_model`),
  `portability_class` = VALUES(`portability_class`),
  `repair_candidate_types` = VALUES(`repair_candidate_types`),
  `repair_priority` = VALUES(`repair_priority`),
  `notes` = VALUES(`notes`),
  `updated_at` = NOW();
