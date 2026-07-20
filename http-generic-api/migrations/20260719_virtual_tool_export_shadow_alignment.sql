-- Spec 007 corrective migration: keep virtual-tool alias exports shadow-only until certification.
-- Canonical capability-export metadata only. Runtime tool catalogs and dispatch bindings are unchanged.
-- no_provider_call=true
-- no_credential_payload_read=true
-- no_raw_secrets=true
-- no_external_send=true
-- no_external_write=true
-- secrets_included=false

CREATE OR REPLACE VIEW v_platform_virtual_tool_exports_current AS
SELECT
  CONCAT('virtual_tool_export.', b.tool_key) AS export_key,
  i.resolved_capability_key AS capability_key,
  MIN(b.surface_class) AS export_surface,
  'platform_tool_dispatch_bindings' AS source_table,
  CAST(b.tool_key AS CHAR(255)) AS source_key,
  'shadow' AS export_status,
  MIN(b.scope_class) AS exposure_scope,
  NULL AS http_method,
  NULL AS http_path,
  CONCAT('Derived shadow alias export from active bindings. endpoints=', GROUP_CONCAT(DISTINCT b.endpoint_key ORDER BY b.endpoint_key SEPARATOR ',')) AS notes
FROM v_platform_virtual_tool_bindings_classified b
JOIN v_platform_virtual_tool_identity_resolution i
  ON i.tool_key = b.tool_key
 AND i.capability_count = 1
 AND i.missing_identity_count = 0
JOIN v_platform_virtual_tool_capabilities_current c
  ON c.capability_key = i.resolved_capability_key
GROUP BY b.tool_key, i.resolved_capability_key
HAVING COUNT(DISTINCT b.scope_class) = 1;

INSERT INTO platform_plugin_capability_exports
  (export_key,capability_key,export_surface,source_table,source_key,export_status,exposure_scope,http_method,http_path,notes)
SELECT export_key,capability_key,export_surface,source_table,source_key,export_status,exposure_scope,http_method,http_path,notes
FROM v_platform_virtual_tool_exports_current
ON DUPLICATE KEY UPDATE
  capability_key=VALUES(capability_key),
  export_surface=VALUES(export_surface),
  source_table=VALUES(source_table),
  source_key=VALUES(source_key),
  export_status=VALUES(export_status),
  exposure_scope=VALUES(exposure_scope),
  http_method=VALUES(http_method),
  http_path=VALUES(http_path),
  notes=VALUES(notes),
  updated_at=CURRENT_TIMESTAMP;
