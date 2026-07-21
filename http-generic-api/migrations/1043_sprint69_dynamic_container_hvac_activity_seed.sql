-- Sprint 69: Dynamic container HVAC business activity seed
-- Purpose:
--   Seed the canonical HVAC / Air Conditioning Services business activity so dynamic
--   container projection can resolve Arab Cooling from brand_paths.business_type_key.
-- Safety:
--   - Idempotent INSERT ... ON DUPLICATE KEY UPDATE on business_activity_type_key.
--   - Adds/updates only one canonical active activity row.
--   - No schema change, destructive write, provider call, external send, credential read, or secret read.
-- Readback after apply:
--   1. business_activity_types contains exactly one active hvac_air_conditioning_services row.
--   2. dynamic_container_projection_dry_run no longer reports business_activity_context_required for arab_cooling.

INSERT INTO `business_activity_types`
  (`business_activity_type_key`, `activity_key`, `business_type_key`, `label`, `parent_activity_type`, `default_knowledge_profile_key`, `supported_engine_categories`, `supported_route_keys`, `supported_workflows`, `brand_core_required`, `status`, `active`, `notes`)
VALUES
  ('hvac_air_conditioning_services', 'hvac_air_conditioning_services', 'hvac_air_conditioning_services', 'HVAC / Air Conditioning Services', NULL, 'hvac_knowledge_profile', 'market_intelligence|brand_intelligence|seo_engines|marketing_engines|content_engines|report_engines', 'brand_strategy|seo_audit|content_creation|local_seo', 'content_generation_workflow;seo_strategy_workflow;brand_marketing_workflow', 'true', 'active', 'active', 'Canonical activity seed for dynamic container projection; mirrors business_type_profiles.hvac_air_conditioning_services without provider calls or secrets.')
ON DUPLICATE KEY UPDATE
  `activity_key` = VALUES(`activity_key`),
  `business_type_key` = VALUES(`business_type_key`),
  `label` = VALUES(`label`),
  `parent_activity_type` = VALUES(`parent_activity_type`),
  `default_knowledge_profile_key` = VALUES(`default_knowledge_profile_key`),
  `supported_engine_categories` = VALUES(`supported_engine_categories`),
  `supported_route_keys` = VALUES(`supported_route_keys`),
  `supported_workflows` = VALUES(`supported_workflows`),
  `brand_core_required` = VALUES(`brand_core_required`),
  `status` = VALUES(`status`),
  `active` = VALUES(`active`),
  `notes` = VALUES(`notes`),
  `updated_at` = CURRENT_TIMESTAMP;
