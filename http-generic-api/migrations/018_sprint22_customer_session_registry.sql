-- Sprint 22: Customer Session Registry
-- Captures AI tool sessions (Codex CLI, Claude Code, etc.) as first-class platform entities.
-- Source format: JSONL with three typed event records:
--   session_meta  → customer_sessions row
--   event_msg     → session_turns + session_events rows
--   response_item → session_events rows (payload_json)
-- All statements idempotent.

-- ─── Core session record ──────────────────────────────────────────────────────
-- One row per AI tool session. Keyed on the originating tool's session_id.

CREATE TABLE IF NOT EXISTS `customer_sessions` (
  `id`                      INT UNSIGNED  AUTO_INCREMENT PRIMARY KEY,
  `session_id`              VARCHAR(128)  NOT NULL UNIQUE COMMENT 'Originating tool session_id (may be UUID or opaque string)',
  `tenant_id`               VARCHAR(36)   NOT NULL,
  `user_id`                 VARCHAR(36)   NULL,
  `originator`              VARCHAR(64)   NULL COMMENT 'codex_vscode, claude_code, cursor, etc.',
  `cli_version`             VARCHAR(32)   NULL,
  `source`                  VARCHAR(64)   NULL COMMENT 'vscode_extension, cli, web, etc.',
  `model_provider`          VARCHAR(64)   NULL COMMENT 'openai, anthropic, etc.',
  `model_name`              VARCHAR(128)  NULL COMMENT 'gpt-4o, claude-opus-4, etc.',
  `cwd`                     VARCHAR(512)  NULL COMMENT 'Working directory at session start',
  `git_branch`              VARCHAR(255)  NULL,
  `git_commit_hash`         VARCHAR(64)   NULL,
  `git_repo_url`            VARCHAR(512)  NULL,
  `brand_key`               VARCHAR(128)  NULL COMMENT 'Ref: brands.target_key — brand the session was working on',
  `workspace_key`           VARCHAR(128)  NULL COMMENT 'Ref: workspace_registry.workspace_key — workspace context',
  `base_instructions_hash`  VARCHAR(64)   NULL COMMENT 'SHA-256 of system prompt for dedup',
  `base_instructions_text`  LONGTEXT      NULL COMMENT 'Full system prompt captured at session start',
  `session_status`          ENUM('pending','active','completed','failed') NOT NULL DEFAULT 'active',
  `turn_count`              SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `started_at`              DATETIME      NULL,
  `ended_at`                DATETIME      NULL,
  `created_at`              DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_sessions_tenant`      (`tenant_id`),
  INDEX `idx_sessions_user`        (`user_id`),
  INDEX `idx_sessions_brand`       (`brand_key`),
  INDEX `idx_sessions_workspace`   (`workspace_key`),
  INDEX `idx_sessions_originator`  (`originator`),
  INDEX `idx_sessions_started`     (`started_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Session turns ────────────────────────────────────────────────────────────
-- One row per conversation turn (event_msg.type = task_started / task_completed).
-- turn_id is the originating tool's turn_id (not a platform UUID).

CREATE TABLE IF NOT EXISTS `session_turns` (
  `id`                   INT UNSIGNED  AUTO_INCREMENT PRIMARY KEY,
  `turn_id`              VARCHAR(128)  NOT NULL UNIQUE COMMENT 'Originating tool turn_id',
  `session_id`           VARCHAR(128)  NOT NULL,
  `tenant_id`            VARCHAR(36)   NOT NULL,
  `turn_index`           SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `model_context_window` INT UNSIGNED  NULL,
  `collaboration_mode`   VARCHAR(64)   NULL COMMENT 'auto_edit, suggest, review, etc.',
  `turn_status`          ENUM('running','completed','failed','aborted') NOT NULL DEFAULT 'running',
  `started_at`           DATETIME      NULL,
  `completed_at`         DATETIME      NULL,
  `created_at`           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_turns_session` (`session_id`),
  INDEX `idx_turns_tenant`  (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Session events ───────────────────────────────────────────────────────────
-- Individual typed events from the JSONL stream.
-- Covers session_meta, event_msg, response_item, and any future record types.

CREATE TABLE IF NOT EXISTS `session_events` (
  `id`              INT UNSIGNED  AUTO_INCREMENT PRIMARY KEY,
  `event_id`        VARCHAR(36)   NOT NULL UNIQUE,
  `session_id`      VARCHAR(128)  NOT NULL,
  `turn_id`         VARCHAR(128)  NULL COMMENT 'NULL for session-level events',
  `tenant_id`       VARCHAR(36)   NOT NULL,
  `record_type`     VARCHAR(64)   NOT NULL COMMENT 'session_meta|event_msg|response_item|tool_call|etc.',
  `event_type`      VARCHAR(128)  NULL COMMENT 'task_started, task_completed, tool_use, etc.',
  `payload_json`    JSON          NULL,
  `event_timestamp` DATETIME      NULL,
  `created_at`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_events_session`     (`session_id`),
  INDEX `idx_events_turn`        (`turn_id`),
  INDEX `idx_events_tenant`      (`tenant_id`),
  INDEX `idx_events_record_type` (`record_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Assimilation queue ───────────────────────────────────────────────────────
-- Feeds completed sessions into post_conversation_knowledge_assimilation workflow.
-- Queue consumer picks up pending rows and dispatches the workflow.

CREATE TABLE IF NOT EXISTS `session_assimilation_queue` (
  `id`           INT UNSIGNED  AUTO_INCREMENT PRIMARY KEY,
  `queue_id`     VARCHAR(36)   NOT NULL UNIQUE,
  `session_id`   VARCHAR(128)  NOT NULL,
  `tenant_id`    VARCHAR(36)   NOT NULL,
  `workflow_key` VARCHAR(128)  NOT NULL DEFAULT 'post_conversation_knowledge_assimilation',
  `run_id`       VARCHAR(36)   NULL COMMENT 'Set when workflow run is dispatched',
  `status`       ENUM('pending','processing','completed','failed','skipped') NOT NULL DEFAULT 'pending',
  `error_msg`    VARCHAR(512)  NULL,
  `queued_at`    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `processed_at` DATETIME      NULL,
  INDEX `idx_assim_tenant`  (`tenant_id`),
  INDEX `idx_assim_status`  (`status`),
  INDEX `idx_assim_session` (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
