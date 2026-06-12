-- Dynamic invocation registry for Activation Guidance Intelligence.
-- Tags and slash aliases are language-neutral routing hints; they never bypass authorization, approval, or runtime readiness.

CREATE TABLE IF NOT EXISTS activation_guidance_invocation_registry (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  invocation_key VARCHAR(180) NOT NULL UNIQUE,
  profile_scope ENUM('all','tenant','admin') NOT NULL DEFAULT 'all',
  path_type ENUM('stage','recommended_action','capability_group') NOT NULL,
  path_key VARCHAR(180) NOT NULL,
  invocation_tag VARCHAR(180) NOT NULL,
  slash_alias VARCHAR(180) NOT NULL,
  intent_key VARCHAR(220) NOT NULL,
  entity_scope_json JSON NULL,
  operation_mode VARCHAR(80) NOT NULL DEFAULT 'read_only_or_advisory',
  default_risk ENUM('low','medium','high','critical') NOT NULL DEFAULT 'low',
  requires_confirmation TINYINT(1) NOT NULL DEFAULT 0,
  tool_candidates_json JSON NULL,
  priority_order INT NOT NULL DEFAULT 100,
  status ENUM('active','pending','deprecated','archived') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_activation_guidance_invocation_lookup (profile_scope, path_type, path_key, status, priority_order),
  INDEX idx_activation_guidance_invocation_tag (invocation_tag, status),
  INDEX idx_activation_guidance_slash_alias (slash_alias, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO activation_guidance_invocation_registry
(invocation_key, profile_scope, path_type, path_key, invocation_tag, slash_alias, intent_key, entity_scope_json, operation_mode, default_risk, requires_confirmation, tool_candidates_json, priority_order, status)
VALUES
('stage.activation','all','stage','activation','@activation/status','/activation','activation.status.read',JSON_ARRAY('activation'),'read_only', 'low',0,JSON_ARRAY(),10,'active'),
('stage.scope','all','stage','scope','@account/scope','/account','account.scope.read',JSON_ARRAY('tenant','workspace','membership'),'read_only','low',0,JSON_ARRAY(),20,'active'),
('stage.admin_management','admin','stage','admin_management','@admin/management','/admin-scope','admin.management.review',JSON_ARRAY('workspace','brand','platform'),'read_only','low',0,JSON_ARRAY('admin_activation_guidance_read_api'),25,'active'),
('stage.counts','all','stage','counts','@account/counts','/counts','account.counts.read',JSON_ARRAY('account','capability'),'read_only','low',0,JSON_ARRAY(),30,'active'),
('stage.permissions','all','stage','permissions','@permissions/readiness','/permissions','permission.readiness.read',JSON_ARRAY('permission','capability'),'read_only','low',0,JSON_ARRAY(),40,'active'),
('stage.ready','all','stage','ready','@capability/ready','/ready','capability.ready.list',JSON_ARRAY('capability'),'read_only','low',0,JSON_ARRAY(),50,'active'),
('stage.limited','all','stage','limited','@capability/limited','/limited','capability.limited.list',JSON_ARRAY('capability','approval'),'advisory','low',0,JSON_ARRAY(),60,'active'),
('stage.next','all','stage','next','@next/best-action','/next','guidance.next_best_action',JSON_ARRAY('guidance'),'advisory','low',0,JSON_ARRAY(),70,'active'),
('stage.commands','all','stage','commands','@commands/palette','/commands','guidance.command_palette',JSON_ARRAY('guidance','command'),'read_only','low',0,JSON_ARRAY(),80,'active'),
('action.read_activation_guidance_brief','all','recommended_action','read_activation_guidance_brief','@activation/brief','/activation','activation.guidance.brief',JSON_ARRAY('activation'),'read_only','low',0,JSON_ARRAY('tenant_activation_guidance_read_api','admin_activation_guidance_read_api'),100,'active'),
('action.check_connector_health','all','recommended_action','check_connector_health','@connector/health','/connector-health','connector.health.read',JSON_ARRAY('device','connector'),'read_only','low',0,JSON_ARRAY('health_check','local_gateway_tools_list'),110,'active'),
('action.connect_or_repair_device','all','recommended_action','connect_or_repair_device','@device/connect','/device-connect','device.connection.prepare',JSON_ARRAY('device','connector'),'setup_or_repair','medium',1,JSON_ARRAY(),120,'active'),
('action.review_connected_app_readiness','all','recommended_action','review_connected_app_readiness','@integration/readiness','/integrations','integration.readiness.review',JSON_ARRAY('connected_system','integration'),'read_only','low',0,JSON_ARRAY('operational_console_read_api'),130,'active'),
('action.review_connected_integrations','all','recommended_action','review_connected_integrations','@integration/review','/integrations','integration.readiness.review',JSON_ARRAY('connected_system','integration'),'read_only','low',0,JSON_ARRAY('operational_console_read_api'),131,'active'),
('action.connect_high_value_app','all','recommended_action','connect_high_value_app','@integration/connect','/connect-app','integration.connection.plan',JSON_ARRAY('integration'),'setup','medium',1,JSON_ARRAY(),140,'active'),
('action.offer_read_only_status_or_inventory_workflow','all','recommended_action','offer_read_only_status_or_inventory_workflow','@workflow/read-only','/safe-workflows','workflow.read_only.offer',JSON_ARRAY('workflow','tool'),'read_only','low',0,JSON_ARRAY(),150,'active'),
('action.offer_safe_read_only_workflows','all','recommended_action','offer_safe_read_only_workflows','@workflow/read-only','/safe-workflows','workflow.read_only.offer',JSON_ARRAY('workflow','tool'),'read_only','low',0,JSON_ARRAY(),151,'active'),
('action.explain_approval_required_paths_without_executing','all','recommended_action','explain_approval_required_paths_without_executing','@approval/explain','/approvals','approval.paths.explain',JSON_ARRAY('capability','approval'),'advisory','low',0,JSON_ARRAY(),160,'active'),
('action.explain_approval_gated_options','all','recommended_action','explain_approval_gated_options','@approval/options','/approvals','approval.paths.explain',JSON_ARRAY('capability','approval'),'advisory','low',0,JSON_ARRAY(),161,'active'),
('action.review_workspace_and_member_operational_state','admin','recommended_action','review_workspace_and_member_operational_state','@workspace/overview','/workspace','workspace.operational.review',JSON_ARRAY('workspace','tenant','membership'),'read_only','low',0,JSON_ARRAY('admin_activation_guidance_read_api'),170,'active'),
('action.review_brand_readiness_and_next_actions','admin','recommended_action','review_brand_readiness_and_next_actions','@brand/readiness','/brands','brand.readiness.review',JSON_ARRAY('brand','brand_core'),'read_only','low',0,JSON_ARRAY('admin_activation_guidance_read_api'),180,'active'),
('action.review_brand_readiness','admin','recommended_action','review_brand_readiness','@brand/readiness','/brands','brand.readiness.review',JSON_ARRAY('brand','brand_core'),'read_only','low',0,JSON_ARRAY('admin_activation_guidance_read_api'),181,'active'),
('action.onboard_or_activate_brand_core','admin','recommended_action','onboard_or_activate_brand_core','@brand/onboard','/brand-onboard','brand.core.onboard.plan',JSON_ARRAY('brand','brand_core'),'setup','medium',1,JSON_ARRAY(),190,'active'),
('action.setup_first_connection','all','recommended_action','setup_first_connection','@connection/setup','/connect','connection.first.setup',JSON_ARRAY('device','integration'),'setup','medium',1,JSON_ARRAY(),200,'active')
ON DUPLICATE KEY UPDATE
  profile_scope=VALUES(profile_scope), path_type=VALUES(path_type), path_key=VALUES(path_key),
  invocation_tag=VALUES(invocation_tag), slash_alias=VALUES(slash_alias), intent_key=VALUES(intent_key),
  entity_scope_json=VALUES(entity_scope_json), operation_mode=VALUES(operation_mode),
  default_risk=VALUES(default_risk), requires_confirmation=VALUES(requires_confirmation),
  tool_candidates_json=VALUES(tool_candidates_json), priority_order=VALUES(priority_order), status=VALUES(status);
