-- Forward-only catalog metadata reconciliation. Never re-run legacy seed migrations.
-- Governed migration only, after exact Staging schema readiness; no live device, token or route mutation.
-- Keeps Admin MCP discovery aligned with the runtime's fail-closed canonical resolver.

UPDATE admin_platform_endpoint_tools
   SET description = 'Authenticated Admin-only installer metadata or protected BAT download for one fresh active canonical device in the exact user/tenant scope. No default hostname, fuzzy alias, cross-device credential fallback, public artifact or database credential write.',
       input_schema = JSON_OBJECT(
         'type', 'object',
         'properties', JSON_OBJECT(
           'user_id', JSON_OBJECT('type','string', 'description','Target user; platform admin is default only for platform-admin operations.'),
           'tenant_id', JSON_OBJECT('type','string', 'description','Tenant scope; required for a non-platform user if absent from signed identity.'),
           'device_id', JSON_OBJECT('type','string', 'description','Canonical device ID. Optional only when exactly one fresh active scoped device is found.'),
           'format', JSON_OBJECT('type','string', 'enum',JSON_ARRAY('json','bat'), 'description','json returns no-secret handoff; bat requires protected credential access.')
         )),
       updated_at = NOW()
 WHERE tool_key = 'local_connector_install_bundle';

UPDATE admin_platform_endpoint_tools
   SET description = 'Admin read/diagnose and protected repair handoff of a fresh active canonical Local Connector device. Exact tenant/user identity, lifecycle, heartbeat and no-secret credential isolation are required. Historical aliases and stale devices never become implicit targets. No global credential fallback or automatic installer publishing.',
       input_schema = JSON_OBJECT(
         'type', 'object',
         'properties', JSON_OBJECT(
           'user_id', JSON_OBJECT('type','string', 'description','Target user; use authenticated identity where present.'),
           'tenant_id', JSON_OBJECT('type','string', 'description','Exact tenant scope; required for non-platform users.'),
           'device_id', JSON_OBJECT('type','string', 'description','Optional canonical device ID; no historical device aliases or stale automatic selection.')
         )),
       updated_at = NOW()
 WHERE tool_key = 'local_connector_self_repair';


-- Dynamic Admin discovery of the read-only inventory. Runtime still applies the
-- authenticated user/tenant barrier and strips all credential values.
INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path,
   path_param_keys, input_schema, fixed_body, tags, sort_order)
VALUES
  ('admin_local_connector_devices', 'List Admin Connector Devices',
   'Read-only scoped canonical connector inventory with lifecycle and heartbeat status. Never returns secrets or implies that a historical alias is currently connected.',
   'GET', '/admin/cli/local-connector/devices', NULL,
   JSON_OBJECT(
     'type', 'object',
     'properties', JSON_OBJECT(
       'user_id', JSON_OBJECT('type','string', 'description','Scoped user, derived from identity where available.'),
       'tenant_id', JSON_OBJECT('type','string', 'description','Required explicit tenant for non-platform admin scope.')
     )),
   NULL, 'admin,local_connector,inventory,read_only', 66)
ON DUPLICATE KEY UPDATE
  description = VALUES(description),
  http_method = VALUES(http_method),
  http_path = VALUES(http_path),
  input_schema = VALUES(input_schema),
  tags = VALUES(tags),
  updated_at = NOW();
