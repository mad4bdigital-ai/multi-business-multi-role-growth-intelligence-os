-- Sprint 67: Workspace authority reconciliation diagnostics
-- Read-only views that detect mismatches introduced by CMS grants, app connections, memberships, and resource grants.

CREATE OR REPLACE VIEW v_cms_grants_without_workspace_membership AS
SELECT
  g.grant_id,
  g.tenant_id,
  g.user_id,
  u.email,
  u.display_name,
  g.site_id,
  s.normalized_domain,
  s.canonical_target_key,
  g.scope,
  g.draft_allowed,
  g.publish_allowed,
  g.status AS cms_grant_status,
  g.approved_by,
  g.approved_at,
  g.updated_at
FROM cms_site_access_grants g
LEFT JOIN users u ON u.user_id = g.user_id
LEFT JOIN cms_sites s ON s.site_id = g.site_id
LEFT JOIN memberships m
  ON m.tenant_id = g.tenant_id
 AND m.user_id = g.user_id
 AND m.status = 'active'
WHERE g.status = 'active'
  AND g.user_id IS NOT NULL
  AND m.user_id IS NULL;

CREATE OR REPLACE VIEW v_connections_without_workspace_membership AS
SELECT
  c.connection_id,
  c.tenant_id,
  c.user_id,
  u.email,
  u.display_name,
  c.app_key,
  c.auth_type,
  c.display_label,
  c.account_label,
  c.status AS connection_status,
  c.validation_status,
  c.connected_at,
  c.last_validated_at,
  c.last_used_at
FROM user_app_connections c
LEFT JOIN users u ON u.user_id = c.user_id
LEFT JOIN memberships m
  ON m.tenant_id = c.tenant_id
 AND m.user_id = c.user_id
 AND m.status = 'active'
WHERE c.status = 'active'
  AND c.tenant_id IS NOT NULL
  AND c.tenant_id NOT IN ('00000000-0000-0000-0000-000000000000')
  AND m.user_id IS NULL;

CREATE OR REPLACE VIEW v_active_memberships_missing_workspace_grants AS
SELECT
  m.tenant_id,
  m.user_id,
  u.email,
  u.display_name,
  m.role,
  m.status AS membership_status,
  t.display_name AS tenant_display_name,
  t.status AS tenant_status
FROM memberships m
JOIN tenants t ON t.tenant_id = m.tenant_id AND t.status = 'active'
LEFT JOIN users u ON u.user_id = m.user_id
LEFT JOIN workspace_resource_grants g
  ON g.tenant_id = m.tenant_id
 AND g.grantee_user_id = m.user_id
 AND g.resource_type = 'workspace'
 AND g.resource_ref = m.tenant_id
 AND g.status = 'active'
WHERE m.status = 'active'
  AND g.grant_id IS NULL;

CREATE OR REPLACE VIEW v_cms_publish_grants_missing_resource_grants AS
SELECT
  g.grant_id AS cms_grant_id,
  g.tenant_id,
  g.user_id,
  u.email,
  g.site_id,
  s.normalized_domain,
  s.canonical_target_key,
  g.draft_allowed,
  g.publish_allowed,
  g.status AS cms_grant_status,
  CASE WHEN g.publish_allowed = 1 THEN 'operate' ELSE 'edit' END AS required_permission
FROM cms_site_access_grants g
LEFT JOIN users u ON u.user_id = g.user_id
LEFT JOIN cms_sites s ON s.site_id = g.site_id
LEFT JOIN v_workspace_resource_grant_effective rg
  ON rg.tenant_id = g.tenant_id
 AND rg.grantee_user_id = g.user_id
 AND (
      (rg.resource_type = 'site' AND rg.resource_ref = g.site_id)
      OR (rg.resource_type = 'workspace' AND rg.resource_ref = g.tenant_id)
 )
 AND (
      rg.permission IN ('owner','admin','manage')
      OR (g.publish_allowed = 1 AND rg.permission = 'operate')
      OR (g.publish_allowed <> 1 AND rg.permission IN ('operate','edit'))
 )
WHERE g.status = 'active'
  AND g.user_id IS NOT NULL
  AND rg.grant_id IS NULL;

CREATE OR REPLACE VIEW v_workspace_authority_reconciliation_summary AS
SELECT 'cms_grants_without_workspace_membership' AS check_key, COUNT(*) AS issue_count FROM v_cms_grants_without_workspace_membership
UNION ALL
SELECT 'connections_without_workspace_membership' AS check_key, COUNT(*) AS issue_count FROM v_connections_without_workspace_membership
UNION ALL
SELECT 'active_memberships_missing_workspace_grants' AS check_key, COUNT(*) AS issue_count FROM v_active_memberships_missing_workspace_grants
UNION ALL
SELECT 'cms_publish_grants_missing_resource_grants' AS check_key, COUNT(*) AS issue_count FROM v_cms_publish_grants_missing_resource_grants;
