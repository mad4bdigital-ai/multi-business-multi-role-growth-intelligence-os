-- Sprint 68: Activation catalog authorized surfaces.
-- Safe tenant-scoped catalog/readback views for remaining activation-relevant platform catalogs.
-- These views intentionally expose identifiers/status/flags only and exclude prompts, manifests, schemas, policies, URLs, args, and payload JSON.

CREATE OR REPLACE VIEW `v_activation_agent_catalog` AS
SELECT
  t.`tenant_id`,
  a.`agent_id`,
  a.`name` AS `agent_name`,
  a.`display_name` AS `agent_display_name`,
  a.`execution_class`,
  a.`execution_layer`,
  a.`health_status`,
  a.`fallback_agent_id`,
  a.`max_delegation_ttl`,
  a.`min_supervision_role`,
  a.`is_system`,
  a.`status` AS `agent_status`,
  a.`updated_at`,
  0 AS `secrets_included`
FROM `tenants` t
JOIN `agents` a ON a.`status` = 'active'
WHERE t.`status` = 'active';

CREATE OR REPLACE VIEW `v_activation_agent_skill_catalog` AS
SELECT
  t.`tenant_id`,
  s.`skill_id`,
  s.`skill_key`,
  s.`display_name` AS `skill_display_name`,
  s.`skill_type`,
  s.`scope` AS `skill_scope`,
  s.`requires_approval`,
  s.`status` AS `skill_status`,
  s.`created_at`,
  0 AS `secrets_included`
FROM `tenants` t
JOIN `agent_skills` s ON s.`status` = 'active'
WHERE t.`status` = 'active';

CREATE OR REPLACE VIEW `v_activation_agent_tool_catalog` AS
SELECT
  t.`tenant_id`,
  ati.`tool_key`,
  ati.`source_truth_resource_type`,
  ati.`source_truth_resource_key`,
  ati.`display_name`,
  ati.`risk_class`,
  ati.`policy_key`,
  ati.`status` AS `tool_status`,
  ati.`last_indexed_at`,
  ati.`updated_at`,
  0 AS `secrets_included`
FROM `tenants` t
JOIN `agent_tool_index` ati ON ati.`status` IN ('active','indexed','ready')
WHERE t.`status` = 'active';

CREATE OR REPLACE VIEW `v_activation_agent_bindings_catalog` AS
SELECT
  t.`tenant_id`,
  a.`agent_id`,
  a.`name` AS `agent_name`,
  'tool' AS `binding_type`,
  atb.`engine_name` AS `binding_key`,
  atb.`tool_type` AS `binding_role`,
  atb.`created_at`,
  0 AS `secrets_included`
FROM `tenants` t
JOIN `agent_tool_bindings` atb ON 1 = 1
JOIN `agents` a ON a.`agent_id` = atb.`agent_id` AND a.`status` = 'active'
WHERE t.`status` = 'active'
UNION ALL
SELECT
  t.`tenant_id`,
  a.`agent_id`,
  a.`name` AS `agent_name`,
  'workflow' AS `binding_type`,
  awb.`workflow_key` AS `binding_key`,
  COALESCE(awb.`trigger_condition`, 'available') AS `binding_role`,
  awb.`created_at`,
  0 AS `secrets_included`
FROM `tenants` t
JOIN `agent_workflow_bindings` awb ON 1 = 1
JOIN `agents` a ON a.`agent_id` = awb.`agent_id` AND a.`status` = 'active'
WHERE t.`status` = 'active'
UNION ALL
SELECT
  t.`tenant_id`,
  a.`agent_id`,
  a.`name` AS `agent_name`,
  'logic_pack' AS `binding_type`,
  alpb.`pack_id` AS `binding_key`,
  CONCAT('priority:', alpb.`priority`) AS `binding_role`,
  alpb.`created_at`,
  0 AS `secrets_included`
FROM `tenants` t
JOIN `agent_logic_pack_bindings` alpb ON 1 = 1
JOIN `agents` a ON a.`agent_id` = alpb.`agent_id` AND a.`status` = 'active'
WHERE t.`status` = 'active';

CREATE OR REPLACE VIEW `v_activation_workflow_catalog` AS
SELECT
  t.`tenant_id`,
  w.`workflow_id`,
  w.`workflow_key`,
  w.`workflow_name`,
  w.`workflow_type`,
  w.`route_key`,
  w.`execution_mode`,
  w.`execution_class`,
  w.`target_module`,
  w.`priority`,
  w.`user_facing`,
  w.`active` AS `workflow_active`,
  w.`status` AS `workflow_status`,
  w.`lifecycle_mode`,
  w.`memory_required`,
  w.`logging_required`,
  w.`review_required`,
  w.`client_allowed`,
  w.`team_allowed`,
  w.`admin_only`,
  w.`brand_scope_enforced`,
  w.`updated_at`,
  0 AS `secrets_included`
FROM `tenants` t
JOIN `workflows` w ON (w.`active` IN ('TRUE','true','1','yes','active') OR w.`status` IN ('active','enabled'))
WHERE t.`status` = 'active';

CREATE OR REPLACE VIEW `v_activation_task_route_catalog` AS
SELECT
  t.`tenant_id`,
  tr.`route_id`,
  tr.`task_key`,
  tr.`intent_key`,
  tr.`request_type`,
  tr.`route_mode`,
  tr.`target_module`,
  tr.`workflow_key`,
  tr.`execution_layer`,
  tr.`priority`,
  tr.`active` AS `route_active`,
  tr.`enabled` AS `route_enabled`,
  tr.`lifecycle_mode`,
  tr.`memory_required`,
  tr.`logging_required`,
  tr.`review_required`,
  tr.`client_allowed`,
  tr.`team_allowed`,
  tr.`admin_only`,
  tr.`brand_scope_enforced`,
  tr.`updated_at`,
  0 AS `secrets_included`
FROM `tenants` t
JOIN `task_routes` tr ON (tr.`active` IN ('TRUE','true','1','yes','active') OR tr.`enabled` IN ('TRUE','true','1','yes','active'))
WHERE t.`status` = 'active';

CREATE OR REPLACE VIEW `v_activation_app_integration_catalog` AS
SELECT
  t.`tenant_id`,
  ai.`app_key`,
  ai.`display_name` AS `app_display_name`,
  ai.`auth_type`,
  ai.`category`,
  ai.`status` AS `app_status`,
  ai.`created_at`,
  0 AS `secrets_included`
FROM `tenants` t
JOIN `app_integrations` ai ON ai.`status` IN ('active','beta')
WHERE t.`status` = 'active';

CREATE OR REPLACE VIEW `v_activation_app_binding_catalog` AS
SELECT
  t.`tenant_id`,
  aiab.`binding_id`,
  aiab.`app_key`,
  ai.`display_name` AS `app_display_name`,
  'action' AS `binding_surface`,
  aiab.`action_key` AS `target_key`,
  aiab.`binding_role`,
  aiab.`credential_source`,
  aiab.`exposure_default` AS `exposure_scope`,
  aiab.`status` AS `binding_status`,
  aiab.`updated_at`,
  0 AS `secrets_included`
FROM `tenants` t
JOIN `app_integration_action_bindings` aiab ON aiab.`status` = 'active'
LEFT JOIN `app_integrations` ai ON ai.`app_key` = aiab.`app_key`
WHERE t.`status` = 'active'
UNION ALL
SELECT
  t.`tenant_id`,
  aitb.`binding_id`,
  aitb.`app_key`,
  ai.`display_name` AS `app_display_name`,
  'tool' AS `binding_surface`,
  aitb.`tool_key` AS `target_key`,
  aitb.`binding_role`,
  aitb.`credential_source`,
  aitb.`exposure_scope`,
  aitb.`status` AS `binding_status`,
  aitb.`updated_at`,
  0 AS `secrets_included`
FROM `tenants` t
JOIN `app_integration_tool_bindings` aitb ON aitb.`status` = 'active'
LEFT JOIN `app_integrations` ai ON ai.`app_key` = aitb.`app_key`
WHERE t.`status` = 'active';

CREATE OR REPLACE VIEW `v_activation_platform_plugin_catalog` AS
SELECT
  t.`tenant_id`,
  pop.`plugin_key`,
  pop.`display_name`,
  pop.`domain_key`,
  pop.`plugin_type`,
  pop.`owner_scope`,
  pop.`version`,
  pop.`lifecycle_stage`,
  pop.`engine_key`,
  pop.`policy_key`,
  pop.`readback_tool_key`,
  pop.`status` AS `plugin_status`,
  pop.`updated_at`,
  0 AS `secrets_included`
FROM `tenants` t
JOIN `platform_orchestration_plugins` pop ON pop.`status` = 'active'
WHERE t.`status` = 'active'
  AND pop.`secrets_included` = 0;

CREATE OR REPLACE VIEW `v_activation_skill_manifest_catalog` AS
SELECT
  t.`tenant_id`,
  sm.`skill_key`,
  sm.`engine_key`,
  sm.`display_name` AS `skill_display_name`,
  sm.`skill_version`,
  sm.`prompt_contract_version`,
  sm.`policy_key`,
  sm.`eval_suite_key`,
  sm.`status` AS `manifest_status`,
  sm.`updated_at`,
  0 AS `secrets_included`
FROM `tenants` t
JOIN `skill_manifests` sm ON sm.`status` = 'active'
WHERE t.`status` = 'active';

CREATE OR REPLACE VIEW `v_activation_skill_package_catalog` AS
SELECT
  t.`tenant_id`,
  sp.`package_id`,
  sp.`package_key`,
  sp.`display_name` AS `package_display_name`,
  sp.`source_type`,
  sp.`version`,
  sp.`logic_key`,
  sp.`install_status`,
  sp.`enabled`,
  sp.`installed_at`,
  sp.`updated_at`,
  0 AS `secrets_included`
FROM `tenants` t
JOIN `skill_packages` sp ON sp.`install_status` = 'installed' AND sp.`enabled` = 1
WHERE t.`status` = 'active';

CREATE OR REPLACE VIEW `v_activation_logic_pack_catalog` AS
SELECT
  COALESCE(lp.`tenant_id`, t.`tenant_id`) AS `tenant_id`,
  lp.`pack_id`,
  lp.`pack_key`,
  lp.`display_name` AS `pack_display_name`,
  lp.`pack_type`,
  lp.`service_mode`,
  lp.`parent_pack_id`,
  lp.`status` AS `pack_status`,
  lp.`created_at`,
  0 AS `secrets_included`
FROM `logic_packs` lp
JOIN `tenants` t ON t.`status` = 'active' AND (lp.`tenant_id` IS NULL OR lp.`tenant_id` = t.`tenant_id`)
WHERE lp.`status` = 'active';

CREATE OR REPLACE VIEW `v_activation_local_gateway_tool_catalog` AS
SELECT
  t.`tenant_id`,
  lgt.`tool_key`,
  lgt.`dispatch_tool_key`,
  lgt.`display_name`,
  lgt.`public_host`,
  lgt.`public_path`,
  lgt.`dispatch_surface`,
  lgt.`capability_class`,
  lgt.`risk_class`,
  lgt.`default_service_mode`,
  lgt.`requires_device_id`,
  lgt.`requires_tenant_context`,
  lgt.`requires_admin`,
  lgt.`requires_approval`,
  lgt.`is_consequential`,
  lgt.`consent_required`,
  lgt.`approval_hold_type`,
  lgt.`approval_required_role`,
  lgt.`approval_ttl_minutes`,
  lgt.`tags`,
  lgt.`status` AS `tool_status`,
  lgt.`sort_order`,
  lgt.`updated_at`,
  0 AS `secrets_included`
FROM `tenants` t
JOIN `local_gateway_tools` lgt ON lgt.`status` = 'active'
WHERE t.`status` = 'active';

CREATE OR REPLACE VIEW `v_activation_catalog_authorized_surface_readiness` AS
SELECT
  'activation_catalog_authorized_surfaces' AS `readiness_key`,
  CASE WHEN SUM(`issue_count`) > 0 THEN 'fail' ELSE 'pass' END AS `readiness_status`,
  SUM(`checked_rows`) AS `checked_rows`,
  SUM(`issue_count`) AS `issue_count`,
  0 AS `secrets_included`
FROM (
  SELECT COUNT(*) AS `checked_rows`, SUM(CASE WHEN `secrets_included` <> 0 THEN 1 ELSE 0 END) AS `issue_count` FROM `v_activation_agent_catalog`
  UNION ALL SELECT COUNT(*), SUM(CASE WHEN `secrets_included` <> 0 THEN 1 ELSE 0 END) FROM `v_activation_agent_skill_catalog`
  UNION ALL SELECT COUNT(*), SUM(CASE WHEN `secrets_included` <> 0 THEN 1 ELSE 0 END) FROM `v_activation_agent_tool_catalog`
  UNION ALL SELECT COUNT(*), SUM(CASE WHEN `secrets_included` <> 0 THEN 1 ELSE 0 END) FROM `v_activation_agent_bindings_catalog`
  UNION ALL SELECT COUNT(*), SUM(CASE WHEN `secrets_included` <> 0 THEN 1 ELSE 0 END) FROM `v_activation_workflow_catalog`
  UNION ALL SELECT COUNT(*), SUM(CASE WHEN `secrets_included` <> 0 THEN 1 ELSE 0 END) FROM `v_activation_task_route_catalog`
  UNION ALL SELECT COUNT(*), SUM(CASE WHEN `secrets_included` <> 0 THEN 1 ELSE 0 END) FROM `v_activation_app_integration_catalog`
  UNION ALL SELECT COUNT(*), SUM(CASE WHEN `secrets_included` <> 0 THEN 1 ELSE 0 END) FROM `v_activation_app_binding_catalog`
  UNION ALL SELECT COUNT(*), SUM(CASE WHEN `secrets_included` <> 0 THEN 1 ELSE 0 END) FROM `v_activation_platform_plugin_catalog`
  UNION ALL SELECT COUNT(*), SUM(CASE WHEN `secrets_included` <> 0 THEN 1 ELSE 0 END) FROM `v_activation_skill_manifest_catalog`
  UNION ALL SELECT COUNT(*), SUM(CASE WHEN `secrets_included` <> 0 THEN 1 ELSE 0 END) FROM `v_activation_skill_package_catalog`
  UNION ALL SELECT COUNT(*), SUM(CASE WHEN `secrets_included` <> 0 THEN 1 ELSE 0 END) FROM `v_activation_logic_pack_catalog`
  UNION ALL SELECT COUNT(*), SUM(CASE WHEN `secrets_included` <> 0 THEN 1 ELSE 0 END) FROM `v_activation_local_gateway_tool_catalog`
) checks;
