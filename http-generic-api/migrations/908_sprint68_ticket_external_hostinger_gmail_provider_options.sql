-- Sprint 68: Support Ticket external delivery Hostinger SMTP and user Gmail provider options
-- Purpose: add explicit provider adapter contracts for platform-managed Hostinger SMTP
-- and user-owned Gmail OAuth delivery. No dispatch flags are enabled by this migration.
-- Safety: additive/idempotent, no secrets, no destructive statements.

INSERT INTO `external_delivery_provider_adapter_contract_registry` (
  `adapter_key`, `family_key`, `channel`, `implementation_status`, `dispatch_enabled`, `provider_dispatch_enabled`,
  `required_credential_type`, `supported_audiences_json`, `send_modes_json`, `payload_schema_json`, `preflight_schema_json`,
  `rate_limit_json`, `retry_policy_json`, `idempotency_policy_json`, `readback_policy_json`, `audit_policy_json`, `safety_json`, `status`
) VALUES
  ('hostinger_smtp_adapter', 'email_delivery', 'email', 'implemented_gated_smtp_runtime', 0, 0,
   'hostinger_smtp_credential', JSON_ARRAY('admin','customer','both'), JSON_ARRAY('dry_run','record_only','provider_send_blocked','sandbox','live_send'),
   JSON_OBJECT('type','object','required',JSON_ARRAY('ticket_id','to','subject','body')),
   JSON_OBJECT('requires_credential_ref', true, 'requires_delivery_approval', true, 'requires_final_provider_gate', true, 'requires_smtp_url', true, 'requires_recipient_allowlist', true),
   JSON_OBJECT('window_minutes', 60, 'max_records', 3),
   JSON_OBJECT('window_minutes', 1440, 'max_records', 5),
   JSON_OBJECT('required', true, 'scope', 'support_ticket_external_delivery'),
   JSON_OBJECT('readback_required', true, 'provider_message_id_required_when_enabled', true),
   JSON_OBJECT('audit_required', true, 'timeline_event_required', true),
   JSON_OBJECT('external_send_supported', true, 'live_send_enabled_by_default', false, 'runtime', 'hostinger_smtp_smtps_only', 'requires_smtp_url', true, 'requires_recipient_allowlist', true, 'requires_approval_hold', true, 'requires_credential_ref', true, 'requires_idempotency_key', true, 'secret_value_included', false, 'secrets_included', false),
   'planned'),
  ('gmail_user_oauth_adapter', 'email_delivery', 'email', 'implemented_gated_gmail_user_oauth_runtime', 0, 0,
   'google_user_oauth_connection', JSON_ARRAY('admin','customer','both'), JSON_ARRAY('dry_run','record_only','provider_send_blocked','sandbox','live_send'),
   JSON_OBJECT('type','object','required',JSON_ARRAY('ticket_id','to','subject','body','google_oauth_config_ref')),
   JSON_OBJECT('requires_credential_ref', true, 'requires_delivery_approval', true, 'requires_final_provider_gate', true, 'requires_google_user_oauth_connection', true, 'requires_gmail_send_scope', true, 'requires_recipient_allowlist', true),
   JSON_OBJECT('window_minutes', 60, 'max_records', 3),
   JSON_OBJECT('window_minutes', 1440, 'max_records', 5),
   JSON_OBJECT('required', true, 'scope', 'support_ticket_external_delivery'),
   JSON_OBJECT('readback_required', true, 'gmail_message_id_required_when_enabled', true),
   JSON_OBJECT('audit_required', true, 'timeline_event_required', true),
   JSON_OBJECT('external_send_supported', true, 'live_send_enabled_by_default', false, 'runtime', 'gmail_user_oauth', 'requires_google_user_connection', true, 'required_scope', 'https://www.googleapis.com/auth/gmail.send', 'requires_recipient_allowlist', true, 'requires_approval_hold', true, 'requires_credential_ref', true, 'requires_idempotency_key', true, 'secret_value_included', false, 'secrets_included', false),
   'planned')
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
) VALUES
  ('hostinger_smtp_adapter_live_send', 'hostinger_smtp_adapter', 'live_send', 'blocked_until_explicit_dispatch_enablement_and_runtime_gates', 1, 1, 1, 1, 0,
   JSON_OBJECT('enabled_by_default', false, 'requires_smtp_url', true, 'requires_recipient_allowlist', true, 'requires_approval_hold', true, 'requires_credential_ref', true, 'requires_idempotency_key', true, 'external_send_performed_default', false, 'secret_value_included', false, 'secrets_included', false),
   'Hostinger SMTP live send requires explicit dispatch enablement plus runtime gates. It is not enabled by default.', 'active'),
  ('gmail_user_oauth_adapter_live_send', 'gmail_user_oauth_adapter', 'live_send', 'blocked_until_explicit_dispatch_enablement_and_runtime_gates', 1, 1, 1, 1, 0,
   JSON_OBJECT('enabled_by_default', false, 'requires_google_user_connection', true, 'required_scope', 'https://www.googleapis.com/auth/gmail.send', 'requires_recipient_allowlist', true, 'requires_approval_hold', true, 'requires_credential_ref', true, 'requires_idempotency_key', true, 'external_send_performed_default', false, 'secret_value_included', false, 'secrets_included', false),
   'Gmail user-owned live send requires an active user_app_connections OAuth row with Gmail send scope plus explicit dispatch enablement and runtime gates.', 'active')
ON DUPLICATE KEY UPDATE
  `mode_status`=VALUES(`mode_status`), `approval_required`=VALUES(`approval_required`), `credential_required`=VALUES(`credential_required`),
  `final_approval_required`=VALUES(`final_approval_required`), `provider_dispatch_required`=VALUES(`provider_dispatch_required`),
  `external_send_performed_default`=VALUES(`external_send_performed_default`), `safety_json`=VALUES(`safety_json`),
  `notes`=VALUES(`notes`), `status`=VALUES(`status`), `updated_at`=CURRENT_TIMESTAMP;

INSERT INTO `execution_policies` (
  `policy_group`, `policy_key`, `policy_value`, `active`,
  `execution_scope`, `affects_layer`, `blocking`, `notes`
) VALUES
  ('Support Ticket External Delivery Governance', 'support_ticket_external_delivery_dual_provider_policy_v1',
   JSON_OBJECT(
     'providers', JSON_ARRAY('hostinger_smtp_adapter','gmail_user_oauth_adapter'),
     'hostinger_source', 'platform_or_tenant_secret_reference',
     'gmail_source', 'user_app_connections_oauth2',
     'enabled_by_default', false,
     'requires_explicit_mode', 'live_send',
     'requires_dispatch_enabled', true,
     'requires_provider_dispatch_enabled', true,
     'requires_approval_hold', true,
     'requires_credential_ref', true,
     'requires_idempotency_key', true,
     'requires_recipient_allowlist', true,
     'forbids_secret_response', true,
     'secret_value_included', false,
     'secrets_included', false
   ),
   'TRUE', 'support_ticket_external_delivery_dual_provider_runtime', 'supportTicketExternalLiveSendService|supportTicketExternalSendProviderGateService|user_app_connections|secret_references', 'TRUE',
   'Support Ticket external delivery may use Hostinger SMTP or user-owned Gmail OAuth only after explicit dispatch enablement and all runtime gates pass.')
ON DUPLICATE KEY UPDATE
  `policy_value`=VALUES(`policy_value`), `active`=VALUES(`active`), `execution_scope`=VALUES(`execution_scope`),
  `affects_layer`=VALUES(`affects_layer`), `blocking`=VALUES(`blocking`), `notes`=VALUES(`notes`), `updated_at`=CURRENT_TIMESTAMP;
