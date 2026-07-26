-- Operational Console API registry seeds.

INSERT INTO admin_platform_endpoint_tools
(tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order)
VALUES
('operational_console_read_api','Read Operational Console API','Read one compact operational console surface combining runtime parity, activation summary, operational tiles, callbacks, attention rules, freshness policies, latest verification run, and evidence manifest. No secrets.','GET','/operational/console',JSON_ARRAY(),JSON_OBJECT('type','object','properties',JSON_OBJECT('environment_key',JSON_OBJECT('type','string','default','production'),'tile_limit',JSON_OBJECT('type','integer','minimum',1,'maximum',100),'evidence_limit',JSON_OBJECT('type','integer','minimum',1,'maximum',50),'surface',JSON_OBJECT('type','string'))),NULL,'admin,operational-console,read_only,no_secrets,summary_first,api_control_plane',1,11950),
('operational_console_evidence_read_api','Read Operational Console Evidence API','Read paginated evidence for the latest runtime verification run referenced by the operational console. No secrets.','GET','/operational/console/evidence',JSON_ARRAY(),JSON_OBJECT('type','object','properties',JSON_OBJECT('environment_key',JSON_OBJECT('type','string','default','production'),'surface',JSON_OBJECT('type','string'),'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',100),'cursor',JSON_OBJECT('type','string'))),NULL,'admin,operational-console,read_only,no_secrets,paginated,api_control_plane',1,11951)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name), description=VALUES(description), http_method=VALUES(http_method),
  http_path=VALUES(http_path), path_param_keys=VALUES(path_param_keys), input_schema=VALUES(input_schema),
  fixed_body=VALUES(fixed_body), tags=VALUES(tags), is_enabled=VALUES(is_enabled), sort_order=VALUES(sort_order);

INSERT INTO activation_operational_tile_registry
(tile_key, provider_family, connector_family, scope_class, display_name, description, category, default_visibility, source_mode, status_callback_key, freshness_sla_seconds, priority_order, risk_level, status)
VALUES
('operational_console_overview','platform','operational_console','platform','Operational Console Overview','Unified operational readback surface for runtime parity, activation summary, attention rules, freshness, callbacks, and verification evidence.','operational_console','admin_only','platform_native','operational_console_read_api',300,1,'critical','active')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name), description=VALUES(description), category=VALUES(category),
  status_callback_key=VALUES(status_callback_key), freshness_sla_seconds=VALUES(freshness_sla_seconds),
  priority_order=VALUES(priority_order), risk_level=VALUES(risk_level), status=VALUES(status);

INSERT INTO activation_callback_registry
(callback_key, tile_key, provider_family, connector_family, intent_key, runtime_action_key, endpoint_selector, safe_mode, allowed_sources_json, output_contract_json, fallback_prompt_template_key, freshness_sla_seconds, priority_order, status)
VALUES
('operational_console_overview_read','operational_console_overview','platform','operational_console','operational.console.read','operational_console_read_api','GET /operational/console','read_only',JSON_ARRAY('platform_native','runtime_verification_control_plane','activation_operational_registry'),JSON_OBJECT('returns',JSON_ARRAY('summary','runtime_parity','activation_summary','operational_tiles','attention_rules','evidence_manifest'),'secrets_included',false),NULL,300,1,'active'),
('operational_console_evidence_read','operational_console_overview','platform','operational_console','operational.console.evidence.read','operational_console_evidence_read_api','GET /operational/console/evidence','read_only',JSON_ARRAY('platform_native','runtime_verification_control_plane'),JSON_OBJECT('returns',JSON_ARRAY('items','page'),'paginated',true,'secrets_included',false),NULL,300,2,'active')
ON DUPLICATE KEY UPDATE
  runtime_action_key=VALUES(runtime_action_key), endpoint_selector=VALUES(endpoint_selector), safe_mode=VALUES(safe_mode),
  allowed_sources_json=VALUES(allowed_sources_json), output_contract_json=VALUES(output_contract_json),
  freshness_sla_seconds=VALUES(freshness_sla_seconds), priority_order=VALUES(priority_order), status=VALUES(status);
