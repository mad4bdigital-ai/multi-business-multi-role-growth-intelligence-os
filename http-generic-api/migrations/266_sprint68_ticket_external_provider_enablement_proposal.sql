-- Sprint 68: Ticket External Provider Adapter Enablement Proposal Flow
-- Adds proposal-only governance surface for future adapter enablement reviews.
-- This migration does not enable adapters, does not set provider_dispatch_enabled, does not implement dispatch, and does not send email/webhook externally.
-- Additive, idempotent, no secrets.

CREATE TABLE IF NOT EXISTS `external_delivery_provider_adapter_enablement_proposals` (
  `proposal_id` CHAR(36) NOT NULL,
  `adapter_key` VARCHAR(160) NOT NULL,
  `family_key` VARCHAR(128) NOT NULL,
  `channel` VARCHAR(64) NOT NULL,
  `requested_mode` VARCHAR(80) NOT NULL DEFAULT 'provider_send_blocked',
  `proposal_status` VARCHAR(32) NOT NULL DEFAULT 'proposed',
  `requested_by` VARCHAR(128) NULL,
  `reason` TEXT NULL,
  `current_state_json` JSON NULL,
  `proposed_target_json` JSON NULL,
  `required_gates_json` JSON NULL,
  `blockers_json` JSON NULL,
  `evidence_json` JSON NULL,
  `registry_mutation_performed` TINYINT(1) NOT NULL DEFAULT 0,
  `external_send_performed` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`proposal_id`),
  KEY `idx_external_delivery_enablement_adapter_status` (`adapter_key`, `proposal_status`),
  KEY `idx_external_delivery_enablement_family_channel` (`family_key`, `channel`),
  CONSTRAINT `fk_external_delivery_enablement_adapter` FOREIGN KEY (`adapter_key`) REFERENCES `external_delivery_provider_adapter_contract_registry` (`adapter_key`) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW `v_external_delivery_provider_enablement_proposal_readiness` AS
SELECT
  p.proposal_id,
  p.adapter_key,
  p.family_key,
  p.channel,
  p.requested_mode,
  p.proposal_status,
  a.implementation_status,
  a.dispatch_enabled,
  a.provider_dispatch_enabled,
  a.status AS adapter_status,
  p.registry_mutation_performed,
  p.external_send_performed,
  CASE
    WHEN p.external_send_performed <> 0 THEN 'invalid_external_send_performed'
    WHEN p.registry_mutation_performed <> 0 THEN 'invalid_registry_mutation_performed'
    WHEN a.provider_dispatch_enabled <> 0 THEN 'requires_review_adapter_already_provider_enabled'
    WHEN a.channel = 'internal' THEN 'proposal_review_internal_record_only'
    WHEN a.implementation_status NOT IN ('implemented','implemented_record_only') THEN 'proposal_review_adapter_not_implemented'
    ELSE 'proposal_review_requires_dispatch_policy'
  END AS readiness_status,
  JSON_OBJECT(
    'proposal_id', p.proposal_id,
    'adapter_key', p.adapter_key,
    'proposal_only', true,
    'registry_mutation_performed', p.registry_mutation_performed,
    'external_send_performed', p.external_send_performed,
    'provider_dispatch_enabled', a.provider_dispatch_enabled,
    'adapter_implementation_status', a.implementation_status,
    'secrets_included', false
  ) AS evidence_json,
  0 AS secrets_included
FROM `external_delivery_provider_adapter_enablement_proposals` p
JOIN `external_delivery_provider_adapter_contract_registry` a ON a.adapter_key = p.adapter_key;

INSERT INTO `execution_policies` (
  `policy_group`, `policy_key`, `policy_value`, `active`,
  `execution_scope`, `affects_layer`, `blocking`, `notes`
)
SELECT 'Support Ticket External Delivery Governance', 'external_provider_adapter_enablement_proposal_policy_v1',
       JSON_OBJECT(
         'rule','external_provider_adapter_enablement_is_proposal_only',
         'proposal_only', true,
         'registry_mutation_allowed', false,
         'provider_dispatch_enablement_allowed', false,
         'external_send_allowed', false,
         'requires_future_implementation_pr', true,
         'requires_separate_dispatch_policy', true,
         'no_secret_payload_read', true,
         'secrets_included', false
       ),
       'TRUE',
       'support_ticket_external_delivery|provider_adapter_enablement_proposal|provider_gate',
       'external_delivery_provider_adapter_enablement_proposals|supportTicketExternalProviderEnablementProposalService|supportTicketExternalSendProviderGateService',
       'TRUE',
       'Adapter enablement proposal surface records governance proposals only; it must not enable dispatch or perform external sends.'
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group`='Support Ticket External Delivery Governance'
     AND `policy_key`='external_provider_adapter_enablement_proposal_policy_v1'
);

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
(
  'support_ticket_external_provider_enablement_candidates',
  'Support Ticket External Provider Enablement Candidates',
  'Read-only candidate list for future provider adapter enablement review. Does not mutate adapter registry, enable dispatch, or send externally.',
  'POST',
  '/admin/support/tickets/external-send/provider-adapter-enablement/candidates',
  JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'family_key',JSON_OBJECT('type','string'),
      'channel',JSON_OBJECT('type','string'),
      'adapter_key',JSON_OBJECT('type','string'),
      'include_internal',JSON_OBJECT('type','boolean','default',false),
      'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',200,'default',50)
    ),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,external_delivery,provider_enablement,candidates,read_only,proposal_only,no_external_send,no_secrets',
  1,
  485
),
(
  'support_ticket_external_provider_enablement_propose',
  'Support Ticket External Provider Enablement Propose',
  'Record a proposal-only adapter enablement review item. Does not update adapter flags, enable provider dispatch, or send externally.',
  'POST',
  '/admin/support/tickets/external-send/provider-adapter-enablement/propose',
  JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'adapter_key',JSON_OBJECT('type','string'),
      'requested_mode',JSON_OBJECT('type','string','enum',JSON_ARRAY('provider_send_blocked','record_only','dry_run')),
      'reason',JSON_OBJECT('type','string'),
      'evidence_json',JSON_OBJECT('type','object'),
      'proposed_target_json',JSON_OBJECT('type','object')
    ),
    'required',JSON_ARRAY('adapter_key'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,external_delivery,provider_enablement,proposal_only,no_registry_mutation,no_external_send,no_secrets',
  1,
  486
)
ON DUPLICATE KEY UPDATE
  `display_name`=VALUES(`display_name`), `description`=VALUES(`description`),
  `http_method`=VALUES(`http_method`), `http_path`=VALUES(`http_path`),
  `path_param_keys`=VALUES(`path_param_keys`), `input_schema`=VALUES(`input_schema`),
  `fixed_body`=VALUES(`fixed_body`), `tags`=VALUES(`tags`), `is_enabled`=VALUES(`is_enabled`),
  `sort_order`=VALUES(`sort_order`), `updated_at`=CURRENT_TIMESTAMP;
