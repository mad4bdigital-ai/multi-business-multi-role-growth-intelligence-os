-- Sprint 69: Cloudflare mutation ownership and readback policy contract.
-- Metadata and readiness view only. No Cloudflare provider call, DNS mutation,
-- credential access, external write, or secret material is executed.

UPDATE `admin_platform_endpoint_tools`
   SET `description` = 'Forward governed Cloudflare REST calls. GET is read-only. POST/PUT/PATCH/DELETE require zone ownership, protected-record checks, preview/readback/rollback metadata, and existing approval/capability-envelope gates.',
       `input_schema` = JSON_OBJECT(
         'type', 'object',
         'required', JSON_ARRAY('path'),
         'properties', JSON_OBJECT(
           'path', JSON_OBJECT('type', 'string', 'description', 'Cloudflare API path under /client/v4.'),
           'method', JSON_OBJECT('type', 'string', 'enum', JSON_ARRAY('GET','POST','PUT','DELETE','PATCH'), 'default', 'GET'),
           'request_body', JSON_OBJECT('type', 'object'),
           'params', JSON_OBJECT('type', 'object'),
           'zone_id', JSON_OBJECT('type', 'string'),
           'record_id', JSON_OBJECT('type', 'string'),
           'expected_zone_name', JSON_OBJECT('type', 'string'),
           'preview_token', JSON_OBJECT('type', 'string'),
           'readback_plan', JSON_OBJECT('type', 'object'),
           'rollback_plan', JSON_OBJECT('type', 'object'),
           'capability_envelope_id', JSON_OBJECT('type', 'string'),
           'approval_hold_id', JSON_OBJECT('type', 'string')
         ),
         'additionalProperties', FALSE
       ),
       `tags` = 'admin,cloudflare,mutation_policy_required,zone_ownership_required,record_protection_required,preview_required,readback,rollback_required,capability_envelope,approval_required,no_secret_response',
       `updated_at` = CURRENT_TIMESTAMP
 WHERE `tool_key` = 'admin_cloudflare';

INSERT INTO `execution_policies`
  (`policy_group`, `policy_key`, `policy_value`, `active`, `execution_scope`, `affects_layer`, `blocking`, `notes`)
VALUES
  (
    'Cloudflare Mutation Governance',
    'cloudflare_zone_record_mutation_policy_v1',
    JSON_OBJECT(
      'rule', 'cloudflare_mutations_require_zone_ownership_record_protection_preview_readback_and_rollback',
      'enforcement_mode', 'blocking',
      'read_only_methods', JSON_ARRAY('GET', 'HEAD', 'OPTIONS'),
      'state_changing_methods', JSON_ARRAY('POST', 'PUT', 'PATCH', 'DELETE'),
      'zone_ownership_required', TRUE,
      'record_protection_required', TRUE,
      'protected_record_classes', JSON_ARRAY('apex', 'auth_control_plane', 'tenant_control_plane', 'mail_exchange', 'verification_record'),
      'preview_required_before_mutation', TRUE,
      'same_cycle_readback_required', TRUE,
      'rollback_metadata_required', TRUE,
      'approval_hold_required', TRUE,
      'capability_envelope_required', TRUE,
      'credential_payload_read_allowed', FALSE,
      'direct_provider_mutation_enabled_by_policy', FALSE,
      'reuse_existing_approval_path', TRUE,
      'secrets_included', FALSE
    ),
    'TRUE',
    'cloudflare|admin_cloudflare|dns_record_mutation|zone_mutation|gpt_tools_call|tool_dispatch',
    'admin_platform_endpoint_tools|governedExecutionPreflight|gptToolsRoutes|capability_resolution_envelope_ledger|approval_holds',
    'TRUE',
    'Cloudflare DNS/zone mutations must prove zone ownership, protected-record checks, preview, readback, rollback metadata, and existing approval/envelope gates before dispatch.'
  )
ON DUPLICATE KEY UPDATE
  `policy_value` = VALUES(`policy_value`),
  `active` = VALUES(`active`),
  `execution_scope` = VALUES(`execution_scope`),
  `affects_layer` = VALUES(`affects_layer`),
  `blocking` = VALUES(`blocking`),
  `notes` = VALUES(`notes`),
  `updated_at` = CURRENT_TIMESTAMP;

CREATE OR REPLACE VIEW `v_cloudflare_mutation_policy_readiness` AS
SELECT
  t.`tool_key`,
  t.`tags`,
  p.`policy_key`,
  CASE
    WHEN t.`tool_key` = 'admin_cloudflare'
      AND FIND_IN_SET('zone_ownership_required', REPLACE(COALESCE(t.`tags`, ''), ' ', '')) > 0
      AND FIND_IN_SET('record_protection_required', REPLACE(COALESCE(t.`tags`, ''), ' ', '')) > 0
      AND FIND_IN_SET('preview_required', REPLACE(COALESCE(t.`tags`, ''), ' ', '')) > 0
      AND FIND_IN_SET('readback', REPLACE(COALESCE(t.`tags`, ''), ' ', '')) > 0
      AND FIND_IN_SET('rollback_required', REPLACE(COALESCE(t.`tags`, ''), ' ', '')) > 0
      AND p.`active` = 'TRUE'
      AND p.`blocking` = 'TRUE'
      THEN 'ready'
    ELSE 'missing_cloudflare_mutation_policy_contract'
  END AS `coverage_status`,
  t.`is_enabled`,
  t.`updated_at`
FROM `admin_platform_endpoint_tools` t
LEFT JOIN `execution_policies` p
  ON p.`policy_group` = 'Cloudflare Mutation Governance'
 AND p.`policy_key` = 'cloudflare_zone_record_mutation_policy_v1'
WHERE t.`tool_key` = 'admin_cloudflare';
