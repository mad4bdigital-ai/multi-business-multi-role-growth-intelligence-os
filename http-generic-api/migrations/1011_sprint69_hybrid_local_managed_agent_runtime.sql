-- Sprint 69: optional hybrid local/managed agent runtime control surface.
-- Local execution, settings updates, installation, and managed fallback are never automatic.

INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order, created_at, updated_at)
VALUES
  ('local_agent_runtime_control',
   'Control Optional Local Agent Runtime',
   'Inspect, configure, install, run, monitor, or cancel an optional local multi-agent runtime using Ollama or a local OpenAI-compatible provider. Run, settings changes, and installation require separate explicit approvals.',
   'POST', '/connector/{device_id}/agent-runtime', JSON_ARRAY('device_id'),
   JSON_OBJECT(
     'type','object',
     'required',JSON_ARRAY('device_id','action'),
     'additionalProperties',true,
     'properties',JSON_OBJECT(
       'device_id',JSON_OBJECT('type','string'),
       'action',JSON_OBJECT('type','string','enum',JSON_ARRAY('capabilities','recommend_models','settings','settings_update','install_provider','install_ollama','install_model','run','job_status','cancel')),
       'settings_update_approved',JSON_OBJECT('type','boolean','default',false),
       'installation_approved',JSON_OBJECT('type','boolean','default',false),
       'model_installation_approved',JSON_OBJECT('type','boolean','default',false),
       'provider_key',JSON_OBJECT('type','string','enum',JSON_ARRAY('ollama','lm_studio','localai','llama_cpp','vllm','jan','custom_openai_compatible')),
       'delegation_approved',JSON_OBJECT('type','boolean','default',false),
       'delegation_mode',JSON_OBJECT('type','string','enum',JSON_ARRAY('manual_api')),
       'delegation_reason',JSON_OBJECT('type','string','minLength',10),
       'execution_target',JSON_OBJECT('type','string','enum',JSON_ARRAY('local_device','platform_managed')),
       'model',JSON_OBJECT('type','string'),
       'max_parallel_agents',JSON_OBJECT('type','integer','minimum',1,'maximum',6),
       'agents',JSON_OBJECT('type','array','minItems',1,'maxItems',6),
       'job_id',JSON_OBJECT('type','string'),
       'settings',JSON_OBJECT('type','object')
     )
   ),
   JSON_OBJECT(),
   'admin,agents,local-device,local-model-provider,openai-compatible,ollama,gemma,multi-agent,manual-api,opt-in,install-approval,no-secrets',
   1, 733, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name), description=VALUES(description), http_method=VALUES(http_method),
  http_path=VALUES(http_path), path_param_keys=VALUES(path_param_keys), input_schema=VALUES(input_schema),
  fixed_body=VALUES(fixed_body), tags=VALUES(tags), is_enabled=VALUES(is_enabled),
  sort_order=VALUES(sort_order), updated_at=CURRENT_TIMESTAMP;

INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order, created_at, updated_at)
SELECT
  'connector_agent_runtime', display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body,
  CONCAT(tags, ',local-gateway-dispatch'), is_enabled, sort_order + 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM admin_platform_endpoint_tools
WHERE tool_key = 'local_agent_runtime_control'
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name), description=VALUES(description), http_method=VALUES(http_method),
  http_path=VALUES(http_path), path_param_keys=VALUES(path_param_keys), input_schema=VALUES(input_schema),
  fixed_body=VALUES(fixed_body), tags=VALUES(tags), is_enabled=VALUES(is_enabled),
  sort_order=VALUES(sort_order), updated_at=CURRENT_TIMESTAMP;

INSERT INTO tenant_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order)
SELECT
  'connector_agent_runtime', display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body,
  CONCAT(tags, ',tenant-owned-device'), is_enabled, sort_order
FROM admin_platform_endpoint_tools
WHERE tool_key = 'connector_agent_runtime'
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name), description=VALUES(description), http_method=VALUES(http_method),
  http_path=VALUES(http_path), path_param_keys=VALUES(path_param_keys), input_schema=VALUES(input_schema),
  fixed_body=VALUES(fixed_body), tags=VALUES(tags), is_enabled=VALUES(is_enabled), sort_order=VALUES(sort_order);

INSERT INTO local_gateway_tools
  (tool_key, dispatch_tool_key, display_name, description, target_path_template, capability_class, risk_class,
   allowed_caller_types_json, service_modes_json, requires_device_id, requires_tenant_context, requires_admin,
   requires_approval, is_consequential, input_schema, tags, status, sort_order, notes)
VALUES
  ('local.connector.agent_runtime', 'connector_agent_runtime', 'Optional Local Multi-Agent Runtime',
   'Inspect or explicitly operate an Ollama or OpenAI-compatible multi-agent runtime on a tenant-owned local device. No automatic delegation or managed fallback.',
   '/connector/{device_id}/agent-runtime', 'local_device_agent_runtime', 'high',
   '["tenant","admin"]', '["self_serve","assisted","managed"]', 1, 1, 0, 0, 1,
   '{"type":"object","required":["device_id","action"],"properties":{"device_id":{"type":"string"},"action":{"type":"string","enum":["capabilities","recommend_models","settings","settings_update","install_provider","install_ollama","install_model","run","job_status","cancel"]},"settings_update_approved":{"type":"boolean"},"installation_approved":{"type":"boolean"},"model_installation_approved":{"type":"boolean"},"provider_key":{"type":"string","enum":["ollama","lm_studio","localai","llama_cpp","vllm","jan","custom_openai_compatible"]},"delegation_approved":{"type":"boolean"},"delegation_mode":{"type":"string","enum":["manual_api"]},"delegation_reason":{"type":"string"},"execution_target":{"type":"string","enum":["local_device","platform_managed"]},"model":{"type":"string"},"max_parallel_agents":{"type":"integer","minimum":1,"maximum":6},"agents":{"type":"array","maxItems":6},"job_id":{"type":"string"},"settings":{"type":"object"},"user_id":{"type":"string"}}}',
   'local,device,agents,local-model-provider,openai-compatible,ollama,gemma,multi-agent,manual-api,opt-in,approval,no-secrets', 'active', 95,
   'Tenant/Admin GPT may inspect freely. Settings updates, installation, and multi-agent runs require explicit action-specific approval.')
ON DUPLICATE KEY UPDATE
  dispatch_tool_key=VALUES(dispatch_tool_key), display_name=VALUES(display_name), description=VALUES(description),
  target_path_template=VALUES(target_path_template), capability_class=VALUES(capability_class), risk_class=VALUES(risk_class),
  allowed_caller_types_json=VALUES(allowed_caller_types_json), service_modes_json=VALUES(service_modes_json),
  requires_device_id=VALUES(requires_device_id), requires_tenant_context=VALUES(requires_tenant_context),
  requires_admin=VALUES(requires_admin), requires_approval=VALUES(requires_approval),
  is_consequential=VALUES(is_consequential), input_schema=VALUES(input_schema), tags=VALUES(tags),
  status=VALUES(status), sort_order=VALUES(sort_order), notes=VALUES(notes);
