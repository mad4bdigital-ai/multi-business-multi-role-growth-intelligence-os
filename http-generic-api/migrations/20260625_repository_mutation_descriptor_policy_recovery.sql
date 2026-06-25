-- Repository mutation descriptor-policy recovery after PR #1912.
-- Additive and idempotent. Keeps explicit mutation classification fail-closed.
-- No provider calls, external writes, credential reads, or secrets.

UPDATE `admin_platform_endpoint_tools`
SET `tags` = CONCAT_WS(',',
  NULLIF(TRIM(BOTH ',' FROM COALESCE(`tags`, '')), ''),
  IF(FIND_IN_SET('state_changing', REPLACE(COALESCE(`tags`, ''), ' ', '')) = 0, 'state_changing', NULL),
  IF(FIND_IN_SET('readback', REPLACE(COALESCE(`tags`, ''), ' ', '')) = 0, 'readback', NULL),
  IF(FIND_IN_SET('no_execution', REPLACE(COALESCE(`tags`, ''), ' ', '')) = 0, 'no_execution', NULL),
  IF(FIND_IN_SET('no_secrets', REPLACE(COALESCE(`tags`, ''), ' ', '')) = 0, 'no_secrets', NULL)
),
`updated_at` = CURRENT_TIMESTAMP
WHERE `tool_key` = 'capability_resolution_envelope_create';

UPDATE `admin_platform_endpoint_tools`
SET `tags` = CONCAT_WS(',',
  NULLIF(TRIM(BOTH ',' FROM COALESCE(`tags`, '')), ''),
  IF(FIND_IN_SET('state_changing', REPLACE(COALESCE(`tags`, ''), ' ', '')) = 0, 'state_changing', NULL),
  IF(FIND_IN_SET('approval_required', REPLACE(COALESCE(`tags`, ''), ' ', '')) = 0, 'approval_required', NULL),
  IF(FIND_IN_SET('readback', REPLACE(COALESCE(`tags`, ''), ' ', '')) = 0, 'readback', NULL),
  IF(FIND_IN_SET('no_execution', REPLACE(COALESCE(`tags`, ''), ' ', '')) = 0, 'no_execution', NULL),
  IF(FIND_IN_SET('no_secrets', REPLACE(COALESCE(`tags`, ''), ' ', '')) = 0, 'no_secrets', NULL)
),
`updated_at` = CURRENT_TIMESTAMP
WHERE `tool_key` = 'capability_resolution_envelope_approve';

INSERT INTO `execution_policies`
  (`policy_group`, `policy_key`, `policy_value`, `active`, `execution_scope`, `affects_layer`, `blocking`, `notes`)
VALUES
  (
    'Repository Mutation Governance',
    'Repository Mutation Descriptor Recovery Contract',
    JSON_OBJECT(
      'rule', 'repository_mutation_descriptor_policy_alignment_is_preferred_permanent_repair',
      'enforcement_mode', 'blocking',
      'source_regression_pull_request', 1912,
      'fail_closed_guard_remains_enabled', TRUE,
      'preferred_repair_strategy', 'sql_registry_descriptor_and_execution_policy_alignment',
      'generic_admin_control_bypass_forbidden', TRUE,
      'db_backed_descriptor_tools', JSON_ARRAY(
        'capability_resolution_envelope_create',
        'capability_resolution_envelope_approve'
      ),
      'virtual_descriptor_tools', JSON_ARRAY(
        'repo_patch_apply',
        'repo_patch_batch_apply'
      ),
      'required_declared_policy_tags', JSON_OBJECT(
        'repo_patch_apply', JSON_ARRAY('capability_envelope', 'readback'),
        'repo_patch_batch_apply', JSON_ARRAY('capability_envelope', 'readback'),
        'capability_resolution_envelope_create', JSON_ARRAY('readback', 'no_execution'),
        'capability_resolution_envelope_approve', JSON_ARRAY('approval_required', 'readback', 'no_execution')
      ),
      'repair_order', JSON_ARRAY(
        'inspect_sql_and_virtual_descriptors',
        'align_sql_descriptor_tags',
        'verify_execution_policy',
        'patch_virtual_descriptor_in_repository',
        'run_same_cycle_readback',
        'retry_original_operation'
      ),
      'disable_guard_as_repair', FALSE,
      'allow_unscoped_mutation', FALSE,
      'secrets_included', FALSE
    ),
    'TRUE',
    'repo_mutation|repo_patch_apply|repo_patch_batch_apply|capability_resolution_envelope_create|capability_resolution_envelope_approve|gpt_tools_call|tool_dispatch',
    'admin_platform_endpoint_tools|virtual_admin_tools|gptToolsRoutes|governedExecutionPreflight|repo_patch_apply|capability_resolution_envelope_ledger',
    'TRUE',
    'Permanent recovery policy after PR #1912. Prefer SQL registry alignment for DB-backed descriptors and repository patching for virtual descriptors; never disable fail-closed or open generic admin_control as a bypass.'
  )
ON DUPLICATE KEY UPDATE
  `policy_value` = VALUES(`policy_value`),
  `active` = VALUES(`active`),
  `execution_scope` = VALUES(`execution_scope`),
  `affects_layer` = VALUES(`affects_layer`),
  `blocking` = VALUES(`blocking`),
  `notes` = VALUES(`notes`),
  `updated_at` = CURRENT_TIMESTAMP;

UPDATE `execution_policies`
SET `execution_scope` = 'repo_mutation|github_pr_merge|branch_delete|repo_patch_apply|repo_patch_batch_apply|capability_resolution_envelope_create|capability_resolution_envelope_approve|gpt_tools_call|tool_dispatch',
    `affects_layer` = 'adminCliRoutes|github_rest_fallback|gptToolsRoutes|repo_patch_apply|admin_platform_endpoint_tools|virtual_admin_tools|capability_resolution_envelope_ledger',
    `policy_value` = JSON_SET(
      COALESCE(`policy_value`, JSON_OBJECT()),
      '$.descriptor_policy_alignment_required', TRUE,
      '$.preferred_repair_strategy', 'sql_registry_descriptor_and_execution_policy_alignment',
      '$.disable_guard_as_repair', FALSE,
      '$.generic_admin_control_bypass_forbidden', TRUE,
      '$.source_regression_pull_request', 1912
    ),
    `active` = 'TRUE',
    `blocking` = 'TRUE',
    `updated_at` = CURRENT_TIMESTAMP
WHERE `policy_group` = 'Repository Mutation Governance'
  AND `policy_key` = 'Stale Duplicate Branch Merge Guard';

CREATE OR REPLACE VIEW `v_repository_mutation_descriptor_policy_readiness` AS
SELECT
  `tool_key`,
  `tags`,
  CASE
    WHEN `tool_key` = 'capability_resolution_envelope_create'
      AND FIND_IN_SET('readback', REPLACE(COALESCE(`tags`, ''), ' ', '')) > 0
      AND FIND_IN_SET('no_execution', REPLACE(COALESCE(`tags`, ''), ' ', '')) > 0
      THEN 'ready'
    WHEN `tool_key` = 'capability_resolution_envelope_approve'
      AND FIND_IN_SET('approval_required', REPLACE(COALESCE(`tags`, ''), ' ', '')) > 0
      AND FIND_IN_SET('readback', REPLACE(COALESCE(`tags`, ''), ' ', '')) > 0
      THEN 'ready'
    ELSE 'missing_required_declared_mutation_policy'
  END AS `coverage_status`,
  `is_enabled`,
  `updated_at`
FROM `admin_platform_endpoint_tools`
WHERE `tool_key` IN (
  'capability_resolution_envelope_create',
  'capability_resolution_envelope_approve'
);
