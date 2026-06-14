-- Sprint 69: expose existing Agent Governance admin routes through the governed GPT tool dispatcher.
-- Additive only. Routes remain backend-api-key + admin-principal protected.
-- No provider calls, no credential payloads, no raw prompt content, no secret values.

INSERT INTO platform_runtime_config
  (config_key, config_json, status, note, created_at, updated_at)
VALUES
  ('support_ticket.admin_gpt_repair_link',
   JSON_OBJECT(
     'base_url', 'https://chatgpt.com/g/g-69c82c73bd6081918c52e38525b2d154-growth-intelligence-platform-admin-assistant/',
     'prompt_parameter', 'prompt',
     'state_mode', 'opaque_handoff_id',
     'resume_key', 'resume_state_id',
     'requested_action_key', 'requested_action',
     'target_surface', 'admin_gpt_assistant',
     'handoff_registry', 'agent_handoff_state_registry',
     'support_additive_only', true,
     'secrets_included', false
   ),
   'active',
   'Canonical Admin GPT repair link using an opaque governed handoff identifier. Raw ticket state is not embedded in the URL.',
   CURRENT_TIMESTAMP,
   CURRENT_TIMESTAMP)
ON DUPLICATE KEY UPDATE
  config_json = VALUES(config_json),
  status = VALUES(status),
  note = VALUES(note),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order, created_at, updated_at)
VALUES
  ('agent_governance_response_profile_resolve',
   'Resolve Agent Response Profile',
   'Resolves the effective presentation-only response profile across global, tenant, brand, role, channel, agent, and workflow scopes. It grants no execution authority.',
   'POST', '/platform/agent-governance/response-profile/resolve', JSON_ARRAY(),
   JSON_OBJECT('type','object','additionalProperties',false,'properties',JSON_OBJECT(
     'tenant_id',JSON_OBJECT('type','string'), 'brand_key',JSON_OBJECT('type','string'),
     'role_key',JSON_OBJECT('type','string'), 'channel',JSON_OBJECT('type','string'),
     'agent_id',JSON_OBJECT('type','string'), 'workflow_key',JSON_OBJECT('type','string'))),
   JSON_OBJECT(), 'admin,agent-governance,response-profile,read-only,no-secrets', 1, 700, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

  ('agent_governance_research_policy_resolve',
   'Resolve Research Source Policy',
   'Resolves the governed internal-first research source policy and recommended plan steps for a question class.',
   'POST', '/platform/agent-governance/research-policy/resolve', JSON_ARRAY(),
   JSON_OBJECT('type','object','additionalProperties',false,'properties',JSON_OBJECT(
     'tenant_id',JSON_OBJECT('type','string'), 'workflow_key',JSON_OBJECT('type','string'),
     'brand_key',JSON_OBJECT('type','string'), 'question_class',JSON_OBJECT('type','string'),
     'query',JSON_OBJECT('type','string','maxLength',4000))),
   JSON_OBJECT(), 'admin,agent-governance,research,policy,read-only,no-secrets', 1, 701, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

  ('agent_governance_research_execution_record',
   'Record Governed Research Source Evidence',
   'Records metadata-only research source execution evidence. Secret-like fields and values are rejected by runtime validation.',
   'POST', '/platform/agent-governance/research-executions', JSON_ARRAY(),
   JSON_OBJECT('type','object','required',JSON_ARRAY('policy_key'),'additionalProperties',false,'properties',JSON_OBJECT(
     'execution_id',JSON_OBJECT('type','string'), 'policy_key',JSON_OBJECT('type','string'),
     'tenant_id',JSON_OBJECT('type','string'), 'plan_id',JSON_OBJECT('type','string'),
     'plan_step_id',JSON_OBJECT('type','string'), 'question_class',JSON_OBJECT('type','string'),
     'selected_sources',JSON_OBJECT('type','array','items',JSON_OBJECT('type','string')),
     'source_evidence',JSON_OBJECT('type','object','additionalProperties',true),
     'external_search_used',JSON_OBJECT('type','boolean'), 'citation_status',JSON_OBJECT('type','string'))),
   JSON_OBJECT(), 'admin,agent-governance,research,evidence,write,no-secrets', 1, 702, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

  ('agent_governance_research_plan_create',
   'Create Governed Research Plan',
   'Creates an idempotent governed sequential research plan from the resolved research source policy. Does not execute the plan.',
   'POST', '/platform/agent-governance/research-plans', JSON_ARRAY(),
   JSON_OBJECT('type','object','required',JSON_ARRAY('tenant_id','query'),'additionalProperties',false,'properties',JSON_OBJECT(
     'tenant_id',JSON_OBJECT('type','string'), 'user_id',JSON_OBJECT('type','string'),
     'brand_key',JSON_OBJECT('type','string'), 'workflow_key',JSON_OBJECT('type','string'),
     'agent_id',JSON_OBJECT('type','string'), 'question_class',JSON_OBJECT('type','string'),
     'query',JSON_OBJECT('type','string','maxLength',4000),
     'idempotency_key',JSON_OBJECT('type','string'))),
   JSON_OBJECT(), 'admin,agent-governance,research,plan,create,idempotent,no-secrets', 1, 703, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

  ('agent_governance_research_plan_run',
   'Run Governed Research Plan',
   'Executes a previously created governed research plan and verifies canonical execution-log readback.',
   'POST', '/platform/agent-governance/research-plans/{plan_id}/run', JSON_ARRAY('plan_id'),
   JSON_OBJECT('type','object','required',JSON_ARRAY('plan_id','tenant_id'),'additionalProperties',false,'properties',JSON_OBJECT(
     'plan_id',JSON_OBJECT('type','string'), 'tenant_id',JSON_OBJECT('type','string'),
     'max_ticks',JSON_OBJECT('type','integer','minimum',1,'maximum',100))),
   JSON_OBJECT(), 'admin,agent-governance,research,plan,execute,readback,no-secrets', 1, 704, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

  ('agent_governance_handoff_create',
   'Create Governed Agent Handoff',
   'Creates an opaque expiring handoff state. Credential and secret-like fields or values are rejected.',
   'POST', '/platform/agent-governance/handoffs', JSON_ARRAY(),
   JSON_OBJECT('type','object','required',JSON_ARRAY('tenant_id','intent'),'additionalProperties',false,'properties',JSON_OBJECT(
     'tenant_id',JSON_OBJECT('type','string'), 'user_id',JSON_OBJECT('type','string'),
     'source_agent_id',JSON_OBJECT('type','string'), 'target_agent_id',JSON_OBJECT('type','string'),
     'resource_ref',JSON_OBJECT('type','string'), 'intent',JSON_OBJECT('type','string'),
     'current_state',JSON_OBJECT('type','object','additionalProperties',true),
     'required_checks',JSON_OBJECT('type','array','items',JSON_OBJECT('type','string')),
     'allowed_actions',JSON_OBJECT('type','array','items',JSON_OBJECT('type','string')),
     'expires_at',JSON_OBJECT('type','string','format','date-time'), 'one_time_use',JSON_OBJECT('type','boolean'))),
   JSON_OBJECT(), 'admin,agent-governance,handoff,create,opaque,no-secrets', 1, 705, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

  ('agent_governance_handoff_read',
   'Read Governed Agent Handoff',
   'Reads an active governed handoff after tenant, target-agent, action, expiry, and consumption checks.',
   'GET', '/platform/agent-governance/handoffs/{state_id}', JSON_ARRAY('state_id'),
   JSON_OBJECT('type','object','required',JSON_ARRAY('state_id','tenant_id'),'additionalProperties',false,'properties',JSON_OBJECT(
     'state_id',JSON_OBJECT('type','string'), 'tenant_id',JSON_OBJECT('type','string'),
     'requested_action',JSON_OBJECT('type','string'), 'allow_source_agent',JSON_OBJECT('type','boolean'))),
   JSON_OBJECT(), 'admin,agent-governance,handoff,read,opaque,no-secrets', 1, 706, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

  ('agent_governance_handoff_consume',
   'Consume Governed Agent Handoff',
   'Consumes or records use of a governed handoff after access checks. One-time handoffs cannot be reused.',
   'POST', '/platform/agent-governance/handoffs/{state_id}/consume', JSON_ARRAY('state_id'),
   JSON_OBJECT('type','object','required',JSON_ARRAY('state_id','tenant_id'),'additionalProperties',false,'properties',JSON_OBJECT(
     'state_id',JSON_OBJECT('type','string'), 'tenant_id',JSON_OBJECT('type','string'),
     'requested_action',JSON_OBJECT('type','string'), 'allow_source_agent',JSON_OBJECT('type','boolean'))),
   JSON_OBJECT(), 'admin,agent-governance,handoff,consume,mutation,no-secrets', 1, 707, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

  ('agent_governance_handoff_revoke',
   'Revoke Governed Agent Handoff',
   'Revokes an active governed handoff and records the authenticated principal in the access log.',
   'POST', '/platform/agent-governance/handoffs/{state_id}/revoke', JSON_ARRAY('state_id'),
   JSON_OBJECT('type','object','required',JSON_ARRAY('state_id','tenant_id'),'additionalProperties',false,'properties',JSON_OBJECT(
     'state_id',JSON_OBJECT('type','string'), 'tenant_id',JSON_OBJECT('type','string'),
     'requested_action',JSON_OBJECT('type','string'))),
   JSON_OBJECT(), 'admin,agent-governance,handoff,revoke,mutation,no-secrets', 1, 708, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

  ('agent_governance_external_prompt_classify',
   'Classify External Prompt Artifact',
   'Classifies and quarantines untrusted external prompt material. It grants no execution, tool, or policy authority.',
   'POST', '/platform/agent-governance/external-prompts/classify', JSON_ARRAY(),
   JSON_OBJECT('type','object','required',JSON_ARRAY('content'),'additionalProperties',false,'properties',JSON_OBJECT(
     'tenant_id',JSON_OBJECT('type','string'), 'source_type',JSON_OBJECT('type','string'),
     'source_ref',JSON_OBJECT('type','string'), 'content',JSON_OBJECT('type','string','maxLength',200000))),
   JSON_OBJECT(), 'admin,agent-governance,external-prompt,quarantine,no-authority,no-secrets', 1, 709, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

  ('agent_governance_skill_coverage',
   'Read Agent Skill Runtime Coverage',
   'Reads skill manifest, prompt, grant, validator, and runtime readiness coverage without executing a skill.',
   'GET', '/platform/agent-governance/skill-coverage', JSON_ARRAY(),
   JSON_OBJECT('type','object','additionalProperties',false,'properties',JSON_OBJECT(
     'skill_key',JSON_OBJECT('type','string'), 'coverage_status',JSON_OBJECT('type','string'))),
   JSON_OBJECT(), 'admin,agent-governance,skills,coverage,read-only,no-secrets', 1, 710, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

  ('agent_governance_readiness',
   'Read Agent Governance Readiness',
   'Reads schema, profile, policy, skill coverage, source adapter, and citation verifier readiness.',
   'GET', '/platform/agent-governance/readiness', JSON_ARRAY(),
   JSON_OBJECT('type','object','additionalProperties',false,'properties',JSON_OBJECT()),
   JSON_OBJECT(), 'admin,agent-governance,readiness,read-only,no-secrets', 1, 711, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

  ('agent_governance_memory_scope_resolve',
   'Resolve Agent Memory Scope',
   'Resolves active approved memory links for requested tenant-scoped memory dimensions. It returns metadata only and grants no execution authority.',
   'POST', '/platform/agent-governance/memory-scope/resolve', JSON_ARRAY(),
   JSON_OBJECT('type','object','required',JSON_ARRAY('tenant_id'),'additionalProperties',false,'properties',JSON_OBJECT(
     'tenant_id',JSON_OBJECT('type','string'),
     'scopes',JSON_OBJECT('type','object','additionalProperties',JSON_OBJECT('type','string')))),
   JSON_OBJECT(), 'admin,agent-governance,memory,scope,read-only,no-secrets', 1, 712, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  http_method = VALUES(http_method),
  http_path = VALUES(http_path),
  path_param_keys = VALUES(path_param_keys),
  input_schema = VALUES(input_schema),
  fixed_body = VALUES(fixed_body),
  tags = VALUES(tags),
  is_enabled = VALUES(is_enabled),
  sort_order = VALUES(sort_order),
  updated_at = CURRENT_TIMESTAMP;
