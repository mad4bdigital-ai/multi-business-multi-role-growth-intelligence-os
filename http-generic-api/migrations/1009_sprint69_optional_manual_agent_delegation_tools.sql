-- Migration execution safety: no_provider_call true; no_credential_payload_read true; no_raw_secrets true;
-- no_external_send true; no_external_write true; secrets_included=false.
-- Sprint 69: expose agent delegation as explicit, manual, admin-governed API actions.
-- No automatic delegation. No batch dispatch tool. No provider call occurs during event creation.
-- Dispatch remains subject to runtime agent, skill, workflow, and execution governance.

INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order, created_at, updated_at)
VALUES
  ('agent_chain_event_create_manual',
   'Create Optional Agent Delegation',
   'Creates optional sub-agent chain events from one completed same-tenant workflow run. Requires explicit manual API opt-in and does not dispatch agents.',
   'POST', '/agent-chain-events', JSON_ARRAY(),
   JSON_OBJECT(
     'type','object',
     'required',JSON_ARRAY('source_run_id','tenant_id','target_workflow_keys','delegation_approved','delegation_mode','delegation_reason'),
     'additionalProperties',false,
     'properties',JSON_OBJECT(
       'source_run_id',JSON_OBJECT('type','string'),
       'tenant_id',JSON_OBJECT('type','string'),
       'target_workflow_keys',JSON_OBJECT('type','array','minItems',1,'maxItems',8,'items',JSON_OBJECT('type','string')),
       'passed',JSON_OBJECT('type','boolean'),
       'delegation_approved',JSON_OBJECT('type','boolean','const',true),
       'delegation_mode',JSON_OBJECT('type','string','const','manual_api'),
       'delegation_reason',JSON_OBJECT('type','string','minLength',10)
     )
   ),
   JSON_OBJECT(),
   'admin,agents,delegation,manual-api,opt-in,create-only,no-dispatch,no-secrets',
   1, 730, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

  ('agent_chain_event_dispatch_manual',
   'Dispatch One Optional Agent Delegation',
   'Dispatches one explicitly selected pending agent chain event. Automatic fallback remains disabled unless separately opted in.',
   'POST', '/agent-chain-events/{event_id}/dispatch', JSON_ARRAY('event_id'),
   JSON_OBJECT(
     'type','object',
     'required',JSON_ARRAY('event_id','delegation_approved','delegation_mode','delegation_reason'),
     'additionalProperties',false,
     'properties',JSON_OBJECT(
       'event_id',JSON_OBJECT('type','string'),
       'delegation_approved',JSON_OBJECT('type','boolean','const',true),
       'delegation_mode',JSON_OBJECT('type','string','const','manual_api'),
       'delegation_reason',JSON_OBJECT('type','string','minLength',10),
       'allow_fallback_agent',JSON_OBJECT('type','boolean','default',false)
     )
   ),
   JSON_OBJECT(),
   'admin,agents,delegation,manual-api,opt-in,single-dispatch,fallback-opt-in,no-secrets',
   1, 731, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

  ('agent_delegation_contract_create_manual',
   'Create Manual Agent Delegation Contract',
   'Creates one explicit user-to-agent delegation contract. It does not execute the agent.',
   'POST', '/agents/{agent_id}/delegate', JSON_ARRAY('agent_id'),
   JSON_OBJECT(
     'type','object',
     'required',JSON_ARRAY('agent_id','user_id','tenant_id','intent_key','delegation_approved','delegation_mode','delegation_reason'),
     'additionalProperties',false,
     'properties',JSON_OBJECT(
       'agent_id',JSON_OBJECT('type','string'),
       'user_id',JSON_OBJECT('type','string'),
       'tenant_id',JSON_OBJECT('type','string'),
       'intent_key',JSON_OBJECT('type','string'),
       'brand_key',JSON_OBJECT('type','string'),
       'plan_id',JSON_OBJECT('type','string'),
       'delegation_approved',JSON_OBJECT('type','boolean','const',true),
       'delegation_mode',JSON_OBJECT('type','string','const','manual_api'),
       'delegation_reason',JSON_OBJECT('type','string','minLength',10)
     )
   ),
   JSON_OBJECT(),
   'admin,agents,delegation,manual-api,opt-in,contract-only,no-execution,no-secrets',
   1, 732, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
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
