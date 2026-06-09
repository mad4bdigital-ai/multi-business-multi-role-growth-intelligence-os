-- Sprint 68: Ticket External Provider Adapter Design Contracts
-- Defines provider families, adapter contracts, and send-mode policies for support ticket external delivery.
-- This migration is registry/readback only. It does not implement provider dispatch, send email, send webhooks, read secret payloads, or enable external delivery.
-- Additive, idempotent, no secrets.

CREATE TABLE IF NOT EXISTS `external_delivery_provider_family_registry` (
  `family_key` VARCHAR(128) NOT NULL,
  `display_name` VARCHAR(255) NOT NULL,
  `channel` VARCHAR(64) NOT NULL,
  `delivery_scope` VARCHAR(64) NOT NULL DEFAULT 'support_ticket_notification',
  `status` VARCHAR(32) NOT NULL DEFAULT 'planned',
  `dispatch_default_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `external_send_supported` TINYINT(1) NOT NULL DEFAULT 0,
  `description` TEXT NULL,
  `safety_json` JSON NULL,
  `sort_order` INT NOT NULL DEFAULT 1000,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`family_key`),
  KEY `idx_external_delivery_family_channel_status` (`channel`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `external_delivery_provider_adapter_contract_registry` (
  `adapter_key` VARCHAR(160) NOT NULL,
  `family_key` VARCHAR(128) NOT NULL,
  `channel` VARCHAR(64) NOT NULL,
  `implementation_status` VARCHAR(64) NOT NULL DEFAULT 'not_implemented',
  `dispatch_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `provider_dispatch_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `required_credential_type` VARCHAR(160) NULL,
  `supported_audiences_json` JSON NULL,
  `send_modes_json` JSON NULL,
  `payload_schema_json` JSON NULL,
  `preflight_schema_json` JSON NULL,
  `rate_limit_json` JSON NULL,
  `retry_policy_json` JSON NULL,
  `idempotency_policy_json` JSON NULL,
  `readback_policy_json` JSON NULL,
  `audit_policy_json` JSON NULL,
  `safety_json` JSON NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'planned',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`adapter_key`),
  KEY `idx_external_delivery_adapter_family_status` (`family_key`, `status`),
  KEY `idx_external_delivery_adapter_channel_status` (`channel`, `status`),
  CONSTRAINT `fk_external_delivery_adapter_family` FOREIGN KEY (`family_key`) REFERENCES `external_delivery_provider_family_registry` (`family_key`) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `external_delivery_provider_send_mode_policy_registry` (
  `policy_key` VARCHAR(180) NOT NULL,
  `adapter_key` VARCHAR(160) NOT NULL,
  `mode_key` VARCHAR(80) NOT NULL,
  `mode_status` VARCHAR(64) NOT NULL DEFAULT 'allowed_readonly',
  `approval_required` TINYINT(1) NOT NULL DEFAULT 1,
  `credential_required` TINYINT(1) NOT NULL DEFAULT 1,
  `final_approval_required` TINYINT(1) NOT NULL DEFAULT 1,
  `provider_dispatch_required` TINYINT(1) NOT NULL DEFAULT 0,
  `external_send_performed_default` TINYINT(1) NOT NULL DEFAULT 0,
  `safety_json` JSON NULL,
  `notes` TEXT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`policy_key`),
  UNIQUE KEY `uq_external_delivery_send_mode_adapter_mode` (`adapter_key`, `mode_key`),
  KEY `idx_external_delivery_send_mode_status` (`mode_status`, `status`),
  CONSTRAINT `fk_external_delivery_send_mode_adapter` FOREIGN KEY (`adapter_key`) REFERENCES `external_delivery_provider_adapter_contract_registry` (`adapter_key`) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `external_delivery_provider_family_registry` (
  `family_key`, `display_name`, `channel`, `delivery_scope`, `status`,
  `dispatch_default_enabled`, `external_send_supported`, `description`, `safety_json`, `sort_order`
) VALUES
('internal_notification', 'Internal Notification Providers', 'internal', 'support_ticket_notification', 'active', 1, 0, 'Internal-only surfaces such as activation inbox, dashboard, ticket timeline, and admin console. No external delivery.', JSON_OBJECT('external_send_performed', false, 'provider_dispatch_required', false, 'secrets_included', false), 10),
('email_delivery', 'Email Delivery Providers', 'email', 'support_ticket_notification', 'planned', 0, 0, 'Future external email delivery family. Dispatch disabled and adapters not implemented by default.', JSON_OBJECT('external_send_performed', false, 'provider_dispatch_enabled', false, 'adapter_implemented', false, 'secrets_included', false), 20),
('webhook_delivery', 'Webhook Delivery Providers', 'webhook', 'support_ticket_notification', 'planned', 0, 0, 'Future external webhook delivery family. Requires signing, idempotency, retry, timeout, and readback policy before enablement.', JSON_OBJECT('external_send_performed', false, 'provider_dispatch_enabled', false, 'adapter_implemented', false, 'secrets_included', false), 30),
('messaging_delivery', 'Messaging Delivery Providers', 'messaging', 'support_ticket_notification', 'future', 0, 0, 'Future messaging adapters such as WhatsApp/SMS/Slack/Telegram. Not enabled in this phase.', JSON_OBJECT('external_send_performed', false, 'provider_dispatch_enabled', false, 'adapter_implemented', false, 'secrets_included', false), 40),
('ads_provider', 'Ads / Marketing Provider Family', 'ads', 'governed_marketing_execution', 'governed_elsewhere', 0, 0, 'Ads providers are governed by ads provider orchestration, not support ticket notification delivery.', JSON_OBJECT('governed_elsewhere', true, 'external_send_performed', false, 'secrets_included', false), 90)
ON DUPLICATE KEY UPDATE
  `display_name`=VALUES(`display_name`), `channel`=VALUES(`channel`), `delivery_scope`=VALUES(`delivery_scope`),
  `status`=VALUES(`status`), `dispatch_default_enabled`=VALUES(`dispatch_default_enabled`),
  `external_send_supported`=VALUES(`external_send_supported`), `description`=VALUES(`description`),
  `safety_json`=VALUES(`safety_json`), `sort_order`=VALUES(`sort_order`), `updated_at`=CURRENT_TIMESTAMP;

INSERT INTO `external_delivery_provider_adapter_contract_registry` (
  `adapter_key`, `family_key`, `channel`, `implementation_status`, `dispatch_enabled`, `provider_dispatch_enabled`,
  `required_credential_type`, `supported_audiences_json`, `send_modes_json`, `payload_schema_json`, `preflight_schema_json`,
  `rate_limit_json`, `retry_policy_json`, `idempotency_policy_json`, `readback_policy_json`, `audit_policy_json`, `safety_json`, `status`
) VALUES
('activation_inbox_adapter', 'internal_notification', 'internal', 'implemented_record_only', 1, 0, NULL, JSON_ARRAY('admin','customer'), JSON_ARRAY('dry_run','record_only'), JSON_OBJECT('type','object','required',JSON_ARRAY('ticket_id','notification_type')), JSON_OBJECT('requires_external_credential', false), JSON_OBJECT('window_minutes', 60, 'max_records', 100), JSON_OBJECT('retry_allowed', false), JSON_OBJECT('required', true, 'scope', 'ticket_notification'), JSON_OBJECT('readback_required', true, 'surface', 'ticket_lifecycle_events'), JSON_OBJECT('audit_required', true, 'external_send_performed', false), JSON_OBJECT('external_send_supported', false, 'external_send_performed', false, 'secrets_included', false), 'active'),
('dashboard_notification_adapter', 'internal_notification', 'internal', 'implemented_record_only', 1, 0, NULL, JSON_ARRAY('admin','customer'), JSON_ARRAY('dry_run','record_only'), JSON_OBJECT('type','object','required',JSON_ARRAY('ticket_id','dashboard_surface')), JSON_OBJECT('requires_external_credential', false), JSON_OBJECT('window_minutes', 60, 'max_records', 100), JSON_OBJECT('retry_allowed', false), JSON_OBJECT('required', true, 'scope', 'dashboard_notification'), JSON_OBJECT('readback_required', true, 'surface', 'ticket_lifecycle_events'), JSON_OBJECT('audit_required', true, 'external_send_performed', false), JSON_OBJECT('external_send_supported', false, 'external_send_performed', false, 'secrets_included', false), 'active'),
('ticket_timeline_adapter', 'internal_notification', 'internal', 'implemented_record_only', 1, 0, NULL, JSON_ARRAY('admin','customer'), JSON_ARRAY('dry_run','record_only'), JSON_OBJECT('type','object','required',JSON_ARRAY('ticket_id','event_type')), JSON_OBJECT('requires_external_credential', false), JSON_OBJECT('window_minutes', 60, 'max_records', 500), JSON_OBJECT('retry_allowed', false), JSON_OBJECT('required', true, 'scope', 'ticket_timeline'), JSON_OBJECT('readback_required', true, 'surface', 'ticket_lifecycle_events'), JSON_OBJECT('audit_required', true, 'external_send_performed', false), JSON_OBJECT('external_send_supported', false, 'external_send_performed', false, 'secrets_included', false), 'active'),
('smtp_email_adapter', 'email_delivery', 'email', 'not_implemented', 0, 0, 'email_delivery_credential', JSON_ARRAY('admin','customer','both'), JSON_ARRAY('dry_run','record_only','provider_send_blocked'), JSON_OBJECT('type','object','required',JSON_ARRAY('ticket_id','to','subject','body')), JSON_OBJECT('requires_credential_ref', true, 'requires_delivery_approval', true, 'requires_final_provider_gate', true), JSON_OBJECT('window_minutes', 60, 'max_records', 3), JSON_OBJECT('window_minutes', 1440, 'max_records', 5), JSON_OBJECT('required', true, 'header', 'Idempotency-Key'), JSON_OBJECT('readback_required', true, 'provider_message_id_required_when_enabled', true), JSON_OBJECT('audit_required', true, 'timeline_event_required', true), JSON_OBJECT('external_send_supported', false, 'provider_dispatch_enabled', false, 'adapter_implemented', false, 'external_send_performed', false, 'secrets_included', false), 'planned'),
('sendgrid_email_adapter', 'email_delivery', 'email', 'not_implemented', 0, 0, 'email_delivery_credential', JSON_ARRAY('admin','customer','both'), JSON_ARRAY('dry_run','record_only','provider_send_blocked'), JSON_OBJECT('type','object','required',JSON_ARRAY('ticket_id','to','subject','body')), JSON_OBJECT('requires_credential_ref', true, 'requires_delivery_approval', true, 'requires_final_provider_gate', true), JSON_OBJECT('window_minutes', 60, 'max_records', 3), JSON_OBJECT('window_minutes', 1440, 'max_records', 5), JSON_OBJECT('required', true, 'header', 'Idempotency-Key'), JSON_OBJECT('readback_required', true, 'provider_message_id_required_when_enabled', true), JSON_OBJECT('audit_required', true, 'timeline_event_required', true), JSON_OBJECT('external_send_supported', false, 'provider_dispatch_enabled', false, 'adapter_implemented', false, 'external_send_performed', false, 'secrets_included', false), 'planned'),
('mailgun_email_adapter', 'email_delivery', 'email', 'not_implemented', 0, 0, 'email_delivery_credential', JSON_ARRAY('admin','customer','both'), JSON_ARRAY('dry_run','record_only','provider_send_blocked'), JSON_OBJECT('type','object','required',JSON_ARRAY('ticket_id','to','subject','body')), JSON_OBJECT('requires_credential_ref', true, 'requires_delivery_approval', true, 'requires_final_provider_gate', true), JSON_OBJECT('window_minutes', 60, 'max_records', 3), JSON_OBJECT('window_minutes', 1440, 'max_records', 5), JSON_OBJECT('required', true, 'header', 'Idempotency-Key'), JSON_OBJECT('readback_required', true, 'provider_message_id_required_when_enabled', true), JSON_OBJECT('audit_required', true, 'timeline_event_required', true), JSON_OBJECT('external_send_supported', false, 'provider_dispatch_enabled', false, 'adapter_implemented', false, 'external_send_performed', false, 'secrets_included', false), 'planned'),
('amazon_ses_email_adapter', 'email_delivery', 'email', 'not_implemented', 0, 0, 'email_delivery_credential', JSON_ARRAY('admin','customer','both'), JSON_ARRAY('dry_run','record_only','provider_send_blocked'), JSON_OBJECT('type','object','required',JSON_ARRAY('ticket_id','to','subject','body')), JSON_OBJECT('requires_credential_ref', true, 'requires_delivery_approval', true, 'requires_final_provider_gate', true), JSON_OBJECT('window_minutes', 60, 'max_records', 3), JSON_OBJECT('window_minutes', 1440, 'max_records', 5), JSON_OBJECT('required', true, 'header', 'Idempotency-Key'), JSON_OBJECT('readback_required', true, 'provider_message_id_required_when_enabled', true), JSON_OBJECT('audit_required', true, 'timeline_event_required', true), JSON_OBJECT('external_send_supported', false, 'provider_dispatch_enabled', false, 'adapter_implemented', false, 'external_send_performed', false, 'secrets_included', false), 'planned'),
('postmark_email_adapter', 'email_delivery', 'email', 'not_implemented', 0, 0, 'email_delivery_credential', JSON_ARRAY('admin','customer','both'), JSON_ARRAY('dry_run','record_only','provider_send_blocked'), JSON_OBJECT('type','object','required',JSON_ARRAY('ticket_id','to','subject','body')), JSON_OBJECT('requires_credential_ref', true, 'requires_delivery_approval', true, 'requires_final_provider_gate', true), JSON_OBJECT('window_minutes', 60, 'max_records', 3), JSON_OBJECT('window_minutes', 1440, 'max_records', 5), JSON_OBJECT('required', true, 'header', 'Idempotency-Key'), JSON_OBJECT('readback_required', true, 'provider_message_id_required_when_enabled', true), JSON_OBJECT('audit_required', true, 'timeline_event_required', true), JSON_OBJECT('external_send_supported', false, 'provider_dispatch_enabled', false, 'adapter_implemented', false, 'external_send_performed', false, 'secrets_included', false), 'planned'),
('generic_webhook_adapter', 'webhook_delivery', 'webhook', 'not_implemented', 0, 0, 'webhook_delivery_credential', JSON_ARRAY('admin','customer','both'), JSON_ARRAY('dry_run','record_only','provider_send_blocked'), JSON_OBJECT('type','object','required',JSON_ARRAY('ticket_id','url_ref','payload')), JSON_OBJECT('requires_credential_ref', true, 'requires_delivery_approval', true, 'requires_final_provider_gate', true, 'requires_timeout_policy', true), JSON_OBJECT('window_minutes', 60, 'max_records', 3), JSON_OBJECT('window_minutes', 1440, 'max_records', 5), JSON_OBJECT('required', true, 'header', 'Idempotency-Key'), JSON_OBJECT('readback_required', true, 'ack_required_when_enabled', true), JSON_OBJECT('audit_required', true, 'timeline_event_required', true), JSON_OBJECT('external_send_supported', false, 'provider_dispatch_enabled', false, 'adapter_implemented', false, 'external_send_performed', false, 'secrets_included', false), 'planned'),
('signed_webhook_adapter', 'webhook_delivery', 'webhook', 'not_implemented', 0, 0, 'webhook_delivery_credential', JSON_ARRAY('admin','customer','both'), JSON_ARRAY('dry_run','record_only','provider_send_blocked'), JSON_OBJECT('type','object','required',JSON_ARRAY('ticket_id','url_ref','payload','signature_profile')), JSON_OBJECT('requires_credential_ref', true, 'requires_signature', true, 'requires_delivery_approval', true, 'requires_final_provider_gate', true), JSON_OBJECT('window_minutes', 60, 'max_records', 3), JSON_OBJECT('window_minutes', 1440, 'max_records', 5), JSON_OBJECT('required', true, 'header', 'Idempotency-Key'), JSON_OBJECT('readback_required', true, 'ack_required_when_enabled', true), JSON_OBJECT('audit_required', true, 'timeline_event_required', true), JSON_OBJECT('external_send_supported', false, 'provider_dispatch_enabled', false, 'adapter_implemented', false, 'external_send_performed', false, 'secrets_included', false), 'planned'),
('hmac_webhook_adapter', 'webhook_delivery', 'webhook', 'not_implemented', 0, 0, 'webhook_delivery_credential', JSON_ARRAY('admin','customer','both'), JSON_ARRAY('dry_run','record_only','provider_send_blocked'), JSON_OBJECT('type','object','required',JSON_ARRAY('ticket_id','url_ref','payload','hmac_profile')), JSON_OBJECT('requires_credential_ref', true, 'requires_hmac_signature', true, 'requires_delivery_approval', true, 'requires_final_provider_gate', true), JSON_OBJECT('window_minutes', 60, 'max_records', 3), JSON_OBJECT('window_minutes', 1440, 'max_records', 5), JSON_OBJECT('required', true, 'header', 'Idempotency-Key'), JSON_OBJECT('readback_required', true, 'ack_required_when_enabled', true), JSON_OBJECT('audit_required', true, 'timeline_event_required', true), JSON_OBJECT('external_send_supported', false, 'provider_dispatch_enabled', false, 'adapter_implemented', false, 'external_send_performed', false, 'secrets_included', false), 'planned'),
('platform_callback_adapter', 'webhook_delivery', 'webhook', 'not_implemented', 0, 0, 'webhook_delivery_credential', JSON_ARRAY('admin','customer','both'), JSON_ARRAY('dry_run','record_only','provider_send_blocked'), JSON_OBJECT('type','object','required',JSON_ARRAY('ticket_id','callback_ref','payload')), JSON_OBJECT('requires_credential_ref', true, 'requires_callback_allowlist', true, 'requires_delivery_approval', true, 'requires_final_provider_gate', true), JSON_OBJECT('window_minutes', 60, 'max_records', 3), JSON_OBJECT('window_minutes', 1440, 'max_records', 5), JSON_OBJECT('required', true, 'header', 'Idempotency-Key'), JSON_OBJECT('readback_required', true, 'ack_required_when_enabled', true), JSON_OBJECT('audit_required', true, 'timeline_event_required', true), JSON_OBJECT('external_send_supported', false, 'provider_dispatch_enabled', false, 'adapter_implemented', false, 'external_send_performed', false, 'secrets_included', false), 'planned'),
('whatsapp_business_adapter', 'messaging_delivery', 'messaging', 'future_not_implemented', 0, 0, 'messaging_delivery_credential', JSON_ARRAY('customer'), JSON_ARRAY('dry_run','record_only','provider_send_blocked'), JSON_OBJECT('type','object','required',JSON_ARRAY('ticket_id','recipient_ref','template_ref')), JSON_OBJECT('requires_credential_ref', true, 'requires_opt_in', true, 'requires_delivery_approval', true, 'requires_final_provider_gate', true), JSON_OBJECT('window_minutes', 60, 'max_records', 1), JSON_OBJECT('window_minutes', 1440, 'max_records', 3), JSON_OBJECT('required', true, 'scope', 'messaging_delivery'), JSON_OBJECT('readback_required', true), JSON_OBJECT('audit_required', true), JSON_OBJECT('external_send_supported', false, 'future_phase', true, 'external_send_performed', false, 'secrets_included', false), 'future'),
('sms_adapter', 'messaging_delivery', 'messaging', 'future_not_implemented', 0, 0, 'messaging_delivery_credential', JSON_ARRAY('customer'), JSON_ARRAY('dry_run','record_only','provider_send_blocked'), JSON_OBJECT('type','object','required',JSON_ARRAY('ticket_id','recipient_ref','message_template')), JSON_OBJECT('requires_credential_ref', true, 'requires_opt_in', true, 'requires_delivery_approval', true, 'requires_final_provider_gate', true), JSON_OBJECT('window_minutes', 60, 'max_records', 1), JSON_OBJECT('window_minutes', 1440, 'max_records', 3), JSON_OBJECT('required', true, 'scope', 'messaging_delivery'), JSON_OBJECT('readback_required', true), JSON_OBJECT('audit_required', true), JSON_OBJECT('external_send_supported', false, 'future_phase', true, 'external_send_performed', false, 'secrets_included', false), 'future')
ON DUPLICATE KEY UPDATE
  `family_key`=VALUES(`family_key`), `channel`=VALUES(`channel`), `implementation_status`=VALUES(`implementation_status`),
  `dispatch_enabled`=VALUES(`dispatch_enabled`), `provider_dispatch_enabled`=VALUES(`provider_dispatch_enabled`),
  `required_credential_type`=VALUES(`required_credential_type`), `supported_audiences_json`=VALUES(`supported_audiences_json`),
  `send_modes_json`=VALUES(`send_modes_json`), `payload_schema_json`=VALUES(`payload_schema_json`),
  `preflight_schema_json`=VALUES(`preflight_schema_json`), `rate_limit_json`=VALUES(`rate_limit_json`),
  `retry_policy_json`=VALUES(`retry_policy_json`), `idempotency_policy_json`=VALUES(`idempotency_policy_json`),
  `readback_policy_json`=VALUES(`readback_policy_json`), `audit_policy_json`=VALUES(`audit_policy_json`),
  `safety_json`=VALUES(`safety_json`), `status`=VALUES(`status`), `updated_at`=CURRENT_TIMESTAMP;

INSERT INTO `external_delivery_provider_send_mode_policy_registry` (
  `policy_key`, `adapter_key`, `mode_key`, `mode_status`, `approval_required`, `credential_required`,
  `final_approval_required`, `provider_dispatch_required`, `external_send_performed_default`, `safety_json`, `notes`, `status`
)
SELECT CONCAT(adapter_key, '_dry_run'), adapter_key, 'dry_run', 'allowed_readonly', 0, 0, 0, 0, 0,
       JSON_OBJECT('external_send_performed', false, 'secrets_included', false),
       'Dry-run/readback only. No provider dispatch.', 'active'
  FROM `external_delivery_provider_adapter_contract_registry`
ON DUPLICATE KEY UPDATE `mode_status`=VALUES(`mode_status`), `safety_json`=VALUES(`safety_json`), `notes`=VALUES(`notes`), `status`=VALUES(`status`), `updated_at`=CURRENT_TIMESTAMP;

INSERT INTO `external_delivery_provider_send_mode_policy_registry` (
  `policy_key`, `adapter_key`, `mode_key`, `mode_status`, `approval_required`, `credential_required`,
  `final_approval_required`, `provider_dispatch_required`, `external_send_performed_default`, `safety_json`, `notes`, `status`
)
SELECT CONCAT(adapter_key, '_record_only'), adapter_key, 'record_only', 'allowed_internal_record_only', 1, CASE WHEN required_credential_type IS NULL THEN 0 ELSE 1 END, 1, 0, 0,
       JSON_OBJECT('external_send_performed', false, 'record_only', true, 'secrets_included', false),
       'Internal record/timeline/audit only. No external provider dispatch.', 'active'
  FROM `external_delivery_provider_adapter_contract_registry`
ON DUPLICATE KEY UPDATE `mode_status`=VALUES(`mode_status`), `approval_required`=VALUES(`approval_required`), `credential_required`=VALUES(`credential_required`), `safety_json`=VALUES(`safety_json`), `notes`=VALUES(`notes`), `status`=VALUES(`status`), `updated_at`=CURRENT_TIMESTAMP;

INSERT INTO `external_delivery_provider_send_mode_policy_registry` (
  `policy_key`, `adapter_key`, `mode_key`, `mode_status`, `approval_required`, `credential_required`,
  `final_approval_required`, `provider_dispatch_required`, `external_send_performed_default`, `safety_json`, `notes`, `status`
)
SELECT CONCAT(adapter_key, '_provider_send_blocked'), adapter_key, 'provider_send_blocked', 'blocked_until_adapter_implemented_and_dispatch_enabled', 1, CASE WHEN required_credential_type IS NULL THEN 0 ELSE 1 END, 1, 1, 0,
       JSON_OBJECT('external_send_performed', false, 'provider_dispatch_enabled', false, 'adapter_implemented', false, 'secrets_included', false),
       'Provider send is intentionally blocked until an explicit future adapter implementation and dispatch enablement policy is merged.', 'active'
  FROM `external_delivery_provider_adapter_contract_registry`
 WHERE channel IN ('email','webhook','messaging')
ON DUPLICATE KEY UPDATE `mode_status`=VALUES(`mode_status`), `approval_required`=VALUES(`approval_required`), `credential_required`=VALUES(`credential_required`), `final_approval_required`=VALUES(`final_approval_required`), `provider_dispatch_required`=VALUES(`provider_dispatch_required`), `safety_json`=VALUES(`safety_json`), `notes`=VALUES(`notes`), `status`=VALUES(`status`), `updated_at`=CURRENT_TIMESTAMP;

CREATE OR REPLACE VIEW `v_external_delivery_provider_contract_readiness` AS
SELECT
  a.adapter_key,
  a.family_key,
  f.display_name AS family_display_name,
  a.channel,
  a.implementation_status,
  a.dispatch_enabled,
  a.provider_dispatch_enabled,
  a.required_credential_type,
  a.status,
  CASE
    WHEN a.channel = 'internal' AND a.dispatch_enabled = 1 AND a.implementation_status = 'implemented_record_only' THEN 'ready_internal_record_only'
    WHEN a.provider_dispatch_enabled = 0 THEN 'blocked_provider_dispatch_disabled'
    WHEN a.implementation_status NOT IN ('implemented','implemented_record_only') THEN 'blocked_adapter_not_implemented'
    ELSE 'requires_final_policy_review'
  END AS readiness_status,
  JSON_OBJECT(
    'adapter_key', a.adapter_key,
    'family_key', a.family_key,
    'channel', a.channel,
    'implementation_status', a.implementation_status,
    'dispatch_enabled', a.dispatch_enabled,
    'provider_dispatch_enabled', a.provider_dispatch_enabled,
    'external_send_performed', false,
    'secrets_included', false
  ) AS evidence_json,
  0 AS external_send_performed,
  0 AS secrets_included
FROM `external_delivery_provider_adapter_contract_registry` a
JOIN `external_delivery_provider_family_registry` f ON f.family_key = a.family_key;

INSERT INTO `execution_policies` (
  `policy_group`, `policy_key`, `policy_value`, `active`,
  `execution_scope`, `affects_layer`, `blocking`, `notes`
)
SELECT 'Support Ticket External Delivery Governance', 'external_provider_adapter_contract_policy_v1',
       JSON_OBJECT(
         'rule','external_provider_adapter_contracts_are_registry_only',
         'default_provider_dispatch_enabled', false,
         'default_adapter_implemented', false,
         'no_external_send', true,
         'no_secret_payload_read', true,
         'allowed_modes', JSON_ARRAY('dry_run','record_only','provider_send_blocked'),
         'future_provider_send_requires_new_policy', true,
         'secrets_included', false
       ),
       'TRUE',
       'support_ticket_external_delivery|provider_adapter_contract|provider_gate',
       'external_delivery_provider_*|supportTicketExternalProviderContractService|supportTicketExternalSendProviderGateService',
       'TRUE',
       'External delivery provider adapter contracts are registry/readback only; provider dispatch stays disabled until a future explicit implementation and policy gate.'
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group`='Support Ticket External Delivery Governance'
     AND `policy_key`='external_provider_adapter_contract_policy_v1'
);

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES (
  'support_ticket_external_provider_contracts',
  'Support Ticket External Provider Contracts',
  'Read-only provider family, adapter contract, and send-mode policy readback for support ticket external delivery. Does not send externally or expose secrets.',
  'GET',
  '/admin/support/tickets/external-send/provider-contracts',
  JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'family_key',JSON_OBJECT('type','string'),
      'channel',JSON_OBJECT('type','string'),
      'include_disabled',JSON_OBJECT('type','boolean','default',true),
      'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',200,'default',100)
    ),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,external_delivery,provider_contracts,read_only,no_external_send,no_secrets',
  1,
  484
) ON DUPLICATE KEY UPDATE
  `display_name`=VALUES(`display_name`), `description`=VALUES(`description`),
  `http_method`=VALUES(`http_method`), `http_path`=VALUES(`http_path`),
  `path_param_keys`=VALUES(`path_param_keys`), `input_schema`=VALUES(`input_schema`),
  `fixed_body`=VALUES(`fixed_body`), `tags`=VALUES(`tags`), `is_enabled`=VALUES(`is_enabled`),
  `sort_order`=VALUES(`sort_order`), `updated_at`=CURRENT_TIMESTAMP;
