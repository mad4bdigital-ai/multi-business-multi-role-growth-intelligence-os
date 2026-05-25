-- Sprint 64: Brand Core agent loop guard.
-- Activates the first blocking brand-context policy in the agent loop.

UPDATE `execution_policies`
   SET `active` = 'TRUE',
       `execution_scope` = 'agent_loop|model_tool_loop|logic_execution|standard|advanced|rule_based|content|seo|strategy|write|publish',
       `affects_layer` = 'agentLoopRunner|agentLoopRunner.js|brand_core|content_workflow',
       `blocking` = 'TRUE',
       `policy_value` = JSON_OBJECT(
         'enforcement_mode', 'blocking',
         'require_brand_core_for_writing_like_intents', true,
         'writing_like_patterns', 'write|content|seo|publish|strategy',
         'reason', 'Brand writing, SEO, publishing, and strategy workflows require Brand Core evidence before model/tool execution.'
       ),
       `notes` = 'Blocking agent-loop policy. governedExecutionPreflight blocks writing-like workflows when Brand Core evidence is absent from the governed context. agentLoopRunner loads secret-free Brand Core evidence from SQL before preflight.',
       `updated_at` = NOW()
 WHERE `policy_group` = 'Agent Loop Governance'
   AND `policy_key` = 'Brand Writing Requires Brand Core';

INSERT INTO `execution_policies`
  (`policy_group`, `policy_key`, `policy_value`, `active`, `execution_scope`, `affects_layer`, `blocking`, `notes`, `created_at`, `updated_at`)
SELECT
  'Agent Loop Governance',
  'Brand Writing Requires Brand Core',
  JSON_OBJECT(
    'enforcement_mode', 'blocking',
    'require_brand_core_for_writing_like_intents', true,
    'writing_like_patterns', 'write|content|seo|publish|strategy',
    'reason', 'Brand writing, SEO, publishing, and strategy workflows require Brand Core evidence before model/tool execution.'
  ),
  'TRUE',
  'agent_loop|model_tool_loop|logic_execution|standard|advanced|rule_based|content|seo|strategy|write|publish',
  'agentLoopRunner|agentLoopRunner.js|brand_core|content_workflow',
  'TRUE',
  'Blocking agent-loop policy. governedExecutionPreflight blocks writing-like workflows when Brand Core evidence is absent from the governed context. agentLoopRunner loads secret-free Brand Core evidence from SQL before preflight.',
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group` = 'Agent Loop Governance'
     AND `policy_key` = 'Brand Writing Requires Brand Core'
);
