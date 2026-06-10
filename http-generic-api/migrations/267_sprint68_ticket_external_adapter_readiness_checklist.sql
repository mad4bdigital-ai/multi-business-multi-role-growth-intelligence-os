-- Sprint 68: Ticket External Adapter Implementation Readiness Checklist
-- Converts provider adapter enablement proposals into implementation readiness checklists.
-- Checklist-only. Does not implement adapters, mutate adapter flags, enable dispatch, read secret payloads, or send externally.
-- Additive, idempotent, no secrets.

CREATE TABLE IF NOT EXISTS `external_delivery_provider_adapter_readiness_checklists` (
  `checklist_id` CHAR(36) NOT NULL,
  `proposal_id` CHAR(36) NOT NULL,
  `adapter_key` VARCHAR(160) NOT NULL,
  `readiness_status` VARCHAR(96) NOT NULL,
  `summary_json` JSON NULL,
  `checklist_json` JSON NULL,
  `evidence_json` JSON NULL,
  `recorded_by` VARCHAR(128) NULL,
  `registry_mutation_performed` TINYINT(1) NOT NULL DEFAULT 0,
  `external_send_performed` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`checklist_id`),
  KEY `idx_external_adapter_checklist_proposal_status` (`proposal_id`, `readiness_status`),
  KEY `idx_external_adapter_checklist_adapter_status` (`adapter_key`, `readiness_status`),
  CONSTRAINT `fk_external_adapter_checklist_proposal` FOREIGN KEY (`proposal_id`) REFERENCES `external_delivery_provider_adapter_enablement_proposals` (`proposal_id`) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `fk_external_adapter_checklist_adapter` FOREIGN KEY (`adapter_key`) REFERENCES `external_delivery_provider_adapter_contract_registry` (`adapter_key`) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW `v_external_delivery_provider_adapter_readiness_checklist_summary` AS
SELECT
  c.checklist_id,
  c.proposal_id,
  c.adapter_key,
  p.family_key,
  p.channel,
  c.readiness_status,
  c.registry_mutation_performed,
  c.external_send_performed,
  JSON_UNQUOTE(JSON_EXTRACT(c.summary_json, '$.item_count')) AS item_count,
  JSON_UNQUOTE(JSON_EXTRACT(c.summary_json, '$.failed_count')) AS failed_count,
  JSON_UNQUOTE(JSON_EXTRACT(c.summary_json, '$.missing_count')) AS missing_count,
  JSON_UNQUOTE(JSON_EXTRACT(c.summary_json, '$.blocked_count')) AS blocked_count,
  CASE
    WHEN c.external_send_performed <> 0 THEN 'invalid_external_send_performed'
    WHEN c.registry_mutation_performed <> 0 THEN 'invalid_registry_mutation_performed'
    WHEN c.readiness_status = 'failed_safety_violation' THEN 'failed_safety_violation'
    WHEN c.readiness_status = 'incomplete_contract' THEN 'incomplete_contract'
    WHEN c.readiness_status = 'blocked_until_future_implementation_and_policy' THEN 'ready_as_blocking_checklist'
    ELSE c.readiness_status
  END AS governance_status,
  JSON_OBJECT(
    'checklist_id', c.checklist_id,
    'proposal_id', c.proposal_id,
    'adapter_key', c.adapter_key,
    'readiness_status', c.readiness_status,
    'registry_mutation_performed', c.registry_mutation_performed,
    'external_send_performed', c.external_send_performed,
    'secrets_included', false
  ) AS evidence_json,
  0 AS secrets_included
FROM `external_delivery_provider_adapter_readiness_checklists` c
JOIN `external_delivery_provider_adapter_enablement_proposals` p ON p.proposal_id = c.proposal_id;

INSERT INTO `execution_policies` (
  `policy_group`, `policy_key`, `policy_value`, `active`,
  `execution_scope`, `affects_layer`, `blocking`, `notes`
)
SELECT 'Support Ticket External Delivery Governance', 'external_adapter_readiness_checklist_policy_v1',
       JSON_OBJECT(
         'rule','external_adapter_readiness_checklist_is_pre_implementation_only',
         'checklist_only', true,
         'adapter_implementation_allowed', false,
         'registry_mutation_allowed', false,
         'provider_dispatch_enablement_allowed', false,
         'external_send_allowed', false,
         'requires_future_implementation_pr', true,
         'requires_separate_dispatch_policy', true,
         'no_secret_payload_read', true,
         'secrets_included', false
       ),
       'TRUE',
       'support_ticket_external_delivery|adapter_readiness_checklist|provider_adapter_enablement_proposal',
       'external_delivery_provider_adapter_readiness_checklists|supportTicketExternalAdapterReadinessChecklistService|supportTicketExternalProviderEnablementProposalService',
       'TRUE',
       'Adapter readiness checklist records pre-implementation gates only; it must not implement adapters, mutate registry flags, enable dispatch, or perform external sends.'
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group`='Support Ticket External Delivery Governance'
     AND `policy_key`='external_adapter_readiness_checklist_policy_v1'
);

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
(
  'support_ticket_external_adapter_readiness_plan',
  'Support Ticket External Adapter Readiness Plan',
  'Dry-run an implementation readiness checklist for a provider adapter enablement proposal. Does not mutate registry flags or send externally.',
  'POST',
  '/admin/support/tickets/external-send/provider-adapter-readiness/plan',
  JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'proposal_id',JSON_OBJECT('type','string'),
      'evidence_json',JSON_OBJECT('type','object')
    ),
    'required',JSON_ARRAY('proposal_id'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,external_delivery,adapter_readiness,checklist,dry_run,no_registry_mutation,no_external_send,no_secrets',
  1,
  487
),
(
  'support_ticket_external_adapter_readiness_record',
  'Support Ticket External Adapter Readiness Record',
  'Record a pre-implementation readiness checklist for a provider adapter enablement proposal. Does not implement adapter, mutate registry flags, enable dispatch, or send externally.',
  'POST',
  '/admin/support/tickets/external-send/provider-adapter-readiness/record',
  JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'proposal_id',JSON_OBJECT('type','string'),
      'evidence_json',JSON_OBJECT('type','object')
    ),
    'required',JSON_ARRAY('proposal_id'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,external_delivery,adapter_readiness,checklist,record_only,no_registry_mutation,no_external_send,no_secrets',
  1,
  488
)
ON DUPLICATE KEY UPDATE
  `display_name`=VALUES(`display_name`), `description`=VALUES(`description`),
  `http_method`=VALUES(`http_method`), `http_path`=VALUES(`http_path`),
  `path_param_keys`=VALUES(`path_param_keys`), `input_schema`=VALUES(`input_schema`),
  `fixed_body`=VALUES(`fixed_body`), `tags`=VALUES(`tags`), `is_enabled`=VALUES(`is_enabled`),
  `sort_order`=VALUES(`sort_order`), `updated_at`=CURRENT_TIMESTAMP;
