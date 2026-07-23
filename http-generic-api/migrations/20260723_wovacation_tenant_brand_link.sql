-- Spec 006: WOVacation tenant brand link evidence
-- Purpose:
--   Resolve one remaining Dynamic Container projection data-quality hold with direct evidence.
-- Safety:
--   - Data-only idempotent insert into tenant_brand_links.
--   - The insert is evidence-bound to both workspace_assets.brand_ref and an active workspace_resource_grants brand grant.
--   - Does not infer links from display names.
--   - Does not update brands or workspace_registry.
--   - No provider call, credential read, external send, secret read, enforcement, or promotion.

INSERT INTO `tenant_brand_links`
  (`link_id`,`tenant_id`,`brand_target_key`,`link_source`,`status`,`metadata_json`)
SELECT
  LOWER(CONCAT(
    SUBSTR(SHA2(CONCAT('tenant-brand-link|', '792029d2-4f62-4994-8dca-00417e90438d', '|', 'wovacation_wp'), 256), 1, 8), '-',
    SUBSTR(SHA2(CONCAT('tenant-brand-link|', '792029d2-4f62-4994-8dca-00417e90438d', '|', 'wovacation_wp'), 256), 9, 4), '-4',
    SUBSTR(SHA2(CONCAT('tenant-brand-link|', '792029d2-4f62-4994-8dca-00417e90438d', '|', 'wovacation_wp'), 256), 14, 3), '-a',
    SUBSTR(SHA2(CONCAT('tenant-brand-link|', '792029d2-4f62-4994-8dca-00417e90438d', '|', 'wovacation_wp'), 256), 18, 3), '-',
    SUBSTR(SHA2(CONCAT('tenant-brand-link|', '792029d2-4f62-4994-8dca-00417e90438d', '|', 'wovacation_wp'), 256), 21, 12)
  )) AS `link_id`,
  '792029d2-4f62-4994-8dca-00417e90438d' AS `tenant_id`,
  'wovacation_wp' AS `brand_target_key`,
  'workspace_asset_and_resource_grant' AS `link_source`,
  'active' AS `status`,
  JSON_OBJECT(
    'source_tables', JSON_ARRAY('workspace_assets','workspace_resource_grants','brands'),
    'source_fields', JSON_ARRAY('workspace_assets.brand_ref','workspace_resource_grants.resource_ref','brands.target_key'),
    'authority_implied', false,
    'secrets_included', false,
    'evidence', JSON_OBJECT(
      'workspace_id','0ff599ae-77d5-11f1-9a4d-d342cf4a053c',
      'workspace_assets_brand_ref','wovacation_wp',
      'workspace_resource_grants_resource_type','brand',
      'workspace_resource_grants_resource_ref','wovacation_wp'
    )
  ) AS `metadata_json`
WHERE EXISTS (
    SELECT 1
    FROM `workspace_assets` wa
    WHERE wa.`tenant_id` = '792029d2-4f62-4994-8dca-00417e90438d'
      AND wa.`brand_ref` COLLATE utf8mb4_uca1400_ai_ci = 'wovacation_wp'
  )
  AND EXISTS (
    SELECT 1
    FROM `workspace_resource_grants` wrg
    WHERE wrg.`tenant_id` = '792029d2-4f62-4994-8dca-00417e90438d'
      AND wrg.`workspace_id` = '0ff599ae-77d5-11f1-9a4d-d342cf4a053c'
      AND wrg.`resource_type` = 'brand'
      AND wrg.`resource_ref` COLLATE utf8mb4_uca1400_ai_ci = 'wovacation_wp'
      AND wrg.`status` = 'active'
  )
  AND EXISTS (
    SELECT 1
    FROM `brands` b
    WHERE b.`target_key` COLLATE utf8mb4_uca1400_ai_ci = 'wovacation_wp'
      AND LOWER(COALESCE(b.`status`, '')) = 'active'
  )
ON DUPLICATE KEY UPDATE
  `link_source` = VALUES(`link_source`),
  `status` = VALUES(`status`),
  `metadata_json` = VALUES(`metadata_json`),
  `updated_at` = CURRENT_TIMESTAMP;
