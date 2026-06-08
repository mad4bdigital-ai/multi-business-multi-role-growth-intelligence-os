-- Sprint 67: Google Ads budget preflight ledger.
-- Scope: immutable-ish audit/readback ledger for preflight results only.
-- No Google Ads provider call, no credential read, no spend mutation.

CREATE TABLE IF NOT EXISTS google_ads_budget_preflight_ledger (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  preflight_id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NULL,
  user_id VARCHAR(64) NULL,
  workspace_id VARCHAR(64) NULL,
  workspace_key VARCHAR(191) NULL,
  brand_key VARCHAR(191) NULL,
  capability_envelope_id VARCHAR(36) NULL,
  budget_authority_id VARCHAR(64) NULL,
  decision VARCHAR(128) NOT NULL,
  ready_for_dispatch TINYINT(1) NOT NULL DEFAULT 0,
  requested_amount_minor BIGINT NULL,
  currency VARCHAR(16) NOT NULL DEFAULT 'USD',
  meter_key VARCHAR(128) NOT NULL DEFAULT 'google_ads_budget_minor',
  blocking_gap_count INT NOT NULL DEFAULT 0,
  preflight_json JSON NOT NULL,
  preflight_sha256 CHAR(64) NOT NULL,
  no_provider_call TINYINT(1) NOT NULL DEFAULT 1,
  no_spend_change TINYINT(1) NOT NULL DEFAULT 1,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_google_ads_budget_preflight_id (preflight_id),
  KEY idx_google_ads_budget_preflight_envelope (capability_envelope_id),
  KEY idx_google_ads_budget_preflight_decision (decision, ready_for_dispatch),
  KEY idx_google_ads_budget_preflight_scope (tenant_id, workspace_id, brand_key, created_at),
  CONSTRAINT chk_google_ads_budget_preflight_no_provider_call CHECK (no_provider_call = 1),
  CONSTRAINT chk_google_ads_budget_preflight_no_spend_change CHECK (no_spend_change = 1),
  CONSTRAINT chk_google_ads_budget_preflight_no_secrets CHECK (secrets_included = 0)
);

INSERT INTO platform_runtime_config
  (config_key, config_json, status, note)
VALUES
  ('google_ads_budget_preflight_ledger_policy_v1',
   JSON_OBJECT(
     'policy_key','google_ads_budget_preflight_ledger_policy_v1',
     'status','active',
     'table','google_ads_budget_preflight_ledger',
     'producer_tool_key','google_ads_budget_change_preflight',
     'future_execution_contract',JSON_OBJECT(
       'future_google_ads_execution_adapter_must_require_preflight_id',true,
       'preflight_id_must_be_ready_for_dispatch',true,
       'preflight_envelope_id_must_match_execution_envelope',true,
       'preflight_budget_authority_must_be_present_for_ready_dispatch',true,
       'preflight_hash_readback_required',true
     ),
     'records_blocked_results',true,
     'records_ready_results',true,
     'no_provider_call',true,
     'no_credential_read',true,
     'no_spend_change',true,
     'secrets_included',false
   ),
   'active',
   'Google Ads budget preflight ledger. Records preflight decisions for future execution readback; no provider call, no credential read, no spend mutation.'
  )
ON DUPLICATE KEY UPDATE
  config_json = VALUES(config_json),
  status = VALUES(status),
  note = VALUES(note),
  updated_at = CURRENT_TIMESTAMP;

UPDATE platform_runtime_config
   SET config_json = JSON_SET(
         config_json,
         '$.preflight_ledger_table', 'google_ads_budget_preflight_ledger',
         '$.future_execution_gate_requires_preflight_id', true,
         '$.records_preflight_results', true
       ),
       note = CONCAT(note, ' Preflight results are recorded in google_ads_budget_preflight_ledger.'),
       updated_at = CURRENT_TIMESTAMP
 WHERE config_key = 'google_ads_budget_change_preflight_policy_v1'
   AND note NOT LIKE '%google_ads_budget_preflight_ledger%';
