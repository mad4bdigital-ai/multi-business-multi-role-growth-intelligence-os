-- CI guard operational alert ingestion and SLO projection.
-- SQL-primary, additive, idempotent, no provider calls, no external sends, no secrets.

CREATE TABLE IF NOT EXISTS operational_alert_ci_signal_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_id VARCHAR(36) NOT NULL UNIQUE,
  idempotency_key VARCHAR(191) NOT NULL UNIQUE,
  signal_key VARCHAR(128) NOT NULL,
  alert_key VARCHAR(191) NOT NULL,
  alert_id VARCHAR(36) NULL,
  workflow_name VARCHAR(191) NOT NULL,
  workflow_run_id VARCHAR(64) NOT NULL,
  workflow_attempt INT UNSIGNED NOT NULL DEFAULT 1,
  job_name VARCHAR(191) NOT NULL,
  status ENUM('success','failure','cancelled','timed_out','action_required') NOT NULL,
  severity ENUM('info','low','medium','high','critical') NOT NULL DEFAULT 'high',
  source_ref VARCHAR(255) NULL,
  commit_sha VARCHAR(64) NULL,
  ref_name VARCHAR(255) NULL,
  started_at DATETIME NULL,
  observed_at DATETIME NOT NULL,
  ingested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  detection_seconds INT UNSIGNED NULL,
  recovery_seconds INT UNSIGNED NULL,
  evidence_json JSON NULL,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  INDEX idx_ci_guard_signal_observed (signal_key, observed_at),
  INDEX idx_ci_guard_signal_status (signal_key, status, observed_at),
  INDEX idx_ci_guard_workflow_run (workflow_run_id, workflow_attempt),
  INDEX idx_ci_guard_alert (alert_id, observed_at),
  CONSTRAINT fk_ci_guard_signal_alert FOREIGN KEY (alert_id)
    REFERENCES operational_alerts(alert_id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO operational_alert_rule_registry
(rule_key, source_type, condition_key, severity, reason_code, recommended_action_key,
 requires_confirmation, lookback_hours, dedupe_scope, status)
VALUES
('alert_ci_guard_failure','ci_guard_signal','status IN failure,cancelled,timed_out,action_required',
 'high','ci_guard_failure','ci_guard.review_failure',0,24,'global','active')
ON DUPLICATE KEY UPDATE
 source_type=VALUES(source_type), condition_key=VALUES(condition_key), severity=VALUES(severity),
 reason_code=VALUES(reason_code), recommended_action_key=VALUES(recommended_action_key),
 requires_confirmation=VALUES(requires_confirmation), lookback_hours=VALUES(lookback_hours),
 dedupe_scope=VALUES(dedupe_scope), status=VALUES(status);

INSERT INTO activation_operational_tile_registry
(tile_key, provider_family, connector_family, scope_class, display_name, description, category,
 default_visibility, source_mode, status_callback_key, freshness_sla_seconds,
 priority_order, risk_level, status)
VALUES
('openapi_guard_slo','platform','ci_guard','platform_admin','OpenAPI Guard SLO',
 'Daily success, detection-time, recovery-time, and current incident lifecycle for the Custom GPT Contract Guard.',
 'observability','owner_and_admin','platform_native','operational.ci_guard.slo.read',300,3,'high','active')
ON DUPLICATE KEY UPDATE
 display_name=VALUES(display_name), description=VALUES(description), category=VALUES(category),
 default_visibility=VALUES(default_visibility), source_mode=VALUES(source_mode),
 status_callback_key=VALUES(status_callback_key), freshness_sla_seconds=VALUES(freshness_sla_seconds),
 priority_order=VALUES(priority_order), risk_level=VALUES(risk_level), status=VALUES(status);

INSERT INTO activation_callback_registry
(callback_key, tile_key, provider_family, connector_family, intent_key, runtime_action_key,
 endpoint_selector, safe_mode, allowed_sources_json, output_contract_json,
 fallback_prompt_template_key, freshness_sla_seconds, priority_order, status)
VALUES
('operational.ci_guard.slo.read','openapi_guard_slo','platform','ci_guard',
 'activation.ci_guard.slo.read','activation_awareness_read_api','GET /activation/awareness','read_only',
 JSON_ARRAY('platform_native'),
 JSON_OBJECT('returns',JSON_ARRAY('dashboard.ci_guard_slo','dashboard.tiles'),'provider_calls',false,
             'external_send',false,'secrets_included',false),
 NULL,300,3,'active')
ON DUPLICATE KEY UPDATE
 tile_key=VALUES(tile_key), runtime_action_key=VALUES(runtime_action_key),
 endpoint_selector=VALUES(endpoint_selector), safe_mode=VALUES(safe_mode),
 allowed_sources_json=VALUES(allowed_sources_json), output_contract_json=VALUES(output_contract_json),
 freshness_sla_seconds=VALUES(freshness_sla_seconds), priority_order=VALUES(priority_order), status=VALUES(status);

INSERT INTO admin_platform_endpoint_tools
(tool_key, display_name, description, http_method, http_path, path_param_keys,
 input_schema, fixed_body, tags, is_enabled, sort_order)
VALUES
('activation_operational_alert_ci_signal_ingest_api','Ingest CI Guard Operational Signal',
 'Idempotently ingest a CI guard success or failure into SQL operational alerts, lifecycle events, notification outbox, and SLO readback.',
 'POST','/activation/operational-attention/ci-signals',JSON_ARRAY(),
 JSON_OBJECT(
   'type','object','required',JSON_ARRAY('signal_key','status','idempotency_key','workflow_run_id','observed_at'),
   'additionalProperties',false,
   'properties',JSON_OBJECT(
     'signal_key',JSON_OBJECT('type','string','minLength',3,'maxLength',128),
     'status',JSON_OBJECT('type','string','enum',JSON_ARRAY('success','failure','cancelled','timed_out','action_required')),
     'idempotency_key',JSON_OBJECT('type','string','minLength',1,'maxLength',191),
     'workflow_name',JSON_OBJECT('type','string','maxLength',191),
     'workflow_run_id',JSON_OBJECT('type','string','maxLength',64),
     'workflow_attempt',JSON_OBJECT('type','integer','minimum',1),
     'job_name',JSON_OBJECT('type','string','maxLength',191),
     'source_ref',JSON_OBJECT('type','string','maxLength',255),
     'commit_sha',JSON_OBJECT('type','string','maxLength',64),
     'ref_name',JSON_OBJECT('type','string','maxLength',255),
     'started_at',JSON_OBJECT('type','string','format','date-time'),
     'observed_at',JSON_OBJECT('type','string','format','date-time'),
     'severity',JSON_OBJECT('type','string','enum',JSON_ARRAY('info','low','medium','high','critical')),
     'title',JSON_OBJECT('type','string','maxLength',512),
     'summary',JSON_OBJECT('type','string','maxLength',4000),
     'evidence',JSON_OBJECT('type','object','additionalProperties',true)
   )
 ),
 NULL,
 'admin,activation,alerts,ci_guard,ingestion,state_changing,idempotent,sql_only,slo,readback,no_provider_call,no_external_send,no_secrets',
 1,11876)
ON DUPLICATE KEY UPDATE
 display_name=VALUES(display_name), description=VALUES(description), http_method=VALUES(http_method),
 http_path=VALUES(http_path), path_param_keys=VALUES(path_param_keys), input_schema=VALUES(input_schema),
 fixed_body=VALUES(fixed_body), tags=VALUES(tags), is_enabled=VALUES(is_enabled), sort_order=VALUES(sort_order);
