-- Sprint 68: Connection capability repair before fallback policy
-- Platform policy: when a connector/tool fallback reports unsupported capability,
-- prioritize adding or repairing the missing native capability before falling back.

INSERT INTO execution_policies (
  policy_group,
  policy_key,
  policy_value,
  active,
  execution_scope,
  affects_layer,
  blocking,
  notes
) VALUES (
  'Connector Capability Governance',
  'Repair Missing Capability Before Fallback',
  JSON_OBJECT(
    'rule','repair_missing_capability_before_fallback',
    'scope','all_connectors_and_admin_tools',
    'trigger_signals',JSON_ARRAY(
      'fallback_unsupported_command',
      'fallback_missing_operation_mapping',
      'connector_capability_not_supported',
      'tool_wrapper_fallback_gap'
    ),
    'required_sequence',JSON_ARRAY(
      'classify_missing_capability',
      'attempt_native_capability_expansion_or_mapping',
      'run_targeted_regression_test',
      'retry_original_operation',
      'only_then_use_fallback_or_manual_route'
    ),
    'max_repair_attempts_before_fallback',3,
    'fallback_allowed_after',JSON_OBJECT(
      'attempts_exhausted',true,
      'unsafe_to_expand',true,
      'provider_endpoint_unavailable',true,
      'auth_scope_missing_or_denied',true
    ),
    'evidence_required',JSON_ARRAY(
      'original_unsupported_operation',
      'capability_gap_classification',
      'repair_attempt_count',
      'test_or_readback_result',
      'fallback_reason_if_used'
    ),
    'example_incident','github_rest_fallback_missing_pr_list'
  ),
  'TRUE',
  'connector_dispatch,admin_tool_dispatch,device_tool_dispatch,system_tool_dispatch',
  'connector_runtime,admin_control,github_fallback,hostinger_fallback,local_connector',
  'TRUE',
  'Do not accept fallback gaps as final. Add or repair missing capability mappings up to three attempts before using fallback/manual route.'
)
ON DUPLICATE KEY UPDATE
  policy_value=VALUES(policy_value),
  active=VALUES(active),
  execution_scope=VALUES(execution_scope),
  affects_layer=VALUES(affects_layer),
  blocking=VALUES(blocking),
  notes=VALUES(notes),
  updated_at=NOW();
