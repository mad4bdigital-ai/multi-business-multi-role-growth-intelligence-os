-- Sprint 44b. Conditional knowledge surface runtime enforcement.
-- Drive folder and canonical surfaces are now conditionally enforced
-- when the request context is brand or business-type relevant.

-- Add business_type_scope column to tag surfaces per business type
-- NULL = global (returned for all brand-relevant requests).
-- Comma-separated list = only for matching business_type_keys.
ALTER TABLE `platform_contract_surfaces`
  ADD COLUMN IF NOT EXISTS `business_type_scope` VARCHAR(500) NULL
  AFTER `surface_scope`;

-- Promote Drive knowledge folders to conditionally runtime-enforced
UPDATE `platform_contract_surfaces`
  SET `runtime_consumption_status` = 'knowledge_candidate_runtime_enforced'
  WHERE `runtime_consumption_status` = 'drive_knowledge_candidate_not_runtime_enforced';

-- Promote canonical file surfaces to conditionally runtime-enforced
UPDATE `platform_contract_surfaces`
  SET `runtime_consumption_status` = 'knowledge_candidate_runtime_enforced'
  WHERE `runtime_consumption_status` = 'canonical_candidate_not_runtime_enforced';

-- Tag all Travel/Tourism surfaces with destination_or_travel_business
UPDATE `platform_contract_surfaces`
  SET `business_type_scope` = 'destination_or_travel_business'
  WHERE `runtime_consumption_status` = 'knowledge_candidate_runtime_enforced'
    AND (
      `surface_name` LIKE 'Travel%'
      OR `surface_name` LIKE '%Travel%'
      OR `surface_name` LIKE '%Tourism%'
    )
    AND `surface_type` IN ('drive_folder', 'google_drive_folder');
