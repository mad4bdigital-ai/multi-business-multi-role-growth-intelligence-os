-- Sprint 67: Backfill default workspace resource grants for existing active memberships
-- Membership gives workspace entry; this backfill creates matching workspace-level resource grants.

INSERT INTO workspace_resource_grants (
  grant_id,
  tenant_id,
  grantee_user_id,
  resource_type,
  resource_ref,
  permission,
  status,
  source,
  granted_by,
  metadata_json
)
SELECT
  UUID() AS grant_id,
  m.tenant_id,
  m.user_id AS grantee_user_id,
  'workspace' AS resource_type,
  m.tenant_id AS resource_ref,
  CASE
    WHEN LOWER(m.role) = 'admin' THEN 'admin'
    WHEN LOWER(m.role) IN ('editor', 'operator') THEN 'operate'
    ELSE 'view'
  END AS permission,
  'active' AS status,
  'membership_default' AS source,
  NULL AS granted_by,
  JSON_OBJECT('backfill', true, 'default_workspace_membership_grant', true, 'role', m.role) AS metadata_json
FROM memberships m
JOIN tenants t ON t.tenant_id = m.tenant_id AND t.status = 'active'
LEFT JOIN workspace_resource_grants g
  ON g.tenant_id = m.tenant_id
 AND g.grantee_user_id = m.user_id
 AND g.resource_type = 'workspace'
 AND g.resource_ref = m.tenant_id
 AND g.status = 'active'
WHERE m.status = 'active'
  AND g.grant_id IS NULL
ON DUPLICATE KEY UPDATE
  updated_at = VALUES(updated_at);
