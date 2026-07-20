-- Declare the internal-persistence mutation policy for Release Operation Ledger writes.
-- Each route performs bounded SQL persistence only and returns same-cycle lifecycle readback.

UPDATE admin_platform_endpoint_tools
SET tags = CONCAT_WS(',',
  NULLIF(tags, ''),
  IF(FIND_IN_SET('readback', REPLACE(COALESCE(tags, ''), ' ', '')) = 0, 'readback', NULL),
  IF(FIND_IN_SET('same_cycle_readback', REPLACE(COALESCE(tags, ''), ' ', '')) = 0, 'same_cycle_readback', NULL)
)
WHERE tool_key IN (
  'release_operation_create',
  'release_operation_step_append',
  'release_operation_evidence_append',
  'release_operation_gate_event_append',
  'release_operation_finalize'
);

INSERT INTO execution_policies
  (policy_group, policy_key, policy_value, active, execution_scope, affects_layer, blocking, notes)
VALUES
  (
    'Release Intelligence Governance',
    'release_operation_internal_persistence_policy_v1',
    JSON_OBJECT(
      'rule', 'release_operation_writes_are_internal_persistence_with_same_cycle_readback',
      'enforcement_mode', 'blocking',
      'internal_persistence_only', TRUE,
      'provider_write_allowed', FALSE,
      'external_mutation_allowed', FALSE,
      'same_cycle_readback_required', TRUE,
      'bounded_evidence_required', TRUE,
      'secrets_included', FALSE
    ),
    'TRUE',
    'gpt_tools_call|tool_dispatch|release_operation_create|release_operation_step_append|release_operation_evidence_append|release_operation_gate_event_append|release_operation_finalize',
    'gptToolsRoutes|releaseOperationRoutes|releaseOperationService|admin_platform_endpoint_tools',
    'FALSE',
    'Release Operation Ledger writes are internal platform persistence only and must return same-cycle lifecycle readback.'
  )
ON DUPLICATE KEY UPDATE
  policy_value = VALUES(policy_value),
  active = VALUES(active),
  execution_scope = VALUES(execution_scope),
  affects_layer = VALUES(affects_layer),
  blocking = VALUES(blocking),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;
