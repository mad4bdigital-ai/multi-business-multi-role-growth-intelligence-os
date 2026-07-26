-- Sprint 68: Session Insight capability binding hardening.
-- Purpose: persist internal app/action/tool graph rows required by the Session Insight
-- internal SQL backlog target-write executor so actual capability envelopes no longer
-- fall back to blocked_requires_setup.
-- Safety: additive/idempotent registry inserts only. No provider credentials, no
-- credential payload reads, no external writes, no raw transcripts, no destructive
-- statements, and no secrets.

INSERT INTO `app_integrations` (`app_key`, `display_name`, `description`, `auth_type`, `category`, `status`) VALUES
  ('session_insight', 'Session Insight', 'Internal Session Insight promotion and backlog target-write capability. No external credential or provider secret is required.', 'mcp', 'session_memory', 'active')
ON DUPLICATE KEY UPDATE
  `display_name` = VALUES(`display_name`),
  `description` = VALUES(`description`),
  `auth_type` = VALUES(`auth_type`),
  `category` = VALUES(`category`),
  `status` = 'active';

INSERT INTO `actions` (`action_key`, `status`, `connector_family`, `runtime_capability_class`, `runtime_callable`, `primary_executor`, `notes`) VALUES
  ('session_insight_development_backlog_apply', 'active', 'session_insight_internal_sql', 'development_backlog', 'TRUE', 'session_insight_backlog_target_write_execute', 'Internal SQL development backlog target write capability. No provider, credential, external write, raw transcript, or secret surface.'),
  ('session_insight_integration_backlog_apply', 'active', 'session_insight_internal_sql', 'integration_backlog', 'TRUE', 'session_insight_backlog_target_write_execute', 'Internal SQL integration backlog target write capability. No provider, credential, external write, raw transcript, or secret surface.'),
  ('session_insight_runtime_repair_backlog_apply', 'active', 'session_insight_internal_sql', 'runtime_repair_backlog', 'TRUE', 'session_insight_backlog_target_write_execute', 'Internal SQL runtime repair backlog target write capability. No provider, credential, external write, raw transcript, or secret surface.')
ON DUPLICATE KEY UPDATE
  `status` = 'active',
  `connector_family` = VALUES(`connector_family`),
  `runtime_capability_class` = VALUES(`runtime_capability_class`),
  `runtime_callable` = VALUES(`runtime_callable`),
  `primary_executor` = VALUES(`primary_executor`),
  `notes` = VALUES(`notes`),
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `app_integration_action_bindings` (`binding_id`, `app_key`, `action_key`, `binding_role`, `credential_source`, `exposure_default`, `status`, `notes`) VALUES
  ('sib_development_apply', 'session_insight', 'session_insight_development_backlog_apply', 'primary_api', 'none', 'manual_tools', 'active', 'Internal SQL target write binding; no credential required.'),
  ('sib_integration_apply', 'session_insight', 'session_insight_integration_backlog_apply', 'primary_api', 'none', 'manual_tools', 'active', 'Internal SQL target write binding; no credential required.'),
  ('sib_runtime_repair_apply', 'session_insight', 'session_insight_runtime_repair_backlog_apply', 'primary_api', 'none', 'manual_tools', 'active', 'Internal SQL target write binding; no credential required.')
ON DUPLICATE KEY UPDATE
  `credential_source` = 'none',
  `exposure_default` = 'manual_tools',
  `status` = 'active',
  `notes` = VALUES(`notes`),
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `app_integration_tool_bindings` (`binding_id`, `app_key`, `tool_key`, `tool_surface`, `binding_role`, `credential_source`, `exposure_scope`, `status`, `notes`) VALUES
  ('sib_target_write_execute', 'session_insight', 'session_insight_backlog_target_write_execute', 'admin_platform_tool', 'state_changing', 'none', 'admin', 'active', 'Internal SQL write executor; no external credential required.'),
  ('sib_target_write_list', 'session_insight', 'session_insight_backlog_target_write_list', 'admin_platform_tool', 'read_only', 'none', 'admin', 'active', 'Internal SQL write readback; no external credential required.'),
  ('sib_target_write_rollback', 'session_insight', 'session_insight_backlog_target_write_rollback', 'admin_platform_tool', 'state_changing', 'none', 'admin', 'active', 'Internal SQL rollback marker; no external credential required.')
ON DUPLICATE KEY UPDATE
  `credential_source` = 'none',
  `exposure_scope` = 'admin',
  `status` = 'active',
  `notes` = VALUES(`notes`),
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `execution_policies` (`policy_group`, `policy_key`, `policy_value`, `active`, `execution_scope`, `affects_layer`, `blocking`, `notes`) VALUES (
  'Session Memory Governance',
  'session_insight_capability_binding_hardening_policy_v1',
  JSON_OBJECT(
    'rule', 'session_insight_internal_sql_capability_binding_required',
    'app_key', 'session_insight',
    'capability_keys', JSON_ARRAY('session_insight_development_backlog_apply', 'session_insight_integration_backlog_apply', 'session_insight_runtime_repair_backlog_apply'),
    'credential_source', 'none',
    'target_executor', 'session_insight_backlog_target_write_execute',
    'provider_calls_allowed', false,
    'credential_payload_reads_allowed', false,
    'external_writes_allowed', false,
    'raw_transcript_included', false,
    'secrets_included', false
  ),
  'TRUE',
  'session_memory|session_insight|capability_binding|internal_sql_only',
  'app_integrations|actions|app_integration_action_bindings|app_integration_tool_bindings|capability_resolution_envelope_ledger',
  'TRUE',
  'Session Insight actual capability envelopes must resolve through internal SQL target-write bindings without provider credentials or secret payloads.'
)
ON DUPLICATE KEY UPDATE
  `policy_value` = VALUES(`policy_value`),
  `active` = VALUES(`active`),
  `execution_scope` = VALUES(`execution_scope`),
  `affects_layer` = VALUES(`affects_layer`),
  `blocking` = VALUES(`blocking`),
  `notes` = VALUES(`notes`),
  `updated_at` = CURRENT_TIMESTAMP;
