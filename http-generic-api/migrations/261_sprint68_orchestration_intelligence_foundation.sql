-- Sprint 68: Orchestration Intelligence foundation.
--
-- Adds the first governed orchestration graph layer above domain ledgers/tools.
-- This slice is read-only/diagnose-only: it creates graph/snapshot/recommendation
-- authority tables, registers an engine/policy/rules, and seeds the first
-- ads_provider_governance_orchestrator graph. It does not enable provider calls,
-- connector execution, credential reads, spend changes, deploys, or publishing.
--
-- Idempotent. Additive only. No secrets.

CREATE TABLE IF NOT EXISTS `platform_orchestration_plugins` (
  `plugin_key` VARCHAR(191) NOT NULL,
  `display_name` VARCHAR(255) NOT NULL,
  `domain_key` VARCHAR(191) NOT NULL,
  `plugin_type` VARCHAR(80) NOT NULL DEFAULT 'orchestration_graph',
  `owner_scope` VARCHAR(191) NOT NULL DEFAULT 'platform',
  `version` VARCHAR(40) NOT NULL DEFAULT 'v1',
  `lifecycle_stage` VARCHAR(80) NOT NULL DEFAULT 'foundation',
  `engine_key` VARCHAR(191) NULL,
  `policy_key` VARCHAR(191) NULL,
  `readback_tool_key` VARCHAR(191) NULL,
  `manifest_json` LONGTEXT NULL CHECK (`manifest_json` IS NULL OR JSON_VALID(`manifest_json`)),
  `safety_contract_json` LONGTEXT NULL CHECK (`safety_contract_json` IS NULL OR JSON_VALID(`safety_contract_json`)),
  `status` VARCHAR(40) NOT NULL DEFAULT 'planned',
  `notes` TEXT NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`plugin_key`),
  KEY `idx_platform_orchestration_plugins_domain` (`domain_key`, `status`),
  KEY `idx_platform_orchestration_plugins_engine` (`engine_key`, `status`),
  CONSTRAINT `chk_platform_orchestration_plugins_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_orchestration_stages` (
  `stage_key` VARCHAR(191) NOT NULL,
  `plugin_key` VARCHAR(191) NOT NULL,
  `stage_order` INT NOT NULL DEFAULT 0,
  `display_name` VARCHAR(255) NOT NULL,
  `stage_type` VARCHAR(80) NOT NULL DEFAULT 'readiness',
  `required_inputs_json` LONGTEXT NULL CHECK (`required_inputs_json` IS NULL OR JSON_VALID(`required_inputs_json`)),
  `produced_outputs_json` LONGTEXT NULL CHECK (`produced_outputs_json` IS NULL OR JSON_VALID(`produced_outputs_json`)),
  `required_tables_json` LONGTEXT NULL CHECK (`required_tables_json` IS NULL OR JSON_VALID(`required_tables_json`)),
  `required_tools_json` LONGTEXT NULL CHECK (`required_tools_json` IS NULL OR JSON_VALID(`required_tools_json`)),
  `required_policies_json` LONGTEXT NULL CHECK (`required_policies_json` IS NULL OR JSON_VALID(`required_policies_json`)),
  `acceptance_criteria_json` LONGTEXT NULL CHECK (`acceptance_criteria_json` IS NULL OR JSON_VALID(`acceptance_criteria_json`)),
  `safety_contract_json` LONGTEXT NULL CHECK (`safety_contract_json` IS NULL OR JSON_VALID(`safety_contract_json`)),
  `status` VARCHAR(40) NOT NULL DEFAULT 'planned',
  `notes` TEXT NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`stage_key`),
  KEY `idx_platform_orchestration_stages_plugin` (`plugin_key`, `stage_order`),
  CONSTRAINT `chk_platform_orchestration_stages_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_orchestration_edges` (
  `edge_key` VARCHAR(191) NOT NULL,
  `plugin_key` VARCHAR(191) NOT NULL,
  `from_stage_key` VARCHAR(191) NOT NULL,
  `to_stage_key` VARCHAR(191) NOT NULL,
  `edge_type` VARCHAR(80) NOT NULL DEFAULT 'requires_ready',
  `condition_json` LONGTEXT NULL CHECK (`condition_json` IS NULL OR JSON_VALID(`condition_json`)),
  `safety_contract_json` LONGTEXT NULL CHECK (`safety_contract_json` IS NULL OR JSON_VALID(`safety_contract_json`)),
  `status` VARCHAR(40) NOT NULL DEFAULT 'active',
  `notes` TEXT NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`edge_key`),
  KEY `idx_platform_orchestration_edges_plugin` (`plugin_key`, `from_stage_key`, `to_stage_key`),
  CONSTRAINT `chk_platform_orchestration_edges_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_orchestration_state_snapshots` (
  `snapshot_id` VARCHAR(36) NOT NULL,
  `snapshot_key` VARCHAR(191) NOT NULL,
  `plugin_key` VARCHAR(191) NOT NULL,
  `scope_type` VARCHAR(80) NOT NULL DEFAULT 'platform',
  `scope_id` VARCHAR(191) NULL,
  `tenant_id` VARCHAR(36) NULL,
  `workspace_id` VARCHAR(36) NULL,
  `brand_key` VARCHAR(128) NULL,
  `subject_key` VARCHAR(191) NULL,
  `state_classification` VARCHAR(191) NOT NULL DEFAULT 'unknown',
  `maturity_score` DECIMAL(5,2) NULL,
  `input_sources_json` LONGTEXT NULL CHECK (`input_sources_json` IS NULL OR JSON_VALID(`input_sources_json`)),
  `state_json` LONGTEXT NULL CHECK (`state_json` IS NULL OR JSON_VALID(`state_json`)),
  `maturity_json` LONGTEXT NULL CHECK (`maturity_json` IS NULL OR JSON_VALID(`maturity_json`)),
  `blockers_json` LONGTEXT NULL CHECK (`blockers_json` IS NULL OR JSON_VALID(`blockers_json`)),
  `safety_json` LONGTEXT NULL CHECK (`safety_json` IS NULL OR JSON_VALID(`safety_json`)),
  `decision_run_id` VARCHAR(36) NULL,
  `produced_by_engine_key` VARCHAR(191) NULL,
  `status` VARCHAR(40) NOT NULL DEFAULT 'recorded',
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`snapshot_id`),
  UNIQUE KEY `uq_platform_orchestration_snapshot_key` (`snapshot_key`),
  KEY `idx_platform_orchestration_snapshots_plugin` (`plugin_key`, `created_at`),
  KEY `idx_platform_orchestration_snapshots_scope` (`scope_type`, `scope_id`, `status`),
  CONSTRAINT `chk_platform_orchestration_snapshots_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_orchestration_recommendations` (
  `recommendation_id` VARCHAR(36) NOT NULL,
  `recommendation_key` VARCHAR(191) NOT NULL,
  `snapshot_id` VARCHAR(36) NULL,
  `plugin_key` VARCHAR(191) NOT NULL,
  `scope_type` VARCHAR(80) NOT NULL DEFAULT 'platform',
  `scope_id` VARCHAR(191) NULL,
  `task_class` VARCHAR(191) NOT NULL DEFAULT 'orchestration_recommendation',
  `recommendation_type` VARCHAR(80) NOT NULL DEFAULT 'next_best_action',
  `priority` VARCHAR(40) NOT NULL DEFAULT 'medium',
  `recommendation_status` VARCHAR(40) NOT NULL DEFAULT 'proposed',
  `decision_json` LONGTEXT NULL CHECK (`decision_json` IS NULL OR JSON_VALID(`decision_json`)),
  `blockers_json` LONGTEXT NULL CHECK (`blockers_json` IS NULL OR JSON_VALID(`blockers_json`)),
  `next_actions_json` LONGTEXT NULL CHECK (`next_actions_json` IS NULL OR JSON_VALID(`next_actions_json`)),
  `safety_contract_json` LONGTEXT NULL CHECK (`safety_contract_json` IS NULL OR JSON_VALID(`safety_contract_json`)),
  `decision_run_id` VARCHAR(36) NULL,
  `produced_by_engine_key` VARCHAR(191) NULL,
  `accepted_at` DATETIME NULL,
  `completed_at` DATETIME NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`recommendation_id`),
  UNIQUE KEY `uq_platform_orchestration_recommendation_key` (`recommendation_key`),
  KEY `idx_platform_orchestration_recommendations_plugin` (`plugin_key`, `recommendation_status`, `priority`),
  KEY `idx_platform_orchestration_recommendations_snapshot` (`snapshot_id`),
  CONSTRAINT `chk_platform_orchestration_recommendations_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `execution_policies` (
  `policy_group`, `policy_key`, `policy_value`, `active`,
  `execution_scope`, `affects_layer`, `blocking`, `notes`
)
SELECT 'Orchestration Intelligence Governance', 'orchestration_intelligence_foundation_policy_v1',
       JSON_OBJECT(
         'rule','orchestration_intelligence_foundation_read_only',
         'creates_tables',JSON_ARRAY('platform_orchestration_plugins','platform_orchestration_stages','platform_orchestration_edges','platform_orchestration_state_snapshots','platform_orchestration_recommendations'),
         'registers_engine','orchestration_intelligence_engine',
         'default_mode','diagnose_only',
         'no_provider_call',true,
         'no_spend_change',true,
         'no_credential_payload_read',true,
         'no_external_write',true,
         'secrets_included',false
       ),
       'TRUE',
       'orchestration_intelligence|state_snapshot|recommendation_generation|plugin_graph',
       'platform_orchestration_plugins|platform_orchestration_state_snapshots|platform_engine_registry|releaseReadiness',
       'TRUE',
       'Orchestration Intelligence foundation is read-only/diagnose-only and does not enable execution.'
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group`='Orchestration Intelligence Governance'
     AND `policy_key`='orchestration_intelligence_foundation_policy_v1'
);

INSERT INTO `platform_engine_registry` (
  `engine_key`, `display_name`, `engine_type`, `runtime_key`,
  `supported_task_classes_json`, `capabilities_json`, `default_policy_key`, `status`, `notes`
) VALUES (
  'orchestration_intelligence_engine',
  'Governed Orchestration Intelligence Engine',
  'runtime_readiness',
  'orchestration_intelligence_runtime_v1',
  JSON_ARRAY('orchestration_state_snapshot','orchestration_recommendation','readiness_scoring','blocker_classification','dry_run_task_planning'),
  JSON_OBJECT('default_mode','diagnose_only','apply_supported',false,'executes_provider_calls',false,'executes_external_writes',false,'reads_credential_payloads',false,'secrets_returned',false),
  'orchestration_intelligence_policy_v1',
  'active',
  'Reads governed registries/ledgers into state snapshots and recommendations only. Execution remains separately gated.'
) ON DUPLICATE KEY UPDATE
  `display_name`=VALUES(`display_name`),
  `engine_type`=VALUES(`engine_type`),
  `runtime_key`=VALUES(`runtime_key`),
  `supported_task_classes_json`=VALUES(`supported_task_classes_json`),
  `capabilities_json`=VALUES(`capabilities_json`),
  `default_policy_key`=VALUES(`default_policy_key`),
  `status`=VALUES(`status`),
  `notes`=VALUES(`notes`),
  `updated_at`=CURRENT_TIMESTAMP;

INSERT INTO `platform_engine_policy_registry` (
  `policy_key`, `engine_key`, `scope_type`, `scope_id`, `mode`, `risk_default`,
  `approval_required_min_risk`, `require_scope_guard`, `require_audit`, `require_validators`,
  `max_changes_json`, `validators_json`, `blocked_terms_json`,
  `allowed_resource_patterns_json`, `blocked_resource_patterns_json`, `status`, `notes`
) VALUES (
  'orchestration_intelligence_policy_v1',
  'orchestration_intelligence_engine',
  'global',
  NULL,
  'diagnose_only',
  'medium',
  'high',
  1,
  1,
  1,
  JSON_OBJECT('apply_supported',false,'writes_allowed',JSON_ARRAY('platform_orchestration_state_snapshots','platform_orchestration_recommendations'),'provider_calls_allowed',false,'credential_payload_reads_allowed',false),
  JSON_ARRAY('node test-orchestration-intelligence-foundation.mjs'),
  JSON_ARRAY('provider_api_mutation','spend_change','credential_payload_read','secret','password','token','freeform_shell','deploy','publish'),
  JSON_ARRAY('platform_orchestration_*','ads_provider_*','execution_enablement_registry','budget_quota_authority_registry','google_ads_*_ledger','decision_runs','platform_engine_execution_runs'),
  JSON_ARRAY('provider_api:*','credential_payload:*','external_write:*','spend_mutation:*'),
  'active',
  'Diagnose-only orchestration intelligence policy. Produces state and recommendations; never executes provider or connector mutations.'
) ON DUPLICATE KEY UPDATE
  `engine_key`=VALUES(`engine_key`),
  `mode`=VALUES(`mode`),
  `risk_default`=VALUES(`risk_default`),
  `require_scope_guard`=VALUES(`require_scope_guard`),
  `require_audit`=VALUES(`require_audit`),
  `require_validators`=VALUES(`require_validators`),
  `max_changes_json`=VALUES(`max_changes_json`),
  `validators_json`=VALUES(`validators_json`),
  `blocked_terms_json`=VALUES(`blocked_terms_json`),
  `allowed_resource_patterns_json`=VALUES(`allowed_resource_patterns_json`),
  `blocked_resource_patterns_json`=VALUES(`blocked_resource_patterns_json`),
  `status`=VALUES(`status`),
  `notes`=VALUES(`notes`),
  `updated_at`=CURRENT_TIMESTAMP;

INSERT INTO `platform_engine_policy_rules` (
  `rule_key`, `policy_key`, `engine_key`, `priority`, `task_class`, `resource_kind`, `resource_pattern`,
  `condition_json`, `strategy_key`, `risk_level`, `auto_apply_allowed`, `dry_run_required`,
  `approval_required`, `validator_commands_json`, `blocked_terms_json`, `allowed_terms_json`,
  `required_skill_keys_json`, `status`, `notes`
) VALUES
  ('orchestration_intelligence_default_rule_v1','orchestration_intelligence_policy_v1','orchestration_intelligence_engine',900,'orchestration_state_snapshot','platform_orchestration','*',JSON_OBJECT('rule_role','default_rule','mode','diagnose_only'),'diagnose_only','medium',0,1,0,JSON_ARRAY('node test-orchestration-intelligence-foundation.mjs'),JSON_ARRAY(),JSON_ARRAY('state_snapshot','recommendation','readback'),'[]','active','Default diagnose-only rule for state snapshots and recommendations.'),
  ('orchestration_intelligence_bypass_deny_rule_v1','orchestration_intelligence_policy_v1','orchestration_intelligence_engine',1000,'tool_execution','external_mutation','*',JSON_OBJECT('rule_role','bypass_deny_rule','denies','hidden_execution_or_policy_bypass'),'diagnose_only','critical',0,1,1,JSON_ARRAY('node test-orchestration-intelligence-foundation.mjs'),JSON_ARRAY('provider_api_mutation','spend_change','credential_payload_read','freeform_shell','deploy','publish'),JSON_ARRAY(),'[]','active','Blocks any attempt to use orchestration intelligence as an execution bypass.'),
  ('orchestration_intelligence_approval_rule_v1','orchestration_intelligence_policy_v1','orchestration_intelligence_engine',800,'orchestration_recommendation','execution_candidate','*',JSON_OBJECT('rule_role','approval_rule','execution_requires_separate_capability_envelope',true),'diagnose_only','high',0,1,1,JSON_ARRAY('node test-orchestration-intelligence-foundation.mjs'),JSON_ARRAY('auto_apply','silent_execution'),JSON_ARRAY('approval_required','capability_envelope_required'),'[]','active','Execution candidates are recommendations only and require separate approval/envelope.'),
  ('orchestration_intelligence_readback_rule_v1','orchestration_intelligence_policy_v1','orchestration_intelligence_engine',700,'orchestration_readback','state_snapshot','*',JSON_OBJECT('rule_role','readback_rule','requires_snapshot_or_recommendation_readback',true),'diagnose_only','medium',0,1,0,JSON_ARRAY('node test-orchestration-intelligence-foundation.mjs'),JSON_ARRAY(),JSON_ARRAY('snapshot_readback','recommendation_readback'),'[]','active','Every recommendation must be tied to snapshot/readback evidence.'),
  ('orchestration_intelligence_no_secret_rule_v1','orchestration_intelligence_policy_v1','orchestration_intelligence_engine',950,'orchestration_state_snapshot','credential_boundary','*',JSON_OBJECT('rule_role','no_secret_rule','secrets_included_must_be_false',true),'diagnose_only','critical',0,1,1,JSON_ARRAY('node test-orchestration-intelligence-foundation.mjs'),JSON_ARRAY('secret','password','token','api_key','authorization','credential_payload'),JSON_ARRAY('credential_metadata','readiness_status'),'[]','active','Snapshots and recommendations may include metadata/status only; no secret payloads.'),
  ('orchestration_intelligence_degraded_fallback_rule_v1','orchestration_intelligence_policy_v1','orchestration_intelligence_engine',600,'orchestration_recommendation','missing_authority','*',JSON_OBJECT('rule_role','degraded_fallback_rule','fallback_classification','validating_or_degraded_contract'),'diagnose_only','medium',0,1,0,JSON_ARRAY('node test-orchestration-intelligence-foundation.mjs'),JSON_ARRAY(),JSON_ARRAY('validating','degraded_contract','blocked_missing_authority'),'[]','active','Missing graph/snapshot authority produces validating/degraded recommendations, not execution.' )
ON DUPLICATE KEY UPDATE
  `policy_key`=VALUES(`policy_key`),
  `engine_key`=VALUES(`engine_key`),
  `priority`=VALUES(`priority`),
  `task_class`=VALUES(`task_class`),
  `resource_kind`=VALUES(`resource_kind`),
  `resource_pattern`=VALUES(`resource_pattern`),
  `condition_json`=VALUES(`condition_json`),
  `strategy_key`=VALUES(`strategy_key`),
  `risk_level`=VALUES(`risk_level`),
  `auto_apply_allowed`=VALUES(`auto_apply_allowed`),
  `dry_run_required`=VALUES(`dry_run_required`),
  `approval_required`=VALUES(`approval_required`),
  `validator_commands_json`=VALUES(`validator_commands_json`),
  `blocked_terms_json`=VALUES(`blocked_terms_json`),
  `allowed_terms_json`=VALUES(`allowed_terms_json`),
  `required_skill_keys_json`=VALUES(`required_skill_keys_json`),
  `status`=VALUES(`status`),
  `notes`=VALUES(`notes`),
  `updated_at`=CURRENT_TIMESTAMP;

INSERT INTO `platform_orchestration_plugins` (
  `plugin_key`, `display_name`, `domain_key`, `plugin_type`, `owner_scope`, `version`,
  `lifecycle_stage`, `engine_key`, `policy_key`, `readback_tool_key`,
  `manifest_json`, `safety_contract_json`, `status`, `notes`, `secrets_included`
) VALUES (
  'ads_provider_governance_orchestrator',
  'Ads Provider Governance Orchestrator',
  'ads_provider_governance',
  'orchestration_graph',
  'platform_admin',
  'v1',
  'foundation',
  'orchestration_intelligence_engine',
  'orchestration_intelligence_policy_v1',
  NULL,
  JSON_OBJECT('provider_family','ads_provider','first_provider','google_ads','graph_version','v1','execution_enabled_default',false,'stages',JSON_ARRAY('profile','preflight_contract','preflight_surface_blueprint','credential_readiness','budget_authority','execution_enablement','execution_adapter_candidate')),
  JSON_OBJECT('no_provider_call',true,'no_spend_change',true,'no_credential_payload_read',true,'execution_enabled_default',false,'recommendation_only',true,'secrets_included',false),
  'active',
  'First orchestration graph for ads provider governance. Reads profile/preflight/readiness/enablement ledgers only.',
  0
) ON DUPLICATE KEY UPDATE
  `display_name`=VALUES(`display_name`),
  `domain_key`=VALUES(`domain_key`),
  `engine_key`=VALUES(`engine_key`),
  `policy_key`=VALUES(`policy_key`),
  `manifest_json`=VALUES(`manifest_json`),
  `safety_contract_json`=VALUES(`safety_contract_json`),
  `status`=VALUES(`status`),
  `notes`=VALUES(`notes`),
  `secrets_included`=0,
  `updated_at`=CURRENT_TIMESTAMP;

INSERT INTO `platform_orchestration_stages` (
  `stage_key`, `plugin_key`, `stage_order`, `display_name`, `stage_type`,
  `required_inputs_json`, `produced_outputs_json`, `required_tables_json`, `required_tools_json`,
  `required_policies_json`, `acceptance_criteria_json`, `safety_contract_json`, `status`, `notes`, `secrets_included`
) VALUES
  ('ads_provider.profile','ads_provider_governance_orchestrator',10,'Provider Capability Profile','registry_readiness',JSON_ARRAY('provider_key'),JSON_ARRAY('provider_profile_state'),JSON_ARRAY('ads_provider_capability_profile_registry'),JSON_ARRAY('ads_provider_profile_lookup'),JSON_ARRAY('ads_provider_capability_profile_registry_policy_v1'),JSON_ARRAY('active_or_draft_profile_exists','execution_enabled_default_false_unless_explicitly_enabled'),JSON_OBJECT('no_provider_call',true,'secrets_included',false),'active','Reads provider capability metadata and governance contract.',0),
  ('ads_provider.preflight_contract','ads_provider_governance_orchestrator',20,'Provider Preflight Contract','contract_readiness',JSON_ARRAY('provider_profile_state'),JSON_ARRAY('preflight_contract_state'),JSON_ARRAY('ads_provider_preflight_contract_registry'),JSON_ARRAY('ads_provider_preflight_contract_validate'),JSON_ARRAY('ads_provider_preflight_contract_policy_v1'),JSON_ARRAY('active_contract_exists','validator_reports_ready_or_actionable_blocker'),JSON_OBJECT('no_provider_call',true,'no_spend_change',true,'secrets_included',false),'active','Validates generic ads provider preflight contract before provider-specific surfaces.',0),
  ('ads_provider.preflight_surface_blueprint','ads_provider_governance_orchestrator',30,'Preflight Surface Blueprint','surface_blueprint',JSON_ARRAY('provider_profile_state','preflight_contract_state'),JSON_ARRAY('surface_blueprint_state'),JSON_ARRAY('ads_provider_preflight_surface_blueprint_registry'),JSON_ARRAY('ads_provider_preflight_surface_blueprint'),JSON_ARRAY('ads_provider_preflight_surface_blueprint_policy_v1'),JSON_ARRAY('blueprint_exists_or_ready_to_propose','does_not_create_execution_surface'),JSON_OBJECT('no_provider_call',true,'surface_creation_allowed',false,'secrets_included',false),'active','Design-only blueprint for provider-specific preflight/readiness/execution surfaces.',0),
  ('ads_provider.credential_readiness','ads_provider_governance_orchestrator',40,'Credential Readiness Ledger','readiness_ledger',JSON_ARRAY('provider_key','credential_app_key'),JSON_ARRAY('credential_readiness_state'),JSON_ARRAY('google_ads_credential_readiness_ledger'),JSON_ARRAY('google_ads_credential_readiness_gate'),JSON_ARRAY('google_ads_credential_readiness_gate_policy_v1','google_ads_credential_readiness_ledger_policy_v1'),JSON_ARRAY('readiness_status_recorded','no_credential_payload_read'),JSON_OBJECT('no_credential_payload_read',true,'no_provider_call',true,'secrets_included',false),'active','Reads credential readiness metadata only; never decrypts or returns credentials.',0),
  ('ads_provider.budget_authority','ads_provider_governance_orchestrator',50,'Budget and Quota Authority','budget_readiness',JSON_ARRAY('spend_capability_key','budget_meter_key'),JSON_ARRAY('budget_authority_state'),JSON_ARRAY('budget_quota_authority_registry','google_ads_budget_preflight_ledger'),JSON_ARRAY('budget_quota_authority_dry_run','google_ads_budget_change_preflight'),JSON_ARRAY('budget_quota_authority_registry_policy_v1','google_ads_budget_preflight_ledger_policy_v1'),JSON_ARRAY('quota_or_approval_state_known','no_spend_change'),JSON_OBJECT('no_spend_change',true,'no_provider_call',true,'secrets_included',false),'active','Scores spend readiness from quota/preflight metadata without spend mutation.',0),
  ('ads_provider.execution_enablement','ads_provider_governance_orchestrator',60,'Execution Enablement Gate','execution_gate',JSON_ARRAY('execution_adapter_key','execution_enablement_family_key'),JSON_ARRAY('execution_enablement_state'),JSON_ARRAY('execution_enablement_registry','execution_enablement_requests'),JSON_ARRAY('execution_enablement_gate','execution_enablement_request'),JSON_ARRAY('execution_enablement_registry_policy_v1','execution_enablement_approval_flow_policy_v1'),JSON_ARRAY('disabled_by_default_is_classified_intentional_safety_block','active_enablement_required_for_execution'),JSON_OBJECT('execution_enabled_default',false,'recommendation_only',true,'secrets_included',false),'active','Classifies disabled execution as intentional safety block unless explicit enablement exists.',0),
  ('ads_provider.execution_adapter_candidate','ads_provider_governance_orchestrator',70,'Execution Adapter Candidate','execution_candidate',JSON_ARRAY('preflight_state','credential_readiness_state','budget_authority_state','execution_enablement_state'),JSON_ARRAY('execution_candidate_recommendation'),JSON_ARRAY('google_ads_budget_execution_gate_audit','platform_orchestration_recommendations'),JSON_ARRAY('google_ads_budget_change_execution_adapter'),JSON_ARRAY('google_ads_budget_execution_adapter_skeleton_policy_v1','recommendation_before_execution_policy_v1','no_hidden_execution_policy_v1'),JSON_ARRAY('candidate_is_recommendation_only','separate_capability_envelope_required_before_execution'),JSON_OBJECT('provider_execution_allowed',false,'requires_separate_capability_envelope',true,'secrets_included',false),'active','Produces recommendation only; provider execution remains out of scope for this foundation.',0)
ON DUPLICATE KEY UPDATE
  `plugin_key`=VALUES(`plugin_key`),
  `stage_order`=VALUES(`stage_order`),
  `display_name`=VALUES(`display_name`),
  `stage_type`=VALUES(`stage_type`),
  `required_inputs_json`=VALUES(`required_inputs_json`),
  `produced_outputs_json`=VALUES(`produced_outputs_json`),
  `required_tables_json`=VALUES(`required_tables_json`),
  `required_tools_json`=VALUES(`required_tools_json`),
  `required_policies_json`=VALUES(`required_policies_json`),
  `acceptance_criteria_json`=VALUES(`acceptance_criteria_json`),
  `safety_contract_json`=VALUES(`safety_contract_json`),
  `status`=VALUES(`status`),
  `notes`=VALUES(`notes`),
  `secrets_included`=0,
  `updated_at`=CURRENT_TIMESTAMP;

INSERT INTO `platform_orchestration_edges` (
  `edge_key`, `plugin_key`, `from_stage_key`, `to_stage_key`, `edge_type`,
  `condition_json`, `safety_contract_json`, `status`, `notes`, `secrets_included`
) VALUES
  ('ads_provider.profile_to_contract','ads_provider_governance_orchestrator','ads_provider.profile','ads_provider.preflight_contract','requires_ready',JSON_OBJECT('requires','provider_profile_state_known'),JSON_OBJECT('no_provider_call',true,'secrets_included',false),'active','Profile metadata is required before generic contract validation.',0),
  ('ads_provider.contract_to_blueprint','ads_provider_governance_orchestrator','ads_provider.preflight_contract','ads_provider.preflight_surface_blueprint','requires_ready',JSON_OBJECT('requires','preflight_contract_active_or_actionable'),JSON_OBJECT('no_provider_call',true,'secrets_included',false),'active','Generic contract must precede provider-specific blueprint.',0),
  ('ads_provider.blueprint_to_credential','ads_provider_governance_orchestrator','ads_provider.preflight_surface_blueprint','ads_provider.credential_readiness','requires_defined_surface',JSON_OBJECT('requires','credential_readiness_surface_named'),JSON_OBJECT('no_credential_payload_read',true,'secrets_included',false),'active','Credential readiness can be scored after readiness surface is named.',0),
  ('ads_provider.credential_to_budget','ads_provider_governance_orchestrator','ads_provider.credential_readiness','ads_provider.budget_authority','parallel_or_requires_known',JSON_OBJECT('requires','credential_state_known'),JSON_OBJECT('no_spend_change',true,'secrets_included',false),'active','Budget readiness is scored only with known credential state.',0),
  ('ads_provider.budget_to_enablement','ads_provider_governance_orchestrator','ads_provider.budget_authority','ads_provider.execution_enablement','requires_governed_budget_state',JSON_OBJECT('requires','budget_authority_state_known'),JSON_OBJECT('execution_enabled_default',false,'secrets_included',false),'active','Execution enablement classification depends on known budget/quota authority.',0),
  ('ads_provider.enablement_to_candidate','ads_provider_governance_orchestrator','ads_provider.execution_enablement','ads_provider.execution_adapter_candidate','recommendation_only',JSON_OBJECT('requires','execution_enablement_state_known','execution_without_enablement','blocked_execution_enablement_missing_or_disabled'),JSON_OBJECT('provider_execution_allowed',false,'requires_separate_capability_envelope',true,'secrets_included',false),'active','Execution candidate is recommendation-only and never performs provider execution.',0)
ON DUPLICATE KEY UPDATE
  `plugin_key`=VALUES(`plugin_key`),
  `from_stage_key`=VALUES(`from_stage_key`),
  `to_stage_key`=VALUES(`to_stage_key`),
  `edge_type`=VALUES(`edge_type`),
  `condition_json`=VALUES(`condition_json`),
  `safety_contract_json`=VALUES(`safety_contract_json`),
  `status`=VALUES(`status`),
  `notes`=VALUES(`notes`),
  `secrets_included`=0,
  `updated_at`=CURRENT_TIMESTAMP;
