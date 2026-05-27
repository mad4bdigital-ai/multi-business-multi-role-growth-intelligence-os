-- Sprint 65: Platform Evolution checkpoint tools.
-- Read-only activation card/thread/evidence tools plus a governed checkpoint creation route.

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
(
  'platform_evolution_activation_card',
  'Platform Evolution Activation Card',
  'Read the latest scoped Platform Evolution activation card for a brand/tenant scope. Returns checkpoint summary, thread counts, linked tasks/signals, and blocker counts. No secrets are returned.',
  'GET',
  '/platform/evolution/activation-card',
  NULL,
  '{"type":"object","properties":{"scope_key":{"type":"string"},"brand_key":{"type":"string"},"tenant_id":{"type":"string"}},"additionalProperties":false}',
  NULL,
  'platform-evolution,checkpoint,activation-card,read_only,scope_gated,no_secrets',
  1,
  470
),
(
  'platform_evolution_thread_map',
  'Platform Evolution Thread Map',
  'Read scoped Platform Evolution threads with linked task/signal/blocker counts and next actions. No secrets are returned.',
  'GET',
  '/platform/evolution/thread-map',
  NULL,
  '{"type":"object","properties":{"scope_key":{"type":"string"},"brand_key":{"type":"string"},"tenant_id":{"type":"string"},"status":{"type":"string"},"priority":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":250,"default":50}},"additionalProperties":false}',
  NULL,
  'platform-evolution,threads,read_only,scope_gated,no_secrets',
  1,
  471
),
(
  'platform_evolution_open_evidence',
  'Platform Evolution Open Evidence',
  'Read scoped open evidence linked to Platform Evolution threads, including pending tasks and summary development signals. No secrets are returned.',
  'GET',
  '/platform/evolution/open-evidence',
  NULL,
  '{"type":"object","properties":{"scope_key":{"type":"string"},"brand_key":{"type":"string"},"tenant_id":{"type":"string"},"thread_key":{"type":"string"},"linked_surface":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":250,"default":50}},"additionalProperties":false}',
  NULL,
  'platform-evolution,evidence,tasks,signals,read_only,scope_gated,no_secrets',
  1,
  472
),
(
  'platform_evolution_checkpoint_create',
  'Create Platform Evolution Checkpoint',
  'Create a scoped Platform Evolution checkpoint after an activation or operation closure. Updates thread checkpoint pointers. No secrets are accepted or returned.',
  'POST',
  '/platform/evolution/checkpoints',
  NULL,
  '{"type":"object","required":["summary_text"],"properties":{"scope_key":{"type":"string"},"brand_key":{"type":"string"},"tenant_id":{"type":"string"},"user_id":{"type":"string"},"checkpoint_type":{"type":"string","enum":["activation","operation","manual","rollup","recovery"],"default":"operation"},"activation_session_id":{"type":"string"},"main_commit_sha":{"type":"string"},"deployed_commit_sha":{"type":"string"},"activation_status":{"type":"string"},"release_readiness_status":{"type":"string"},"summary_text":{"type":"string"},"thread_snapshot":{"type":"object"},"delta":{"type":"object"},"evidence":{"type":"object"},"next_actions":{"type":"array","items":{"type":"string"}},"created_by":{"type":"string"}},"additionalProperties":false}',
  NULL,
  'platform-evolution,checkpoint,state_changing,audited,scope_gated,no_secrets',
  1,
  473
)
ON DUPLICATE KEY UPDATE
  `display_name` = VALUES(`display_name`),
  `description` = VALUES(`description`),
  `http_method` = VALUES(`http_method`),
  `http_path` = VALUES(`http_path`),
  `path_param_keys` = VALUES(`path_param_keys`),
  `input_schema` = VALUES(`input_schema`),
  `fixed_body` = VALUES(`fixed_body`),
  `tags` = VALUES(`tags`),
  `is_enabled` = VALUES(`is_enabled`),
  `sort_order` = VALUES(`sort_order`);
