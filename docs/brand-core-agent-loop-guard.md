# Brand Core Agent Loop Guard

## Purpose

This phase activates the first blocking brand-context policy in the agent loop.

Brand writing, SEO, publishing, and strategy workflows must not enter model/tool execution without Brand Core evidence.

## Runtime flow

`agentLoopRunner.js` now loads secret-free Brand Core evidence before agent-loop preflight:

```text
loadWorkflow(plan.workflow_key)
→ loadLogicDefinition(workflow.target_module)
→ buildGovernedContext(plan)
→ loadPathResolverRows(plan)
→ loadBrandCoreEvidence(plan.brand_key || plan.target_key)
→ context.brand_core / context.brand_core_resolved
→ evaluateAgentLoopPreflight(...)
→ assertPreflightAllowed(...)
→ rule_based dispatchTool(...) OR deps.runLogicWithModel(...)
```

## Brand Core evidence

The loader reads from SQL `brand_core` and returns metadata only:

- `brand_key`
- `brand_name`
- `document_count`
- `active_document_count`
- `valid_document_count`
- `validation_statuses`
- `asset_types`
- `core_functions`
- `latest_updated_at`
- `secrets_included: false`

It does not expose Google Drive links, document IDs, file IDs, or raw Brand Core content.

## Policy seed

Migration:

```text
http-generic-api/migrations/128_sprint64_brand_core_agent_loop_guard.sql
```

Policy row:

```text
policy_group: Agent Loop Governance
policy_key: Brand Writing Requires Brand Core
execution_scope: agent_loop|model_tool_loop|logic_execution|standard|advanced|rule_based|content|seo|strategy|write|publish
affects_layer: agentLoopRunner|agentLoopRunner.js|brand_core|content_workflow
blocking: TRUE
```

## Blocking condition

The evaluator blocks when both conditions are true:

```text
1) intent/workflow is writing-like:
   write | content | seo | publish | strategy

2) context has no Brand Core evidence:
   context.brand_core / context.brand_core_resolved / context.brandCore
```

The block occurs before any model call, tool call, or rule-based engine dispatch.

## Why this matters

The platform instruction contract requires Brand Core first for brand writing. This change makes that rule executable inside the JS runtime instead of leaving it as advisory governance text.
