-- Sprint 68: Ticket External Adapter Readiness Checklist Decision Flow
-- Adds checklist decision records for approve_for_future_pr / reject / needs_changes.
-- Decision-only. Does not implement adapters, mutate adapter flags, enable dispatch, read secret payloads, or send externally.
-- Additive, idempotent, no secrets.

CREATE TABLE IF NOT EXISTS `external_delivery_provider_adapter_readiness_decisions` (
  `decision_id` CHAR(36) NOT NULL,
  `checklist_id` CHAR(36) NOT NULL,
  `proposal_id` CHAR(36) NOT NULL,
  `adapter_key` VARCHAR(160) NOT NULL,
  `decision` ENUM('approve_for_future_pr','reject','needs_changes') NOT NULL,
  `decision_note` TEXT NULL,
  `readiness_status` VARCHAR(96) NOT NULL,
  `summary_json` JSON NULL,
  `evidence_json` JSON NULL,
  `decided_by` VARCHAR(128) NULL,
  `actor_type` VARCHAR(64) NULL,
  `registry_mutation_performed` TINYINT(1) NOT NULL DEFAULT 0,
  `adapter_implementation_performed` TINYINT(1) NOT NULL DEFAULT 0,
  `dispatch_enabled_changed` TINYINT(1) NOT NULL DEFAULT 0,
  `provider_dispatch_enabled_changed` TINYINT(1) NOT NULL DEFAULT 0,
  `external_send_performed` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`decision_id`),
  KEY `idx_external_adapter_decision_checklist` (`checklist_id`, `decision`),
  KEY `idx_external_adapter_decision_proposal` (`proposal_id`, `decision`),
  KEY `idx_external_adapter_decision_adapter` (`adapter_key`, `decision`),
  CONSTRAINT `fk_external_adapter_decision_checklist` FOREIGN KEY (`checklist_id`) REFERENCES `external_delivery_provider_adapter_readiness_checklists` (`checklist_id`) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `fk_external_adapter_decision_proposal` FOREIGN KEY (`proposal_id`) REFERENCES `external_delivery_provider_adapter_enablement_proposals` (`proposal_id`) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `fk_external_adapter_decision_adapter` FOREIGN KEY (`adapter_key`) REFERENCES `external_delivery_provider_adapter_contract_registry` (`adapter_key`) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW `v_external_delivery_provider_adapter_readiness_decision_summary` AS
SELECT
  d.decision_id,
  d.checklist_id,
  d.proposal_id,
  d.adapter_key,
  p.family_key,
  p.channel,
  d.decision,
  d.readiness_status,
  d.registry_mutation_performed,
  d.adapter_implementation_performed,
  d.dispatch_enabled_changed,
  d.provider_dispatch_enabled_changed,
  d.external_send_performed,
  CASE
    WHEN d.external_send_performed <> 0 THEN 'invalid_external_send_performed'
    WHEN d.registry_mutation_performed <> 0 THEN 'invalid_registry_mutation_performed'
    WHEN d.adapter_implementation_performed <> 0 THEN 'invalid_adapter_implementation_performed'
    WHEN d.dispatch_enabled_changed <> 0 THEN 'invalid_dispatch_flag_changed'
    WHEN d.provider_dispatch_enabled_changed <> 0 THEN 'invalid_provider_dispatch_flag_changed'
    WHEN d.decision = 'approve_for_future_pr' THEN 'approved_for_future_pr_only'
    WHEN d.decision = 'needs_changes' THEN 'needs_changes_before_future_pr'
    ELSE 'rejected'
  END AS governance_status,
  JSON_OBJECT(
    'decision_id', d.decision_id,
    'checklist_id', d.checklist_id,
    'proposal_id', d.proposal_id,
    'adapter_key', d.adapter_key,
    'decision', d.decision,
    'future_pr_only', d.decision = 'approve_for_future_pr',
    'registry_mutation_performed', d.registry_mutation_performed,
    'adapter_implementation_performed', d.adapter_implementation_performed,
    'dispatch_enabled_changed', d.dispatch_enabled_changed,
    'provider_dispatch_enabled_changed', d.provider_dispatch_enabled_changed,
    'external_send_performed', d.external_send_performed,
    'secrets_included', false
  ) AS evidence_json,
  0 AS secrets_included
FROM `external_delivery_provider_adapter_readiness_decisions` d
JOIN `external_delivery_provider_adapter_enablement_proposals` p ON p.proposal_id = d.proposal_id;

INSERT INTO `execution_policies` (
  `policy_group`, `policy_key`, `policy_value`, `active`,
  `execution_scope`, `affects_layer`, `blocking`, `notes`
)
SELECT 'Support Ticket External Delivery Governance', 'external_adapter_readiness_decision_policy_v1',
       JSON_OBJECT(
         'rule','external_adapter_readiness_decision_is_future_pr_gate_only',
         'decision_only', true,
         'allowed_decisions', JSON_ARRAY('approve_for_future_pr','reject','needs_changes'),
         'adapter_implementation_allowed', false,
         'registry_mutation_allowed', false,
         'provider_dispatch_enablement_allowed', false,
         'external_send_allowed', false,
         'approve_for_future_pr_does_not_enable_dispatch', true,
         'requires_future_implementation_pr', true,
         'requires_separate_dispatch_policy', true,
         'no_secret_payload_read', true,
         'secrets_included', false
       ),
       'TRUE',
       'support_ticket_external_delivery|adapter_readiness_decision|future_pr_gate',
       'external_delivery_provider_adapter_readiness_decisions|supportTicketExternalAdapterReadinessChecklistService|external_delivery_provider_adapter_contract_registry',
       'TRUE',
       'Adapter readiness decisions approve only future PR review, not adapter implementation, registry mutation, dispatch enablement, or external send.'
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group`='Support Ticket External Delivery Governance'
     AND `policy_key`='external_adapter_readiness_decision_policy_v1'
);

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES (
  'support_ticket_external_adapter_readiness_decision',
  'Support Ticket External Adapter Readiness Decision',
  'Record a governance decision for an external adapter readiness checklist. Decisions are future-PR-only and do not implement adapters, mutate registry flags, enable dispatch, or send externally.',
  'POST',
  '/admin/support/tickets/external-send/provider-adapter-readiness/decision',
  JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'checklist_id',JSON_OBJECT('type','string'),
      'decision',JSON_OBJECT('type','string','enum',JSON_ARRAY('approve_for_future_pr','reject','needs_changes')),
      'decision_note',JSON_OBJECT('type','string'),
      'evidence_json',JSON_OBJECT('type','object')
    ),
    'required',JSON_ARRAY('checklist_id','decision'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,external_delivery,adapter_readiness,decision,future_pr_only,no_registry_mutation,no_dispatch_enablement,no_external_send,no_secrets',
  1,
  489
) ON DUPLICATE KEY UPDATE
  `display_name`=VALUES(`display_name`), `description`=VALUES(`description`),
  `http_method`=VALUES(`http_method`), `http_path`=VALUES(`http_path`),
  `path_param_keys`=VALUES(`path_param_keys`), `input_schema`=VALUES(`input_schema`),
  `fixed_body`=VALUES(`fixed_body`), `tags`=VALUES(`tags`), `is_enabled`=VALUES(`is_enabled`),
  `sort_order`=VALUES(`sort_order`), `updated_at`=CURRENT_TIMESTAMP;
