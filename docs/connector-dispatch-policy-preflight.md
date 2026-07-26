# Connector Dispatch Policy Preflight

## Purpose

This phase extends `execution_policies` runtime preflight into `connectorExecutor.js`, which is the bridge from approved execution plans into WordPress, MCP, and content workflow execution.

The first policy is advisory and non-breaking. It restores policy visibility before a plan is converted into an active workflow run.

## Runtime flow

`connectorExecutor.js` now runs preflight after resolving the plan and connector type, but before creating workflow runs or marking the plan as executing:

```text
load plan
→ validate plan_status/access_decision
→ resolve brand/connectedSystem/workflowDef/actionRow
→ determine connector_type
→ evaluateConnectorDispatchPreflight(...)
→ assertPreflightAllowed(...)
→ createWorkflowRun(...)
→ execution_plans.plan_status = executing
→ dispatchWordpress / dispatchMcpConnector / dispatchContentWorkflow
```

## Policy seed

Migration:

```text
http-generic-api/migrations/126_sprint64_connector_dispatch_preflight.sql
```

Policy row:

```text
policy_group: Connector Dispatch Governance
policy_key: Connector Dispatch Preflight Visibility
execution_scope: connector_dispatch|workflow_dispatch|wordpress|mcp_connector|content_workflow
affects_layer: connectorExecutor|connectorExecutor.js|wordpress|mcp_connector|content_workflow
blocking: FALSE
```

## Evidence

The preflight evidence is secret-free and includes only runtime metadata such as:

- `plan_id`
- `tenant_id`
- `workflow_key`
- `intent_key`
- `brand_key`
- `connector_type`
- `workflow_execution_class`
- `workflow_review_required`
- `apply`

## Future blocking policies

The evaluator already supports a future policy:

```text
policy_group: Connector Dispatch Governance
policy_key: WordPress Apply Requires Explicit Reason
```

That policy can block WordPress `apply=true` unless the plan carries a clear execution reason. It is not seeded in this phase, because the current change is intended to be non-breaking.

## Why this matters

The original Workbook/Sheet runtime governance expected Execution Policy Registry to influence module loading and execution dispatch. This phase reconnects SQL `execution_policies` to the connector dispatch bridge before workflow state changes occur.
