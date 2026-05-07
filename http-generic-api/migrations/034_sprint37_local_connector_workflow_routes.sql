-- Sprint 37: Local Connector — workflow registry, task routes, skills, agent bindings
-- Connects /local-connector/* endpoints into the governed execution pipeline:
--   intent → task_route → workflow → agent_workflow_binding → execution plan

-- ── Part A: Workflow registry ─────────────────────────────────────────────────

INSERT IGNORE INTO `workflows`
  (workflow_key, workflow_name, execution_class, execution_mode, target_module,
   output_artifact_type, primary_output, parent_layer, linked_workflows,
   review_required, memory_required, logging_required, active, status,
   registry_source)
VALUES
  ('local_connector_device_install',
   'Local Connector — Device Install',
   'authority', 'sync', 'local_connector_install',
   'Operational', 'Device Install Bundle', 'Local Device Orchestration',
   'local_connector_health_check',
   'FALSE', 'FALSE', 'TRUE', '1', 'active', 'platform_seed'),

  ('local_connector_health_check',
   'Local Connector — Health Check',
   'rule_based', 'sync', 'local_connector_health',
   'Operational', 'Connector Health Report', 'Local Device Orchestration',
   NULL,
   'FALSE', 'FALSE', 'TRUE', '1', 'active', 'platform_seed'),

  ('local_connector_shell_run',
   'Local Connector — Shell Command Run',
   'authority', 'sync', 'local_connector_shell',
   'Operational', 'Shell Execution Result', 'Local Device Orchestration',
   NULL,
   'FALSE', 'FALSE', 'TRUE', '1', 'active', 'platform_seed'),

  ('local_connector_file_read',
   'Local Connector — File Read',
   'standard', 'sync', 'local_connector_file',
   'Operational', 'File Content', 'Local Device Orchestration',
   NULL,
   'FALSE', 'FALSE', 'TRUE', '1', 'active', 'platform_seed'),

  ('local_connector_file_write',
   'Local Connector — File Write',
   'authority', 'sync', 'local_connector_file',
   'Operational', 'File Write Confirmation', 'Local Device Orchestration',
   'local_connector_health_check',
   'FALSE', 'FALSE', 'TRUE', '1', 'active', 'platform_seed');

-- ── Part B: Task routes (intent → workflow mapping) ───────────────────────────

INSERT IGNORE INTO `task_routes`
  (task_key, intent_key, workflow_key, target_module, execution_layer,
   route_mode, priority, enabled, active, logging_required, review_required,
   memory_required, route_source, match_rule)
VALUES
  ('local.device.install',
   'local.device.install',
   'local_connector_device_install',
   'local_connector_install',
   'custom_gpt',
   'direct', '10', 'true', '1', 'TRUE', 'FALSE', 'FALSE',
   'platform_seed',
   'intent_key:local.device.install'),

  ('local.health.check',
   'local.health.check',
   'local_connector_health_check',
   'local_connector_health',
   'custom_gpt',
   'direct', '10', 'true', '1', 'TRUE', 'FALSE', 'FALSE',
   'platform_seed',
   'intent_key:local.health.check'),

  ('local.shell.run',
   'local.shell.run',
   'local_connector_shell_run',
   'local_connector_shell',
   'custom_gpt',
   'direct', '10', 'true', '1', 'TRUE', 'FALSE', 'FALSE',
   'platform_seed',
   'intent_key:local.shell.run'),

  ('local.file.read',
   'local.file.read',
   'local_connector_file_read',
   'local_connector_file',
   'custom_gpt',
   'direct', '10', 'true', '1', 'TRUE', 'FALSE', 'FALSE',
   'platform_seed',
   'intent_key:local.file.read'),

  ('local.file.write',
   'local.file.write',
   'local_connector_file_write',
   'local_connector_file',
   'custom_gpt',
   'direct', '10', 'true', '1', 'TRUE', 'FALSE', 'FALSE',
   'platform_seed',
   'intent_key:local.file.write');

-- ── Part C: Local connector skills ────────────────────────────────────────────

INSERT IGNORE INTO `agent_skills`
  (skill_id, skill_key, display_name, description, skill_type, scope,
   capability_json, requires_approval, status)
VALUES
  ('skl-loc-con-0001',
   'local.connector.shell_execute',
   'Local Connector — Shell Execute',
   'Run an allowlisted shell command on a user device via Cloudflare tunnel.',
   'system_control', 'global',
   '{"allowed_actions":["shell_run","shell_list","shell_status"],"requires_device_config":true}',
   0, 'active'),

  ('skl-loc-con-0002',
   'local.connector.file_access',
   'Local Connector — File Access',
   'Read or write governed files on a user device via Cloudflare tunnel.',
   'data_write', 'global',
   '{"allowed_actions":["file_read","file_write"],"requires_device_config":true}',
   0, 'active'),

  ('skl-loc-con-0003',
   'local.connector.device_management',
   'Local Connector — Device Management',
   'Provision Cloudflare tunnels, install connector, check device health.',
   'system_control', 'global',
   '{"allowed_actions":["device_install","health_check","device_uninstall"],"auto_provisions_tunnel":true}',
   0, 'active');

-- ── Part D: Grant local connector skills to Admin GPT agent ──────────────────
-- Admin GPT agent_id: 00000000-0000-4000-a000-000000000020

INSERT IGNORE INTO `agent_skill_grants`
  (grant_id, agent_id, skill_id, tenant_id, granted_by, status)
VALUES
  ('00000000-0000-4000-a000-000000000050',
   '00000000-0000-4000-a000-000000000020',
   'skl-loc-con-0001',
   '00000000-0000-4000-a000-000000000001',
   '00000000-0000-4000-a000-000000000002',
   'active'),

  ('00000000-0000-4000-a000-000000000051',
   '00000000-0000-4000-a000-000000000020',
   'skl-loc-con-0002',
   '00000000-0000-4000-a000-000000000001',
   '00000000-0000-4000-a000-000000000002',
   'active'),

  ('00000000-0000-4000-a000-000000000052',
   '00000000-0000-4000-a000-000000000020',
   'skl-loc-con-0003',
   '00000000-0000-4000-a000-000000000001',
   '00000000-0000-4000-a000-000000000002',
   'active');

-- ── Part E: Update api_access_platform skill to include local_connector ───────

UPDATE `agent_skills`
SET capability_json = JSON_SET(
  capability_json,
  '$.allowed_services',
  JSON_ARRAY('tenants','identity','access','customers','planner','connector',
             'workflows','observability','sessions','uploads','local_connector')
)
WHERE skill_key = 'api_access_platform';

-- ── Part F: Bind Admin GPT agent to all local connector workflows ─────────────

INSERT IGNORE INTO `agent_workflow_bindings`
  (agent_id, workflow_key, trigger_condition)
VALUES
  ('00000000-0000-4000-a000-000000000020', 'local_connector_device_install',  'on_demand'),
  ('00000000-0000-4000-a000-000000000020', 'local_connector_health_check',    'on_demand'),
  ('00000000-0000-4000-a000-000000000020', 'local_connector_shell_run',       'on_demand'),
  ('00000000-0000-4000-a000-000000000020', 'local_connector_file_read',       'on_demand'),
  ('00000000-0000-4000-a000-000000000020', 'local_connector_file_write',      'on_demand');

-- ── Part G: Chain event template — install always chains to health_check ──────
-- linked_workflows on the workflow row handles this at runtime (Part A above).
-- This supervision policy ensures Admin GPT auto-approves local connector calls.

INSERT IGNORE INTO `agent_supervision_policy`
  (agent_id, tenant_id, min_assistance_role, auto_approve_below_class)
VALUES
  ('00000000-0000-4000-a000-000000000020',
   '00000000-0000-4000-a000-000000000001',
   'admin',
   'authority');
