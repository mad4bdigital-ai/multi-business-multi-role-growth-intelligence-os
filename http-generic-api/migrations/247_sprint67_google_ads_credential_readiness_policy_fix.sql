-- Sprint 67: Google Ads credential readiness policy readback fix.
-- Scope: policy readback correction only. No provider calls, no credential reads, no spend changes.

UPDATE platform_runtime_config
   SET config_json = JSON_MERGE_PATCH(
         COALESCE(config_json, JSON_OBJECT()),
         JSON_OBJECT(
           'future_execution_contract', JSON_OBJECT(
             'credential_readiness_gate_required', true,
             'credential_readiness_tool_key', 'google_ads_credential_readiness_gate',
             'real_google_ads_user_connection_required', true,
             'preflight_execution_gate_helper_required', true,
             'execution_enablement_still_required', true,
             'no_credential_read', true,
             'no_provider_call', true,
             'no_spend_change', true,
             'secrets_included', false
           )
         )
       ),
       note = CASE
         WHEN note LIKE '%credential readiness gate%' THEN note
         ELSE CONCAT(note, ' Future provider execution also requires google_ads_credential_readiness_gate.')
       END,
       updated_at = CURRENT_TIMESTAMP
 WHERE config_key = 'google_ads_budget_execution_adapter_skeleton_policy_v1';

INSERT INTO platform_runtime_config
  (config_key, config_json, status, note)
VALUES
  ('google_ads_credential_readiness_policy_readback_fix_v1',
   JSON_OBJECT(
     'policy_key','google_ads_credential_readiness_policy_readback_fix_v1',
     'status','active',
     'target_config_key','google_ads_budget_execution_adapter_skeleton_policy_v1',
     'ensures_future_execution_contract_object',true,
     'credential_readiness_tool_key','google_ads_credential_readiness_gate',
     'real_google_ads_user_connection_required',true,
     'no_credential_read',true,
     'no_provider_call',true,
     'no_spend_change',true,
     'secrets_included',false
   ),
   'active',
   'Readback fix for Google Ads credential readiness requirement on execution adapter skeleton policy. No execution.'
  )
ON DUPLICATE KEY UPDATE
  config_json = VALUES(config_json),
  status = VALUES(status),
  note = VALUES(note),
  updated_at = CURRENT_TIMESTAMP;
