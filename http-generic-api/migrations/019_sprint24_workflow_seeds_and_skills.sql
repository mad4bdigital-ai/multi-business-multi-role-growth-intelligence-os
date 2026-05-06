-- Sprint 24: Workflow Seeds + Agent Skills
-- Part A: Seeds the critical system workflows that chain-event-dispatcher and
--         session-assimilation-consumer depend on. Without these rows, loadWorkflowDef()
--         returns null and both consumers silently fail.
-- Part B: agent_skills and agent_skill_grants — formalises what capabilities
--         each agent is authorised to use, per tenant/brand scope.
-- All statements idempotent.

-- ─── Part A: System workflow seeds ───────────────────────────────────────────
-- workflows.active uses VARCHAR so we store '1' (matches the loadWorkflowDef() query).
-- review_required, memory_required, logging_required also VARCHAR in legacy schema.

INSERT IGNORE INTO `workflows`
  (workflow_key, workflow_name, execution_class, execution_mode, target_module,
   output_artifact_type, primary_output, parent_layer, linked_workflows,
   review_required, memory_required, logging_required, active, status,
   registry_source)
VALUES
  -- Processes captured AI tool sessions → extracts knowledge for platform memory
  ('post_conversation_knowledge_assimilation',
   'Post-Conversation Knowledge Assimilation',
   'standard', 'async', 'conversation_assimilation',
   'Analysis', 'Assimilated Knowledge Report', 'System Intelligence', NULL,
   'FALSE', 'TRUE', 'TRUE', '1', 'active', 'platform_seed'),

  -- Writes assimilation results back into logic_definitions / adaptation_records
  ('conversation_assimilation_writeback',
   'Conversation Assimilation Writeback',
   'rule_based', 'sync', 'assimilation_writeback',
   'Operational', 'Writeback Confirmation', 'System Intelligence',
   NULL,
   'FALSE', 'FALSE', 'TRUE', '1', 'active', 'platform_seed'),

  -- Deterministic health check for agent registry entries
  ('agent_health_check',
   'Agent Health Check',
   'rule_based', 'sync', 'agent_health_evaluator',
   'Operational', 'Agent Health Report', 'System Governance', NULL,
   'FALSE', 'FALSE', 'TRUE', '1', 'active', 'platform_seed'),

  -- Evaluates governance rules for a brand publish request
  ('brand_publish_preflight',
   'Brand Publish Preflight Validation',
   'rule_based', 'sync', 'publish_preflight_evaluator',
   'Operational', 'Preflight Pass/Fail', 'Governed Operations', NULL,
   'FALSE', 'FALSE', 'TRUE', '1', 'active', 'platform_seed'),

  -- Audit sweep — checks execution_plans / workflow_runs for governance drift
  ('governance_audit_sweep',
   'Governance Audit Sweep',
   'rule_based', 'sync', 'governance_audit_evaluator',
   'Scorecard', 'Audit Scorecard', 'Governance Audit',
   'conversation_assimilation_writeback',
   'TRUE', 'FALSE', 'TRUE', '1', 'active', 'platform_seed'),

  -- Links to brand_publish_preflight on pass, skips on fail
  ('content_batch_publish',
   'Content Batch Publish',
   'standard', 'async', 'content_batch_publisher',
   'Operational', 'Publish Result', 'Content Operations',
   'brand_publish_preflight',
   'FALSE', 'FALSE', 'TRUE', '1', 'active', 'platform_seed'),

  -- SEO analysis with linked writeback on completion
  ('seo_gap_analysis',
   'SEO Gap Analysis',
   'complex', 'async', 'seo_gap_analyser',
   'Analysis', 'SEO Gap Report', 'SEO Intelligence',
   'conversation_assimilation_writeback',
   'TRUE', 'TRUE', 'TRUE', '1', 'active', 'platform_seed'),

  -- Brand onboarding profile builder
  ('brand_onboarding_bootstrap',
   'Brand Onboarding Bootstrap',
   'standard', 'async', 'brand_onboarding_builder',
   'Operational', 'Brand Profile', 'Brand Intelligence',
   'post_conversation_knowledge_assimilation',
   'FALSE', 'TRUE', 'TRUE', '1', 'active', 'platform_seed');

-- ─── Part B: Agent skills ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `agent_skills` (
  `id`               INT UNSIGNED  AUTO_INCREMENT PRIMARY KEY,
  `skill_id`         VARCHAR(36)   NOT NULL UNIQUE,
  `skill_key`        VARCHAR(128)  NOT NULL UNIQUE,
  `display_name`     VARCHAR(255)  NOT NULL,
  `description`      TEXT          NULL,
  `skill_type`       ENUM('tool_use','logic_execution','api_access',
                          'data_read','data_write','system_control') NOT NULL DEFAULT 'tool_use',
  `scope`            ENUM('global','tenant','brand') NOT NULL DEFAULT 'global',
  `capability_json`  JSON          NULL  COMMENT 'Structured capability descriptor (tools, endpoints, permissions)',
  `requires_approval` TINYINT(1)   NOT NULL DEFAULT 0,
  `status`           ENUM('active','draft','deprecated') NOT NULL DEFAULT 'active',
  `created_at`       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_skill_type`   (`skill_type`),
  INDEX `idx_skill_scope`  (`scope`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Skill grants per agent (global or scoped to tenant/brand) ────────────────

CREATE TABLE IF NOT EXISTS `agent_skill_grants` (
  `id`          INT UNSIGNED  AUTO_INCREMENT PRIMARY KEY,
  `grant_id`    VARCHAR(36)   NOT NULL UNIQUE,
  `agent_id`    VARCHAR(36)   NOT NULL,
  `skill_id`    VARCHAR(36)   NOT NULL,
  `tenant_id`   VARCHAR(36)   NULL  COMMENT 'NULL = global grant across all tenants',
  `brand_key`   VARCHAR(128)  NULL  COMMENT 'NULL = not brand-scoped',
  `granted_by`  VARCHAR(36)   NULL,
  `granted_at`  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at`  DATETIME      NULL,
  `status`      ENUM('active','revoked','expired') NOT NULL DEFAULT 'active',
  UNIQUE KEY `uq_agent_skill_tenant` (`agent_id`, `skill_id`, `tenant_id`),
  INDEX `idx_grants_agent`  (`agent_id`),
  INDEX `idx_grants_skill`  (`skill_id`),
  INDEX `idx_grants_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Seed: platform skills ────────────────────────────────────────────────────

INSERT IGNORE INTO `agent_skills`
  (skill_id, skill_key, display_name, description, skill_type, scope, requires_approval, status)
VALUES
  -- Logic evaluation
  ('skl-logic-eval-0001', 'logic.evaluate_pack',
   'Evaluate Logic Pack', 'Run a bound logic pack against input context.',
   'logic_execution', 'global', 0, 'active'),

  -- Data reads
  ('skl-data-read-0001', 'data.read_workflow_runs',
   'Read Workflow Runs', 'Query workflow_runs and step_runs for a tenant.',
   'data_read', 'global', 0, 'active'),

  ('skl-data-read-0002', 'data.read_sessions',
   'Read Customer Sessions', 'Query customer_sessions, session_turns, session_events.',
   'data_read', 'global', 0, 'active'),

  ('skl-data-read-0003', 'data.read_logic_definitions',
   'Read Logic Definitions', 'Query logic_definitions and adaptation_records.',
   'data_read', 'global', 0, 'active'),

  -- Data writes
  ('skl-data-wrt-0001', 'data.write_adaptation_records',
   'Write Adaptation Records', 'Create or update adaptation_records from rule evaluation output.',
   'data_write', 'global', 0, 'active'),

  ('skl-data-wrt-0002', 'data.write_output_artifacts',
   'Write Output Artifacts', 'Write completed execution output to output_artifacts.',
   'data_write', 'global', 0, 'active'),

  -- API access
  ('skl-api-wp-0001', 'api.wordpress_read',
   'WordPress Read', 'GET requests to WordPress REST API for a brand.',
   'api_access', 'brand', 0, 'active'),

  ('skl-api-wp-0002', 'api.wordpress_write',
   'WordPress Write', 'POST/PUT/DELETE to WordPress REST API. Requires brand.write_allowed.',
   'api_access', 'brand', 1, 'active'),

  ('skl-api-mcp-0001', 'api.make_mcp',
   'Make MCP Connector', 'tools/call to Make.com MCP stateless endpoint.',
   'api_access', 'global', 0, 'active'),

  -- System control (authority-only)
  ('skl-sys-ctrl-0001', 'system.trigger_chain_dispatch',
   'Trigger Chain Event Dispatch', 'Dispatch pending agent_chain_events.',
   'system_control', 'global', 1, 'active'),

  ('skl-sys-ctrl-0002', 'system.assimilate_sessions',
   'Assimilate Sessions', 'Run session assimilation queue consumer.',
   'system_control', 'global', 1, 'active'),

  ('skl-sys-ctrl-0003', 'system.write_logic_definitions',
   'Write Logic Definitions', 'Create or update logic_definitions (governance-gated).',
   'system_control', 'global', 1, 'active');

-- ─── Seed: agent → skill grants ───────────────────────────────────────────────
-- Global grants (tenant_id = NULL).

INSERT IGNORE INTO `agent_skill_grants`
  (grant_id, agent_id, skill_id, tenant_id, granted_by, status)
VALUES
  -- governed_ops_agent: logic eval + data reads + WP read + WP write
  (UUID(), 'agt-gov-ops-0001', 'skl-logic-eval-0001', NULL, 'system', 'active'),
  (UUID(), 'agt-gov-ops-0001', 'skl-data-read-0001',  NULL, 'system', 'active'),
  (UUID(), 'agt-gov-ops-0001', 'skl-api-wp-0001',     NULL, 'system', 'active'),
  (UUID(), 'agt-gov-ops-0001', 'skl-api-wp-0002',     NULL, 'system', 'active'),
  (UUID(), 'agt-gov-ops-0001', 'skl-data-wrt-0001',   NULL, 'system', 'active'),

  -- system_governance_agent: logic eval + data reads + write logic defs
  (UUID(), 'agt-sys-gov-0001', 'skl-logic-eval-0001',    NULL, 'system', 'active'),
  (UUID(), 'agt-sys-gov-0001', 'skl-data-read-0001',     NULL, 'system', 'active'),
  (UUID(), 'agt-sys-gov-0001', 'skl-data-read-0003',     NULL, 'system', 'active'),
  (UUID(), 'agt-sys-gov-0001', 'skl-sys-ctrl-0003',      NULL, 'system', 'active'),
  (UUID(), 'agt-sys-gov-0001', 'skl-data-wrt-0001',      NULL, 'system', 'active'),

  -- governance_audit_agent: logic eval + data reads
  (UUID(), 'agt-gov-aud-0001', 'skl-logic-eval-0001', NULL, 'system', 'active'),
  (UUID(), 'agt-gov-aud-0001', 'skl-data-read-0001',  NULL, 'system', 'active'),
  (UUID(), 'agt-gov-aud-0001', 'skl-data-read-0003',  NULL, 'system', 'active'),
  (UUID(), 'agt-gov-aud-0001', 'skl-data-wrt-0001',   NULL, 'system', 'active'),

  -- provider_ops_agent: WP read/write + MCP
  (UUID(), 'agt-prv-ops-0001', 'skl-data-read-0001',  NULL, 'system', 'active'),
  (UUID(), 'agt-prv-ops-0001', 'skl-api-wp-0001',     NULL, 'system', 'active'),
  (UUID(), 'agt-prv-ops-0001', 'skl-api-wp-0002',     NULL, 'system', 'active'),
  (UUID(), 'agt-prv-ops-0001', 'skl-api-mcp-0001',    NULL, 'system', 'active'),
  (UUID(), 'agt-prv-ops-0001', 'skl-data-wrt-0002',   NULL, 'system', 'active'),

  -- content_ops_agent, publishing_agent: WP read/write + data writes
  (UUID(), 'agt-cnt-ops-0001', 'skl-data-read-0001', NULL, 'system', 'active'),
  (UUID(), 'agt-cnt-ops-0001', 'skl-api-wp-0001',    NULL, 'system', 'active'),
  (UUID(), 'agt-cnt-ops-0001', 'skl-api-wp-0002',    NULL, 'system', 'active'),
  (UUID(), 'agt-cnt-ops-0001', 'skl-data-wrt-0002',  NULL, 'system', 'active'),

  (UUID(), 'agt-pub-000-0001', 'skl-data-read-0001', NULL, 'system', 'active'),
  (UUID(), 'agt-pub-000-0001', 'skl-api-wp-0001',    NULL, 'system', 'active'),
  (UUID(), 'agt-pub-000-0001', 'skl-api-wp-0002',    NULL, 'system', 'active'),
  (UUID(), 'agt-pub-000-0001', 'skl-data-wrt-0002',  NULL, 'system', 'active'),

  -- migration_agent: WP read/write + MCP
  (UUID(), 'agt-mig-000-0001', 'skl-data-read-0001', NULL, 'system', 'active'),
  (UUID(), 'agt-mig-000-0001', 'skl-api-wp-0001',    NULL, 'system', 'active'),
  (UUID(), 'agt-mig-000-0001', 'skl-api-wp-0002',    NULL, 'system', 'active'),
  (UUID(), 'agt-mig-000-0001', 'skl-api-mcp-0001',   NULL, 'system', 'active'),
  (UUID(), 'agt-mig-000-0001', 'skl-data-wrt-0002',  NULL, 'system', 'active'),

  -- revenue, product, execution agents: data reads + output writes
  (UUID(), 'agt-rev-000-0001', 'skl-data-read-0001', NULL, 'system', 'active'),
  (UUID(), 'agt-rev-000-0001', 'skl-data-wrt-0002',  NULL, 'system', 'active'),
  (UUID(), 'agt-prd-000-0001', 'skl-data-read-0001', NULL, 'system', 'active'),
  (UUID(), 'agt-prd-000-0001', 'skl-data-wrt-0002',  NULL, 'system', 'active'),
  (UUID(), 'agt-exe-000-0001', 'skl-data-read-0001', NULL, 'system', 'active'),
  (UUID(), 'agt-exe-000-0001', 'skl-api-mcp-0001',   NULL, 'system', 'active'),
  (UUID(), 'agt-exe-000-0001', 'skl-data-wrt-0002',  NULL, 'system', 'active'),

  -- complex agents: data reads + sessions + output writes
  (UUID(), 'agt-seo-000-0001', 'skl-data-read-0001', NULL, 'system', 'active'),
  (UUID(), 'agt-seo-000-0001', 'skl-data-read-0002', NULL, 'system', 'active'),
  (UUID(), 'agt-seo-000-0001', 'skl-data-wrt-0002',  NULL, 'system', 'active'),

  (UUID(), 'agt-mkt-000-0001', 'skl-data-read-0001', NULL, 'system', 'active'),
  (UUID(), 'agt-mkt-000-0001', 'skl-data-read-0002', NULL, 'system', 'active'),
  (UUID(), 'agt-mkt-000-0001', 'skl-data-wrt-0002',  NULL, 'system', 'active'),

  (UUID(), 'agt-grw-000-0001', 'skl-data-read-0001', NULL, 'system', 'active'),
  (UUID(), 'agt-grw-000-0001', 'skl-data-read-0002', NULL, 'system', 'active'),
  (UUID(), 'agt-grw-000-0001', 'skl-data-wrt-0002',  NULL, 'system', 'active'),

  (UUID(), 'agt-brd-000-0001', 'skl-data-read-0001', NULL, 'system', 'active'),
  (UUID(), 'agt-brd-000-0001', 'skl-data-read-0002', NULL, 'system', 'active'),
  (UUID(), 'agt-brd-000-0001', 'skl-api-wp-0001',    NULL, 'system', 'active'),
  (UUID(), 'agt-brd-000-0001', 'skl-data-wrt-0002',  NULL, 'system', 'active'),

  (UUID(), 'agt-air-000-0001', 'skl-data-read-0001', NULL, 'system', 'active'),
  (UUID(), 'agt-air-000-0001', 'skl-data-read-0003', NULL, 'system', 'active'),
  (UUID(), 'agt-air-000-0001', 'skl-data-wrt-0002',  NULL, 'system', 'active'),

  -- system_intelligence_agent (authority): all skills
  (UUID(), 'agt-sys-int-0001', 'skl-logic-eval-0001',  NULL, 'system', 'active'),
  (UUID(), 'agt-sys-int-0001', 'skl-data-read-0001',   NULL, 'system', 'active'),
  (UUID(), 'agt-sys-int-0001', 'skl-data-read-0002',   NULL, 'system', 'active'),
  (UUID(), 'agt-sys-int-0001', 'skl-data-read-0003',   NULL, 'system', 'active'),
  (UUID(), 'agt-sys-int-0001', 'skl-data-wrt-0001',    NULL, 'system', 'active'),
  (UUID(), 'agt-sys-int-0001', 'skl-data-wrt-0002',    NULL, 'system', 'active'),
  (UUID(), 'agt-sys-int-0001', 'skl-api-wp-0001',      NULL, 'system', 'active'),
  (UUID(), 'agt-sys-int-0001', 'skl-api-wp-0002',      NULL, 'system', 'active'),
  (UUID(), 'agt-sys-int-0001', 'skl-api-mcp-0001',     NULL, 'system', 'active'),
  (UUID(), 'agt-sys-int-0001', 'skl-sys-ctrl-0001',    NULL, 'system', 'active'),
  (UUID(), 'agt-sys-int-0001', 'skl-sys-ctrl-0002',    NULL, 'system', 'active'),
  (UUID(), 'agt-sys-int-0001', 'skl-sys-ctrl-0003',    NULL, 'system', 'active');
