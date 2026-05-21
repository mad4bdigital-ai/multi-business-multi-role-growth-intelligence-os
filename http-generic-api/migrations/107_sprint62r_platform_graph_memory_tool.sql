-- Sprint 62r: expose graph-powered memory retrieval through governed admin tool registry
-- Completes the Platform Graph Runtime vertical slice by routing scoped memory lookup through /gpt/tools/call.

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`,
  `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES (
  'platform_graph_memory',
  'Resolve Platform Graph Memory',
  'Resolve graph-scoped JSON memory assets for tenant/user/device/asset/intent/route/workflow/action/endpoint/business type. Returns summary-only memory; never raw JSON payloads or secrets.',
  'POST',
  '/platform/graph/memory',
  NULL,
  '{"type":"object","properties":{"node_id":{"type":"string"},"subject_type":{"type":"string"},"subject_ref":{"type":"string"},"tenant_id":{"type":"string"},"user_id":{"type":"string"},"device_id":{"type":"string"},"asset_id":{"type":"string"},"intent_key":{"type":"string"},"route_id":{"type":"string"},"workflow_key":{"type":"string"},"action_key":{"type":"string"},"endpoint_key":{"type":"string"},"business_type_key":{"type":"string"},"depth":{"type":"integer"},"limit":{"type":"integer"},"memory_limit":{"type":"integer"}}}',
  NULL,
  'admin,platform-graph,memory,diagnostics,read_only',
  1,
  3106
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
