-- Sprint 69: Activation session context lookup indexes.
-- Additive only. Supports workspace/brand-scoped activation session reuse,
-- memory readback, and GPT tool-turn archive binding without destructive data changes.
-- secrets_included=false

CREATE INDEX IF NOT EXISTS `idx_cs_gpt_context_active_started`
  ON `customer_sessions` (
    `originator`,
    `tenant_id`,
    `user_id`,
    `workspace_key`,
    `brand_key`,
    `session_status`,
    `started_at`
  );

CREATE INDEX IF NOT EXISTS `idx_ar_context_reuse_session`
  ON `activation_runs` (
    `tenant_id`,
    `user_id`,
    `idempotency_key`,
    `created_at`,
    `session_id`
  );

CREATE INDEX IF NOT EXISTS `idx_ss_context_created`
  ON `session_summaries` (
    `tenant_id`,
    `user_id`,
    `workspace_key`,
    `created_at`
  );

CREATE INDEX IF NOT EXISTS `idx_gst_context_scope_created`
  ON `gpt_session_turns` (
    `tenant_id`,
    `user_id`,
    `workspace_key`,
    `brand_key`,
    `session_id`,
    `created_at`
  );

CREATE INDEX IF NOT EXISTS `idx_gst_session_context_lookup`
  ON `gpt_session_turns` (
    `session_id`,
    `workspace_key`,
    `brand_key`,
    `created_at`
  );

CREATE INDEX IF NOT EXISTS `idx_gst_session_context_created`
  ON `gpt_session_turns` (
    `session_id`,
    `workspace_key`,
    `brand_key`,
    `created_at`
  );
