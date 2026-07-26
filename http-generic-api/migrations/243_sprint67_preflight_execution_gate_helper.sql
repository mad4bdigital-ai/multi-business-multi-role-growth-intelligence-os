-- Sprint 67: Preflight execution gate helper policy.
-- Scope: policy/helper only. Does not add provider execution.

INSERT INTO platform_runtime_config
  (config_key, config_json, status, note)
VALUES
  ('preflight_execution_gate_helper_policy_v1',
   JSON_OBJECT(
     'policy_key','preflight_execution_gate_helper_policy_v1',
     'status','active',
     'helper','http-generic-api/preflightLedgerExecutionGate.js',
     'exported_function','requireValidatedPreflightForExecution',
     'validator_tool_key','preflight_ledger_validate',
     'requires_preflight_id',true,
     'requires_family_key',true,
     'requires_ready_for_dispatch',true,
     'requires_expected_decision','ready_for_dispatch',
     'validates_hash',true,
     'validates_optional_envelope_match',true,
     'future_execution_adapters_must_use_helper',true,
     'direct_family_ledger_reads_for_execution_forbidden',true,
     'does_not_execute_target_capability',true,
     'no_provider_call',true,
     'no_spend_change',true,
     'secrets_included',false
   ),
   'active',
   'Generic helper for future execution adapters. Validates preflight_id through preflight_ledger_validate before execution; no provider call or spend change.'
  )
ON DUPLICATE KEY UPDATE
  config_json = VALUES(config_json),
  status = VALUES(status),
  note = VALUES(note),
  updated_at = CURRENT_TIMESTAMP;

UPDATE platform_runtime_config
   SET config_json = JSON_SET(
         config_json,
         '$.future_execution_contract.future_execution_adapters_must_use_preflight_execution_gate_helper', true,
         '$.future_execution_contract.helper', 'http-generic-api/preflightLedgerExecutionGate.js',
         '$.future_execution_contract.direct_family_ledger_reads_for_execution_forbidden', true
       ),
       note = CONCAT(note, ' Future execution adapters must validate through preflightLedgerExecutionGate.js before mutation.'),
       updated_at = CURRENT_TIMESTAMP
 WHERE config_key = 'preflight_ledger_validator_policy_v1'
   AND note NOT LIKE '%preflightLedgerExecutionGate.js%';
