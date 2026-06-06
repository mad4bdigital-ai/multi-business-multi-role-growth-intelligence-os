-- Sprint 67: OpenClaude provider bridge route contract and disabled admin tools.
-- These rows codify the no-secret, no-local-execution bridge contract. Tool rows
-- remain disabled until the route is merged, deployed, and health-read back.

INSERT INTO platform_runtime_config
(config_key, config_json, status, note)
VALUES
('openclaude_provider_bridge_contract_v1',
 JSON_OBJECT(
   'runtime_key','openclaude_essam_local_v1',
   'preferred_profile_key','openclaude_essam_platform_bridge_v1',
   'bridge_mode','platform_hosted_openai_compatible_proxy',
   'credential_boundary','platform_managed_credentials_never_copied_to_device',
   'local_device','essam-pc',
   'local_agent','openclaude',
   'local_provider_shape','openai_compatible_chat_completions',
   'planned_endpoint','/dev-agent/openclaude/bridge/v1/chat/completions',
   'planned_health_endpoint','/dev-agent/openclaude/bridge/v1/health',
   'auth_model','scoped_device_token_and_tenant_runtime_authority',
   'allowed_use_cases',JSON_ARRAY('repo_analysis','patch_planning','code_review','local_read_only_probe'),
   'allowed_openclaude_tools',JSON_ARRAY('Read','Grep','Glob','LS'),
   'denied_openclaude_tools',JSON_ARRAY('Edit','Write','MultiEdit','NotebookEdit','Bash','git push','git commit','apply_patch'),
   'hard_limits',JSON_OBJECT(
      'copy_platform_secret_to_device',false,
      'return_provider_api_key_to_agent',false,
      'repo_mutation',false,
      'provider_write',false,
      'local_shell_execution',false,
      'network_from_local_device_to_provider',false,
      'secrets_included',false
   ),
   'initial_provider_candidates',JSON_ARRAY('platform_model_provider_bridge','openclaude_openrouter_openai_compatible'),
   'status','contract_registered_pending_route',
   'next_step','merge route then certify health dry-run before enabling dispatch'
 ),
 'active',
 'OpenClaude provider bridge contract registered. No provider secret is copied to Essam; route tools stay disabled until deployed and certified.'
)
ON DUPLICATE KEY UPDATE
 config_json=VALUES(config_json), status=VALUES(status), note=VALUES(note), updated_at=CURRENT_TIMESTAMP;

INSERT INTO admin_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES
(
  'dev_agent_openclaude_bridge_health',
  'OpenClaude Bridge Health',
  'Read the OpenClaude provider bridge contract and route readiness. Does not call a provider, execute local commands, mutate repositories, or return secrets.',
  'GET',
  '/dev-agent/openclaude/bridge/v1/health',
  NULL,
  '{"type":"object","properties":{},"additionalProperties":false}',
  NULL,
  'dev_agent,openclaude,provider_bridge,health,read_only,no_secrets,no_provider_call,no_local_execution,no_repo_mutation,disabled_until_deploy',
  0,
  151
),
(
  'dev_agent_openclaude_bridge_chat_dry_run',
  'OpenClaude Bridge Chat Dry Run',
  'OpenAI-compatible chat-completions dry-run for OpenClaude bridge integration. Requires dry_run=true and never calls a provider, executes local commands, mutates repositories, or returns secrets.',
  'POST',
  '/dev-agent/openclaude/bridge/v1/chat/completions',
  NULL,
  '{"type":"object","required":["dry_run"],"properties":{"dry_run":{"type":"boolean","const":true},"model":{"type":"string"},"messages":{"type":"array","items":{"type":"object","properties":{"role":{"type":"string"},"content":{"type":"string"}}}},"prompt":{"type":"string"}},"additionalProperties":true}',
  NULL,
  'dev_agent,openclaude,provider_bridge,chat_completions,dry_run,openai_compatible,no_secrets,no_provider_call,no_local_execution,no_repo_mutation,disabled_until_deploy',
  0,
  152
)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),
  description=VALUES(description),
  http_method=VALUES(http_method),
  http_path=VALUES(http_path),
  path_param_keys=VALUES(path_param_keys),
  input_schema=VALUES(input_schema),
  fixed_body=VALUES(fixed_body),
  tags=VALUES(tags),
  is_enabled=VALUES(is_enabled),
  sort_order=VALUES(sort_order);

UPDATE dev_agent_provider_registry
SET status='planned',
    policy_json=JSON_OBJECT('copy_platform_secret_to_device',false,'requires_scoped_device_token',true,'can_mutate_repo',false,'repo_mutation_allowed',false,'local_shell_execution_allowed',false,'secrets_included',false,'bridge_contract_key','openclaude_provider_bridge_contract_v1','endpoint_live',false),
    notes='Preferred bridge option. Contract registered under openclaude_provider_bridge_contract_v1. Keeps Gemini/OpenRouter credentials inside the platform and exposes only a future scoped OpenAI-compatible proxy to local agent workflows. Endpoint must be deployed and certified before dispatch is enabled.',
    updated_at=CURRENT_TIMESTAMP
WHERE provider_key='platform_model_provider_bridge';

UPDATE dev_agent_runtime_provider_profiles
SET endpoint_url='https://auth.mad4b.com/dev-agent/openclaude/bridge/v1/chat/completions',
    status='planned',
    policy_json=JSON_OBJECT('can_mutate_repo',false,'copy_platform_secret_to_device',false,'allowed_tools',JSON_ARRAY('Read','Grep','Glob','LS'),'denied_tools',JSON_ARRAY('Edit','Write','MultiEdit','NotebookEdit','Bash','git push','git commit','apply_patch'),'requires_scoped_device_token',true,'endpoint_live',false,'secrets_included',false),
    metadata_json=JSON_OBJECT('bridge_required',true,'repo_ready',true,'bridge_contract_registered',true,'bridge_contract_key','openclaude_provider_bridge_contract_v1','endpoint_live',false,'route_tools_enabled',false,'next_step','deploy route and run health dry-run before enabling'),
    notes='Platform bridge profile selected as preferred path. Contract is registered but provider dispatch remains disabled; no provider secret is copied to Essam and no runtime execution is enabled.',
    updated_at=CURRENT_TIMESTAMP
WHERE profile_key='openclaude_essam_platform_bridge_v1';

UPDATE dev_agent_runtime_registry
SET status='degraded',
    policy_json=JSON_SET(COALESCE(NULLIF(policy_json,''), JSON_OBJECT()), '$.execution_status', 'blocked_pending_provider_bridge_route', '$.provider_bridge_contract_key', 'openclaude_provider_bridge_contract_v1', '$.copy_platform_secret_to_device', false, '$.can_mutate_repo', false, '$.secrets_included', false),
    notes=CONCAT(COALESCE(notes,''), '\nOpenClaude provider bridge route contract codified; runtime remains degraded until deployed route health readback and scoped dispatch certification are complete.'),
    updated_at=CURRENT_TIMESTAMP
WHERE runtime_key='openclaude_essam_local_v1';

INSERT INTO execution_policies
(policy_group, policy_key, policy_value, active, execution_scope, affects_layer, blocking, notes)
VALUES
('dev_agent_provider_bridge_governance','openclaude_no_secret_device_proxy',
 JSON_OBJECT(
   'rule','openclaude_provider_bridge_must_not_expose_provider_secrets_to_device',
   'runtime_key','openclaude_essam_local_v1',
   'bridge_contract_key','openclaude_provider_bridge_contract_v1',
   'allowed_local_agent_mode','read_only_plan',
   'allowed_tools',JSON_ARRAY('Read','Grep','Glob','LS'),
   'denied_tools',JSON_ARRAY('Edit','Write','MultiEdit','NotebookEdit','Bash','git push','git commit','apply_patch'),
   'requirements',JSON_ARRAY('scoped device token','tenant/runtime authority','rate limit','audit evidence','same-cycle health readback','no provider secret returned'),
   'forbidden',JSON_ARRAY('copy Gemini/OpenRouter secrets to Essam','freeform shell execution','repo mutation','provider write','mark active without route health probe')
 ),
 'true','dev_agent_provider_bridge','dev_agent_runtime_registry,dev_agent_provider_registry,dev_agent_runtime_provider_profiles,local_connector,repo_analysis','true',
 'OpenClaude provider bridge may only expose a scoped proxy interface. Platform provider secrets stay server-side; local agent gets no raw credentials and no write tools.'
)
ON DUPLICATE KEY UPDATE policy_value=VALUES(policy_value), active=VALUES(active), execution_scope=VALUES(execution_scope), affects_layer=VALUES(affects_layer), blocking=VALUES(blocking), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP;

INSERT INTO runtime_dispatch_certification_registry
(certification_key, surface_key, surface_family, tool_or_action_key, risk_class, certification_status, smoke_strategy, dispatch_allowed, apply_allowed, requires_resource_authority, requires_dry_run, requires_audit_evidence, requires_readback, notes)
VALUES
('openclaude_platform_provider_bridge_v1','openclaude_provider_bridge','dev_agent_provider_bridge','dev_agent_openclaude_bridge_chat_dry_run','B','route_registered_pending_deploy','health endpoint dry-run must prove auth boundary, no secrets returned, no repo mutation, no local shell, and no provider dispatch unless explicitly enabled',0,0,1,1,1,1,'Bridge route contract is codified. Dispatch/apply remain disabled until deployment, scoped token verification, and same-cycle health smoke exist.')
ON DUPLICATE KEY UPDATE surface_key=VALUES(surface_key), surface_family=VALUES(surface_family), tool_or_action_key=VALUES(tool_or_action_key), risk_class=VALUES(risk_class), certification_status=VALUES(certification_status), smoke_strategy=VALUES(smoke_strategy), dispatch_allowed=VALUES(dispatch_allowed), apply_allowed=VALUES(apply_allowed), requires_resource_authority=VALUES(requires_resource_authority), requires_dry_run=VALUES(requires_dry_run), requires_audit_evidence=VALUES(requires_audit_evidence), requires_readback=VALUES(requires_readback), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP;
