-- Sprint 68: CMS grant duplicate dedupe and NULL-workspace hardening.
-- Scope: one known duplicate active grant group for allroyalegypt.com.
-- Safety: revoke duplicate grants only; keep the oldest approved canonical grant active; add a generated active-scope key so NULL workspace_id cannot bypass uniqueness.

UPDATE cms_site_access_grants
SET status = 'revoked', updated_at = UTC_TIMESTAMP()
WHERE grant_id IN (
  '0548b6ef-b83a-4a9d-9241-7dbb8788ae37',
  '3e2ba8be-3137-4b55-bd5e-584b15917c8f'
)
  AND status = 'active'
  AND site_id = 'a70a7aac-0851-4594-8b14-53ff4d0a610e'
  AND tenant_id = '4bc39fca-270e-4daa-b373-db75e1f36ccd'
  AND user_id = 'f242960c-2857-4b4d-a504-ee50f8a278b4'
  AND workspace_id IS NULL
  AND connection_id = 'fbfa6eff-281c-42f7-a568-a05e15c64b5d'
  AND scope = 'tenant_brand'
  AND EXISTS (
    SELECT 1 FROM (
      SELECT grant_id
      FROM cms_site_access_grants
      WHERE grant_id = '99354c25-7e0c-476d-817c-129328a1962c'
        AND status = 'active'
        AND site_id = 'a70a7aac-0851-4594-8b14-53ff4d0a610e'
        AND tenant_id = '4bc39fca-270e-4daa-b373-db75e1f36ccd'
        AND user_id = 'f242960c-2857-4b4d-a504-ee50f8a278b4'
        AND workspace_id IS NULL
        AND connection_id = 'fbfa6eff-281c-42f7-a568-a05e15c64b5d'
        AND scope = 'tenant_brand'
      LIMIT 1
    ) canonical_guard
  );

ALTER TABLE cms_site_access_grants
  ADD COLUMN IF NOT EXISTS active_grant_scope_key VARCHAR(255)
  GENERATED ALWAYS AS (
    CASE
      WHEN status = 'active' THEN CONCAT(
        site_id,
        '#', tenant_id,
        '#', scope,
        '#', COALESCE(user_id, '__NULL_USER__'),
        '#', COALESCE(workspace_id, '__NULL_WORKSPACE__'),
        '#', COALESCE(connection_id, '__NULL_CONNECTION__')
      )
      ELSE NULL
    END
  ) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cms_active_grant_scope_key
  ON cms_site_access_grants (active_grant_scope_key);

CREATE OR REPLACE VIEW v_cms_active_grant_duplicate_groups AS
SELECT
  site_id,
  tenant_id,
  user_id,
  workspace_id,
  COALESCE(workspace_id, '__NULL_WORKSPACE__') AS workspace_key,
  connection_id,
  scope,
  COUNT(*) AS duplicate_count,
  GROUP_CONCAT(grant_id ORDER BY approved_at, created_at, grant_id SEPARATOR ',') AS grant_ids,
  MIN(approved_at) AS first_approved_at,
  MAX(approved_at) AS last_approved_at,
  SUM(publish_allowed = 1) AS publish_allowed_rows,
  SUM(destructive_allowed = 1) AS destructive_allowed_rows
FROM cms_site_access_grants
WHERE status = 'active'
GROUP BY site_id, tenant_id, user_id, workspace_id, connection_id, scope
HAVING COUNT(*) > 1;
