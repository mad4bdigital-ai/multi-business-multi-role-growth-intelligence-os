-- Sprint 68: Ticket External Adapter Future PR Scope Generator
-- Generates scope records for a future adapter implementation PR from an approved readiness decision.
-- Scope-only. Does not implement adapters, mutate adapter flags, enable dispatch, read secret payloads, or send externally.
-- Additive, idempotent, no secrets.

CREATE TABLE IF NOT EXISTS `external_delivery_provider_adapter_future_pr_scopes` (
  `scope_id` CHAR(36) NOT NULL,
  `decision_id` CHAR(36) NOT NULL,
  `checklist_id` CHAR(36) NOT NULL,
  `proposal_id` CHAR(36) NOT NULL,
  `adapter_key` VARCHAR(160) NOT NULL,
  `family_key` VARCHAR(128) NOT NULL,
  `channel` VARCHAR(64) NOT NULL,
  `scope_status` VARCHAR(64) NOT NULL DEFAULT 'generated_scope_only',
  `scope_json` JSON NULL,
  `evidence_json` JSON NULL,
  `recorded_by` VARCHAR(128) NULL,
  `actor_type` VARCHAR(64) NULL,
  `registry_mutation_performed` TINYINT(1) NOT NULL DEFAULT 0,
  `adapter_implementation_performed` TINYINT(1) NOT NULL DEFAULT 0,
  `dispatch_enabled_changed` TINYINT(1) NOT NULL DEFAULT 0,
  `provider_dispatch_enabled_changed` TINYINT(1) NOT NULL DEFAULT 0,
  `external_send_performed` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`scope_id`),
  KEY `idx_external_adapter_future_pr_decision` (`decision_id`, `scope_status`),
  KEY `idx_external_adapter_future_pr_adapter` (`adapter_key`, `scope_status`),
  CONSTRAINT `fk_external_adapter_future_pr_decision` FOREIGN KEY (`decision_id`) REFERENCES `external_delivery_provider_adapter_readiness_decisions` (`decision_id`) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `fk_external_adapter_future_pr_checklist` FOREIGN KEY (`checklist_id`) REFERENCES `external_delivery_provider_adapter_readiness_checklists` (`checklist_id`) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `fk_external_adapter_future_pr_proposal` FOREIGN KEY (`proposal_id`) REFERENCES `external_delivery_provider_adapter_enablement_proposals` (`proposal_id`) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `fk_external_adapter_future_pr_adapter` FOREIGN KEY (`adapter_key`) REFERENCES `external_delivery_provider_adapter_contract_registry` (`adapter_key`) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW `v_external_delivery_provider_adapter_future_pr_scope_summary` AS
SELECT
  s.scope_id,
  s.decision_id,
  s.checklist_id,
  s.proposal_id,
  s.adapter_key,
  s.family_key,
  s.channel,
  s.scope_status,
  s.registry_mutation_performed,
  s.adapter_implementation_performed,
  s.dispatch_enabled_changed,
  s.provider_dispatch_enabled_changed,
  s.external_send_performed,
  JSON_UNQUOTE(JSON_EXTRACT(s.scope_json, '$.proposed_pr_title')) AS proposed_pr_title,
  JSON_UNQUOTE(JSON_EXTRACT(s.scope_json, '$.proposed_branch_prefix')) AS proposed_branch_prefix,
  CASE
    WHEN s.external_send_performed <> 0 THEN 'invalid_external_send_performed'
    WHEN s.registry_mutation_performed <> 0 THEN 'invalid_registry_mutation_performed'
    WHEN s.adapter_implementation_performed <> 0 THEN 'invalid_adapter_implementation_performed'
    WHEN s.dispatch_enabled_changed <> 0 THEN 'invalid_dispatch_flag_changed'
    WHEN s.provider_dispatch_enabled_changed <> 0 THEN 'invalid_provider_dispatch_flag_changed'
    ELSE 'scope_only_ready_for_future_pr_review'
  END AS governance_status,
  JSON_OBJECT(
    'scope_id', s.scope_id,
    'decision_id', s.decision_id,
    'adapter_key', s.adapter_key,
    'scope_status', s.scope_status,
    'future_pr_only', true,
    'registry_mutation_performed', s.registry_mutation_performed,
    'adapter_implementation_performed', s.adapter_implementation_performed,
    'dispatch_enabled_changed', s.dispatch_enabled_changed,
    'provider_dispatch_enabled_changed', s.provider_dispatch_enabled_changed,
    'external_send_performed', s.external_send_performed,
    'secrets_included', false
  ) AS evidence_json,
  0 AS secrets_included
FROM `external_delivery_provider_adapter_future_pr_scopes` s;

INSERT INTO `execution_policies` (
  `policy_group`, `policy_key`, `policy_value`, `active`,
  `execution_scope`, `affects_layer`, `blocking`, `notes`
)
SELECT 'Support Ticket External Delivery Governance', 'external_adapter_future_pr_scope_policy_v1',
       JSON_OBJECT(
         'rule','external_adapter_future_pr_scope_is_planning_only',
         'scope_only', true,
         'adapter_implementation_allowed', false,
         'registry_mutation_allowed', false,
         'provider_dispatch_enablement_allowed', false,
         'external_send_allowed', false,
         'requires_approve_for_future_pr_decision', true,
         'requires_future_implementation_pr', true,
         'requires_separate_dispatch_policy', true,
         'no_secret_payload_read', true,
         'secrets_included', false
       ),
       'TRUE',
       'support_ticket_external_delivery|adapter_future_pr_scope|future_pr_gate',
       'external_delivery_provider_adapter_future_pr_scopes|supportTicketExternalAdapterFuturePrScopeService|external_delivery_provider_adapter_contract_registry',
       'TRUE',
       'Future PR scope generation records implementation plan only; it must not implement adapters, mutate registry flags, enable dispatch, or perform external sends.'
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group`='Support Ticket External Delivery Governance'
     AND `policy_key`='external_adapter_future_pr_scope_policy_v1'
);

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
(
  'support_ticket_external_adapter_future_pr_scope_plan',
  'Support Ticket External Adapter Future PR Scope Plan',
  'Dry-run future implementation PR scope from an approved adapter readiness decision. Does not implement adapters, mutate registry flags, enable dispatch, or send externally.',
  'POST',
  '/admin/support/tickets/external-send/provider-adapter-future-pr-scope/plan',
  JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'decision_id',JSON_OBJECT('type','string'),
      'evidence_json',JSON_OBJECT('type','object')
    ),
    'required',JSON_ARRAY('decision_id'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,external_delivery,adapter_future_pr_scope,dry_run,scope_only,no_registry_mutation,no_dispatch_enablement,no_external_send,no_secrets',
  1,
  490
),
(
  'support_ticket_external_adapter_future_pr_scope_record',
  'Support Ticket External Adapter Future PR Scope Record',
  'Record future implementation PR scope from an approved adapter readiness decision. Does not implement adapters, mutate registry flags, enable dispatch, or send externally.',
  'POST',
  '/admin/support/tickets/external-send/provider-adapter-future-pr-scope/record',
  JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'decision_id',JSON_OBJECT('type','string'),
      'evidence_json',JSON_OBJECT('type','object')
    ),
    'required',JSON_ARRAY('decision_id'),
    'additionalProperties',false
  ),
  NULL,
  'admin,support,tickets,external_delivery,adapter_future_pr_scope,record_only,scope_only,no_registry_mutation,no_dispatch_enablement,no_external_send,no_secrets',
  1,
  491
)
ON DUPLICATE KEY UPDATE
  `display_name`=VALUES(`display_name`), `description`=VALUES(`description`),
  `http_method`=VALUES(`http_method`), `http_path`=VALUES(`http_path`),
  `path_param_keys`=VALUES(`path_param_keys`), `input_schema`=VALUES(`input_schema`),
  `fixed_body`=VALUES(`fixed_body`), `tags`=VALUES(`tags`), `is_enabled`=VALUES(`is_enabled`),
  `sort_order`=VALUES(`sort_order`), `updated_at`=CURRENT_TIMESTAMP;
