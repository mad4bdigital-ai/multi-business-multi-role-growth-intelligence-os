-- Sprint 68: Support Ticket external delivery live SMTP registry alignment
-- Purpose: align registry/readiness with the gated SMTP runtime introduced in PR #1337.
-- Safety: does not enable dispatch by default; no secrets; no destructive statements.

UPDATE `external_delivery_provider_adapter_contract_registry`
   SET `implementation_status` = 'implemented_gated_smtp_runtime',
       `dispatch_enabled` = 0,
       `provider_dispatch_enabled` = 0,
       `send_modes_json` = JSON_ARRAY('dry_run','record_only','provider_send_blocked','sandbox','live_send'),
       `safety_json` = JSON_SET(
         COALESCE(`safety_json`, JSON_OBJECT()),
         '$.external_send_supported', true,
         '$.external_send_performed_default', false,
         '$.live_send_enabled_by_default', false,
         '$.runtime', 'smtp_smtps_only',
         '$.requires_smtp_url', true,
         '$.requires_recipient_allowlist', true,
         '$.requires_approval_hold', true,
         '$.requires_credential_ref', true,
         '$.requires_idempotency_key', true,
         '$.secret_value_included', false,
         '$.secrets_included', false
       ),
       `updated_at` = CURRENT_TIMESTAMP
 WHERE `adapter_key` = 'smtp_email_adapter';

UPDATE `external_delivery_provider_send_mode_policy_registry`
   SET `mode_status` = 'blocked_until_explicit_dispatch_enablement_and_runtime_gates',
       `approval_required` = 1,
       `credential_required` = 1,
       `final_approval_required` = 1,
       `provider_dispatch_required` = 1,
       `external_send_performed_default` = 0,
       `safety_json` = JSON_SET(
         COALESCE(`safety_json`, JSON_OBJECT()),
         '$.live_send', true,
         '$.enabled_by_default', false,
         '$.requires_smtp_url', true,
         '$.requires_recipient_allowlist', true,
         '$.requires_approval_hold', true,
         '$.requires_credential_ref', true,
         '$.requires_idempotency_key', true,
         '$.external_send_performed_default', false,
         '$.secret_value_included', false,
         '$.secrets_included', false
       ),
       `updated_at` = CURRENT_TIMESTAMP
 WHERE `adapter_key` = 'smtp_email_adapter'
   AND `mode_key` = 'live_send';

INSERT INTO `execution_policies`
  (`policy_group`, `policy_key`, `policy_value`, `active`, `execution_scope`, `affects_layer`, `blocking`, `notes`, `created_at`, `updated_at`)
VALUES
  ('Support Ticket External Delivery Governance',
   'support_ticket_external_delivery_live_smtp_runtime_policy_v1',
   JSON_OBJECT(
     'runtime', 'smtp_smtps_only',
     'enabled_by_default', false,
     'requires_explicit_mode', 'live_send',
     'requires_dispatch_enabled', true,
     'requires_provider_dispatch_enabled', true,
     'requires_approval_hold', true,
     'requires_credential_ref', true,
     'requires_idempotency_key', true,
     'requires_recipient_allowlist', true,
     'requires_smtp_url', true,
     'forbids_secret_response', true,
     'secret_value_included', false,
     'secrets_included', false
   ),
   'TRUE',
   'support_ticket_external_delivery_live_smtp_runtime',
   'supportTicketExternalLiveSendService|supportTicketExternalSendProviderGateService',
   'TRUE',
   'Live SMTP runtime exists but dispatch remains disabled until explicit adapter flags, approval, credential, idempotency, SMTP_URL, and recipient allowlist gates pass.',
   CURRENT_TIMESTAMP,
   CURRENT_TIMESTAMP)
ON DUPLICATE KEY UPDATE
  `policy_value` = VALUES(`policy_value`),
  `active` = VALUES(`active`),
  `execution_scope` = VALUES(`execution_scope`),
  `affects_layer` = VALUES(`affects_layer`),
  `blocking` = VALUES(`blocking`),
  `notes` = VALUES(`notes`),
  `updated_at` = CURRENT_TIMESTAMP;
