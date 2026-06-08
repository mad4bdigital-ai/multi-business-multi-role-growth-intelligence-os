-- Sprint 67: Capability resolution envelope approval tool.
-- Scope: register governed approval helper only. No secrets, no execution of target capabilities.

INSERT INTO platform_runtime_config
  (config_key, config_json, status, note)
VALUES
  ('capability_resolution_envelope_approval_tool_policy_v1',
   JSON_OBJECT(
     'policy_key','capability_resolution_envelope_approval_tool_policy_v1',
     'status','active',
     'tool_key','capability_resolution_envelope_approve',
     'script','http-generic-api/scripts/capability-resolution-envelope-approve.mjs',
     'approvable_envelope_status','ready_requires_approval',
     'result_envelope_status','ready_for_dispatch',
     'requires_dispatch_allowed',true,
     'requires_zero_blocking_gaps',true,
     'requires_approval_required',true,
     'rejects_expired_envelopes',true,
     'rejects_secret_marked_envelopes',true,
     'writes_approval_holds',true,
     'updates_envelope_hash',true,
     'does_not_execute_target_capability',true,
     'secrets_included',false
   ),
   'active',
   'Governed approval helper for capability_resolution_envelope_ledger rows that are ready_requires_approval. Does not execute target capabilities.'
  )
ON DUPLICATE KEY UPDATE
  config_json = VALUES(config_json),
  status = VALUES(status),
  note = VALUES(note),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO admin_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES (
  'capability_resolution_envelope_approve',
  'Approve Capability Resolution Envelope',
  'Approve a ready_requires_approval capability resolution envelope. Writes an approval_holds row, flips the envelope to ready_for_dispatch, updates the envelope hash, and never executes the target capability.',
  'POST',
  '/admin/control',
  JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'tool',JSON_OBJECT('type','string','const','shell'),
      'action',JSON_OBJECT('type','string','const','run'),
      'alias',JSON_OBJECT('type','string','const','capability_resolution_envelope_approve'),
      'extra_args',JSON_OBJECT('type','array','items',JSON_OBJECT('type','string'),'maxItems',12,'description','Required: --envelope-id <uuid>. Optional: --approved-by, --decision-note, --ttl-minutes.')
    ),
    'required',JSON_ARRAY('tool','action','alias'),
    'additionalProperties',false
  ),
  NULL,
  'admin,capability_resolution,envelope_approval,no_execution,no_secrets,approval_holds,authority_graph,managed_dedicated_dynamic',
  1,
  232
)
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
