-- Sprint 64: Connector dispatch runtime policy preflight.
-- Advisory seed that restores execution_policies visibility before connectorExecutor dispatch.

UPDATE `execution_policies`
   SET `active` = 'TRUE',
       `execution_scope` = 'connector_dispatch|workflow_dispatch|wordpress|mcp_connector|content_workflow',
       `affects_layer` = 'connectorExecutor|connectorExecutor.js|wordpress|mcp_connector|content_workflow',
       `blocking` = 'FALSE',
       `policy_value` = JSON_OBJECT(
         'enforcement_mode', 'advisory',
         'require_preflight_visibility', true,
         'require_secret_free_evidence', true,
         'require_policy_specific_evaluator_for_blocking', true,
         'reason', 'Connector dispatch must pass through governedExecutionPreflight before workflow_runs are created or execution_plans are marked executing.'
       ),
       `notes` = 'Non-blocking visibility policy for connectorExecutor.js. This restores execution_policies as a preflight authority source before WordPress, MCP, or content workflow dispatch without changing existing execution behavior.',
       `updated_at` = NOW()
 WHERE `policy_group` = 'Connector Dispatch Governance'
   AND `policy_key` = 'Connector Dispatch Preflight Visibility';

INSERT INTO `execution_policies`
  (`policy_group`, `policy_key`, `policy_value`, `active`, `execution_scope`, `affects_layer`, `blocking`, `notes`, `created_at`, `updated_at`)
SELECT
  'Connector Dispatch Governance',
  'Connector Dispatch Preflight Visibility',
  JSON_OBJECT(
    'enforcement_mode', 'advisory',
    'require_preflight_visibility', true,
    'require_secret_free_evidence', true,
    'require_policy_specific_evaluator_for_blocking', true,
    'reason', 'Connector dispatch must pass through governedExecutionPreflight before workflow_runs are created or execution_plans are marked executing.'
  ),
  'TRUE',
  'connector_dispatch|workflow_dispatch|wordpress|mcp_connector|content_workflow',
  'connectorExecutor|connectorExecutor.js|wordpress|mcp_connector|content_workflow',
  'FALSE',
  'Non-blocking visibility policy for connectorExecutor.js. This restores execution_policies as a preflight authority source before WordPress, MCP, or content workflow dispatch without changing existing execution behavior.',
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group` = 'Connector Dispatch Governance'
     AND `policy_key` = 'Connector Dispatch Preflight Visibility'
);
