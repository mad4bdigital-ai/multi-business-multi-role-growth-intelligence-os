-- Sprint 66: WordPress publish authority diagnostic tool.
-- Registers a read-only/dry-run diagnostic for the WordPress publish authority pilot.

INSERT INTO admin_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path, path_param_keys,
  input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES (
  'wordpress_publish_authority_diagnostic',
  'WordPress Publish Authority Diagnostic',
  'Dry-run diagnostic for WordPress publish authority. Checks brand write flag and CMS site access grant for draft/publish without resolving secrets and without sending any WordPress request.',
  'POST',
  '/wordpress/publish-authority/diagnose',
  '[]',
  '{"type":"object","additionalProperties":false,"required":["tenant_id","user_id"],"properties":{"tenant_id":{"type":"string","minLength":1},"user_id":{"type":"string","minLength":1},"connection_id":{"type":"string"},"brand_key":{"type":"string"},"target_key":{"type":"string"},"title":{"type":"string"},"content":{"type":"string"},"status":{"type":"string","enum":["draft","publish"],"default":"draft"},"publish_status":{"type":"string","enum":["draft","publish"]}},"anyOf":[{"required":["brand_key"]},{"required":["target_key"]}]}',
  NULL,
  'admin,wordpress,resource_authority,publish,dry_run,diagnostics,read_only,no_secrets',
  1,
  423
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

INSERT IGNORE INTO runtime_dispatch_certification_registry
  (certification_key, surface_key, surface_family, tool_or_action_key, risk_class, certification_status,
   smoke_strategy, dispatch_allowed, apply_allowed, requires_resource_authority, requires_dry_run,
   requires_audit_evidence, requires_readback, notes)
VALUES
  ('wordpress_publish_authority_diagnostic_v1', 'wordpress_publish_routes', 'wordpress', 'wordpress_publish_authority_diagnostic',
   'B', 'diagnostic_certified', 'dry_run_authority_probe_no_wordpress_post', 1, 0, 0, 0, 0, 0,
   'Dry-run diagnostic validates CMS site grant and publish/draft authority without credential secret read or WordPress POST.');
