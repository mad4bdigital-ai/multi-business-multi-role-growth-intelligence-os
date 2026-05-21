-- Sprint 62q: expose platform graph runtime through governed admin tool registry
-- Keeps the graph API callable through /gpt/tools/call instead of relying on ad-hoc route calls.

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`,
  `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
(
  'platform_graph_project',
  'Project Platform Graph',
  'Project platform registry/source tables into the SQL-primary graph. Advisory-first; admin only.',
  'POST',
  '/platform/graph/project',
  NULL,
  '{"type":"object","properties":{"projection_key":{"type":"string"},"dry_run":{"type":"boolean"}}}',
  NULL,
  'admin,platform-graph,state_changing,audited',
  1,
  3100
),
(
  'platform_graph_validate',
  'Validate Platform Graph',
  'Validate graph node/edge integrity and secret-safety constraints.',
  'GET',
  '/platform/graph/validate',
  NULL,
  '{"type":"object","properties":{}}',
  NULL,
  'admin,platform-graph,diagnostics,read_only',
  1,
  3101
),
(
  'platform_graph_resolve_context',
  'Resolve Platform Graph Context',
  'Resolve graph context for tenant/user/device/asset/intent/route/workflow/action/endpoint/business type.',
  'POST',
  '/platform/graph/resolve-context',
  NULL,
  '{"type":"object","properties":{"node_id":{"type":"string"},"subject_type":{"type":"string"},"subject_ref":{"type":"string"},"tenant_id":{"type":"string"},"user_id":{"type":"string"},"device_id":{"type":"string"},"asset_id":{"type":"string"},"intent_key":{"type":"string"},"route_id":{"type":"string"},"workflow_key":{"type":"string"},"action_key":{"type":"string"},"endpoint_key":{"type":"string"},"business_type_key":{"type":"string"},"depth":{"type":"integer"},"limit":{"type":"integer"}}}',
  NULL,
  'admin,platform-graph,diagnostics,read_only',
  1,
  3102
),
(
  'platform_graph_node_get',
  'Get Platform Graph Node',
  'Read one platform graph node by node_id.',
  'GET',
  '/platform/graph/node/{node_id}',
  '["node_id"]',
  '{"type":"object","required":["node_id"],"properties":{"node_id":{"type":"string"}}}',
  NULL,
  'admin,platform-graph,diagnostics,read_only',
  1,
  3103
),
(
  'platform_graph_neighborhood',
  'Get Platform Graph Neighborhood',
  'Read the graph neighborhood around one or more node IDs.',
  'GET',
  '/platform/graph/neighborhood',
  NULL,
  '{"type":"object","properties":{"node_id":{"type":"string"},"node_ids":{"type":"string"},"depth":{"type":"integer"},"limit":{"type":"integer"}}}',
  NULL,
  'admin,platform-graph,diagnostics,read_only',
  1,
  3104
),
(
  'platform_graph_status',
  'Get Platform Graph Status',
  'Get graph node/edge counts and latest projection/validation status.',
  'GET',
  '/platform/graph/status',
  NULL,
  '{"type":"object","properties":{}}',
  NULL,
  'admin,platform-graph,diagnostics,read_only',
  1,
  3105
)
ON DUPLICATE KEY UPDATE
  `display_name` = VALUES(`display_name`),
  `description` = VALUES(`description`),
  `http_method` = VALUES(`http_method`),
  `http_path` = VALUES(`http_path`),
  `path_param_keys` = VALUES(`path_param_keys`),
  `input_schema` = VALUES(`input_schema`),
  `tags` = VALUES(`tags`),
  `is_enabled` = VALUES(`is_enabled`),
  `sort_order` = VALUES(`sort_order`);
