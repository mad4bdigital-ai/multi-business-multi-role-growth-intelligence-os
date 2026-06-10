-- Sprint 68: Ticket External Provider Gate Registry Resolver Schema Alignment
-- Aligns provider gate tool schemas with DB adapter contract/send-mode authority.
-- This migration is additive/idempotent registry metadata only. It does not implement SMTP, enable dispatch, read secrets, or send externally.

UPDATE `admin_platform_endpoint_tools`
   SET `input_schema` = JSON_OBJECT(
         'type','object',
         'properties',JSON_OBJECT(
           'tenant_id',JSON_OBJECT('type','string'),
           'channel',JSON_OBJECT('type','string','enum',JSON_ARRAY('email','webhook'),'default','email'),
           'audience',JSON_OBJECT('type','string','enum',JSON_ARRAY('admin','customer','both'),'default','admin'),
           'approval_hold_id',JSON_OBJECT('type','string'),
           'credential_ref',JSON_OBJECT('type','string'),
           'provider_key',JSON_OBJECT('type','string','description','Adapter key from external_delivery_provider_adapter_contract_registry, for example smtp_email_adapter or generic_webhook_adapter.'),
           'send_mode',JSON_OBJECT('type','string','enum',JSON_ARRAY('dry_run','record_only','provider_send_blocked'),'default','dry_run'),
           'subject',JSON_OBJECT('type','string'),
           'body',JSON_OBJECT('type','string'),
           'payload_json',JSON_OBJECT('type','object')
         ),
         'additionalProperties',false
       ),
       `description` = 'Plan support ticket external provider gate using DB adapter contracts and send-mode policy registry. No external send is performed and secrets are not exposed.',
       `tags` = 'admin,support,tickets,external_delivery,provider_gate,adapter_contract_registry,read_only,no_external_send,no_secrets',
       `updated_at` = CURRENT_TIMESTAMP
 WHERE `tool_key` = 'support_ticket_external_send_provider_gate_plan';

UPDATE `admin_platform_endpoint_tools`
   SET `input_schema` = JSON_OBJECT(
         'type','object',
         'properties',JSON_OBJECT(
           'tenant_id',JSON_OBJECT('type','string'),
           'channel',JSON_OBJECT('type','string','enum',JSON_ARRAY('email','webhook'),'default','email'),
           'audience',JSON_OBJECT('type','string','enum',JSON_ARRAY('admin','customer','both'),'default','admin'),
           'approval_hold_id',JSON_OBJECT('type','string'),
           'credential_ref',JSON_OBJECT('type','string'),
           'provider_key',JSON_OBJECT('type','string','description','Adapter key from external_delivery_provider_adapter_contract_registry, for example smtp_email_adapter or generic_webhook_adapter.'),
           'send_mode',JSON_OBJECT('type','string','enum',JSON_ARRAY('dry_run','record_only','provider_send_blocked'),'default','dry_run'),
           'mode',JSON_OBJECT('type','string','enum',JSON_ARRAY('dry_run','record_blocked_attempt'),'default','dry_run'),
           'subject',JSON_OBJECT('type','string'),
           'body',JSON_OBJECT('type','string'),
           'payload_json',JSON_OBJECT('type','object'),
           'actor_id',JSON_OBJECT('type','string'),
           'actor_type',JSON_OBJECT('type','string')
         ),
         'additionalProperties',false
       ),
       `description` = 'Record a blocked support ticket external provider gate attempt using DB adapter contracts and send-mode policy registry. No external send is performed and secrets are not exposed.',
       `tags` = 'admin,support,tickets,external_delivery,provider_gate,adapter_contract_registry,record_blocked_attempt,no_external_send,no_secrets',
       `updated_at` = CURRENT_TIMESTAMP
 WHERE `tool_key` = 'support_ticket_external_send_provider_gate_attempt';

INSERT INTO `execution_policies` (
  `policy_group`, `policy_key`, `policy_value`, `active`,
  `execution_scope`, `affects_layer`, `blocking`, `notes`
)
SELECT 'Support Ticket External Delivery Governance', 'external_provider_gate_registry_resolver_policy_v1',
       JSON_OBJECT(
         'rule','provider_gate_must_resolve_adapter_contracts_from_db_registry',
         'adapter_contract_registry','external_delivery_provider_adapter_contract_registry',
         'send_mode_policy_registry','external_delivery_provider_send_mode_policy_registry',
         'default_email_adapter','smtp_email_adapter',
         'default_webhook_adapter','generic_webhook_adapter',
         'allowed_modes', JSON_ARRAY('dry_run','record_only','provider_send_blocked'),
         'legacy_provider_send_mode_allowed', false,
         'no_external_send', true,
         'provider_dispatch_enabled', false,
         'external_send_performed', false,
         'secrets_included', false
       ),
       'TRUE',
       'support_ticket_external_delivery|provider_gate|adapter_contract_resolver',
       'supportTicketExternalSendProviderGateService|supportTicketExternalProviderContractService|external_delivery_provider_*',
       'TRUE',
       'Provider gate must derive adapter/send-mode authority from SQL registry contracts. Real provider dispatch remains blocked and requires a future explicit policy.'
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group`='Support Ticket External Delivery Governance'
     AND `policy_key`='external_provider_gate_registry_resolver_policy_v1'
);
