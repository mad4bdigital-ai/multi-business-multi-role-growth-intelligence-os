-- Sprint 68: Dynamic Capability Tool Bus kernel alignment
--
-- Purpose:
--   - Keep /system/tools/call as a kernel dispatcher, not a DB-registered
--     tenant wrapper target.
--   - Disable active tenant manual tools that recursively dispatch into
--     /system/tools/call or /gpt/tools/call.
--   - Register the runtime_endpoint_call kernel surface for capability audit.
--   - Add a v2 export compatibility view that includes platform_endpoint_tool_exports.
--
-- This migration does not expose secrets and does not execute providers.

UPDATE tenant_platform_endpoint_tools
   SET is_enabled = 0,
       description = CONCAT(
         COALESCE(description, ''),
         ' [disabled: Dynamic Capability Tool Bus kernel policy forbids tenant manual tools from recursively dispatching into /system/tools/call or /gpt/tools/call; use the direct system-layer callTool surface instead]'
       ),
       tags = CONCAT(COALESCE(tags, ''), ',disabled,self_recursive_dispatch_blocked,tool_bus_kernel')
 WHERE is_enabled = 1
   AND http_path IN ('/system/tools/call', '/gpt/tools/call');

INSERT INTO runtime_dispatch_certification_registry (
  certification_key,
  surface_key,
  surface_family,
  tool_or_action_key,
  risk_class,
  certification_status,
  smoke_strategy,
  dispatch_allowed,
  apply_allowed,
  requires_resource_authority,
  requires_dry_run,
  requires_audit_evidence,
  requires_readback,
  last_evidence_ref,
  last_certified_at,
  notes
) VALUES (
  'runtime_endpoint_call_kernel_v1',
  'runtime_endpoint_call',
  'system_tool_bus',
  'runtime_endpoint_call',
  'C',
  'kernel_dispatch_registered_policy_guarded',
  'direct_system_tool_call_preserves_principal_and_brand_target_fields',
  1,
  0,
  1,
  1,
  1,
  1,
  'pr:dynamic-capability-tool-bus-v2',
  CURRENT_TIMESTAMP,
  'runtime_endpoint_call is a kernel system-layer dispatcher. Provider writes remain governed by endpoint/export policy, resource authority, capability envelopes, dry-run, audit, and readback gates.'
)
ON DUPLICATE KEY UPDATE
  surface_key = VALUES(surface_key),
  surface_family = VALUES(surface_family),
  tool_or_action_key = VALUES(tool_or_action_key),
  risk_class = VALUES(risk_class),
  certification_status = VALUES(certification_status),
  smoke_strategy = VALUES(smoke_strategy),
  dispatch_allowed = VALUES(dispatch_allowed),
  apply_allowed = VALUES(apply_allowed),
  requires_resource_authority = VALUES(requires_resource_authority),
  requires_dry_run = VALUES(requires_dry_run),
  requires_audit_evidence = VALUES(requires_audit_evidence),
  requires_readback = VALUES(requires_readback),
  last_evidence_ref = VALUES(last_evidence_ref),
  last_certified_at = VALUES(last_certified_at),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

CREATE OR REPLACE VIEW v_platform_exports_current_v2 AS
SELECT
  CONCAT('admin_tool_export.', t.tool_key) AS export_key,
  CONCAT('admin_tool.', t.tool_key) AS capability_key,
  'admin_platform_tool' AS export_surface,
  'admin_platform_endpoint_tools' AS source_table,
  CAST(t.tool_key AS CHAR(255)) AS source_key,
  CASE WHEN t.is_enabled = 1 THEN 'active' ELSE 'disabled' END AS export_status,
  'admin' AS exposure_scope,
  t.http_method AS http_method,
  t.http_path AS http_path,
  t.description AS notes
FROM admin_platform_endpoint_tools t
UNION ALL
SELECT
  CONCAT('tenant_tool_export.', t.tool_key) AS export_key,
  CONCAT('tenant_tool.', t.tool_key) AS capability_key,
  'tenant_platform_tool' AS export_surface,
  'tenant_platform_endpoint_tools' AS source_table,
  CAST(t.tool_key AS CHAR(255)) AS source_key,
  CASE WHEN t.is_enabled = 1 THEN 'active' ELSE 'disabled' END AS export_status,
  'tenant' AS exposure_scope,
  t.http_method AS http_method,
  t.http_path AS http_path,
  t.description AS notes
FROM tenant_platform_endpoint_tools t
UNION ALL
SELECT
  CONCAT('platform_endpoint_tool_export.', x.export_key) AS export_key,
  CONCAT('platform_endpoint_tool.', x.tool_name) AS capability_key,
  'platform_endpoint_tool_export' AS export_surface,
  'platform_endpoint_tool_exports' AS source_table,
  CAST(x.export_key AS CHAR(255)) AS source_key,
  x.status AS export_status,
  x.scope_class AS exposure_scope,
  e.method AS http_method,
  e.endpoint_path_or_function AS http_path,
  x.notes AS notes
FROM platform_endpoint_tool_exports x
LEFT JOIN endpoints e
  ON e.parent_action_key = x.parent_action_key
 AND e.endpoint_key = x.endpoint_key;
