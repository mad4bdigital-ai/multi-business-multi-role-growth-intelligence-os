-- Sprint 20: Agent Registry
-- Formalises the implicit agent layer already expressed through task_routes.execution_layer,
-- logic_definitions, and the agentLoopRunner runtime into named, auditable agents.
-- All statements are idempotent (CREATE TABLE IF NOT EXISTS / ALTER IF NOT EXISTS pattern).

-- ─── Core agent definitions ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `agents` (
  `id`                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `agent_id`              VARCHAR(36)  NOT NULL UNIQUE,
  `name`                  VARCHAR(64)  NOT NULL UNIQUE,
  `display_name`          VARCHAR(128) NOT NULL,
  `description`           TEXT         NULL,
  `execution_class`       ENUM('rule_based','standard','complex','authority') NOT NULL DEFAULT 'standard',
  `execution_layer`       VARCHAR(128) NULL COMMENT 'Maps to task_routes.execution_layer',
  `system_prompt`         TEXT         NULL,
  `health_status`         ENUM('active','degraded','offline') NOT NULL DEFAULT 'active',
  `fallback_agent_id`     VARCHAR(36)  NULL COMMENT 'Agent to escalate to on failure',
  `max_delegation_ttl`    INT          NOT NULL DEFAULT 3600 COMMENT 'Delegation expiry in seconds',
  `min_supervision_role`  VARCHAR(64)  NULL COMMENT 'Minimum assistance_role required to invoke',
  `is_system`             TINYINT(1)   NOT NULL DEFAULT 1,
  `status`                ENUM('active','draft','archived') NOT NULL DEFAULT 'active',
  `created_at`            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Agent ↔ logic_pack bindings ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `agent_logic_pack_bindings` (
  `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `agent_id`   VARCHAR(36)     NOT NULL,
  `pack_id`    VARCHAR(36)     NOT NULL,
  `priority`   TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_agent_pack` (`agent_id`, `pack_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Agent ↔ engine/tool bindings ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `agent_tool_bindings` (
  `id`          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `agent_id`    VARCHAR(36)  NOT NULL,
  `engine_name` VARCHAR(128) NOT NULL,
  `tool_type`   ENUM('mcp','http_action','logic_key') NOT NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_agent_tool` (`agent_id`, `engine_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Agent ↔ workflow bindings ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `agent_workflow_bindings` (
  `id`                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `agent_id`          VARCHAR(36)  NOT NULL,
  `workflow_key`      VARCHAR(128) NOT NULL,
  `trigger_condition` VARCHAR(255) NULL,
  `created_at`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_agent_workflow` (`agent_id`, `workflow_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Supervision policy per agent (optionally scoped to tenant) ──────────────

CREATE TABLE IF NOT EXISTS `agent_supervision_policy` (
  `id`                       INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `agent_id`                 VARCHAR(36) NOT NULL,
  `tenant_id`                VARCHAR(36) NULL COMMENT 'NULL = global default',
  `min_assistance_role`      VARCHAR(64) NOT NULL,
  `auto_approve_below_class` ENUM('rule_based','standard','complex','authority') NULL,
  `created_at`               DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_agent_tenant_policy` (`agent_id`, `tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Delegation contracts (explicit user → agent delegation record) ───────────

CREATE TABLE IF NOT EXISTS `agent_delegations` (
  `id`             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `delegation_id`  VARCHAR(36)  NOT NULL UNIQUE,
  `user_id`        VARCHAR(36)  NOT NULL,
  `tenant_id`      VARCHAR(36)  NOT NULL,
  `agent_id`       VARCHAR(36)  NOT NULL,
  `intent_key`     VARCHAR(128) NOT NULL,
  `brand_key`      VARCHAR(128) NULL,
  `plan_id`        VARCHAR(36)  NULL,
  `status`         ENUM('pending','executing','completed','failed','expired') NOT NULL DEFAULT 'pending',
  `expires_at`     DATETIME     NOT NULL,
  `completed_at`   DATETIME     NULL,
  `failure_reason` VARCHAR(255) NULL,
  `created_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Wire agent_id into existing delegation chain tables ─────────────────────

ALTER TABLE `intent_resolutions`
  ADD COLUMN IF NOT EXISTS `agent_id` VARCHAR(36) NULL AFTER `matched_workflow_key`;

ALTER TABLE `execution_plans`
  ADD COLUMN IF NOT EXISTS `agent_id` VARCHAR(36) NULL AFTER `workflow_key`;

ALTER TABLE `workflow_runs`
  ADD COLUMN IF NOT EXISTS `agent_id` VARCHAR(36) NULL AFTER `workflow_key`;

ALTER TABLE `adaptation_records`
  ADD COLUMN IF NOT EXISTS `agent_id` VARCHAR(36) NULL AFTER `logic_id`;

-- Allow logic_packs to attach TO agents (extends existing enum)
ALTER TABLE `pack_attachments`
  MODIFY COLUMN `target_type` ENUM('tenant','workflow','logic','action','brand','agent') NOT NULL;

-- ─── Seed: system agents ─────────────────────────────────────────────────────
-- execution_layer values map directly to task_routes.execution_layer
-- fallback chain: rule_based → system_intelligence_agent → approval_hold

INSERT IGNORE INTO `agents`
  (`agent_id`, `name`, `display_name`, `description`, `execution_class`, `execution_layer`,
   `max_delegation_ttl`, `min_supervision_role`, `is_system`, `status`)
VALUES
  -- Rule-based agents (no model call, deterministic)
  ('agt-gov-ops-0001', 'governed_ops_agent',      'Governed Operations Agent',
   'Handles brand governance, publish control, preflight validation, and asset intake. Deterministic rule evaluation only.',
   'rule_based', 'Governed Operations', 1800, NULL, 1, 'active'),

  ('agt-sys-gov-0001', 'system_governance_agent', 'System Governance Agent',
   'Manages logic addition pipelines, surface governance, execution log audits. Deterministic rule evaluation only.',
   'rule_based', 'System Governance', 1800, 'reviewer_trainee', 1, 'active'),

  ('agt-gov-aud-0001', 'governance_audit_agent',  'Governance Audit Agent',
   'Emits governance drift anomalies, validates surface connectivity. Deterministic audit checks.',
   'rule_based', 'Governance Audit', 900, 'certified_reviewer', 1, 'active'),

  -- Standard agents (LLM: claude-haiku)
  ('agt-prv-ops-0001', 'provider_ops_agent',      'Provider Operations Agent',
   'Executes Hostinger and WordPress provider operations: DNS, VPS, content, forms, SEO plugins.',
   'standard', 'Provider Operations', 3600, NULL, 1, 'active'),

  ('agt-exe-000-0001', 'execution_agent',          'Execution Agent',
   'Handles HTTP execution, API design, content repurposing enablement, and tracking analytics.',
   'standard', 'Execution', 3600, NULL, 1, 'active'),

  ('agt-cnt-ops-0001', 'content_ops_agent',        'Content Operations Agent',
   'CPT CRUD, draft creation, bulk validation, publish and unpublish flows.',
   'standard', 'Content Operations', 3600, NULL, 1, 'active'),

  ('agt-pub-000-0001', 'publishing_agent',          'Publishing Agent',
   'Batch draft creation, brand bootstrapping, translation variants, repair of failed publish runs.',
   'standard', 'Publishing', 3600, NULL, 1, 'active'),

  ('agt-rev-000-0001', 'revenue_agent',             'Revenue Intelligence Agent',
   'Analytics reporting, Google Ads reporting, pricing and revenue intelligence.',
   'standard', 'Revenue Intelligence', 3600, NULL, 1, 'active'),

  ('agt-prd-000-0001', 'product_agent',             'Product Intelligence Agent',
   'Tour catalog analysis and product intelligence tasks.',
   'standard', 'Product Intelligence', 3600, NULL, 1, 'active'),

  ('agt-mig-000-0001', 'migration_agent',           'CMS Migration Agent',
   'Site migration, migration validation, migration repair, multilingual operations.',
   'standard', 'CMS / Migration', 7200, NULL, 1, 'active'),

  -- Complex agents (LLM: claude-sonnet)
  ('agt-seo-000-0001', 'seo_agent',                 'SEO Intelligence Agent',
   'SEO strategy, SERP research, Search Console reporting.',
   'complex', 'SEO Intelligence', 3600, NULL, 1, 'active'),

  ('agt-mkt-000-0001', 'market_agent',              'Market Intelligence Agent',
   'Destination analysis, web scraping, tourism market gap detection.',
   'complex', 'Market Intelligence', 3600, NULL, 1, 'active'),

  ('agt-grw-000-0001', 'growth_agent',              'Growth Intelligence Agent',
   'Analytics sync across active brands, growth strategy planning.',
   'complex', 'Growth Intelligence', 3600, NULL, 1, 'active'),

  ('agt-brd-000-0001', 'brand_agent',               'Brand Intelligence Agent',
   'Brand marketing, brand positioning, onboarding profile bootstrap.',
   'complex', 'Brand Intelligence', 3600, NULL, 1, 'active'),

  ('agt-air-000-0001', 'ai_resolver_agent',         'AI Resolver Agent',
   'Generates AI implementation plans and task manifests from intent.',
   'complex', 'AI resolver', 3600, NULL, 1, 'active'),

  -- Authority agent (LLM: claude-opus)
  ('agt-sys-int-0001', 'system_intelligence_agent', 'System Intelligence Agent',
   'Full system audits, anomaly detection, auto-repair, activation, diagnostics, schema reconciliation.',
   'authority', 'System Intelligence', 7200, 'senior_reviewer', 1, 'active');

-- ─── Seed: fallback chain ─────────────────────────────────────────────────────
-- rule_based agents fall back to system_intelligence_agent on hard failure

UPDATE `agents` SET `fallback_agent_id` = 'agt-sys-int-0001'
WHERE `name` IN ('governed_ops_agent','system_governance_agent','governance_audit_agent');

-- ─── Seed: global supervision policies ───────────────────────────────────────

INSERT IGNORE INTO `agent_supervision_policy`
  (`agent_id`, `tenant_id`, `min_assistance_role`, `auto_approve_below_class`)
VALUES
  ('agt-sys-int-0001', NULL, 'senior_reviewer',      'standard'),
  ('agt-sys-gov-0001', NULL, 'reviewer_trainee',     'rule_based'),
  ('agt-gov-aud-0001', NULL, 'certified_reviewer',   'rule_based'),
  ('agt-gov-ops-0001', NULL, NULL,                   'rule_based'),
  ('agt-prv-ops-0001', NULL, NULL,                   'standard'),
  ('agt-exe-000-0001', NULL, NULL,                   'standard'),
  ('agt-seo-000-0001', NULL, NULL,                   'complex'),
  ('agt-brd-000-0001', NULL, NULL,                   'complex'),
  ('agt-grw-000-0001', NULL, NULL,                   'complex'),
  ('agt-mkt-000-0001', NULL, NULL,                   'complex'),
  ('agt-air-000-0001', NULL, NULL,                   'complex'),
  ('agt-cnt-ops-0001', NULL, NULL,                   'standard'),
  ('agt-pub-000-0001', NULL, NULL,                   'standard'),
  ('agt-rev-000-0001', NULL, NULL,                   'standard'),
  ('agt-prd-000-0001', NULL, NULL,                   'standard'),
  ('agt-mig-000-0001', NULL, NULL,                   'standard');
