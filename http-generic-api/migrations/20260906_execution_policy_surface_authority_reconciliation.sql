-- Staging/runtime execution-policy surface authority reconciliation.
--
-- The runtime resolver uses `surface.execution_policy_registry_sheet`, while
-- older schema history seeded `surface.execution_policy_sheet` and migration
-- 194 only updated the canonical key when it already existed.
--
-- Keep the repair additive and idempotent. The legacy row is left untouched
-- for historical traceability; no provider, Production, secret, or grant
-- mutation is performed here.

INSERT INTO `registry_surfaces_catalog`
  (`surface_id`, `logical_surface_key`, `surface_name`, `surface_type`, `surface_scope`,
   `storage_type`, `active_status`, `authority_status`, `required_for_execution`,
   `resolution_rule`, `owner_layer`, `schema_ref`, `schema_version`, `binding_mode`,
   `sheet_role`, `backend_type`, `backend_adapter`, `authority_model`, `portability_class`,
   `repair_candidate_types`, `repair_priority`, `notes`, `created_at`, `updated_at`)
VALUES
  ('surface.execution_policy_registry_sheet',
   'surface.execution_policy_registry_sheet',
   'Execution Policy Registry',
   'execution_policy_registry',
   'runtime',
   'sql_table',
   'active',
   'authoritative',
   'TRUE',
   'sql_primary',
   'governance_validation_engine',
   'execution_policies',
   'v1',
   'sql_runtime_authority',
   'execution_policy_registry',
   'sql',
   'governance_validation_engine.execution_policies',
   'sql_runtime_authority',
   'runtime_policy',
   'surface_authority|runtime_policy_preflight',
   'high',
   'Canonical SQL runtime authority for governed execution policy preflight.',
   NOW(),
   NOW())
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
