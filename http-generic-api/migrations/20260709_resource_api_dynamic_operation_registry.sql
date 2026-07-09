-- Dynamic Resource API operation registry seeds.
-- Source authority: platform_data_table_registry.
-- This keeps operation rows generated from DB resource rows instead of hardcoding per-resource code.

INSERT INTO platform_resource_operation_registry
  (operation_id, resource_key, actor_scope, operation_key, http_method, http_path, implementation_status, route_file, tool_key, readback_required, permissions_required, status)
SELECT
  CONCAT('resource_', table_key, '_admin_list'),
  table_key,
  'admin',
  'list',
  'GET',
  '/admin/resources/{resourceKey}',
  'active',
  'routes/resourceApiRoutes.js',
  'platform_resource_list',
  1,
  0,
  'active'
FROM platform_data_table_registry
WHERE status='active' AND enabled_surfaces_json LIKE '%"admin"%'
UNION ALL
SELECT CONCAT('resource_', table_key, '_admin_read'), table_key, 'admin', 'read', 'GET', '/admin/resources/{resourceKey}/{resourceId}', 'active', 'routes/resourceApiRoutes.js', 'platform_resource_get', 1, 0, 'active'
FROM platform_data_table_registry
WHERE status='active' AND enabled_surfaces_json LIKE '%"admin"%'
UNION ALL
SELECT CONCAT('resource_', table_key, '_admin_permissions'), table_key, 'admin', 'permissions', 'GET', '/admin/resources/{resourceKey}/{resourceId}/permissions', 'active', 'routes/resourceApiRoutes.js', 'platform_resource_permissions_get', 1, 0, 'active'
FROM platform_data_table_registry
WHERE status='active' AND enabled_surfaces_json LIKE '%"admin"%'
UNION ALL
SELECT CONCAT('resource_', table_key, '_admin_changes'), table_key, 'admin', 'changes', 'GET', '/admin/resources/{resourceKey}/{resourceId}/changes', 'active', 'routes/resourceApiRoutes.js', 'platform_resource_changes_list', 1, 0, 'active'
FROM platform_data_table_registry
WHERE status='active' AND enabled_surfaces_json LIKE '%"admin"%'
UNION ALL
SELECT CONCAT('resource_', table_key, '_tenant_list'), table_key, 'tenant', 'list', 'GET', '/me/workspaces/{tenant_id}/resources/{resourceKey}', 'active', 'routes/resourceApiRoutes.js', 'tenant_resource_list', 1, 0, 'active'
FROM platform_data_table_registry
WHERE status='active' AND enabled_surfaces_json LIKE '%"tenant"%'
UNION ALL
SELECT CONCAT('resource_', table_key, '_tenant_read'), table_key, 'tenant', 'read', 'GET', '/me/workspaces/{tenant_id}/resources/{resourceKey}/{resourceId}', 'active', 'routes/resourceApiRoutes.js', 'tenant_resource_get', 1, 0, 'active'
FROM platform_data_table_registry
WHERE status='active' AND enabled_surfaces_json LIKE '%"tenant"%'
UNION ALL
SELECT CONCAT('resource_', table_key, '_tenant_permissions'), table_key, 'tenant', 'permissions', 'GET', '/me/workspaces/{tenant_id}/resources/{resourceKey}/{resourceId}/permissions', 'active', 'routes/resourceApiRoutes.js', 'tenant_resource_permissions_get', 1, 0, 'active'
FROM platform_data_table_registry
WHERE status='active' AND enabled_surfaces_json LIKE '%"tenant"%'
UNION ALL
SELECT CONCAT('resource_', table_key, '_tenant_changes'), table_key, 'tenant', 'changes', 'GET', '/me/workspaces/{tenant_id}/resources/{resourceKey}/{resourceId}/changes', 'active', 'routes/resourceApiRoutes.js', 'tenant_resource_changes_list', 1, 0, 'active'
FROM platform_data_table_registry
WHERE status='active' AND enabled_surfaces_json LIKE '%"tenant"%'
ON DUPLICATE KEY UPDATE
  resource_key=VALUES(resource_key),
  actor_scope=VALUES(actor_scope),
  operation_key=VALUES(operation_key),
  http_method=VALUES(http_method),
  http_path=VALUES(http_path),
  implementation_status=VALUES(implementation_status),
  route_file=VALUES(route_file),
  tool_key=VALUES(tool_key),
  readback_required=VALUES(readback_required),
  permissions_required=VALUES(permissions_required),
  status=VALUES(status),
  updated_at=NOW();
