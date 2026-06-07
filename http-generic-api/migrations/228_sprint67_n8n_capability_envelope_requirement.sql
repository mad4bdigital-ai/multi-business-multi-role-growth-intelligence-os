-- Sprint 67: Require capability resolution envelopes for n8n state-changing control.
-- Scope: policy/runtime registry only. Runtime enforcement is in routes/connectorProxyRoutes.js.
-- Read-only n8n actions remain available without an envelope.

INSERT INTO platform_runtime_config
  (config_key, config_json, status, note)
VALUES
  ('n8n_state_changing_capability_envelope_requirement_v1',
   JSON_OBJECT(
     'policy_key','n8n_state_changing_capability_envelope_requirement_v1',
     'status','active',
     'app_key','n8n',
     'tool_key','connector_n8n',
     'route','/connector/{device_id}/n8n',
     'proxy_route','routes/connectorProxyRoutes.js',
     'envelope_table','capability_resolution_envelope_ledger',
     'read_only_actions_do_not_require_envelope',JSON_ARRAY('status','diagnose','health','list_workflows','get_workflow','list_executions','open'),
     'state_changing_actions_require_envelope',JSON_ARRAY('start','stop','restart','activate_workflow','deactivate_workflow','run_workflow','execute_workflow'),
     'required_envelope_status','ready_for_dispatch',
     'required_dispatch_allowed',true,
     'approval_required_must_be_false',true,
     'blocking_gap_count_must_be_zero',true,
     'expired_envelopes_rejected',true,
     'accepted_app_keys',JSON_ARRAY('n8n'),
     'accepted_intents',JSON_ARRAY('n8n_workflow_control','workflow_control','automation_workflows','activate_workflow','deactivate_workflow','run_workflow','execute_workflow','start','stop','restart'),
     'tenant_user_match_enforced_when_present',true,
     'marks_envelope_referenced_before_forwarding',true,
     'connector_forwarding_blocked_without_envelope',true,
     'api_key_bridge_occurs_after_envelope_gate',true,
     'secrets_included',false
   ),
   'active',
   'n8n state-changing connector control requires a no-secret capability resolution envelope before connector forwarding or API-key bridge injection.'
  )
ON DUPLICATE KEY UPDATE
  config_json = VALUES(config_json),
  status = VALUES(status),
  note = VALUES(note),
  updated_at = CURRENT_TIMESTAMP;

UPDATE admin_platform_endpoint_tools
   SET input_schema = JSON_SET(input_schema, '$.properties.capability_envelope_id', JSON_OBJECT('type','string','description','Required for state-changing n8n actions: start, stop, restart, activate_workflow, deactivate_workflow, run_workflow, execute_workflow. Not required for read-only actions.')),
       description = CONCAT(description, ' State-changing n8n actions require capability_envelope_id before connector forwarding.'),
       tags = CONCAT(tags, ',capability_envelope_required_for_state_change'),
       updated_at = CURRENT_TIMESTAMP
 WHERE tool_key = 'connector_n8n'
   AND tags NOT LIKE '%capability_envelope_required_for_state_change%';

UPDATE tenant_platform_endpoint_tools
   SET input_schema = JSON_SET(input_schema, '$.properties.capability_envelope_id', JSON_OBJECT('type','string','description','Required for state-changing n8n actions. Not required for read-only actions.')),
       description = CONCAT(description, ' State-changing n8n actions require capability_envelope_id before connector forwarding.')
 WHERE tool_key = 'connector_n8n'
   AND description NOT LIKE '%State-changing n8n actions require capability_envelope_id%';

UPDATE local_gateway_tools
   SET input_schema = JSON_SET(input_schema, '$.properties.capability_envelope_id', JSON_OBJECT('type','string','description','Required for state-changing n8n actions. Not required for read-only actions.')),
       notes = CONCAT(COALESCE(notes, ''), ' State-changing n8n actions require capability envelope before connector forwarding.'),
       updated_at = CURRENT_TIMESTAMP
 WHERE tool_key = 'local.connector.n8n'
   AND (notes IS NULL OR notes NOT LIKE '%capability envelope before connector forwarding%');
