-- Sprint 67: Google Ads credential readiness ledger.
-- Scope: audit/readback ledger for credential readiness gate results only. No credential decrypt, no provider calls, no spend changes.

CREATE TABLE IF NOT EXISTS google_ads_credential_readiness_ledger (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  credential_readiness_id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NULL,
  user_id VARCHAR(64) NULL,
  connection_id VARCHAR(64) NULL,
  decision VARCHAR(128) NOT NULL,
  ready_for_execution_credentials TINYINT(1) NOT NULL DEFAULT 0,
  validation_status VARCHAR(64) NULL,
  validation_age_hours DECIMAL(12,2) NULL,
  active_binding_count INT NOT NULL DEFAULT 0,
  matching_binding_present TINYINT(1) NOT NULL DEFAULT 0,
  blocking_gap_count INT NOT NULL DEFAULT 0,
  max_validation_age_hours INT NOT NULL DEFAULT 720,
  readiness_json JSON NOT NULL,
  readiness_sha256 CHAR(64) NOT NULL,
  no_credential_payload_read TINYINT(1) NOT NULL DEFAULT 1,
  no_provider_call TINYINT(1) NOT NULL DEFAULT 1,
  no_spend_change TINYINT(1) NOT NULL DEFAULT 1,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_google_ads_credential_readiness_id (credential_readiness_id),
  KEY idx_google_ads_credential_readiness_connection (connection_id, created_at),
  KEY idx_google_ads_credential_readiness_decision (decision, ready_for_execution_credentials, created_at),
  KEY idx_google_ads_credential_readiness_scope (tenant_id, user_id, created_at),
  CONSTRAINT chk_google_ads_credential_readiness_no_payload CHECK (no_credential_payload_read = 1),
  CONSTRAINT chk_google_ads_credential_readiness_no_provider_call CHECK (no_provider_call = 1),
  CONSTRAINT chk_google_ads_credential_readiness_no_spend CHECK (no_spend_change = 1),
  CONSTRAINT chk_google_ads_credential_readiness_no_secrets CHECK (secrets_included = 0)
);

INSERT INTO platform_runtime_config
  (config_key, config_json, status, note)
VALUES
  ('google_ads_credential_readiness_ledger_policy_v1',
   JSON_OBJECT(
     'policy_key','google_ads_credential_readiness_ledger_policy_v1',
     'status','active',
     'table','google_ads_credential_readiness_ledger',
     'producer_tool_key','google_ads_credential_readiness_gate',
     'records_blocked_results',true,
     'records_ready_results',true,
     'future_execution_contract',JSON_OBJECT(
       'future_google_ads_execution_adapter_must_require_credential_readiness_id',true,
       'credential_readiness_id_must_be_ready_for_execution_credentials',true,
       'credential_readiness_hash_readback_required',true,
       'connection_id_match_required_when_supplied',true,
       'freshness_window_required',true,
       'preflight_gate_still_required',true,
       'execution_enablement_still_required',true
     ),
     'does_not_read_encrypted_credentials',true,
     'does_not_decrypt_credentials',true,
     'no_credential_payload_read',true,
     'no_provider_call',true,
     'no_spend_change',true,
     'secrets_included',false
   ),
   'active',
   'Google Ads credential readiness ledger. Records readiness decisions for future execution readback; no credential decrypt, provider call, or spend mutation.'
  )
ON DUPLICATE KEY UPDATE
  config_json = VALUES(config_json),
  status = VALUES(status),
  note = VALUES(note),
  updated_at = CURRENT_TIMESTAMP;

UPDATE platform_runtime_config
   SET config_json = JSON_MERGE_PATCH(
         COALESCE(config_json, JSON_OBJECT()),
         JSON_OBJECT(
           'credential_readiness_ledger_table', 'google_ads_credential_readiness_ledger',
           'records_credential_readiness_results', true,
           'future_execution_contract', JSON_OBJECT(
             'credential_readiness_id_required', true,
             'credential_readiness_ledger_table', 'google_ads_credential_readiness_ledger',
             'credential_readiness_hash_readback_required', true,
             'credential_readiness_ready_decision_required', true,
             'does_not_read_encrypted_credentials', true,
             'does_not_decrypt_credentials', true,
             'secrets_included', false
           )
         )
       ),
       note = CASE
         WHEN note LIKE '%google_ads_credential_readiness_ledger%' THEN note
         ELSE CONCAT(note, ' Credential readiness results are recorded in google_ads_credential_readiness_ledger.')
       END,
       updated_at = CURRENT_TIMESTAMP
 WHERE config_key = 'google_ads_credential_readiness_gate_policy_v1';
