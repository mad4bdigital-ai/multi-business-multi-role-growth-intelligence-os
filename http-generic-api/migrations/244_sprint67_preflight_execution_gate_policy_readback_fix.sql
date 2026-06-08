-- Sprint 67: Preflight execution gate policy readback fix.
-- Scope: policy readback correction only. No provider calls, no connector execution, no spend changes.

UPDATE platform_runtime_config
   SET config_json = JSON_MERGE_PATCH(
         COALESCE(config_json, JSON_OBJECT()),
         JSON_OBJECT(
           'future_execution_contract', JSON_OBJECT(
             'future_execution_adapters_must_use_preflight_execution_gate_helper', true,
             'helper', 'http-generic-api/preflightLedgerExecutionGate.js',
             'direct_family_ledger_reads_for_execution_forbidden', true,
             'requires_ready_for_dispatch', true,
             'requires_hash_readback', true,
             'requires_no_provider_call_marker', true,
             'requires_no_spend_change_marker', true,
             'secrets_included', false
           )
         )
       ),
       note = CASE
         WHEN note LIKE '%preflightLedgerExecutionGate.js%' THEN note
         ELSE CONCAT(note, ' Future execution adapters must validate through preflightLedgerExecutionGate.js before mutation.')
       END,
       updated_at = CURRENT_TIMESTAMP
 WHERE config_key = 'preflight_ledger_validator_policy_v1';

INSERT INTO platform_runtime_config
  (config_key, config_json, status, note)
VALUES
  ('preflight_execution_gate_policy_readback_fix_v1',
   JSON_OBJECT(
     'policy_key','preflight_execution_gate_policy_readback_fix_v1',
     'status','active',
     'target_config_key','preflight_ledger_validator_policy_v1',
     'ensures_future_execution_contract_object',true,
     'helper','http-generic-api/preflightLedgerExecutionGate.js',
     'direct_family_ledger_reads_for_execution_forbidden',true,
     'no_provider_call',true,
     'no_spend_change',true,
     'secrets_included',false
   ),
   'active',
   'Readback fix for preflight ledger validator future_execution_contract helper policy. No execution.'
  )
ON DUPLICATE KEY UPDATE
  config_json = VALUES(config_json),
  status = VALUES(status),
  note = VALUES(note),
  updated_at = CURRENT_TIMESTAMP;
