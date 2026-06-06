-- Reproduce lifecycle owner engines that already exist in the live registry.
-- This migration only aligns registry metadata; it does not execute engine tasks.

INSERT INTO platform_engine_registry
  (engine_key, display_name, engine_type, runtime_key, supported_task_classes_json,
   capabilities_json, default_policy_key, status, notes)
VALUES
  (
    'developer_platform_lifecycle_engine',
    'Developer Platform Lifecycle Engine',
    'developer_platform',
    NULL,
    '["developer_app","request_envelope","proposal_discussion"]',
    '{"default_mode":"dry_run"}',
    'platform_engine_default_v1',
    'planned',
    'Owns developer app, request envelope, and proposal discussion metadata.'
  ),
  (
    'platform_contract_governance_engine',
    'Platform Contract Governance Engine',
    'schema_governance',
    NULL,
    '["contract_surface","contract_alias","contract_finding"]',
    '{"default_mode":"dry_run"}',
    'platform_engine_default_v1',
    'planned',
    'Owns platform contract graph/finding/relationship lifecycle metadata.'
  ),
  (
    'workflow_runtime_engine',
    'Workflow Runtime Engine',
    'workflow_runtime',
    NULL,
    '["workflow_registry","workflow_run","execution_plan","step_run"]',
    '{"default_mode":"dry_run"}',
    'platform_engine_default_v1',
    'planned',
    'Owns workflow, task route, execution plan and workflow run metadata.'
  )
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  engine_type = VALUES(engine_type),
  runtime_key = VALUES(runtime_key),
  supported_task_classes_json = VALUES(supported_task_classes_json),
  capabilities_json = VALUES(capabilities_json),
  default_policy_key = VALUES(default_policy_key),
  status = VALUES(status),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;
