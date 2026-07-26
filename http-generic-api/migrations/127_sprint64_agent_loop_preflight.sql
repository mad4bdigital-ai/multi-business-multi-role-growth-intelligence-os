-- Sprint 64: Agent loop runtime policy preflight.
-- Advisory seed that restores execution_policies visibility before model/tool or rule-based logic execution.

UPDATE `execution_policies`
   SET `active` = 'TRUE',
       `execution_scope` = 'agent_loop|model_tool_loop|logic_execution|standard|advanced|rule_based',
       `affects_layer` = 'agentLoopRunner|agentLoopRunner.js|standard|advanced|rule_based',
       `blocking` = 'FALSE',
       `policy_value` = JSON_OBJECT(
         'enforcement_mode', 'advisory',
         'require_preflight_visibility', true,
         'require_secret_free_evidence', true,
         'require_policy_specific_evaluator_for_blocking', true,
         'reason', 'Agent loop execution must pass through governedExecutionPreflight before model/tool or rule-based engine execution.'
       ),
       `notes` = 'Non-blocking visibility policy for agentLoopRunner.js. This restores execution_policies as a preflight authority source before model/tool loops and rule-based engine dispatch without changing current workflow behavior.',
       `updated_at` = NOW()
 WHERE `policy_group` = 'Agent Loop Governance'
   AND `policy_key` = 'Agent Loop Preflight Visibility';

INSERT INTO `execution_policies`
  (`policy_group`, `policy_key`, `policy_value`, `active`, `execution_scope`, `affects_layer`, `blocking`, `notes`, `created_at`, `updated_at`)
SELECT
  'Agent Loop Governance',
  'Agent Loop Preflight Visibility',
  JSON_OBJECT(
    'enforcement_mode', 'advisory',
    'require_preflight_visibility', true,
    'require_secret_free_evidence', true,
    'require_policy_specific_evaluator_for_blocking', true,
    'reason', 'Agent loop execution must pass through governedExecutionPreflight before model/tool or rule-based engine execution.'
  ),
  'TRUE',
  'agent_loop|model_tool_loop|logic_execution|standard|advanced|rule_based',
  'agentLoopRunner|agentLoopRunner.js|standard|advanced|rule_based',
  'FALSE',
  'Non-blocking visibility policy for agentLoopRunner.js. This restores execution_policies as a preflight authority source before model/tool loops and rule-based engine dispatch without changing current workflow behavior.',
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group` = 'Agent Loop Governance'
     AND `policy_key` = 'Agent Loop Preflight Visibility'
);
