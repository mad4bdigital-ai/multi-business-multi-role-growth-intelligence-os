-- Migration execution safety: no_provider_call true; no_credential_payload_read true; no_raw_secrets true;
-- no_external_send true; no_external_write true; secrets_included=false.
-- Activation Guidance Intelligence for Tenant GPT and Admin GPT.
-- Summary/readback only. No provider call, no mutation, no secret return.

INSERT INTO tenant_platform_endpoint_tools
(tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order)
VALUES
('tenant_activation_guidance_read_api','Read Tenant Activation Guidance','Tenant-safe proactive activation guidance. Returns account counts, capability groups, readiness semantics, safe action menu, blocked/limited capabilities, and next-best-action instructions. No secrets.','GET','/tenant/activation/guidance',JSON_ARRAY(),JSON_OBJECT('type','object','properties',JSON_OBJECT('tenant_id',JSON_OBJECT('type','string'))),NULL,'tenant,activation-guidance,read_only,no_secrets,summary_first,proactive_guidance',1,1010)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name), description=VALUES(description), http_method=VALUES(http_method),
  http_path=VALUES(http_path), path_param_keys=VALUES(path_param_keys), input_schema=VALUES(input_schema),
  fixed_body=VALUES(fixed_body), tags=VALUES(tags), is_enabled=VALUES(is_enabled), sort_order=VALUES(sort_order);

INSERT INTO admin_platform_endpoint_tools
(tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order)
VALUES
('admin_activation_guidance_read_api','Read Admin Activation Guidance','Admin proactive activation guidance across workspace, tenant, brand, platform tool, capability and permission counts. No secrets.','GET','/admin/activation/guidance',JSON_ARRAY(),JSON_OBJECT('type','object','properties',JSON_OBJECT('tenant_id',JSON_OBJECT('type','string'),'user_id',JSON_OBJECT('type','string'))),NULL,'admin,activation-guidance,read_only,no_secrets,summary_first,proactive_guidance,workspace_management,brand_management',1,11940)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name), description=VALUES(description), http_method=VALUES(http_method),
  http_path=VALUES(http_path), path_param_keys=VALUES(path_param_keys), input_schema=VALUES(input_schema),
  fixed_body=VALUES(fixed_body), tags=VALUES(tags), is_enabled=VALUES(is_enabled), sort_order=VALUES(sort_order);

INSERT INTO activation_operational_tile_registry
(tile_key, provider_family, connector_family, scope_class, display_name, description, category, default_visibility, source_mode, status_callback_key, freshness_sla_seconds, priority_order, risk_level, status)
VALUES
('tenant_activation_guidance','platform','activation_guidance','tenant','Tenant Activation Guidance','Proactive tenant activation brief with account counts, permission semantics, capability groups and next-best actions.','activation_guidance','owner_and_admin','platform_native','tenant_activation_guidance_read_api',300,2,'low','active'),
('admin_activation_guidance','platform','activation_guidance','platform','Admin Activation Guidance','Proactive admin activation brief for workspace, tenant, brand and platform management with dynamic capability counts.','activation_guidance','admin_only','platform_native','admin_activation_guidance_read_api',300,3,'low','active')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name), description=VALUES(description), category=VALUES(category), default_visibility=VALUES(default_visibility),
  status_callback_key=VALUES(status_callback_key), freshness_sla_seconds=VALUES(freshness_sla_seconds), priority_order=VALUES(priority_order),
  risk_level=VALUES(risk_level), status=VALUES(status);

INSERT INTO activation_callback_registry
(callback_key, tile_key, provider_family, connector_family, intent_key, runtime_action_key, endpoint_selector, safe_mode, allowed_sources_json, output_contract_json, fallback_prompt_template_key, freshness_sla_seconds, priority_order, status)
VALUES
('tenant_activation_guidance_read','tenant_activation_guidance','platform','activation_guidance','activation.guidance.tenant.read','tenant_activation_guidance_read_api','GET /tenant/activation/guidance','read_only',JSON_ARRAY('platform_native','tenant_user_jwt'),JSON_OBJECT('returns',JSON_ARRAY('activation_brief','counts','capability_groups','recommended_next_actions','safe_action_menu','blocked_or_limited_capabilities','assistant_instruction_pack'),'secrets_included',false),NULL,300,2,'active'),
('admin_activation_guidance_read','admin_activation_guidance','platform','activation_guidance','activation.guidance.admin.read','admin_activation_guidance_read_api','GET /admin/activation/guidance','read_only',JSON_ARRAY('platform_native','admin_backend_key'),JSON_OBJECT('returns',JSON_ARRAY('activation_brief','admin_capability_snapshot','workspace_management','brand_management','recommended_next_actions','assistant_instruction_pack'),'secrets_included',false),NULL,300,3,'active')
ON DUPLICATE KEY UPDATE
  runtime_action_key=VALUES(runtime_action_key), endpoint_selector=VALUES(endpoint_selector), safe_mode=VALUES(safe_mode),
  allowed_sources_json=VALUES(allowed_sources_json), output_contract_json=VALUES(output_contract_json),
  freshness_sla_seconds=VALUES(freshness_sla_seconds), priority_order=VALUES(priority_order), status=VALUES(status);
