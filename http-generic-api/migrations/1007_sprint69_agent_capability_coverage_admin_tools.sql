-- Sprint 69: expose Logic and Engine evidence coverage through governed Admin tools.
-- Read-only metadata surfaces. No provider calls, execution, credential reads, or secret returns.

INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order, created_at, updated_at)
VALUES
  ('agent_governance_logic_coverage',
   'Read Agent Logic Runtime Coverage',
   'Reads Logic inventory and evidence-backed retrieval, selection, dispatch, success, verification, and last-used coverage. Active inventory alone is not reported as usage.',
   'GET', '/platform/agent-governance/logic-coverage', JSON_ARRAY(),
   JSON_OBJECT(
     'type','object',
     'additionalProperties',false,
     'properties',JSON_OBJECT(
       'logic_key',JSON_OBJECT('type','string','pattern','^[A-Za-z0-9_.:-]{1,191}$'),
       'registry_status',JSON_OBJECT('type','string','pattern','^[a-z0-9_-]{1,32}$'),
       'usage_status',JSON_OBJECT('type','string','enum',JSON_ARRAY(
         'never_retrieved','retrieved_never_selected','selected_never_dispatched',
         'dispatched_never_succeeded','succeeded_not_verified','verified')),
       'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',250,'default',100)
     )
   ),
   JSON_OBJECT(),
   'admin,agent-governance,logic,coverage,evidence,read-only,no-secrets',
   1, 713, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

  ('agent_governance_engine_coverage',
   'Read Agent Engine Runtime Coverage',
   'Reads workflow-bound Engine references and evidence-backed retrieval, selection, dispatch, success, verification, and last-used coverage. Textual references alone are not reported as usage.',
   'GET', '/platform/agent-governance/engine-coverage', JSON_ARRAY(),
   JSON_OBJECT(
     'type','object',
     'additionalProperties',false,
     'properties',JSON_OBJECT(
       'engine_key',JSON_OBJECT('type','string','pattern','^[A-Za-z0-9_.:-]{1,191}$'),
       'usage_status',JSON_OBJECT('type','string','enum',JSON_ARRAY(
         'never_retrieved','retrieved_never_selected','selected_never_dispatched',
         'dispatched_never_succeeded','succeeded_not_verified','verified')),
       'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',250,'default',100)
     )
   ),
   JSON_OBJECT(),
   'admin,agent-governance,engine,coverage,evidence,read-only,no-secrets',
   1, 714, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
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
