-- Sprint 67: Narrow runtime collation repair for user app connection join keys.
-- Context: live WordPress credential-intake status and workspace/plugin runtime joins
-- failed with ER_CANT_AGGREGATE_2COLLATIONS because user_app_connections
-- inherited utf8mb4_uca1400_ai_ci while related runtime tables use utf8mb4_unicode_ci.
-- Scope is intentionally narrow: only non-secret join keys are altered. No JSON,
-- encrypted credential, token, or secret payload columns are modified.

ALTER TABLE user_app_connections
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY connection_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY app_key VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;
