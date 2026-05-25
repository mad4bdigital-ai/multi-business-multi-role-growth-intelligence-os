# App Action Policy Preflight

## Purpose

This phase extends `execution_policies` runtime preflight from repository mutations and GPT tool dispatch into external app actions.

The first implementation is intentionally non-breaking. It adds preflight visibility for app actions and creates a policy hook where app-specific blocking rules can be added later.

## Runtime flow

`appAdapters/index.js` now runs:

```text
ensureFreshCredentials(connection)
→ evaluateAppActionPreflight({ connection, appKey, actionKey, args })
→ assertPreflightAllowed(preflight)
→ adapter.call(action_key, args, creds, connection)
→ validation_status self-heal on success
```

This preserves the existing credential refresh and successful-use validation self-heal behavior while ensuring external app calls pass through `governedExecutionPreflight` before adapter execution.

## Policy seed

Migration:

```text
http-generic-api/migrations/124_sprint64_app_action_policy_preflight.sql
```

Policy row:

```text
policy_group: External App Action Governance
policy_key: External App Action Preflight Visibility
execution_scope: app_action|external_app_action|n8n|cloudflare|hostinger|google_drive|wordpress_rest|github
affects_layer: appAdapters|appAdapters/index.js|n8n|cloudflare|hostinger|google_drive|wordpress_rest|github
blocking: FALSE
```

The seed is advisory. It does not block existing app actions. Blocking behavior should be introduced only with adapter-specific evaluators, such as:

- n8n workflow mutation guard
- Google Drive writeback readback guard
- Hostinger site mutation guard
- Cloudflare DNS/tunnel mutation guard
- WordPress publish/runtime preflight guard

## Why this matters

The older Workbook/Sheet governance design treated execution policy rows as a cross-cutting authority for model/tool execution. After migration to SQL and JavaScript runtime, app actions were still mostly governed by adapter code and connection state. This phase reconnects app action execution to SQL policy authority.

## Safety contract

- No secrets are included in preflight evidence.
- Missing matching policies return `allow` with evidence reason `no_matching_active_execution_policy`.
- Advisory matching policies return `allow_with_policy_advisory`.
- Blocking policies must be paired with policy-specific evaluator logic before they can safely block app actions.
