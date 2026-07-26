-- Sprint 69: Local connector transient retry-before-repair policy.
-- Cloudflare 1033 / HTTP 530 must receive bounded health retries before installer generation.
-- Safety contract: no_provider_call, no_credential_payload_read, no_raw_secrets, no_external_send, no_external_write, secrets_included=false.

UPDATE `admin_platform_endpoint_tools`
   SET `description` = 'Retry bounded connector health up to three total attempts for transient 1033/HTTP 530. Stop on pass or authorization-gated reachability. Generate repair installer assets only after retry exhaustion and degraded readback. Returns no-secret diagnosis and retry evidence.',
       `updated_at` = NOW()
 WHERE `tool_key` = 'local_connector_self_repair';

UPDATE `execution_policies`
   SET `policy_value` = JSON_OBJECT(
         'enforcement_mode', 'blocking',
         'policy_key', 'cloudflare_1033_retry_before_repair_v1',
         'retryable_error_codes', JSON_ARRAY('1033'),
         'retryable_http_statuses', JSON_ARRAY(502, 503, 504, 530),
         'max_attempts', 3,
         'base_delay_ms', 750,
         'max_delay_ms', 2000,
         'stop_on_pass', true,
         'stop_on_authorization_gated', true,
         'require_retry_exhaustion_before_repair', true,
         'require_retry_evidence', true,
         'forbid_installer_when_retry_recovers', true,
         'no_provider_call', true,
         'no_credential_payload_read', true,
         'no_raw_secrets', true,
         'no_external_send', true,
         'no_external_write', true,
         'secrets_included_false', true,
         'reason', 'Cloudflare 1033 and HTTP 530 are frequently transient and must not trigger unnecessary connector reinstall or tunnel reprovisioning.'
       ),
       `active` = 'TRUE',
       `execution_scope` = 'local_connector_recovery|cloudflare_1033|http_530|connector_health',
       `affects_layer` = 'adminCliRoutes|localConnectorCompositeHealth|repairLocalConnector|local_connector_self_repair',
       `blocking` = 'TRUE',
       `notes` = 'Blocking retry-before-repair authority. Runtime and GPT callers must perform three total bounded health attempts and may generate repair assets only after retry exhaustion.',
       `updated_at` = NOW()
 WHERE `policy_group` = 'Local Connector Recovery Governance'
   AND `policy_key` = 'Cloudflare 1033 Retry Before Repair';

INSERT INTO `execution_policies`
  (`policy_group`, `policy_key`, `policy_value`, `active`, `execution_scope`, `affects_layer`, `blocking`, `notes`, `created_at`, `updated_at`)
SELECT
  'Local Connector Recovery Governance',
  'Cloudflare 1033 Retry Before Repair',
  JSON_OBJECT(
    'enforcement_mode', 'blocking',
    'policy_key', 'cloudflare_1033_retry_before_repair_v1',
    'retryable_error_codes', JSON_ARRAY('1033'),
    'retryable_http_statuses', JSON_ARRAY(502, 503, 504, 530),
    'max_attempts', 3,
    'base_delay_ms', 750,
    'max_delay_ms', 2000,
    'stop_on_pass', true,
    'stop_on_authorization_gated', true,
    'require_retry_exhaustion_before_repair', true,
    'require_retry_evidence', true,
    'forbid_installer_when_retry_recovers', true,
    'no_provider_call', true,
    'no_credential_payload_read', true,
    'no_raw_secrets', true,
    'no_external_send', true,
    'no_external_write', true,
    'secrets_included_false', true,
    'reason', 'Cloudflare 1033 and HTTP 530 are frequently transient and must not trigger unnecessary connector reinstall or tunnel reprovisioning.'
  ),
  'TRUE',
  'local_connector_recovery|cloudflare_1033|http_530|connector_health',
  'adminCliRoutes|localConnectorCompositeHealth|repairLocalConnector|local_connector_self_repair',
  'TRUE',
  'Blocking retry-before-repair authority. Runtime and GPT callers must perform three total bounded health attempts and may generate repair assets only after retry exhaustion.',
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1
    FROM `execution_policies`
   WHERE `policy_group` = 'Local Connector Recovery Governance'
     AND `policy_key` = 'Cloudflare 1033 Retry Before Repair'
);
