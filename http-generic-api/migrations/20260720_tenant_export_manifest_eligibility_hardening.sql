-- Tenant capability-export manifest-eligibility hardening.
-- Exportable current manifest statuses: shadow_ready, active, certified.
-- Registry/view/trigger changes only; no provider call, credential payload,
-- raw secret, external write, destructive delete, or manifest activation.

CREATE OR REPLACE VIEW v_platform_exports_current AS
SELECT
  CONCAT('admin_tool_export.', t.tool_key) AS export_key,
  CONCAT('admin_tool.', t.tool_key) AS capability_key,
  'admin_platform_tool' AS export_surface,
  'admin_platform_endpoint_tools' AS source_table,
  CAST(t.tool_key AS CHAR(255)) AS source_key,
  CASE WHEN t.is_enabled = 1 THEN 'active' ELSE 'disabled' END AS export_status,
  'admin' AS exposure_scope,
  t.http_method,
  t.http_path,
  t.description AS notes
FROM admin_platform_endpoint_tools t
UNION ALL
SELECT
  CONCAT('tenant_tool_export.', t.tool_key) AS export_key,
  CONCAT('tenant_tool.', t.tool_key) AS capability_key,
  'tenant_platform_tool' AS export_surface,
  'tenant_platform_endpoint_tools' AS source_table,
  CAST(t.tool_key AS CHAR(255)) AS source_key,
  CASE
    WHEN t.is_enabled = 1
      AND EXISTS (
        SELECT 1
        FROM platform_capability_compiled_manifests m
        WHERE m.capability_key = CONCAT('tenant_tool.', t.tool_key)
          AND m.is_current = 1
          AND m.status IN ('shadow_ready', 'active', 'certified')
      )
    THEN 'active'
    ELSE 'disabled'
  END AS export_status,
  'tenant' AS exposure_scope,
  t.http_method,
  t.http_path,
  t.description AS notes
FROM tenant_platform_endpoint_tools t
UNION ALL
SELECT
  CONCAT('resource_authority_route_family_export.', r.route_family_key) AS export_key,
  CONCAT('resource_authority_route_family.', r.route_family_key) AS capability_key,
  'resource_authority_route_family' AS export_surface,
  'resource_authority_route_family_registry' AS source_table,
  CAST(r.route_family_key AS CHAR(255)) AS source_key,
  CASE WHEN r.apply_allowed_default = 1 THEN 'active' ELSE 'disabled' END AS export_status,
  'internal' AS exposure_scope,
  NULL AS http_method,
  r.runtime_surface AS http_path,
  r.notes
FROM resource_authority_route_family_registry r
UNION ALL
SELECT
  CONCAT('runtime_dispatch_certification_export.', c.certification_key) AS export_key,
  CONCAT('runtime_dispatch_certification.', c.certification_key) AS capability_key,
  'runtime_dispatch_certification' AS export_surface,
  'runtime_dispatch_certification_registry' AS source_table,
  CAST(c.certification_key AS CHAR(255)) AS source_key,
  CASE WHEN c.dispatch_allowed = 1 THEN 'active' ELSE 'disabled' END AS export_status,
  'internal' AS exposure_scope,
  NULL AS http_method,
  c.surface_key AS http_path,
  c.notes
FROM runtime_dispatch_certification_registry c;

UPDATE platform_plugin_capability_exports e
LEFT JOIN platform_capability_compiled_manifests m
  ON m.capability_key = e.capability_key
 AND m.is_current = 1
SET e.export_status = 'disabled',
    e.notes = CASE
      WHEN LOCATE('[disabled: current capability manifest not exportable]', COALESCE(e.notes, '')) = 0
        THEN CONCAT(COALESCE(e.notes, ''), ' [disabled: current capability manifest not exportable]')
      ELSE e.notes
    END,
    e.updated_at = CURRENT_TIMESTAMP
WHERE e.exposure_scope = 'tenant'
  AND e.export_surface = 'tenant_platform_tool'
  AND e.source_table = 'tenant_platform_endpoint_tools'
  AND e.export_status = 'active'
  AND (m.capability_key IS NULL OR m.status NOT IN ('shadow_ready', 'active', 'certified'));

CREATE OR REPLACE TRIGGER trg_tenant_export_manifest_guard_before_insert
BEFORE INSERT ON platform_plugin_capability_exports
FOR EACH ROW
SET
  NEW.notes = CASE
    WHEN NEW.exposure_scope = 'tenant'
      AND NEW.export_surface = 'tenant_platform_tool'
      AND NEW.source_table = 'tenant_platform_endpoint_tools'
      AND NEW.export_status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM platform_capability_compiled_manifests m
        WHERE m.capability_key = NEW.capability_key
          AND m.is_current = 1
          AND m.status IN ('shadow_ready', 'active', 'certified')
      )
    THEN CASE
      WHEN LOCATE('[disabled: current capability manifest not exportable]', COALESCE(NEW.notes, '')) = 0
        THEN CONCAT(COALESCE(NEW.notes, ''), ' [disabled: current capability manifest not exportable]')
      ELSE NEW.notes
    END
    ELSE NEW.notes
  END,
  NEW.export_status = CASE
    WHEN NEW.exposure_scope = 'tenant'
      AND NEW.export_surface = 'tenant_platform_tool'
      AND NEW.source_table = 'tenant_platform_endpoint_tools'
      AND NEW.export_status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM platform_capability_compiled_manifests m
        WHERE m.capability_key = NEW.capability_key
          AND m.is_current = 1
          AND m.status IN ('shadow_ready', 'active', 'certified')
      )
    THEN 'disabled'
    ELSE NEW.export_status
  END;

CREATE OR REPLACE TRIGGER trg_tenant_export_manifest_guard_before_update
BEFORE UPDATE ON platform_plugin_capability_exports
FOR EACH ROW
SET
  NEW.notes = CASE
    WHEN NEW.exposure_scope = 'tenant'
      AND NEW.export_surface = 'tenant_platform_tool'
      AND NEW.source_table = 'tenant_platform_endpoint_tools'
      AND NEW.export_status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM platform_capability_compiled_manifests m
        WHERE m.capability_key = NEW.capability_key
          AND m.is_current = 1
          AND m.status IN ('shadow_ready', 'active', 'certified')
      )
    THEN CASE
      WHEN LOCATE('[disabled: current capability manifest not exportable]', COALESCE(NEW.notes, '')) = 0
        THEN CONCAT(COALESCE(NEW.notes, ''), ' [disabled: current capability manifest not exportable]')
      ELSE NEW.notes
    END
    ELSE NEW.notes
  END,
  NEW.export_status = CASE
    WHEN NEW.exposure_scope = 'tenant'
      AND NEW.export_surface = 'tenant_platform_tool'
      AND NEW.source_table = 'tenant_platform_endpoint_tools'
      AND NEW.export_status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM platform_capability_compiled_manifests m
        WHERE m.capability_key = NEW.capability_key
          AND m.is_current = 1
          AND m.status IN ('shadow_ready', 'active', 'certified')
      )
    THEN 'disabled'
    ELSE NEW.export_status
  END;

CREATE OR REPLACE TRIGGER trg_tenant_export_manifest_guard_after_manifest_insert
AFTER INSERT ON platform_capability_compiled_manifests
FOR EACH ROW
UPDATE platform_plugin_capability_exports e
SET e.export_status = 'disabled',
    e.notes = CASE
      WHEN LOCATE('[disabled: current capability manifest not exportable]', COALESCE(e.notes, '')) = 0
        THEN CONCAT(COALESCE(e.notes, ''), ' [disabled: current capability manifest not exportable]')
      ELSE e.notes
    END,
    e.updated_at = CURRENT_TIMESTAMP
WHERE NEW.is_current = 1
  AND LEFT(NEW.capability_key, CHAR_LENGTH('tenant_tool.')) = 'tenant_tool.'
  AND NEW.status NOT IN ('shadow_ready', 'active', 'certified')
  AND e.capability_key = NEW.capability_key
  AND e.exposure_scope = 'tenant'
  AND e.export_surface = 'tenant_platform_tool'
  AND e.source_table = 'tenant_platform_endpoint_tools'
  AND e.export_status = 'active';

CREATE OR REPLACE TRIGGER trg_tenant_export_manifest_guard_after_manifest_update
AFTER UPDATE ON platform_capability_compiled_manifests
FOR EACH ROW
UPDATE platform_plugin_capability_exports e
SET e.export_status = 'disabled',
    e.notes = CASE
      WHEN LOCATE('[disabled: current capability manifest not exportable]', COALESCE(e.notes, '')) = 0
        THEN CONCAT(COALESCE(e.notes, ''), ' [disabled: current capability manifest not exportable]')
      ELSE e.notes
    END,
    e.updated_at = CURRENT_TIMESTAMP
WHERE NEW.is_current = 1
  AND LEFT(NEW.capability_key, CHAR_LENGTH('tenant_tool.')) = 'tenant_tool.'
  AND NEW.status NOT IN ('shadow_ready', 'active', 'certified')
  AND e.capability_key = NEW.capability_key
  AND e.exposure_scope = 'tenant'
  AND e.export_surface = 'tenant_platform_tool'
  AND e.source_table = 'tenant_platform_endpoint_tools'
  AND e.export_status = 'active';

CREATE OR REPLACE TRIGGER trg_tenant_export_manifest_guard_after_manifest_delete
AFTER DELETE ON platform_capability_compiled_manifests
FOR EACH ROW
UPDATE platform_plugin_capability_exports e
SET e.export_status = 'disabled',
    e.notes = CASE
      WHEN LOCATE('[disabled: current capability manifest not exportable]', COALESCE(e.notes, '')) = 0
        THEN CONCAT(COALESCE(e.notes, ''), ' [disabled: current capability manifest not exportable]')
      ELSE e.notes
    END,
    e.updated_at = CURRENT_TIMESTAMP
WHERE OLD.is_current = 1
  AND LEFT(OLD.capability_key, CHAR_LENGTH('tenant_tool.')) = 'tenant_tool.'
  AND e.capability_key = OLD.capability_key
  AND e.exposure_scope = 'tenant'
  AND e.export_surface = 'tenant_platform_tool'
  AND e.source_table = 'tenant_platform_endpoint_tools'
  AND e.export_status = 'active';
