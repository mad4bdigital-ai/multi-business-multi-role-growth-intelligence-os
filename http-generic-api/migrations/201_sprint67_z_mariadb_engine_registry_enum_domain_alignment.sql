-- Add the lifecycle engine type used by the next ordered registry seed.
-- Additive enum-domain alignment only; no engine task or provider execution.

ALTER TABLE platform_engine_registry
  MODIFY COLUMN engine_type ENUM(
    'repo_maintenance','schema_governance','runtime_readiness','provider_certification',
    'release_readiness','browser_runtime','local_device_repair','activation_validation',
    'workflow_runtime','generic','developer_platform'
  ) NOT NULL DEFAULT 'generic';
