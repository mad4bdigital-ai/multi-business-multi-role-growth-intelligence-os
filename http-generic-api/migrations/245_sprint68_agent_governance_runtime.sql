-- Sprint 68: governed agent behavior, research routing, opaque handoff state, and prompt quarantine.

CREATE TABLE IF NOT EXISTS agent_response_profile_registry (
  profile_key VARCHAR(191) NOT NULL PRIMARY KEY,
  scope_type ENUM('global','tenant','brand','role','channel','agent','workflow') NOT NULL DEFAULT 'global',
  scope_ref VARCHAR(191) NULL,
  language VARCHAR(64) NULL, channel VARCHAR(64) NULL, tone VARCHAR(64) NULL, verbosity VARCHAR(64) NULL,
  format_policy_json JSON NULL, citation_policy_json JSON NULL,
  priority INT NOT NULL DEFAULT 0,
  status ENUM('planned','active','disabled') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_agent_response_profile_scope (scope_type, scope_ref, status, priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS research_source_policy_registry (
  policy_key VARCHAR(191) NOT NULL PRIMARY KEY,
  scope_type ENUM('global','tenant','workflow') NOT NULL DEFAULT 'global',
  scope_ref VARCHAR(191) NULL,
  question_classes_json JSON NULL, source_order_json JSON NOT NULL,
  freshness_required TINYINT(1) NOT NULL DEFAULT 0, citations_required TINYINT(1) NOT NULL DEFAULT 1,
  external_search_allowed TINYINT(1) NOT NULL DEFAULT 0, max_tool_calls INT NOT NULL DEFAULT 5,
  priority INT NOT NULL DEFAULT 0, status ENUM('planned','active','disabled') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_research_source_policy_scope (scope_type, scope_ref, status, priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS research_source_execution_log (
  execution_id VARCHAR(36) NOT NULL PRIMARY KEY, policy_key VARCHAR(191) NOT NULL,
  tenant_id VARCHAR(64) NULL, plan_id VARCHAR(36) NULL, plan_step_id VARCHAR(36) NULL,
  question_class VARCHAR(191) NOT NULL DEFAULT 'general', selected_sources_json JSON NULL, source_evidence_json JSON NULL,
  external_search_used TINYINT(1) NOT NULL DEFAULT 0,
  citation_status ENUM('not_checked','passed','failed','not_required') NOT NULL DEFAULT 'not_checked',
  secrets_included TINYINT(1) NOT NULL DEFAULT 0, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_research_execution_plan_step (plan_id, plan_step_id),
  KEY idx_research_execution_policy (policy_key, created_at), KEY idx_research_execution_plan (plan_id, plan_step_id),
  CONSTRAINT chk_research_source_execution_no_secrets CHECK (secrets_included = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS governed_research_plan_registry (
  plan_id VARCHAR(36) NOT NULL PRIMARY KEY, tenant_id VARCHAR(64) NOT NULL,
  idempotency_key VARCHAR(191) NOT NULL, query_hash VARCHAR(64) NOT NULL, policy_key VARCHAR(191) NOT NULL,
  policy_snapshot_json JSON NOT NULL, policy_snapshot_hash VARCHAR(64) NOT NULL, plan_contract_hash VARCHAR(64) NOT NULL,
  question_class VARCHAR(191) NOT NULL DEFAULT 'general', created_by VARCHAR(191) NULL,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_governed_research_plan_idempotency (tenant_id, idempotency_key),
  KEY idx_governed_research_plan_query (tenant_id, query_hash, created_at),
  KEY idx_governed_research_plan_policy_snapshot (policy_key, policy_snapshot_hash),
  CONSTRAINT chk_governed_research_plan_no_secrets CHECK (secrets_included = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_handoff_state_registry (
  state_id VARCHAR(36) NOT NULL PRIMARY KEY, state_hash VARCHAR(64) NOT NULL UNIQUE,
  tenant_id VARCHAR(64) NULL, user_id VARCHAR(191) NULL, source_agent_id VARCHAR(191) NULL, target_agent_id VARCHAR(191) NULL,
  resource_ref VARCHAR(500) NULL, intent VARCHAR(191) NOT NULL DEFAULT 'continue',
  current_state_json JSON NULL, required_checks_json JSON NULL, allowed_actions_json JSON NULL,
  expires_at DATETIME NULL, one_time_use TINYINT(1) NOT NULL DEFAULT 1,
  consumed_at DATETIME NULL, consumed_by VARCHAR(191) NULL, revoked_at DATETIME NULL, revoked_by VARCHAR(191) NULL,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_agent_handoff_tenant (tenant_id, created_at), KEY idx_agent_handoff_target (target_agent_id, created_at),
  CONSTRAINT chk_agent_handoff_state_no_secrets CHECK (secrets_included = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_handoff_state_access_log (
  access_id VARCHAR(36) NOT NULL PRIMARY KEY, state_id VARCHAR(36) NOT NULL, actor_id VARCHAR(191) NULL,
  action ENUM('read','consume','revoke','denied') NOT NULL, outcome ENUM('allowed','denied','failed') NOT NULL,
  evidence_json JSON NULL, secrets_included TINYINT(1) NOT NULL DEFAULT 0, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_agent_handoff_access_state (state_id, created_at),
  CONSTRAINT chk_agent_handoff_access_no_secrets CHECK (secrets_included = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS external_prompt_artifact_registry (
  artifact_id VARCHAR(36) NOT NULL PRIMARY KEY, artifact_hash VARCHAR(64) NOT NULL,
  tenant_id VARCHAR(64) NULL, user_id VARCHAR(191) NULL, source_ref VARCHAR(500) NULL,
  classification VARCHAR(191) NOT NULL, trust_status ENUM('quarantined','reviewed','rejected','promoted') NOT NULL DEFAULT 'quarantined',
  findings_json JSON NULL, content_summary TEXT NULL,
  execution_authority TINYINT(1) NOT NULL DEFAULT 0, tool_authority TINYINT(1) NOT NULL DEFAULT 0, policy_authority TINYINT(1) NOT NULL DEFAULT 0,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_external_prompt_trust (trust_status, created_at), KEY idx_external_prompt_hash (artifact_hash),
  CONSTRAINT chk_external_prompt_no_execution_authority CHECK (execution_authority = 0),
  CONSTRAINT chk_external_prompt_no_tool_authority CHECK (tool_authority = 0),
  CONSTRAINT chk_external_prompt_no_policy_authority CHECK (policy_authority = 0),
  CONSTRAINT chk_external_prompt_no_secrets CHECK (secrets_included = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- memory_scope_type_registry and memory_scope_links are owned by migrations
-- 251_sprint68_dynamic_memory_scope_types.sql and 252_sprint68_memory_scope_links_foundation.sql.
-- This migration must not create legacy versions of those canonical tables.

CREATE OR REPLACE VIEW v_skill_runtime_coverage AS
SELECT s.skill_key, s.display_name, s.skill_type, s.scope, s.status AS agent_skill_status,
       COUNT(DISTINCT CASE WHEN g.status = 'active' THEN g.grant_id END) AS active_grant_count,
       m.status AS manifest_status, p.status AS prompt_registry_status,
       CASE WHEN m.skill_key IS NOT NULL AND p.skill_key IS NOT NULL THEN 'covered' ELSE 'gap' END AS coverage_status
FROM agent_skills s
LEFT JOIN agent_skill_grants g ON g.skill_id = s.skill_id
LEFT JOIN skill_manifests m
  ON m.skill_key COLLATE utf8mb4_unicode_ci = s.skill_key COLLATE utf8mb4_unicode_ci
LEFT JOIN platform_engine_skill_prompt_registry p
  ON p.skill_key COLLATE utf8mb4_unicode_ci = s.skill_key COLLATE utf8mb4_unicode_ci
GROUP BY s.skill_key, s.display_name, s.skill_type, s.scope, s.status, m.status, p.status, m.skill_key, p.skill_key;

INSERT INTO agent_response_profile_registry
  (profile_key, scope_type, language, channel, tone, verbosity, format_policy_json, citation_policy_json, priority, status)
VALUES ('platform_default_response', 'global', 'auto', 'api', 'direct', 'concise', JSON_OBJECT('structured', TRUE), JSON_OBJECT('cite_external_sources', TRUE), 0, 'active')
ON DUPLICATE KEY UPDATE status = VALUES(status), updated_at = CURRENT_TIMESTAMP;

INSERT INTO research_source_policy_registry
  (policy_key, scope_type, source_order_json, freshness_required, citations_required, external_search_allowed, max_tool_calls, priority, status)
VALUES ('internal_first_default', 'global', JSON_ARRAY('internal_registry','workspace_knowledge','external_search'), 0, 1, 0, 5, 0, 'active')
ON DUPLICATE KEY UPDATE source_order_json = VALUES(source_order_json), status = VALUES(status), updated_at = CURRENT_TIMESTAMP;

INSERT INTO memory_scope_type_registry
  (scope_type, display_name, description, scope_layer, identity_table, identity_key_column,
   parent_scope_type, supports_tenant_id, supports_user_id, supports_workspace_key,
   supports_brand_key, supports_activity_type_key, supports_role_key,
   default_visibility_scope, approval_required, status, metadata_json)
VALUES
  ('agent', 'Agent', 'Platform agent runtime identity and governance scope.', 'runtime',
   'agents', 'agent_id', 'platform', 0, 0, 1, 1, 1, 1,
   'platform_admin', 1, 'active',
   JSON_OBJECT('dynamic_scope', TRUE, 'source_migration', '245_sprint68_agent_governance_runtime.sql'))
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  scope_layer = VALUES(scope_layer),
  identity_table = VALUES(identity_table),
  identity_key_column = VALUES(identity_key_column),
  parent_scope_type = VALUES(parent_scope_type),
  supports_tenant_id = VALUES(supports_tenant_id),
  supports_user_id = VALUES(supports_user_id),
  supports_workspace_key = VALUES(supports_workspace_key),
  supports_brand_key = VALUES(supports_brand_key),
  supports_activity_type_key = VALUES(supports_activity_type_key),
  supports_role_key = VALUES(supports_role_key),
  default_visibility_scope = VALUES(default_visibility_scope),
  approval_required = VALUES(approval_required),
  status = VALUES(status),
  metadata_json = VALUES(metadata_json),
  updated_at = CURRENT_TIMESTAMP;
INSERT INTO platform_engine_policy_registry
  (policy_key, engine_key, scope_type, mode, risk_default, approval_required_min_risk,
   require_scope_guard, require_audit, require_validators, blocked_terms_json, status, notes)
VALUES
  ('agent_governance_runtime_policy_v1', 'canonical_agent_runtime_engine', 'global', 'diagnose_only', 'high', 'low',
   1, 1, 1, JSON_ARRAY('execution_authority=true','tool_authority=true','policy_authority=true'), 'active',
   'External prompt artifacts, response profiles, and handoff state cannot self-grant authority.')
ON DUPLICATE KEY UPDATE status = VALUES(status), notes = VALUES(notes), updated_at = CURRENT_TIMESTAMP;

INSERT INTO platform_engine_policy_rules
  (rule_key, policy_key, engine_key, priority, task_class, resource_kind, resource_pattern,
   condition_json, strategy_key, risk_level, auto_apply_allowed, dry_run_required, approval_required,
   validator_commands_json, blocked_terms_json, status, notes)
VALUES
  ('external_prompt_quarantine_rule_v1', 'agent_governance_runtime_policy_v1', 'canonical_agent_runtime_engine', 1000,
   'external_prompt_classification', 'prompt_artifact', '*',
   JSON_OBJECT('trust_status','quarantined','execution_authority',FALSE), 'manual_only', 'high', 0, 1, 1,
   JSON_ARRAY('node test-agent-governance-runtime.mjs'),
   JSON_ARRAY('execution_authority=true','tool_authority=true','policy_authority=true'), 'active',
   'Quarantine prompt-like external text and forbid authority promotion without a separate governed decision.')
ON DUPLICATE KEY UPDATE priority = VALUES(priority), status = VALUES(status), notes = VALUES(notes), updated_at = CURRENT_TIMESTAMP;

INSERT INTO database_table_lifecycle_registry
  (table_name, table_family, owner_engine_key, authority_model, usage_status, write_strategy,
   retention_class, archive_strategy, cleanup_strategy, growth_policy, linked_by_code, linked_by_policy, risk_level, status, notes)
VALUES
  ('agent_response_profile_registry','agent_governance','canonical_agent_runtime_engine','canonical','runtime_registry','platform_primary','configuration','manual_review','none','low_growth',1,1,'low','active','Presentation-only response profiles.'),
  ('research_source_policy_registry','agent_governance','canonical_agent_runtime_engine','canonical','runtime_registry','platform_primary','configuration','manual_review','none','low_growth',1,1,'medium','active','Internal-first research policy.'),
  ('research_source_execution_log','agent_governance','canonical_agent_runtime_engine','canonical','audit_log','platform_primary','audit_standard','manual_review','retention_policy','append_only',1,1,'medium','active','Research source evidence ledger.'),
  ('governed_research_plan_registry','agent_governance','canonical_agent_runtime_engine','canonical','runtime_registry','platform_primary','business_record','manual_review','retain_plan_lineage','bounded_growth',1,1,'high','active','Tenant-bound idempotency and policy binding for governed research plans.'),
  ('agent_handoff_state_registry','agent_governance','canonical_agent_runtime_engine','canonical','runtime_canonical','platform_primary','short_lived_state','manual_review','expiry_policy','bounded_growth',1,1,'high','active','Opaque expiring agent handoff state.'),
  ('agent_handoff_state_access_log','agent_governance','canonical_agent_runtime_engine','canonical','audit_log','platform_primary','audit_standard','manual_review','retention_policy','append_only',1,1,'high','active','Handoff access ledger.'),
  ('external_prompt_artifact_registry','agent_governance','canonical_agent_runtime_engine','canonical','runtime_registry','platform_primary','quarantine_review','manual_review','review_policy','bounded_growth',1,1,'high','active','Untrusted prompt artifact quarantine.')
  ,('memory_scope_type_registry','agent_governance','canonical_agent_runtime_engine','canonical','runtime_registry','platform_primary','configuration','manual_review','none','low_growth',1,1,'medium','active','Memory scope precedence and cross-scope defaults.')
  ,('memory_scope_links','agent_governance','canonical_agent_runtime_engine','canonical','runtime_registry','platform_primary','business_record','manual_review','expiry_policy','bounded_growth',1,1,'high','active','Explicit tenant-bound cross-scope memory links.')
ON DUPLICATE KEY UPDATE table_family = VALUES(table_family), owner_engine_key = VALUES(owner_engine_key),
  usage_status = VALUES(usage_status), linked_by_code = VALUES(linked_by_code), linked_by_policy = VALUES(linked_by_policy),
  risk_level = VALUES(risk_level), status = VALUES(status), notes = VALUES(notes), updated_at = CURRENT_TIMESTAMP;
