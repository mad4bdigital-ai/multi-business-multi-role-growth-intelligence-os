-- Sprint 65: Tenant-scoped Platform Evolution checkpoint read tools.
-- Tenant users can read only scopes granted by v_platform_evolution_scope_access.
-- No checkpoint write route is exposed to tenants in this sprint.

INSERT INTO `tenant_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
(
  'tenant_evolution_activation_card',
  'Tenant Evolution Activation Card',
  'Read the latest tenant/user scoped Platform Evolution activation card. Access is resolved from active membership and v_platform_evolution_scope_access. No secrets are returned.',
  'GET',
  '/tenant/evolution/activation-card',
  NULL,
  '{"type":"object","properties":{"scope_key":{"type":"string"},"brand_key":{"type":"string"}},"additionalProperties":false}',
  NULL,
  'tenant,evolution,checkpoint,activation-card,read_only,scope_gated,no_secrets',
  1,
  340
),
(
  'tenant_evolution_thread_map',
  'Tenant Evolution Thread Map',
  'Read tenant/user scoped Platform Evolution threads with linked task/signal/blocker counts and next actions. Access is scope-gated and no secrets are returned.',
  'GET',
  '/tenant/evolution/thread-map',
  NULL,
  '{"type":"object","properties":{"scope_key":{"type":"string"},"brand_key":{"type":"string"},"status":{"type":"string"},"priority":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":100,"default":50}},"additionalProperties":false}',
  NULL,
  'tenant,evolution,threads,read_only,scope_gated,no_secrets',
  1,
  341
),
(
  'tenant_evolution_open_evidence',
  'Tenant Evolution Open Evidence',
  'Read tenant/user scoped evidence linked to Platform Evolution threads, including permitted tasks and signals. Access is scope-gated and no secrets are returned.',
  'GET',
  '/tenant/evolution/open-evidence',
  NULL,
  '{"type":"object","properties":{"scope_key":{"type":"string"},"brand_key":{"type":"string"},"thread_key":{"type":"string"},"linked_surface":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":100,"default":50}},"additionalProperties":false}',
  NULL,
  'tenant,evolution,evidence,tasks,signals,read_only,scope_gated,no_secrets',
  1,
  342
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
