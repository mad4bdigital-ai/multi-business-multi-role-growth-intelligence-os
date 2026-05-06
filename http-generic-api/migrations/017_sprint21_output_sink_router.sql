-- Sprint 21: Output Sink Router
-- Adds the missing downstream layer: routes agent output_json into typed sink tables
-- instead of leaving it stranded in workflow_runs.output_json.
-- All statements idempotent.

-- ─── Universal artifact store ─────────────────────────────────────────────────
-- Every agent execution writes one row here regardless of class or artifact type.

CREATE TABLE IF NOT EXISTS `output_artifacts` (
  `id`             INT UNSIGNED  AUTO_INCREMENT PRIMARY KEY,
  `artifact_id`    VARCHAR(36)   NOT NULL UNIQUE,
  `run_id`         VARCHAR(36)   NOT NULL,
  `agent_id`       VARCHAR(36)   NULL,
  `tenant_id`      VARCHAR(36)   NOT NULL,
  `brand_key`      VARCHAR(128)  NULL,
  `workflow_key`   VARCHAR(128)  NULL,
  `artifact_type`  VARCHAR(64)   NOT NULL COMMENT 'From workflows.output_artifact_type',
  `primary_output` VARCHAR(255)  NULL     COMMENT 'Human label from workflows.primary_output',
  `content_text`   LONGTEXT      NULL     COMMENT 'Raw text / markdown output',
  `content_json`   JSON          NULL     COMMENT 'Structured JSON output',
  `sink_targets`   JSON          NULL     COMMENT 'Which sinks received this artifact',
  `status`         ENUM('pending','delivered','failed') NOT NULL DEFAULT 'pending',
  `created_at`     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_artifact_run`    (`run_id`),
  INDEX `idx_artifact_tenant` (`tenant_id`),
  INDEX `idx_artifact_agent`  (`agent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Sink dispatch audit trail ────────────────────────────────────────────────
-- One row per sink write attempt — observability for the router itself.

CREATE TABLE IF NOT EXISTS `sink_dispatch_log` (
  `id`          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `dispatch_id` VARCHAR(36)  NOT NULL UNIQUE,
  `run_id`      VARCHAR(36)  NOT NULL,
  `agent_id`    VARCHAR(36)  NULL,
  `tenant_id`   VARCHAR(36)  NULL,
  `sink_type`   VARCHAR(64)  NOT NULL COMMENT 'output_artifact|adaptation_record|reporting_view|chain_event|audit_log',
  `sink_ref_id` VARCHAR(36)  NULL COMMENT 'ID of the record created in the target sink',
  `status`      ENUM('ok','failed','skipped') NOT NULL DEFAULT 'ok',
  `error_msg`   VARCHAR(255) NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_sink_run`    (`run_id`),
  INDEX `idx_sink_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Agent chain events ───────────────────────────────────────────────────────
-- Event bus for chaining agents. When a workflow completes and has linked_workflows,
-- chain events are emitted here for the chain dispatcher to pick up and execute.

CREATE TABLE IF NOT EXISTS `agent_chain_events` (
  `id`                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `event_id`             VARCHAR(36)  NOT NULL UNIQUE,
  `source_run_id`        VARCHAR(36)  NOT NULL,
  `source_agent_id`      VARCHAR(36)  NULL,
  `target_workflow_key`  VARCHAR(128) NOT NULL,
  `target_agent_id`      VARCHAR(36)  NULL,
  `tenant_id`            VARCHAR(36)  NOT NULL,
  `trigger_condition`    ENUM('on_pass','on_fail','always') NOT NULL DEFAULT 'always',
  `payload_json`         JSON         NULL,
  `status`               ENUM('pending','dispatched','failed','skipped') NOT NULL DEFAULT 'pending',
  `dispatched_at`        DATETIME     NULL,
  `created_at`           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_chain_tenant` (`tenant_id`),
  INDEX `idx_chain_status` (`status`),
  INDEX `idx_chain_source` (`source_run_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Extend reporting_views with data storage ─────────────────────────────────
-- reporting_views was a view-definition table with no actual data columns.
-- Add columns to store agent-generated report snapshots.

ALTER TABLE `reporting_views`
  ADD COLUMN IF NOT EXISTS `source_run_id` VARCHAR(36)  NULL AFTER `view_key`,
  ADD COLUMN IF NOT EXISTS `agent_id`      VARCHAR(36)  NULL AFTER `source_run_id`,
  ADD COLUMN IF NOT EXISTS `snapshot_json` LONGTEXT     NULL AFTER `columns_json`,
  ADD COLUMN IF NOT EXISTS `updated_at`    DATETIME     NULL;
