-- Resolve six persisted operational alerts after their source pending tasks were
-- completed and verified by 20260722_close_verified_high_operational_attention.sql.
--
-- Safety contract:
-- - exact alert_id + source_record_id targeting
-- - lifecycle_status=open guard
-- - internal lifecycle persistence only
-- - no provider call or external write
-- - no credential or secret payload read
-- - no schema change or destructive SQL
-- - secrets_included=false

UPDATE operational_alerts
SET lifecycle_status = 'resolved',
    lifecycle_revision = lifecycle_revision + 1,
    verification_state = 'verified',
    evidence_type = 'completed_source_task_readback',
    evidence_ref = 'task://8fbb84a1-61a9-11f1-8ecd-456940024c79',
    evidence_json = JSON_SET(
      COALESCE(evidence_json, JSON_OBJECT()),
      '$.source_task_status', 'done',
      '$.source_task_resolution_classification', 'superseded',
      '$.source_task_resolution_reason', 'production_uses_github_main_auto_deploy',
      '$.source_task_updated_by', 'migration:20260722_close_verified_high_operational_attention',
      '$.resolution_verified', TRUE,
      '$.migration_provider_call_executed', FALSE,
      '$.migration_external_write_executed', FALSE,
      '$.secrets_included', FALSE
    ),
    lifecycle_actor = 'migration:20260722_resolve_persisted_completed_task_alerts',
    lifecycle_note = 'Resolved after source task readback confirmed the Hostinger SSH target probe was superseded by the active GitHub main auto-deploy production path.',
    resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
    resolution_note = 'Source task is done with blocker_level=none and classification=superseded.',
    secrets_included = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE alert_id = '0caaa888-3da1-4db1-93fe-07ba2b00cc13'
  AND source_record_id = '8fbb84a1-61a9-11f1-8ecd-456940024c79'
  AND lifecycle_status = 'open';

UPDATE operational_alerts
SET lifecycle_status = 'resolved',
    lifecycle_revision = lifecycle_revision + 1,
    verification_state = 'verified',
    evidence_type = 'completed_source_task_readback',
    evidence_ref = 'task://527cafca-61b9-11f1-8ecd-456940024c79',
    evidence_json = JSON_SET(
      COALESCE(evidence_json, JSON_OBJECT()),
      '$.source_task_status', 'done',
      '$.source_task_resolution_classification', 'superseded',
      '$.source_task_resolution_reason', 'credential_handoff_not_required_for_github_main_auto_deploy',
      '$.source_task_updated_by', 'migration:20260722_close_verified_high_operational_attention',
      '$.resolution_verified', TRUE,
      '$.migration_provider_call_executed', FALSE,
      '$.migration_external_write_executed', FALSE,
      '$.secrets_included', FALSE
    ),
    lifecycle_actor = 'migration:20260722_resolve_persisted_completed_task_alerts',
    lifecycle_note = 'Resolved after source task readback confirmed credential intake is not required for the active GitHub main auto-deploy production path.',
    resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
    resolution_note = 'Source task is done with blocker_level=none and classification=superseded.',
    secrets_included = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE alert_id = '239736b0-26e0-492b-8cef-f77731b263b2'
  AND source_record_id = '527cafca-61b9-11f1-8ecd-456940024c79'
  AND lifecycle_status = 'open';

UPDATE operational_alerts
SET lifecycle_status = 'resolved',
    lifecycle_revision = lifecycle_revision + 1,
    verification_state = 'verified',
    evidence_type = 'completed_source_task_readback',
    evidence_ref = 'task://90cb38e5-618e-11f1-8ecd-456940024c79',
    evidence_json = JSON_SET(
      COALESCE(evidence_json, JSON_OBJECT()),
      '$.source_task_status', 'done',
      '$.source_task_resolution_classification', 'verified_complete',
      '$.source_task_resolution_reason', 'openclaude_bridge_ready_for_live_provider_dispatch',
      '$.source_task_updated_by', 'migration:20260722_close_verified_high_operational_attention',
      '$.resolution_verified', TRUE,
      '$.migration_provider_call_executed', FALSE,
      '$.migration_external_write_executed', FALSE,
      '$.secrets_included', FALSE
    ),
    lifecycle_actor = 'migration:20260722_resolve_persisted_completed_task_alerts',
    lifecycle_note = 'Resolved after source task readback confirmed OpenClaude bridge readiness for live provider dispatch.',
    resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
    resolution_note = 'Source task is done with blocker_level=none and classification=verified_complete.',
    secrets_included = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE alert_id = '52f68ac6-7e1d-4d31-977b-cb74085b43f2'
  AND source_record_id = '90cb38e5-618e-11f1-8ecd-456940024c79'
  AND lifecycle_status = 'open';

UPDATE operational_alerts
SET lifecycle_status = 'resolved',
    lifecycle_revision = lifecycle_revision + 1,
    verification_state = 'verified',
    evidence_type = 'completed_source_task_readback',
    evidence_ref = 'task://b7667095-61cd-11f1-8ecd-456940024c79',
    evidence_json = JSON_SET(
      COALESCE(evidence_json, JSON_OBJECT()),
      '$.source_task_status', 'done',
      '$.source_task_resolution_classification', 'superseded',
      '$.source_task_resolution_reason', 'production_uses_github_main_auto_deploy',
      '$.source_task_updated_by', 'migration:20260722_close_verified_high_operational_attention',
      '$.resolution_verified', TRUE,
      '$.migration_provider_call_executed', FALSE,
      '$.migration_external_write_executed', FALSE,
      '$.secrets_included', FALSE
    ),
    lifecycle_actor = 'migration:20260722_resolve_persisted_completed_task_alerts',
    lifecycle_note = 'Resolved after source task readback confirmed Hostinger SSH password authentication is not part of the normal production update path.',
    resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
    resolution_note = 'Source task is done with blocker_level=none and classification=superseded.',
    secrets_included = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE alert_id = '5efecea9-bb01-49ea-99fd-534dba5bbc5e'
  AND source_record_id = 'b7667095-61cd-11f1-8ecd-456940024c79'
  AND lifecycle_status = 'open';

UPDATE operational_alerts
SET lifecycle_status = 'resolved',
    lifecycle_revision = lifecycle_revision + 1,
    verification_state = 'verified',
    evidence_type = 'completed_source_task_readback',
    evidence_ref = 'task://3fa74909-64af-11f1-8ecd-456940024c79',
    evidence_json = JSON_SET(
      COALESCE(evidence_json, JSON_OBJECT()),
      '$.source_task_status', 'done',
      '$.source_task_resolution_classification', 'policy_disabled_by_design',
      '$.source_task_resolution_reason', 'execution_enablement_intentionally_disabled',
      '$.source_task_updated_by', 'migration:20260722_close_verified_high_operational_attention',
      '$.resolution_verified', TRUE,
      '$.migration_provider_call_executed', FALSE,
      '$.migration_external_write_executed', FALSE,
      '$.secrets_included', FALSE
    ),
    lifecycle_actor = 'migration:20260722_resolve_persisted_completed_task_alerts',
    lifecycle_note = 'Resolved after source task readback confirmed Google Ads execution remains intentionally disabled by policy.',
    resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
    resolution_note = 'Source task is done with blocker_level=none and classification=policy_disabled_by_design; no activation was performed.',
    secrets_included = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE alert_id = '8e36b98d-0424-4600-b3b8-e662fcb56baa'
  AND source_record_id = '3fa74909-64af-11f1-8ecd-456940024c79'
  AND lifecycle_status = 'open';

UPDATE operational_alerts
SET lifecycle_status = 'resolved',
    lifecycle_revision = lifecycle_revision + 1,
    verification_state = 'verified',
    evidence_type = 'completed_source_task_readback',
    evidence_ref = 'task://22a15347-619d-11f1-8ecd-456940024c79',
    evidence_json = JSON_SET(
      COALESCE(evidence_json, JSON_OBJECT()),
      '$.source_task_status', 'done',
      '$.source_task_resolution_classification', 'superseded',
      '$.source_task_resolution_reason', 'ssh_deploy_executor_retained_as_break_glass_not_normal_update_path',
      '$.source_task_updated_by', 'migration:20260722_close_verified_high_operational_attention',
      '$.resolution_verified', TRUE,
      '$.migration_provider_call_executed', FALSE,
      '$.migration_external_write_executed', FALSE,
      '$.secrets_included', FALSE
    ),
    lifecycle_actor = 'migration:20260722_resolve_persisted_completed_task_alerts',
    lifecycle_note = 'Resolved after source task readback confirmed the SSH deploy executor is retained for break-glass use rather than normal production updates.',
    resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
    resolution_note = 'Source task is done with blocker_level=none and classification=superseded.',
    secrets_included = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE alert_id = '9f1d3538-76f9-4579-9308-16b7a2fb7a97'
  AND source_record_id = '22a15347-619d-11f1-8ecd-456940024c79'
  AND lifecycle_status = 'open';
