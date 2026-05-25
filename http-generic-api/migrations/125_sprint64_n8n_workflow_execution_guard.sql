-- Sprint 64: n8n workflow execution guard.
-- Adds the first blocking adapter-specific app action policy.

UPDATE `execution_policies`
   SET `active` = 'TRUE',
       `execution_scope` = 'app_action|external_app_action|n8n|execute_workflow',
       `affects_layer` = 'appAdapters|appAdapters/index.js|n8n',
       `blocking` = 'TRUE',
       `policy_value` = JSON_OBJECT(
         'enforcement_mode', 'blocking',
         'guarded_app_key', 'n8n',
         'guarded_action_key', 'execute_workflow',
         'allow_read_actions', true,
         'allow_trigger_webhook', true,
         'require_explicit_execution_reason', true,
         'min_reason_chars', 10,
         'reason', 'n8n execute_workflow can create side effects and must include an explicit execution reason before adapter execution.'
       ),
       `notes` = 'Blocking app-specific runtime policy. governedExecutionPreflight blocks n8n execute_workflow unless allow_n8n_workflow_execution=true and n8n_execution_reason/execution_reason is supplied. Read/list actions and trigger_webhook are not blocked by this policy.',
       `updated_at` = NOW()
 WHERE `policy_group` = 'External App Action Governance'
   AND `policy_key` = 'n8n Workflow Execution Guard';

INSERT INTO `execution_policies`
  (`policy_group`, `policy_key`, `policy_value`, `active`, `execution_scope`, `affects_layer`, `blocking`, `notes`, `created_at`, `updated_at`)
SELECT
  'External App Action Governance',
  'n8n Workflow Execution Guard',
  JSON_OBJECT(
    'enforcement_mode', 'blocking',
    'guarded_app_key', 'n8n',
    'guarded_action_key', 'execute_workflow',
    'allow_read_actions', true,
    'allow_trigger_webhook', true,
    'require_explicit_execution_reason', true,
    'min_reason_chars', 10,
    'reason', 'n8n execute_workflow can create side effects and must include an explicit execution reason before adapter execution.'
  ),
  'TRUE',
  'app_action|external_app_action|n8n|execute_workflow',
  'appAdapters|appAdapters/index.js|n8n',
  'TRUE',
  'Blocking app-specific runtime policy. governedExecutionPreflight blocks n8n execute_workflow unless allow_n8n_workflow_execution=true and n8n_execution_reason/execution_reason is supplied. Read/list actions and trigger_webhook are not blocked by this policy.',
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group` = 'External App Action Governance'
     AND `policy_key` = 'n8n Workflow Execution Guard'
);
