-- Safety contract: no_provider_call=true; no_credential_payload_read=true; no_raw_secrets=true;
-- no_external_send=true; no_external_write=true; secrets_included=false.
-- Correct the internal policy metadata field name. The previous JSON key contained
-- the substring "token", which is intentionally rejected by capability-envelope
-- sensitive-field validation. Typed confirmation remains enforced by the script,
-- the registry booleans, and the non-sensitive required_confirmation metadata.

UPDATE capability_apply_authorization_policy_registry
SET policy_json = JSON_SET(
      JSON_REMOVE(COALESCE(policy_json, JSON_OBJECT()), '$.confirmation_token'),
      '$.required_confirmation',
      'APPLY_SUPERVISOR_BEHAVIORAL_CERTIFICATION'
    ),
    notes = CONCAT_WS(
      ' ',
      NULLIF(notes, ''),
      'Policy metadata uses required_confirmation so envelope serialization remains secret-safe; typed confirmation and rollback requirements are unchanged.'
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE policy_key = 'supervisor_behavioral_certification_apply_v1'
  AND capability_key = 'supervisor_behavioral_certification'
  AND app_key = 'platform_orchestration'
  AND operation_intent = 'supervisor_behavioral_certification'
  AND runtime_surface = 'admin_control';
