-- Spec 006: repair default workspace classification created by the 2026-07-04 capability gate repair.
--
-- Context:
--   The historical repair inserted minimal default workspace rows without an explicit
--   workspace_type, so the workspace_registry column default classified every row as
--   `brand`. Three rows have no linked_brand_key and no active tenant_brand_links
--   evidence. Dynamic Container projection therefore holds them as missing brand links.
--
-- Safety:
--   - Data-only, additive metadata update plus workspace_type correction.
--   - Limited to the three known repair-created workspace IDs.
--   - Requires the original repair key and default_workspace marker.
--   - Requires no linked_brand_key and no active tenant_brand_links evidence.
--   - Does not modify brands, tenant_brand_links, memberships, grants, or authority rows.
--   - Idempotent: reruns affect no rows after workspace_type becomes `project`.
--   - No provider calls, credential reads, external sends, secrets, enforcement, or promotion.

UPDATE `workspace_registry` AS w
JOIN `tenants` AS t
  ON t.`tenant_id` = w.`tenant_id`
SET
  w.`workspace_type` = 'project',
  w.`config_json` = JSON_SET(
    COALESCE(NULLIF(w.`config_json`, ''), '{}'),
    '$.workspace_classification_repair',
    JSON_OBJECT(
      'repair_key', 'default_workspace_non_brand_classification_20260723',
      'source_repair_key', 'capability_gate_default_workspace_registry_20260704',
      'previous_workspace_type', 'brand',
      'new_workspace_type', 'project',
      'reason', 'Repair-created default workspace has no canonical brand evidence.',
      'authority_implied', false,
      'secrets_included', false
    )
  ),
  w.`updated_at` = CURRENT_TIMESTAMP
WHERE w.`workspace_id` IN (
    '0ff5982f-77d5-11f1-9a4d-d342cf4a053c',
    '0ff59ac4-77d5-11f1-9a4d-d342cf4a053c',
    '0ff59b5f-77d5-11f1-9a4d-d342cf4a053c'
  )
  AND w.`tenant_id` IN (
    '00000000-0000-4000-a000-000000000001',
    '1e673d38-89a2-4872-a6b9-8bc937bd9503',
    'd7696384-ef5c-4d38-a90c-b17edaaf8c72'
  )
  AND w.`workspace_type` = 'brand'
  AND (w.`linked_brand_key` IS NULL OR TRIM(w.`linked_brand_key`) = '')
  AND JSON_UNQUOTE(JSON_EXTRACT(w.`config_json`, '$.repair_key')) = 'capability_gate_default_workspace_registry_20260704'
  AND JSON_UNQUOTE(JSON_EXTRACT(w.`config_json`, '$.default_workspace')) = 'true'
  AND t.`tenant_type` IN ('platform_owner', 'managed_client_account')
  AND NOT EXISTS (
    SELECT 1
    FROM `tenant_brand_links` AS tbl
    WHERE tbl.`tenant_id` = w.`tenant_id`
      AND tbl.`status` = 'active'
  );
