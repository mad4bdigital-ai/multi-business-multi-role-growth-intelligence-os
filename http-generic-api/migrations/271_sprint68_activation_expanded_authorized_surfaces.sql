-- Sprint 68: Expanded activation authorized surfaces.
-- Safe activation readback views for agents, skills, apps, workflows, plugins, tasks, and tenant tools.
-- These views intentionally exclude prompts, raw manifests, credentials, env vars, tokens, and config payloads.

CREATE OR REPLACE VIEW `v_activation_agent_skill_grants` AS
SELECT
  asg.`grant_id`,
  asg.`tenant_id`,
  asg.`brand_key`,
  asg.`agent_id`,
  a.`name` AS `agent_name`,
  a.`display_name` AS `agent_display_name`,
  asg.`skill_id`,
  s.`skill_key`,
  s.`display_name` AS `skill_display_name`,
  s.`skill_type`,
  s.`scope` AS `skill_scope`,
  s.`requires_approval`,
  asg.`status` AS `grant_status`,
  asg.`expires_at`,
  asg.`granted_at`,
  0 AS `secrets_included`
FROM `agent_skill_grants` asg
LEFT JOIN `agents` a ON a.`agent_id` = asg.`agent_id`
LEFT JOIN `agent_skills` s ON s.`skill_id` = asg.`skill_id`
WHERE asg.`status` = 'active'
  AND (asg.`expires_at` IS NULL OR asg.`expires_at` > UTC_TIMESTAMP())
  AND s.`status` = 'active'
  AND a.`status` = 'active';

CREATE OR REPLACE VIEW `v_activation_connected_app_connections` AS
SELECT
  uac.`connection_id`,
  uac.`tenant_id`,
  uac.`user_id`,
  uac.`app_key`,
  ai.`display_name` AS `app_display_name`,
  uac.`display_label`,
  uac.`auth_type`,
  uac.`is_primary`,
  uac.`status` AS `connection_status`,
  uac.`validation_status`,
  CASE
    WHEN (uac.`credential_ref` IS NOT NULL AND uac.`credential_ref` <> '')
      OR (uac.`encrypted_credentials` IS NOT NULL AND uac.`encrypted_credentials` <> '')
    THEN 1 ELSE 0
  END AS `auth_material_present`,
  uac.`connected_at`,
  uac.`last_used_at`,
  0 AS `secrets_included`
FROM `user_app_connections` uac
LEFT JOIN `app_integrations` ai ON ai.`app_key` = uac.`app_key`
WHERE uac.`status` = 'active';

CREATE OR REPLACE VIEW `v_activation_workflow_runtime_bindings` AS
SELECT
  wrb.`binding_key`,
  wrb.`tenant_id`,
  wrb.`workflow_key`,
  w.`workflow_name`,
  wrb.`runtime_type`,
  wrb.`task_class`,
  wrb.`execution_mode`,
  wrb.`auth_mode`,
  wrb.`status` AS `binding_status`,
  w.`active` AS `workflow_active`,
  w.`status` AS `workflow_status`,
  wrb.`updated_at`,
  0 AS `secrets_included`
FROM `workflow_runtime_bindings` wrb
LEFT JOIN `workflows` w ON w.`workflow_key` = wrb.`workflow_key`
WHERE wrb.`status` = 'active';

CREATE OR REPLACE VIEW `v_activation_plugin_contributions` AS
SELECT
  pc.`contribution_id`,
  pc.`plugin_key`,
  pc.`display_name`,
  pc.`plugin_type`,
  pc.`owner_scope`,
  pc.`owner_tenant_id` AS `tenant_id`,
  pc.`owner_user_id` AS `user_id`,
  pc.`target`,
  pc.`status` AS `contribution_status`,
  pc.`certification_status`,
  pc.`private_execution_enabled`,
  pc.`private_activated_at`,
  pc.`created_by`,
  pc.`updated_by`,
  0 AS `secrets_included`
FROM `platform_plugin_contributions` pc
WHERE pc.`status` IN ('submitted','certified')
   OR pc.`private_execution_enabled` = 1;

CREATE OR REPLACE VIEW `v_activation_pending_tasks` AS
SELECT
  pt.`task_id`,
  pt.`task_key`,
  pt.`title`,
  pt.`task_type`,
  pt.`priority`,
  pt.`status` AS `task_status`,
  pt.`owner_scope`,
  pt.`tenant_id`,
  pt.`user_id`,
  pt.`source_surface`,
  pt.`blocker_level`,
  pt.`due_at`,
  pt.`updated_at`,
  0 AS `secrets_included`
FROM `platform_pending_tasks` pt
WHERE pt.`activation_visibility` = 1
  AND pt.`status` IN ('pending','in_progress','blocked');

CREATE OR REPLACE VIEW `v_activation_tenant_tools` AS
SELECT
  t.`tenant_id`,
  tt.`tool_key`,
  tt.`display_name`,
  tt.`http_method`,
  tt.`http_path`,
  tt.`tags`,
  'active' AS `tool_enabled_status`,
  tt.`sort_order`,
  0 AS `secrets_included`
FROM `tenant_platform_endpoint_tools` tt
JOIN `tenants` t ON t.`status` = 'active'
WHERE tt.`is_enabled` = 1;

CREATE OR REPLACE VIEW `v_activation_app_action_grants` AS
SELECT
  aag.`grant_id`,
  uac.`tenant_id`,
  uac.`user_id`,
  aag.`workspace_id`,
  aag.`agent_id`,
  aag.`app_key`,
  ai.`display_name` AS `app_display_name`,
  aag.`action_key`,
  aag.`grant_mode`,
  aag.`status` AS `grant_status`,
  aag.`expires_at`,
  aag.`created_at`,
  0 AS `secrets_included`
FROM `app_action_grants` aag
LEFT JOIN `user_app_connections` uac ON uac.`connection_id` = aag.`connection_id`
LEFT JOIN `app_integrations` ai ON ai.`app_key` = aag.`app_key`
WHERE aag.`status` = 'active'
  AND (aag.`expires_at` IS NULL OR aag.`expires_at` > UTC_TIMESTAMP());

CREATE OR REPLACE VIEW `v_activation_tenant_integration_policies` AS
SELECT
  tip.`tenant_id`,
  tip.`app_key`,
  ai.`display_name` AS `app_display_name`,
  tip.`source_mode`,
  tip.`fallback_allowed`,
  tip.`required_for_device_install`,
  tip.`status` AS `policy_status`,
  tip.`source`,
  tip.`updated_at`,
  0 AS `secrets_included`
FROM `tenant_integration_policies` tip
LEFT JOIN `app_integrations` ai ON ai.`app_key` = tip.`app_key`
WHERE tip.`status` = 'active';

CREATE OR REPLACE VIEW `v_activation_expanded_authorized_surface_readiness` AS
SELECT
  'activation_expanded_authorized_surfaces' AS `readiness_key`,
  CASE
    WHEN SUM(`issue_count`) > 0 THEN 'fail'
    ELSE 'pass'
  END AS `readiness_status`,
  SUM(`checked_rows`) AS `checked_rows`,
  SUM(`issue_count`) AS `issue_count`,
  0 AS `secrets_included`
FROM (
  SELECT COUNT(*) AS `checked_rows`, SUM(CASE WHEN `secrets_included` <> 0 THEN 1 ELSE 0 END) AS `issue_count` FROM `v_activation_agent_skill_grants`
  UNION ALL SELECT COUNT(*), SUM(CASE WHEN `secrets_included` <> 0 THEN 1 ELSE 0 END) FROM `v_activation_connected_app_connections`
  UNION ALL SELECT COUNT(*), SUM(CASE WHEN `secrets_included` <> 0 THEN 1 ELSE 0 END) FROM `v_activation_workflow_runtime_bindings`
  UNION ALL SELECT COUNT(*), SUM(CASE WHEN `secrets_included` <> 0 THEN 1 ELSE 0 END) FROM `v_activation_plugin_contributions`
  UNION ALL SELECT COUNT(*), SUM(CASE WHEN `secrets_included` <> 0 THEN 1 ELSE 0 END) FROM `v_activation_pending_tasks`
  UNION ALL SELECT COUNT(*), SUM(CASE WHEN `secrets_included` <> 0 THEN 1 ELSE 0 END) FROM `v_activation_tenant_tools`
  UNION ALL SELECT COUNT(*), SUM(CASE WHEN `secrets_included` <> 0 THEN 1 ELSE 0 END) FROM `v_activation_app_action_grants`
  UNION ALL SELECT COUNT(*), SUM(CASE WHEN `secrets_included` <> 0 THEN 1 ELSE 0 END) FROM `v_activation_tenant_integration_policies`
) checks;
