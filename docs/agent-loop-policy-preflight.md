# Agent Loop Policy Preflight

## Purpose

This phase extends `execution_policies` runtime preflight into `agentLoopRunner.js`, which is the closest current runtime surface to the future Governed Canonical Agent Runtime.

The first policy is advisory and non-breaking. It restores policy visibility before model/tool loops or rule-based logic execution.

## Runtime flow

`agentLoopRunner.js` now runs preflight after workflow, logic, governed context, workspace app context, and tool manifest preparation, but before model or engine execution:

```text
loadWorkflow(plan.workflow_key)
→ loadLogicDefinition(workflow.target_module)
→ buildGovernedContext(plan)
→ loadWorkspaceAppContext(...)
→ buildToolsFromEngines(workflow.mapped_engines)
→ evaluateAgentLoopPreflight(...)
→ assertPreflightAllowed(...)
→ rule_based dispatchTool(...) OR deps.runLogicWithModel(...)
```

## Policy seed

Migration:

```text
http-generic-api/migrations/127_sprint64_agent_loop_preflight.sql
```

Policy row:

```text
policy_group: Agent Loop Governance
policy_key: Agent Loop Preflight Visibility
execution_scope: agent_loop|model_tool_loop|logic_execution|standard|advanced|rule_based
affects_layer: agentLoopRunner|agentLoopRunner.js|standard|advanced|rule_based
blocking: FALSE
```

## Evidence

The preflight evidence is secret-free and includes runtime metadata such as:

- `plan_id`
- `tenant_id`
- `agent_id`
- `workflow_key`
- `intent_key`
- `brand_key`
- `logic_key`
- `execution_class`
- `tool_count`
- `review_required`
- `workspace_app_connection_count`

## Future blocking policy

The evaluator includes a future policy hook:

```text
policy_group: Agent Loop Governance
policy_key: Brand Writing Requires Brand Core
```

That policy can block writing/content/SEO/publishing workflows when Brand Core evidence is missing from governed context. It is not seeded as blocking in this phase, because the current implementation is intended to restore visibility without changing existing workflow behavior.

## Why this matters

The earlier Workbook/Sheet runtime governance expected `Execution Policy Registry` to participate in prompt routing, module loading, and execution classification. This phase reconnects SQL `execution_policies` to the model/tool loop boundary, setting the foundation for the Governed Canonical Agent Runtime.
