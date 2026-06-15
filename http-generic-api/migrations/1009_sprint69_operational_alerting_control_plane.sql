-- Sprint 69: Unified Operational Alerting Control Plane.
-- SQL-primary, evidence-linked, tenant-scoped, additive only, no provider calls, no external sends, no secrets.

CREATE TABLE IF NOT EXISTS operational_alert_rule_registry (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  rule_key VARCHAR(191) NOT NULL UNIQUE,
  source_type VARCHAR(128) NOT NULL,
  condition_key VARCHAR(191) NOT NULL,
  severity ENUM('info','low','medium','high','critical') NOT NULL DEFAULT 'medium',
  reason_code VARCHAR(191) NOT NULL,
  recommended_action_key VARCHAR(191) NULL,
  requires_confirmation TINYINT(1) NOT NULL DEFAULT 0,
  lookback_hours INT UNSIGNED NOT NULL DEFAULT 168,
  dedupe_scope ENUM('global','tenant','workspace','user','record') NOT NULL DEFAULT 'record',
  status ENUM('active','pending','deprecated','archived') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_operational_alert_rule_source (source_type, status),
  INDEX idx_operational_alert_rule_severity (severity, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS operational_alert_sync_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  sync_run_id VARCHAR(36) NOT NULL UNIQUE,
  tenant_id VARCHAR(64) NULL,
  user_id VARCHAR(64) NULL,
  requested_by VARCHAR(191) NULL,
  sync_status ENUM('running','completed','completed_degraded','failed') NOT NULL DEFAULT 'running',
  source_health_json JSON NULL,
  candidate_count INT UNSIGNED NOT NULL DEFAULT 0,
  upserted_count INT UNSIGNED NOT NULL DEFAULT 0,
  resolved_count INT UNSIGNED NOT NULL DEFAULT 0,
  notification_queued_count INT UNSIGNED NOT NULL DEFAULT 0,
  degraded_source_count INT UNSIGNED NOT NULL DEFAULT 0,
  error_code VARCHAR(191) NULL,
  error_message TEXT NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_operational_alert_sync_subject (tenant_id, user_id, started_at),
  INDEX idx_operational_alert_sync_status (sync_status, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS operational_alerts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  alert_id VARCHAR(36) NOT NULL UNIQUE,
  alert_key VARCHAR(191) NOT NULL UNIQUE,
  fingerprint_sha256 CHAR(64) NOT NULL,
  tenant_id VARCHAR(64) NULL,
  user_id VARCHAR(64) NULL,
  workspace_id VARCHAR(64) NULL,
  container_key VARCHAR(220) NULL,
  source_type VARCHAR(128) NOT NULL,
  source_ref VARCHAR(255) NULL,
  source_record_id VARCHAR(191) NULL,
  category VARCHAR(128) NOT NULL DEFAULT 'operational',
  severity ENUM('info','low','medium','high','critical') NOT NULL DEFAULT 'medium',
  title VARCHAR(512) NOT NULL,
  summary TEXT NULL,
  reason_code VARCHAR(191) NOT NULL,
  lifecycle_status ENUM('open','acknowledged','investigating','resolved','ignored') NOT NULL DEFAULT 'open',
  verification_state ENUM('unverified','observed','verified','not_reproduced') NOT NULL DEFAULT 'observed',
  evidence_type VARCHAR(128) NULL,
  evidence_ref VARCHAR(255) NULL,
  evidence_json JSON NULL,
  execution_log_id BIGINT UNSIGNED NULL,
  trace_id VARCHAR(255) NULL,
  occurrence_count INT UNSIGNED NOT NULL DEFAULT 1,
  first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_sync_run_id VARCHAR(36) NULL,
  recommended_action_key VARCHAR(191) NULL,
  requires_confirmation TINYINT(1) NOT NULL DEFAULT 0,
  manual_known_issue TINYINT(1) NOT NULL DEFAULT 0,
  lifecycle_actor VARCHAR(191) NULL,
  lifecycle_note TEXT NULL,
  acknowledged_at DATETIME NULL,
  resolved_at DATETIME NULL,
  resolution_note TEXT NULL,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_operational_alert_scope (tenant_id, user_id, lifecycle_status, severity),
  INDEX idx_operational_alert_workspace (workspace_id, lifecycle_status, severity),
  INDEX idx_operational_alert_source (source_type, reason_code, lifecycle_status),
  INDEX idx_operational_alert_trace (execution_log_id, trace_id),
  INDEX idx_operational_alert_sync (last_sync_run_id),
  INDEX idx_operational_alert_seen (last_seen_at, lifecycle_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS operational_alert_notification_outbox (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  notification_id VARCHAR(36) NOT NULL UNIQUE,
  notification_key VARCHAR(255) NOT NULL UNIQUE,
  alert_id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NULL,
  user_id VARCHAR(64) NULL,
  channel ENUM('in_app','email','webhook') NOT NULL DEFAULT 'in_app',
  recipient_scope VARCHAR(128) NOT NULL DEFAULT 'authorized_subject',
  delivery_status ENUM('pending','processing','delivered','failed','skipped') NOT NULL DEFAULT 'pending',
  payload_summary_json JSON NULL,
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  last_attempt_at DATETIME NULL,
  delivered_at DATETIME NULL,
  error_code VARCHAR(191) NULL,
  error_message TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_operational_alert_outbox_status (delivery_status, channel, created_at),
  INDEX idx_operational_alert_outbox_subject (tenant_id, user_id, created_at),
  CONSTRAINT fk_operational_alert_outbox_alert FOREIGN KEY (alert_id) REFERENCES operational_alerts(alert_id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO operational_alert_rule_registry
(rule_key, source_type, condition_key, severity, reason_code, recommended_action_key, requires_confirmation, lookback_hours, dedupe_scope, status)
VALUES
('alert_execution_failed','execution_log','execution_status=failed','critical','execution_failed','execution.review_failure',0,168,'workspace','active'),
('alert_execution_degraded','execution_log','execution_status=degraded','high','execution_degraded','execution.review_failure',0,168,'workspace','active'),
('alert_execution_blocked_choice','execution_log','execution_status=blocked_with_choice_required','critical','execution_blocked_with_choice_required','execution.review_choice',1,168,'record','active'),
('alert_execution_warning','execution_log','execution_status IN success_with_warnings,passed_with_follow_up','high','execution_warning','execution.review_failure',0,168,'workspace','active'),
('alert_connector_error','connected_systems','status=error','high','connector_error','connector.reconnect_or_review',1,168,'record','active'),
('alert_connector_pending','connected_systems','status=pending','medium','connector_pending','connector.complete_setup',0,168,'record','active'),
('alert_task_blocked','v_activation_pending_tasks','task_status=blocked OR blocker_level=hard','critical','task_blocked','task.review_blocker',0,168,'record','active'),
('alert_agent_unhealthy','v_activation_agent_catalog','health_status IN offline,degraded','high','agent_unhealthy','agent.health_review',0,168,'record','active'),
('alert_skill_approval','v_activation_agent_skill_grants','requires_approval=1','medium','skill_requires_approval','skill.review_approval',1,168,'record','active'),
('alert_freshness','activation_freshness_ledger','freshness_status IN stale,failed','high','freshness_attention','surface.refresh',0,168,'record','active'),
('alert_external_signal','activation_signal_inbox','severity IN critical,high AND signal_status IN new,failed','high','external_signal_attention','signal.review',0,168,'record','active'),
('alert_readiness','readiness_checks','check_status IN fail,warn,pending','high','readiness_attention','readiness.review',0,168,'record','active'),
('alert_telemetry','telemetry_spans','status IN error,timeout','high','telemetry_attention','telemetry.review_trace',0,168,'workspace','active')
ON DUPLICATE KEY UPDATE
 source_type=VALUES(source_type), condition_key=VALUES(condition_key), severity=VALUES(severity),
 reason_code=VALUES(reason_code), recommended_action_key=VALUES(recommended_action_key),
 requires_confirmation=VALUES(requires_confirmation), lookback_hours=VALUES(lookback_hours),
 dedupe_scope=VALUES(dedupe_scope), status=VALUES(status);

INSERT INTO operational_alerts
(alert_id, alert_key, fingerprint_sha256, source_type, source_ref, source_record_id,
 category, severity, title, summary, reason_code, lifecycle_status, verification_state,
 evidence_type, evidence_ref, evidence_json, occurrence_count, first_seen_at, last_seen_at,
 recommended_action_key, requires_confirmation, manual_known_issue, secrets_included)
VALUES
(UUID(),'known.pr_checks_manual_dispatch',SHA2('known.pr_checks_manual_dispatch',256),'known_issue','work-session://2026-06-14','pr-checks-manual-dispatch','delivery_reliability','high','Required PR checks did not start automatically','Required GitHub checks entered action_required or missing state and needed a governed manual workflow dispatch.','pr_checks_manual_dispatch','open','verified','github_workflow_state','work-session://2026-06-14',JSON_OBJECT('observed',true,'permanent_fix_required',true,'no_secret_evidence',true),1,'2026-06-14 21:00:00','2026-06-14 21:00:00','github_actions.repair_auto_trigger',0,1,0),
(UUID(),'known.deploy_operation_intent_mismatch',SHA2('known.deploy_operation_intent_mismatch',256),'known_issue','work-session://2026-06-14','deploy-operation-intent-mismatch','policy_contract','high','Deploy operation intent mismatched the active policy','The envelope used deploy_release while the active apply policy required deploy.','deploy_operation_intent_mismatch','open','verified','policy_envelope_readback','work-session://2026-06-14',JSON_OBJECT('observed',true,'expected_operation_intent','deploy','received_operation_intent','deploy_release'),1,'2026-06-14 21:30:00','2026-06-14 21:30:00','policy.align_deploy_intent',0,1,0),
(UUID(),'known.db_update_result_serialization',SHA2('known.db_update_result_serialization',256),'known_issue','work-session://2026-06-14','db-update-result-serialization','api_contract','high','Single-statement DB UPDATE results are not serialized reliably','A single UPDATE returned a blank tool error while UPDATE followed by SELECT 1 returned bounded affected-row evidence.','db_update_result_serialization','open','verified','admin_control_behavior','work-session://2026-06-14',JSON_OBJECT('observed',true,'workaround','multi_statement_update_plus_select_one','permanent_fix_required',true),1,'2026-06-14 21:40:00','2026-06-14 21:40:00','admin_control.fix_mutation_serialization',0,1,0),
(UUID(),'known.capability_envelope_lifecycle_tool_gap',SHA2('known.capability_envelope_lifecycle_tool_gap',256),'known_issue','tool-catalog://capability-envelope','capability-envelope-lifecycle-tool-gap','governance_gap','high','Capability envelopes lack a governed consume, cancel, or expire lifecycle tool','Operators currently need indirect state handling instead of an explicit audited lifecycle action.','capability_envelope_lifecycle_tool_gap','open','verified','tool_catalog','tool-catalog://capability-envelope',JSON_OBJECT('observed',true,'missing_actions',JSON_ARRAY('consume','cancel','expire')),1,'2026-06-14 21:45:00','2026-06-14 21:45:00','capability_envelope.add_lifecycle_tool',1,1,0),
(UUID(),'known.hostinger_restart_transient_503',SHA2('known.hostinger_restart_transient_503',256),'known_issue','work-session://2026-06-14','hostinger-restart-transient-503','deployment_reliability','high','Production deploy restart can return a transient HTML 503','The deployment result became indeterminate until health and commit SHA readbacks proved success.','hostinger_restart_transient_503','acknowledged','verified','deployment_response_and_readback','work-session://2026-06-14',JSON_OBJECT('observed',true,'readback_required',true,'desired_fix','durable_deployment_job_receipt'),1,'2026-06-14 22:30:00','2026-06-14 22:30:00','deployment.add_durable_job_receipt',0,1,0),
(UUID(),'known.main_sha_pin_race',SHA2('known.main_sha_pin_race',256),'known_issue','work-session://2026-06-14','main-sha-pin-race','deployment_reliability','high','Main can advance after deployment SHA is pinned','The safety gate correctly reset on SHA mismatch, but pin and revalidation are not atomic.','main_sha_pin_race','open','verified','git_readback','work-session://2026-06-14',JSON_OBJECT('observed',true,'safety_gate_worked',true,'atomic_revalidation_required',true),1,'2026-06-14 22:00:00','2026-06-14 22:00:00','deployment.atomic_sha_revalidation',0,1,0),
(UUID(),'known.process_local_feature_flag_scope',SHA2('known.process_local_feature_flag_scope',256),'known_issue','work-session://2026-06-14','process-local-feature-flag-scope','runtime_configuration','medium','Process-local feature flag changes do not reach separate workers','An environment change applied to one request process did not affect the deployment worker process.','process_local_feature_flag_scope','open','verified','runtime_readback','work-session://2026-06-14',JSON_OBJECT('observed',true,'desired_fix','shared_governed_runtime_config'),1,'2026-06-14 22:05:00','2026-06-14 22:05:00','runtime_config.use_shared_authority',0,1,0),
(UUID(),'known.response_chunk_cache_expiry',SHA2('known.response_chunk_cache_expiry',256),'known_issue','work-session://2026-06-14','response-chunk-cache-expiry','tool_reliability','medium','Large response chunks can expire before complete consumption','A release-readiness continuation chunk expired before all details were read.','response_chunk_cache_expiry','open','verified','tool_response_cache','work-session://2026-06-14',JSON_OBJECT('observed',true,'desired_fix','durable_summary_or_longer_ttl'),1,'2026-06-14 22:10:00','2026-06-14 22:10:00','tool_response.improve_chunk_durability',0,1,0),
(UUID(),'known.transient_error_envelope_inconsistency',SHA2('known.transient_error_envelope_inconsistency',256),'known_issue','work-session://2026-06-14','transient-error-envelope-inconsistency','api_contract','medium','Transient failures do not always use structured error envelopes','Observed HTML 503, 502 responses, and a temporary module-not-found error despite the file being present.','transient_error_envelope_inconsistency','open','verified','runtime_errors','work-session://2026-06-14',JSON_OBJECT('observed',true,'examples',JSON_ARRAY('502','html_503','transient_module_not_found'),'correlation_id_required',true),1,'2026-06-14 22:15:00','2026-06-14 22:15:00','errors.standardize_transient_envelopes',0,1,0),
(UUID(),'known.repo_patch_exact_match_fragility',SHA2('known.repo_patch_exact_match_fragility',256),'known_issue','work-session://2026-06-14','repo-patch-exact-match-fragility','developer_experience','medium','Repository block replacement is fragile to exact whitespace','A safe patch was rejected because the exact source formatting differed from the replacement anchor.','repo_patch_exact_match_fragility','open','verified','repo_patch_behavior','work-session://2026-06-14',JSON_OBJECT('observed',true,'desired_fix','context_or_ast_aware_patch'),1,'2026-06-14 21:20:00','2026-06-14 21:20:00','repo_patch.add_context_aware_mode',0,1,0),
(UUID(),'known.github_rest_fallback_coverage_gap',SHA2('known.github_rest_fallback_coverage_gap',256),'known_issue','work-session://2026-06-14','github-rest-fallback-coverage-gap','provider_adapter','medium','GitHub REST fallback mappings are incomplete','Some governed GitHub operations returned incomplete data and required GraphQL or alternate governed tools.','github_rest_fallback_coverage_gap','open','verified','github_adapter_behavior','work-session://2026-06-14',JSON_OBJECT('observed',true,'fallback_expansion_required',true),1,'2026-06-14 21:25:00','2026-06-14 21:25:00','github_adapter.expand_fallback_coverage',0,1,0)
ON DUPLICATE KEY UPDATE
 severity=VALUES(severity), title=VALUES(title), summary=VALUES(summary), reason_code=VALUES(reason_code),
 verification_state=VALUES(verification_state), evidence_type=VALUES(evidence_type), evidence_ref=VALUES(evidence_ref),
 evidence_json=VALUES(evidence_json), recommended_action_key=VALUES(recommended_action_key),
 requires_confirmation=VALUES(requires_confirmation), manual_known_issue=1, updated_at=CURRENT_TIMESTAMP;

INSERT INTO activation_delivery_policy_registry
(policy_key, surface_key_like, source_table_like, delivery_mode, dedupe_scope,
 inline_priority, max_inline_rows, max_inline_bytes, supports_cursor, cache_ttl_seconds,
 response_profiles_json, priority_order, status)
VALUES
('activation.operational.alerts',NULL,'operational_alerts','attention_first','tenant',5,20,30000,1,30,JSON_ARRAY('evidence','summary','dashboard','diagnostic','full'),5,'active')
ON DUPLICATE KEY UPDATE
 source_table_like=VALUES(source_table_like), delivery_mode=VALUES(delivery_mode), dedupe_scope=VALUES(dedupe_scope),
 inline_priority=VALUES(inline_priority), max_inline_rows=VALUES(max_inline_rows),
 max_inline_bytes=VALUES(max_inline_bytes), supports_cursor=VALUES(supports_cursor),
 cache_ttl_seconds=VALUES(cache_ttl_seconds), response_profiles_json=VALUES(response_profiles_json),
 priority_order=VALUES(priority_order), status=VALUES(status);

INSERT INTO activation_operational_tile_registry
(tile_key, provider_family, connector_family, scope_class, display_name, description, category,
 default_visibility, source_mode, status_callback_key, freshness_sla_seconds, priority_order, risk_level, status)
VALUES
('operational_alert_center','platform','operational_alerts','mixed','Operational Alert Center',
 'Unified current and known issues with evidence, severity, lifecycle, notification readiness, and governed actions.',
 'observability','owner_and_admin','platform_native','operational.alerts.read',30,4,'high','active')
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
('operational.alerts.read','operational_alert_center','platform','operational_alerts',
 'activation.operational.alerts.read','activation_operational_attention_read_api','GET /activation/operational-attention','read_only',
 JSON_ARRAY('platform_native'),JSON_OBJECT('returns',JSON_ARRAY('summary','final_result','completeness','source_health'),'all_known_issues_visible',true,'cursor_pagination',true,'secrets_included',false),NULL,30,4,'active'),
('operational.alerts.sync','operational_alert_center','platform','operational_alerts',
 'activation.operational.alerts.sync','activation_operational_attention_sync_api','POST /activation/operational-attention/sync','write_requires_confirmation',
 JSON_ARRAY('platform_native'),JSON_OBJECT('returns',JSON_ARRAY('sync_run_id','counts','readback'),'provider_calls',false,'external_send',false,'secrets_included',false),NULL,30,5,'active')
ON DUPLICATE KEY UPDATE
 tile_key=VALUES(tile_key), runtime_action_key=VALUES(runtime_action_key), endpoint_selector=VALUES(endpoint_selector),
 safe_mode=VALUES(safe_mode), allowed_sources_json=VALUES(allowed_sources_json),
 output_contract_json=VALUES(output_contract_json), freshness_sla_seconds=VALUES(freshness_sla_seconds),
 priority_order=VALUES(priority_order), status=VALUES(status);

INSERT INTO admin_platform_endpoint_tools
(tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order)
VALUES
('activation_operational_attention_read_api','Read Unified Operational Alerts','Read every matching current and known operational problem from SQL evidence sources and the alert lifecycle store. Supports up to 1000 rows, explicit completeness, and no silent omission.','GET','/activation/operational-attention',JSON_ARRAY(),JSON_OBJECT('type','object','additionalProperties',false,'properties',JSON_OBJECT('cursor',JSON_OBJECT('type','integer','minimum',0),'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',1000,'default',500),'lookback_hours',JSON_OBJECT('type','integer','minimum',1,'maximum',2160,'default',168),'include_resolved',JSON_OBJECT('type','boolean','default',false),'severity',JSON_OBJECT('type','string','enum',JSON_ARRAY('info','low','medium','high','critical')),'source_type',JSON_OBJECT('type','string'),'lifecycle_status',JSON_OBJECT('type','string','enum',JSON_ARRAY('open','acknowledged','investigating','resolved','ignored')),'q',JSON_OBJECT('type','string'))),NULL,'admin,activation,alerts,attention,execution_log,evidence,known_issues,read_only,cursor_pagination,no_secrets',1,11873),
('activation_operational_attention_sync_api','Synchronize Unified Operational Alerts','Evaluate live SQL evidence sources, upsert alert lifecycle rows, auto-resolve disappeared automatic alerts, queue in-app notifications, and return a same-cycle complete readback. No provider calls or external sends.','POST','/activation/operational-attention/sync',JSON_ARRAY(),JSON_OBJECT('type','object','additionalProperties',false,'properties',JSON_OBJECT('lookback_hours',JSON_OBJECT('type','integer','minimum',1,'maximum',2160,'default',168),'requested_by',JSON_OBJECT('type','string'))),NULL,'admin,activation,alerts,sync,state_changing,sql_only,in_app_notification,no_provider_call,no_external_send,no_secrets',1,11874),
('activation_operational_alert_lifecycle_api','Update Operational Alert Lifecycle','Acknowledge, investigate, resolve, ignore, or reopen one operational alert with actor and note readback.','POST','/activation/operational-attention/{alertId}/lifecycle',JSON_ARRAY('alertId'),JSON_OBJECT('type','object','required',JSON_ARRAY('lifecycle_status'),'additionalProperties',false,'properties',JSON_OBJECT('lifecycle_status',JSON_OBJECT('type','string','enum',JSON_ARRAY('open','acknowledged','investigating','resolved','ignored')),'actor',JSON_OBJECT('type','string'),'note',JSON_OBJECT('type','string'))),NULL,'admin,activation,alerts,lifecycle,state_changing,audited,no_secrets',1,11875)
ON DUPLICATE KEY UPDATE
 display_name=VALUES(display_name), description=VALUES(description), http_method=VALUES(http_method),
 http_path=VALUES(http_path), path_param_keys=VALUES(path_param_keys), input_schema=VALUES(input_schema),
 fixed_body=VALUES(fixed_body), tags=VALUES(tags), is_enabled=VALUES(is_enabled), sort_order=VALUES(sort_order);

INSERT INTO tenant_platform_endpoint_tools
(tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order)
VALUES
('tenant_activation_operational_attention_read_api','Read Tenant Operational Alerts','Read every matching current and known tenant-visible operational problem. Tenant scope is derived from active JWT membership.','GET','/tenant/activation/operational-attention',JSON_ARRAY(),JSON_OBJECT('type','object','additionalProperties',false,'properties',JSON_OBJECT('cursor',JSON_OBJECT('type','integer','minimum',0),'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',1000,'default',500),'lookback_hours',JSON_OBJECT('type','integer','minimum',1,'maximum',2160,'default',168),'include_resolved',JSON_OBJECT('type','boolean','default',false),'severity',JSON_OBJECT('type','string','enum',JSON_ARRAY('info','low','medium','high','critical')),'source_type',JSON_OBJECT('type','string'),'lifecycle_status',JSON_OBJECT('type','string'),'q',JSON_OBJECT('type','string'))),NULL,'tenant,activation,alerts,attention,evidence,read_only,cursor_pagination,no_secrets',1,1062)
ON DUPLICATE KEY UPDATE
 display_name=VALUES(display_name), description=VALUES(description), http_method=VALUES(http_method),
 http_path=VALUES(http_path), path_param_keys=VALUES(path_param_keys), input_schema=VALUES(input_schema),
 fixed_body=VALUES(fixed_body), tags=VALUES(tags), is_enabled=VALUES(is_enabled), sort_order=VALUES(sort_order);

CREATE OR REPLACE VIEW v_operational_alerts_open AS
SELECT alert_id, alert_key, tenant_id, user_id, workspace_id, container_key, source_type,
       source_ref, category, severity, title, summary, reason_code, lifecycle_status,
       verification_state, evidence_type, evidence_ref, execution_log_id, trace_id,
       occurrence_count, first_seen_at, last_seen_at, recommended_action_key,
       requires_confirmation, manual_known_issue, updated_at
  FROM operational_alerts
 WHERE lifecycle_status IN ('open','acknowledged','investigating');
