-- Sprint 65: widen Platform Graph taxonomy for complete execution authority coverage.
-- Covers Brand/Brand Core, Business Activity, Logic, Agent Skills, Platform Plugins,
-- Tools, Connections, Tenant Policies, and Guard/Grant concepts.

INSERT INTO `platform_graph_taxonomy`
  (`taxonomy_key`, `taxonomy_type`, `taxonomy_value`, `description`, `runtime_enforced`, `status`)
VALUES
  ('node_type.brand', 'node_type', 'brand', 'Brand runtime context node', 1, 'active'),
  ('node_type.brand_core_asset', 'node_type', 'brand_core_asset', 'Brand Core asset/readiness node', 1, 'active'),
  ('node_type.business_activity', 'node_type', 'business_activity', 'Business activity type node', 1, 'active'),
  ('node_type.logic', 'node_type', 'logic', 'Logic definition node', 1, 'active'),
  ('node_type.logic_pack', 'node_type', 'logic_pack', 'Logic pack node', 1, 'active'),
  ('node_type.agent', 'node_type', 'agent', 'Agent runtime identity node', 1, 'active'),
  ('node_type.skill', 'node_type', 'skill', 'Agent skill capability node', 1, 'active'),
  ('node_type.plugin', 'node_type', 'plugin', 'Platform Plugin / app integration node', 1, 'active'),
  ('node_type.tool', 'node_type', 'tool', 'Governed admin/tenant/system tool node', 1, 'active'),
  ('node_type.connection', 'node_type', 'connection', 'User or tenant app connection metadata node', 1, 'active'),
  ('node_type.tenant_policy', 'node_type', 'tenant_policy', 'Tenant integration policy node', 1, 'active'),
  ('node_type.action_grant', 'node_type', 'action_grant', 'App action grant node', 1, 'active'),
  ('node_type.action_request', 'node_type', 'action_request', 'App action request/approval node', 1, 'active'),
  ('edge_type.has_brand_core', 'edge_type', 'has_brand_core', 'Brand has Brand Core asset edge', 1, 'active'),
  ('edge_type.has_business_type', 'edge_type', 'has_business_type', 'Brand maps to business type edge', 1, 'active'),
  ('edge_type.has_business_activity', 'edge_type', 'has_business_activity', 'Business type has activity edge', 1, 'active'),
  ('edge_type.requires_brand_core', 'edge_type', 'requires_brand_core', 'Activity/workflow/action requires Brand Core edge', 1, 'active'),
  ('edge_type.uses_logic', 'edge_type', 'uses_logic', 'Workflow/agent/pack uses logic edge', 1, 'active'),
  ('edge_type.grants_skill', 'edge_type', 'grants_skill', 'Agent has granted skill edge', 1, 'active'),
  ('edge_type.bound_to_workflow', 'edge_type', 'bound_to_workflow', 'Agent or runtime binding to workflow edge', 1, 'active'),
  ('edge_type.binds_action', 'edge_type', 'binds_action', 'Plugin binds action edge', 1, 'active'),
  ('edge_type.binds_tool', 'edge_type', 'binds_tool', 'Plugin binds tool edge', 1, 'active'),
  ('edge_type.allows_plugin', 'edge_type', 'allows_plugin', 'Tenant policy allows plugin edge', 1, 'active'),
  ('edge_type.connects_plugin', 'edge_type', 'connects_plugin', 'Connection links user/tenant to plugin edge', 1, 'active'),
  ('edge_type.grants_action', 'edge_type', 'grants_action', 'Connection/agent grant allows action edge', 1, 'active'),
  ('edge_type.requests_action', 'edge_type', 'requests_action', 'Connection/agent requested action approval edge', 1, 'active'),
  ('edge_type.has_guard', 'edge_type', 'has_guard', 'Execution manifest/guard relationship edge', 1, 'active')
ON DUPLICATE KEY UPDATE
  `taxonomy_type` = VALUES(`taxonomy_type`),
  `taxonomy_value` = VALUES(`taxonomy_value`),
  `description` = VALUES(`description`),
  `runtime_enforced` = VALUES(`runtime_enforced`),
  `status` = VALUES(`status`),
  `updated_at` = CURRENT_TIMESTAMP;
