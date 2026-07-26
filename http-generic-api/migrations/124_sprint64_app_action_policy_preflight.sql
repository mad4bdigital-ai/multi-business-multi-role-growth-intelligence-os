-- Sprint 64: External app action runtime policy preflight.
-- Non-blocking seed that makes appAdapters participate in execution_policies.

UPDATE `execution_policies`
   SET `active` = 'TRUE',
       `execution_scope` = 'app_action|external_app_action|n8n|cloudflare|hostinger|google_drive|wordpress_rest|github',
       `affects_layer` = 'appAdapters|appAdapters/index.js|n8n|cloudflare|hostinger|google_drive|wordpress_rest|github',
       `blocking` = 'FALSE',
       `policy_value` = JSON_OBJECT(
         'enforcement_mode', 'advisory',
         'require_preflight_visibility', true,
         'require_secret_free_evidence', true,
         'require_adapter_specific_evaluator_for_blocking', true,
         'reason', 'External app actions must pass through governedExecutionPreflight before adapter execution. Blocking app-specific policies require a dedicated evaluator.'
       ),
       `notes` = 'Non-blocking visibility policy for appAdapters/index.js. This restores execution_policies as a preflight authority source for external app actions without breaking existing n8n, Google Drive, GitHub, or future Hostinger/Cloudflare actions.',
       `updated_at` = NOW()
 WHERE `policy_group` = 'External App Action Governance'
   AND `policy_key` = 'External App Action Preflight Visibility';

INSERT INTO `execution_policies`
  (`policy_group`, `policy_key`, `policy_value`, `active`, `execution_scope`, `affects_layer`, `blocking`, `notes`, `created_at`, `updated_at`)
SELECT
  'External App Action Governance',
  'External App Action Preflight Visibility',
  JSON_OBJECT(
    'enforcement_mode', 'advisory',
    'require_preflight_visibility', true,
    'require_secret_free_evidence', true,
    'require_adapter_specific_evaluator_for_blocking', true,
    'reason', 'External app actions must pass through governedExecutionPreflight before adapter execution. Blocking app-specific policies require a dedicated evaluator.'
  ),
  'TRUE',
  'app_action|external_app_action|n8n|cloudflare|hostinger|google_drive|wordpress_rest|github',
  'appAdapters|appAdapters/index.js|n8n|cloudflare|hostinger|google_drive|wordpress_rest|github',
  'FALSE',
  'Non-blocking visibility policy for appAdapters/index.js. This restores execution_policies as a preflight authority source for external app actions without breaking existing n8n, Google Drive, GitHub, or future Hostinger/Cloudflare actions.',
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group` = 'External App Action Governance'
     AND `policy_key` = 'External App Action Preflight Visibility'
);
