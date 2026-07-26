-- Sprint 65: governed execution plan dispatch admin tool
-- Purpose: expose a controlled route for dispatching an already validated or approved execution_plan.

INSERT INTO admin_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path, path_param_keys,
  input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES (
  'execution_plan_dispatch',
  'Dispatch Execution Plan',
  'Dispatch one validated or approved execution_plans row through connectorExecutor.dispatchPlan. Intended for governed resume/draft smoke tests and audited workflow continuation. Does not accept secrets.',
  'POST',
  '/execution-plans/{plan_id}/dispatch',
  '["plan_id"]',
  '{"type":"object","additionalProperties":false,"required":["plan_id"],"properties":{"plan_id":{"type":"string","minLength":1},"apply":{"type":"boolean","default":false},"publish_status":{"type":"string","enum":["draft","publish"],"default":"draft"},"post_types":{"type":"array","items":{"type":"string"},"default":["post"]},"actor_id":{"type":"string","default":"admin:gpt"}}}',
  NULL,
  'admin,execution_plan,dispatch,state_changing,audited,no_secrets',
  1,
  421
) ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  http_method = VALUES(http_method),
  http_path = VALUES(http_path),
  path_param_keys = VALUES(path_param_keys),
  input_schema = VALUES(input_schema),
  tags = VALUES(tags),
  is_enabled = VALUES(is_enabled),
  sort_order = VALUES(sort_order);
