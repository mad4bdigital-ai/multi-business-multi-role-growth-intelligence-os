# n8n Workflow Execution Guard

## Purpose

This phase adds the first blocking adapter-specific policy under the app action preflight layer.

`n8n.execute_workflow` can trigger workflow side effects, so it now requires explicit execution intent before `adapter.call(...)` runs.

## Runtime flow

`appAdapters/index.js` already runs:

```text
ensureFreshCredentials(connection)
→ evaluateAppActionPreflight({ connection, appKey, actionKey, args })
→ assertPreflightAllowed(preflight)
→ adapter.call(action_key, args, creds, connection)
```

The n8n-specific evaluator lives in:

```text
http-generic-api/governedExecutionPreflight.js
```

## Policy seed

Migration:

```text
http-generic-api/migrations/125_sprint64_n8n_workflow_execution_guard.sql
```

Policy row:

```text
policy_group: External App Action Governance
policy_key: n8n Workflow Execution Guard
execution_scope: app_action|external_app_action|n8n|execute_workflow
affects_layer: appAdapters|appAdapters/index.js|n8n
blocking: TRUE
```

## Blocking condition

The preflight blocks only this pair:

```text
app_key: n8n
action_key: execute_workflow
```

It requires:

```json
{
  "allow_n8n_workflow_execution": true,
  "n8n_execution_reason": "clear reason with at least 10 characters"
}
```

`execution_reason` is accepted as an alias for `n8n_execution_reason`.

## Not blocked by this policy

The following n8n actions remain unaffected:

```text
list_workflows
get_workflow
list_executions
trigger_webhook
```

`trigger_webhook` can also have side effects, but it remains unchanged for compatibility. It should get a separate policy later after existing workflows are reviewed.

## Safety contract

- No secrets are included in preflight evidence.
- The policy blocks before `adapter.call(...)`.
- Successful app-action validation self-heal is preserved for calls that pass preflight.
- Generic blocking app-action policies remain advisory unless a dedicated evaluator exists.
