-- Repository main movement release trigger coordinator.
-- Internal event ingestion, runtime verification, and advisory planning only.
-- No Release Operation, gate, capability envelope, queue job, deploy, restart, provider call, or external write.

CREATE TABLE IF NOT EXISTS repository_main_moved_trigger_events (
  trigger_event_id CHAR(36) NOT NULL,
  event_fingerprint_sha256 CHAR(64) NOT NULL,
  source_event_id VARCHAR(191) NOT NULL,
  outbox_event_id CHAR(36) NOT NULL,
  repository_full_name VARCHAR(255) NOT NULL,
  branch_name VARCHAR(191) NOT NULL,
  before_sha CHAR(40) NOT NULL,
  after_sha CHAR(40) NOT NULL,
  forced TINYINT(1) NOT NULL DEFAULT 0,
  deleted TINYINT(1) NOT NULL DEFAULT 0,
  environment_key VARCHAR(64) NOT NULL DEFAULT 'production',
  target_id CHAR(36) NULL,
  runtime_verification_run_id CHAR(36) NULL,
  release_advisor_run_id CHAR(36) NULL,
  coordination_status ENUM('received','verifying','evaluated','approval_required','no_action','blocked','failed','superseded') NOT NULL DEFAULT 'received',
  next_action_key VARCHAR(191) NOT NULL DEFAULT 'release.run_runtime_verification',
  summary_json JSON NULL,
  error_code VARCHAR(120) NULL,
  error_message VARCHAR(500) NULL,
  created_by VARCHAR(191) NOT NULL,
  occurred_at DATETIME(3) NOT NULL,
  completed_at DATETIME(3) NULL,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (trigger_event_id),
  UNIQUE KEY uq_repository_main_moved_fingerprint (event_fingerprint_sha256),
  UNIQUE KEY uq_repository_main_moved_outbox_event (outbox_event_id),
  KEY idx_repository_main_moved_status (environment_key, coordination_status, created_at),
  KEY idx_repository_main_moved_commit (repository_full_name, branch_name, after_sha),
  KEY idx_repository_main_moved_verification (runtime_verification_run_id),
  KEY idx_repository_main_moved_advisor (release_advisor_run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO platform_outbox_event_types
  (event_type, current_schema_version, producer_key, payload_classification,
   contains_pii, status, description)
VALUES
  ('repository.main_moved', 1, 'repository_main_moved_trigger_coordinator',
   'internal', 0, 'active',
   'Internal metadata-only event emitted when the allowlisted repository main branch moves. The coordinator runs runtime verification and advisory planning only; no execution authority is granted.')
ON DUPLICATE KEY UPDATE
  current_schema_version = GREATEST(current_schema_version, VALUES(current_schema_version)),
  producer_key = VALUES(producer_key),
  payload_classification = VALUES(payload_classification),
  contains_pii = VALUES(contains_pii),
  status = CASE WHEN status IN ('paused','retired') THEN status ELSE 'active' END,
  description = VALUES(description),
  updated_at = CURRENT_TIMESTAMP(6);

INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys,
   input_schema, fixed_body, tags, is_enabled, sort_order)
VALUES
  ('repository_main_moved_event_create','Create Repository Main Moved Event','Ingest one internal allowlisted main-branch movement event, run runtime verification, and create or deduplicate a Self-Healing Release Advisor plan. Stops at approval handoff and never executes a release.','POST','/admin/repository-main-moved-events',JSON_ARRAY(),JSON_OBJECT('type','object','required',JSON_ARRAY('source_event_id','repository','before_sha','after_sha'),'properties',JSON_OBJECT('source_event_id',JSON_OBJECT('type','string','maxLength',191),'repository',JSON_OBJECT('type','string','maxLength',255),'branch',JSON_OBJECT('type','string','enum',JSON_ARRAY('main','refs/heads/main'),'default','main'),'before_sha',JSON_OBJECT('type','string','pattern','^[0-9a-fA-F]{40}$'),'after_sha',JSON_OBJECT('type','string','pattern','^[0-9a-fA-F]{40}$'),'forced',JSON_OBJECT('type','boolean','default',false),'deleted',JSON_OBJECT('type','boolean','enum',JSON_ARRAY(false),'default',false),'environment_key',JSON_OBJECT('type','string','enum',JSON_ARRAY('production','staging'),'default','production'),'target_id',JSON_OBJECT('type','string','format','uuid'),'occurred_at',JSON_OBJECT('type','string','format','date-time')),'additionalProperties',false),NULL,'release_intelligence,repository_event,internal_write,idempotent,mutation_policy_required,readback,same_cycle_readback,no_execution,no_provider_call,no_external_write,no_secrets',1,6780),
  ('repository_main_moved_event_get','Get Repository Main Moved Event','Read one repository main movement coordination event and its bounded verification/advisor handoff summary.','GET','/admin/repository-main-moved-events/{triggerEventId}',JSON_ARRAY('triggerEventId'),JSON_OBJECT('type','object','required',JSON_ARRAY('triggerEventId'),'properties',JSON_OBJECT('triggerEventId',JSON_OBJECT('type','string','format','uuid')),'additionalProperties',false),NULL,'release_intelligence,repository_event,read_only,no_execution,no_provider_call,no_external_write,no_secrets',1,6781)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name), description=VALUES(description), http_method=VALUES(http_method),
  http_path=VALUES(http_path), path_param_keys=VALUES(path_param_keys), input_schema=VALUES(input_schema),
  fixed_body=VALUES(fixed_body), tags=VALUES(tags), is_enabled=VALUES(is_enabled), sort_order=VALUES(sort_order);

INSERT INTO execution_policies
  (policy_group, policy_key, policy_value, active, execution_scope, affects_layer, blocking, notes)
VALUES
  ('Release Intelligence Governance','repository_main_moved_trigger_policy_v1',
   JSON_OBJECT('rule','main_moved_may_verify_and_advise_but_never_execute','enforcement_mode','blocking','allowlisted_repository_required',true,'main_branch_only',true,'event_idempotency_required',true,'transactional_outbox_required',true,'runtime_verification_allowed',true,'advisor_planning_allowed',true,'release_operation_creation_forbidden',true,'gate_mutation_forbidden',true,'capability_envelope_creation_forbidden',true,'job_enqueue_forbidden',true,'deploy_forbidden',true,'restart_forbidden',true,'provider_calls_forbidden',true,'external_writes_forbidden',true,'execution_allowed',false,'typed_approval_required_for_future_execution',true,'same_cycle_readback_required',true,'secrets_included',false),
   'TRUE','repository_main_moved_event_create|repository_main_moved_event_get|gpt_tools_call|tool_dispatch',
   'repositoryMainMovedTriggerService|repositoryMainMovedTriggerRoutes|repository_main_moved_trigger_events|platform_outbox_events|runtime_verification_runs|release_advisor_runs',
   'TRUE','The coordinator may ingest an internal repository event, run verification, and create an advisory plan only. Any Release Operation, gate, capability envelope, queue job, deployment, restart, or provider action requires a later independent typed approval and governed workflow.')
ON DUPLICATE KEY UPDATE policy_value=VALUES(policy_value), active=VALUES(active), execution_scope=VALUES(execution_scope), affects_layer=VALUES(affects_layer), blocking=VALUES(blocking), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP;
