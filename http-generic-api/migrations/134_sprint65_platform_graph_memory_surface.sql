-- Sprint 65: Platform Graph memory surface authority.
-- Registers platform_graph_nodes/platform_graph_edges as a required SQL-backed
-- memory graph surface for governed runtime graph writes.

INSERT INTO `registry_surfaces_catalog`
  (`surface_id`, `logical_surface_key`, `surface_name`, `surface_type`, `surface_scope`,
   `storage_type`, `active_status`, `authority_status`, `required_for_execution`,
   `resolution_rule`, `owner_layer`, `schema_ref`, `schema_version`, `binding_mode`,
   `sheet_role`, `backend_type`, `backend_adapter`, `authority_model`, `portability_class`,
   `repair_candidate_types`, `repair_priority`, `notes`, `created_at`, `updated_at`)
VALUES
  ('surface.platform_graph_memory', 'surface.platform_graph_memory', 'Platform Graph Memory',
   'runtime_memory_graph', 'runtime', 'sql_tables', 'active', 'authoritative', 'TRUE',
   'sql_primary', 'memory_graph_runtime', 'platform_graph_nodes|platform_graph_edges', '1',
   'sql_runtime_authority', 'memory_graph_nodes_edges', 'sql', 'platform_graph_memory_writer',
   'sql_runtime_authority', 'runtime_memory_graph', 'surface_authority|readback|graph_integrity',
   'high', 'Required execution surface for governed memory graph writes to platform_graph_nodes and platform_graph_edges.',
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
