-- Sprint 68: Support Ticket External Delivery Completion Certification
-- Completes safe end-to-end external delivery scope: dispatcher skeleton, sandbox/null adapter evidence,
-- live rollout gates, and completion certification tooling. Additive/idempotent only.
-- No external send, no provider network call, no raw secrets.

UPDATE `execution_policies`
   SET `policy_value` = JSON_SET(
         COALESCE(`policy_value`, JSON_OBJECT()),
         '$.completion_certification_required', true,
         '$.safe_dispatch_interface_required', true,
         '$.sandbox_mode_allowed_without_external_send', true,
         '$.live_send_requires_future_enablement', true,
         '$.allowed_modes', JSON_ARRAY('dry_run','record_only','provider_send_blocked','sandbox','live_send'),
         '$.no_external_send', true,
         '$.secrets_included', false
       ),
       `execution_scope` = CONCAT_WS('|', `execution_scope`, 'support_ticket_external_delivery_completion', 'provider_dispatch_interface', 'sandbox_dispatch', 'live_dispatch_gate'),
       `affects_layer` = CONCAT_WS('|', `affects_layer`, 'supportTicketExternalProviderDispatchService', 'supportTicketExternalDeliveryCompletionService'),
       `blocking` = 'TRUE',
       `active` = 'TRUE',
       `updated_at` = CURRENT_TIMESTAMP
 WHERE `policy_group` = 'Support Ticket External Delivery Governance'
   AND `policy_key` IN ('external_provider_gate_registry_resolver_policy_v1','external_provider_adapter_contract_policy_v1');

INSERT INTO `execution_policies` (`policy_group`, `policy_key`, `policy_value`, `active`, `execution_scope`, `affects_layer`, `blocking`, `notes`)
VALUES (
  'Support Ticket External Delivery Governance',
  'support_ticket_external_delivery_completion_certification_policy_v1',
  JSON_OBJECT(
    'rule','support_ticket_external_delivery_requires_completion_certification_before_live_enablement',
    'required_phases', JSON_ARRAY('AM-1','AM-2','AM-3','AM-4','AM-5','AM-6','AM-7','AM-8','AM-9','AM-10','AM-11','AM-12','AM-13','AM-14','AM-15','AM-16'),
    'live_external_send_default_enabled', false,
    'sandbox_mode_network_allowed', false,
    'no_external_send', true,
    'provider_dispatch_enabled', false,
    'raw_credential_values_allowed_in_response', false,
    'idempotency_required_before_live_send', true,
    'approval_required_before_live_send', true,
    'tenant_enablement_required_before_live_send', true,
    'release_readiness_required_before_live_send', true,
    'secrets_included', false
  ),
  'TRUE',
  'support_ticket_external_delivery_completion|provider_dispatch_interface|sandbox_dispatch|live_dispatch_gate',
  'supportTicketExternalDeliveryCompletionService|supportTicketExternalProviderDispatchService|supportTicketExternalSendProviderGateService',
  'TRUE',
  'External delivery completion certification is required before any future live provider dispatch enablement. This policy remains no-send/no-secret by default.'
)
ON DUPLICATE KEY UPDATE
  `policy_value` = VALUES(`policy_value`), `active` = VALUES(`active`), `execution_scope` = VALUES(`execution_scope`),
  `affects_layer` = VALUES(`affects_layer`), `blocking` = VALUES(`blocking`), `notes` = VALUES(`notes`), `updated_at` = CURRENT_TIMESTAMP;

UPDATE `external_delivery_provider_adapter_contract_registry`
   SET `send_modes_json` = JSON_ARRAY('dry_run','record_only','provider_send_blocked','sandbox','live_send'),
       `implementation_status` = CASE
         WHEN `adapter_key` = 'smtp_email_adapter' THEN 'skeleton_dispatch_interface_no_network'
         WHEN `adapter_key` = 'generic_webhook_adapter' THEN 'skeleton_dispatch_interface_no_network'
         ELSE `implementation_status`
       END,
       `safety_json` = JSON_SET(COALESCE(`safety_json`, JSON_OBJECT()), '$.safe_dispatch_interface_present', true, '$.sandbox_mode_network_allowed', false, '$.live_send_supported', false, '$.external_send_performed', false, '$.secrets_included', false),
       `updated_at` = CURRENT_TIMESTAMP
 WHERE `adapter_key` IN ('smtp_email_adapter','generic_webhook_adapter');

INSERT INTO `external_delivery_provider_send_mode_policy_registry` (`policy_key`, `adapter_key`, `mode_key`, `mode_status`, `approval_required`, `credential_required`, `final_approval_required`, `provider_dispatch_required`, `external_send_performed_default`, `safety_json`, `notes`, `status`)
SELECT CONCAT(adapter_key, '_sandbox'), adapter_key, 'sandbox', 'allowed_sandbox_no_network', 0, 0, 0, 0, 0,
       JSON_OBJECT('sandbox', true, 'network_request_performed', false, 'external_send_performed', false, 'secrets_included', false),
       'Sandbox/null provider response only. No SMTP/webhook/network dispatch.', 'active'
  FROM `external_delivery_provider_adapter_contract_registry`
 WHERE adapter_key IN ('smtp_email_adapter','generic_webhook_adapter')
ON DUPLICATE KEY UPDATE `mode_status`=VALUES(`mode_status`), `approval_required`=VALUES(`approval_required`), `credential_required`=VALUES(`credential_required`), `final_approval_required`=VALUES(`final_approval_required`), `provider_dispatch_required`=VALUES(`provider_dispatch_required`), `external_send_performed_default`=VALUES(`external_send_performed_default`), `safety_json`=VALUES(`safety_json`), `notes`=VALUES(`notes`), `status`=VALUES(`status`), `updated_at`=CURRENT_TIMESTAMP;

INSERT INTO `external_delivery_provider_send_mode_policy_registry` (`policy_key`, `adapter_key`, `mode_key`, `mode_status`, `approval_required`, `credential_required`, `final_approval_required`, `provider_dispatch_required`, `external_send_performed_default`, `safety_json`, `notes`, `status`)
SELECT CONCAT(adapter_key, '_live_send'), adapter_key, 'live_send', 'blocked_until_tenant_rollout_and_future_provider_enablement', 1, 1, 1, 1, 0,
       JSON_OBJECT('live_send', true, 'enabled_by_default', false, 'external_send_performed', false, 'secrets_included', false),
       'Live send remains blocked until future adapter implementation, tenant enablement, approval, idempotency, and release readiness gates pass.', 'active'
  FROM `external_delivery_provider_adapter_contract_registry`
 WHERE adapter_key IN ('smtp_email_adapter','generic_webhook_adapter')
ON DUPLICATE KEY UPDATE `mode_status`=VALUES(`mode_status`), `approval_required`=VALUES(`approval_required`), `credential_required`=VALUES(`credential_required`), `final_approval_required`=VALUES(`final_approval_required`), `provider_dispatch_required`=VALUES(`provider_dispatch_required`), `external_send_performed_default`=VALUES(`external_send_performed_default`), `safety_json`=VALUES(`safety_json`), `notes`=VALUES(`notes`), `status`=VALUES(`status`), `updated_at`=CURRENT_TIMESTAMP;

INSERT INTO `platform_engine_policy_registry` (`policy_key`, `engine_key`, `scope_type`, `scope_id`, `mode`, `risk_default`, `approval_required_min_risk`, `require_scope_guard`, `require_audit`, `require_validators`, `max_changes_json`, `validators_json`, `blocked_terms_json`, `allowed_resource_patterns_json`, `blocked_resource_patterns_json`, `status`, `notes`)
VALUES ('support_ticket_external_delivery_completion_certification_policy_v1','support_ticket_lifecycle_orchestrator','global',NULL,'blocking','high','medium',1,1,1,
  JSON_OBJECT('max_live_sends',0,'max_external_network_calls',0),
  JSON_ARRAY('certifySupportTicketExternalDeliveryCompletion','planSupportTicketExternalProviderDispatch'),
  JSON_ARRAY('sendMail','nodemailer','fetch(','axios','legacy_provider_send_flag'),
  JSON_ARRAY('support_ticket_external_delivery_completion','provider_dispatch_interface','sandbox_dispatch'),
  JSON_ARRAY('live_external_send_without_future_policy'), 'active',
  'Completion certification for Support Ticket external delivery requires no-send/no-secret dispatcher and live rollout gates.')
ON DUPLICATE KEY UPDATE `engine_key`=VALUES(`engine_key`), `mode`=VALUES(`mode`), `risk_default`=VALUES(`risk_default`), `approval_required_min_risk`=VALUES(`approval_required_min_risk`), `require_scope_guard`=VALUES(`require_scope_guard`), `require_audit`=VALUES(`require_audit`), `require_validators`=VALUES(`require_validators`), `max_changes_json`=VALUES(`max_changes_json`), `validators_json`=VALUES(`validators_json`), `blocked_terms_json`=VALUES(`blocked_terms_json`), `allowed_resource_patterns_json`=VALUES(`allowed_resource_patterns_json`), `blocked_resource_patterns_json`=VALUES(`blocked_resource_patterns_json`), `status`=VALUES(`status`), `notes`=VALUES(`notes`), `updated_at`=CURRENT_TIMESTAMP;

INSERT INTO `platform_engine_policy_rules` (`rule_key`, `policy_key`, `engine_key`, `priority`, `task_class`, `resource_kind`, `resource_pattern`, `condition_json`, `strategy_key`, `risk_level`, `auto_apply_allowed`, `dry_run_required`, `approval_required`, `validator_commands_json`, `blocked_terms_json`, `allowed_terms_json`, `required_skill_keys_json`, `status`, `notes`)
VALUES ('support_ticket_external_delivery_completion_certification_target_rule_v1', 'support_ticket_external_delivery_completion_certification_policy_v1','support_ticket_lifecycle_orchestrator',960, 'completion_certification','support_ticket_external_delivery','support_ticket_external_delivery_completion', JSON_OBJECT('execution_policy_group','Support Ticket External Delivery Governance','execution_policy_key','support_ticket_external_delivery_completion_certification_policy_v1'), 'support_ticket_external_delivery_completion_preflight','high',0,1,1, JSON_ARRAY('certifySupportTicketExternalDeliveryCompletion','test-ticket-external-delivery-completion-certification.mjs'), JSON_ARRAY('sendMail','nodemailer','raw_secret','external_send_performed:true'), JSON_ARRAY('sandbox','live_send_gated','completion_certification'), JSON_ARRAY('support_ticket_external_delivery'), 'active', 'Target rule for external delivery completion certification and live-send gate closure.')
ON DUPLICATE KEY UPDATE `policy_key`=VALUES(`policy_key`), `engine_key`=VALUES(`engine_key`), `priority`=VALUES(`priority`), `task_class`=VALUES(`task_class`), `resource_kind`=VALUES(`resource_kind`), `resource_pattern`=VALUES(`resource_pattern`), `condition_json`=VALUES(`condition_json`), `strategy_key`=VALUES(`strategy_key`), `risk_level`=VALUES(`risk_level`), `auto_apply_allowed`=VALUES(`auto_apply_allowed`), `dry_run_required`=VALUES(`dry_run_required`), `approval_required`=VALUES(`approval_required`), `validator_commands_json`=VALUES(`validator_commands_json`), `blocked_terms_json`=VALUES(`blocked_terms_json`), `allowed_terms_json`=VALUES(`allowed_terms_json`), `required_skill_keys_json`=VALUES(`required_skill_keys_json`), `status`=VALUES(`status`), `notes`=VALUES(`notes`), `updated_at`=CURRENT_TIMESTAMP;

INSERT INTO `admin_platform_endpoint_tools` (`tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`)
VALUES ('support_ticket_external_delivery_completion_certify', 'Support Ticket External Delivery Completion Certify', 'Certify all Support Ticket external delivery phases AM-1..AM-16 for a ticket without external send or raw secrets. Live provider dispatch remains gated and disabled by default.', 'POST', '/admin/support/tickets/{ticket_id}/external-delivery/completion-certification', JSON_ARRAY('ticket_id'), JSON_OBJECT('type','object','required',JSON_ARRAY('ticket_id'),'properties',JSON_OBJECT('ticket_id',JSON_OBJECT('type','string'),'tenant_id',JSON_OBJECT('type','string'),'channel',JSON_OBJECT('type','string','enum',JSON_ARRAY('email','webhook'),'default','email'),'audience',JSON_OBJECT('type','string','enum',JSON_ARRAY('admin','customer','both'),'default','admin'),'provider_key',JSON_OBJECT('type','string'),'send_mode',JSON_OBJECT('type','string','enum',JSON_ARRAY('dry_run','record_only','provider_send_blocked','sandbox','live_send'),'default','dry_run'),'approval_hold_id',JSON_OBJECT('type','string'),'credential_ref',JSON_OBJECT('type','string'),'idempotency_key',JSON_OBJECT('type','string'),'subject',JSON_OBJECT('type','string'),'body',JSON_OBJECT('type','string'),'payload_json',JSON_OBJECT('type','object')), 'additionalProperties', false), NULL, 'admin,support,tickets,external_delivery,completion_certification,provider_dispatch_interface,sandbox,no_external_send,no_secrets', 1, 488)
ON DUPLICATE KEY UPDATE `display_name`=VALUES(`display_name`), `description`=VALUES(`description`), `http_method`=VALUES(`http_method`), `http_path`=VALUES(`http_path`), `path_param_keys`=VALUES(`path_param_keys`), `input_schema`=VALUES(`input_schema`), `fixed_body`=VALUES(`fixed_body`), `tags`=VALUES(`tags`), `is_enabled`=VALUES(`is_enabled`), `sort_order`=VALUES(`sort_order`), `updated_at`=CURRENT_TIMESTAMP;
