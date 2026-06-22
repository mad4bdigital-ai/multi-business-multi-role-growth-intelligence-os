# GitHub REST Endpoint Dispatch

## Purpose

GitHub REST operations are defined by SQL registry authority rather than by caller-supplied HTTP methods, paths, URLs, or authorization headers.

The authority chain is:

```text
actions.github_api_mcp
  -> endpoints
  -> platform_endpoint_tool_exports
  -> platform_tool_dispatch_bindings
  -> runtime_endpoint_call
  -> http_generic_api
  -> GitHub REST
```

## Responsibilities

- `actions.github_api_mcp` defines the parent provider capability and authentication ownership.
- `endpoints` defines each operation's canonical method, path, provider domain, schema, readiness, and delegated transport.
- `platform_endpoint_tool_exports` exposes only reviewed canonical endpoint rows.
- `platform_tool_dispatch_bindings` binds callable tools to capability, operation intent, runtime surface, and readback policy.
- `runtime_endpoint_call` performs the existing system-layer authority, credential, preflight, audit, and readback flow.
- `http_generic_api` is transport only and must not invent endpoint contracts.

## Admin dispatcher

The Admin tool `github_rest_endpoint_dispatch` forwards to the existing `runtime_endpoint_call` system tool. Callers provide a nested `tool_args` object containing only a reviewed `parent_action_key`, `endpoint_key`, path parameters, bounded query/body fields, and applicable approval/readback evidence.

The dispatcher rejects caller-supplied raw methods and URLs. GitHub authorization remains server-side and must not be supplied in caller headers.

Supported initial endpoint keys:

- `github_update_pull_request`
- `github_list_issue_labels`
- `github_add_issue_labels`
- `github_set_issue_labels`
- `github_remove_issue_label`

## Canonical row eligibility

A row is executable through this projection only when all of the following hold:

```sql
endpoint_id IS NOT NULL
AND parent_action_key = 'github_api_mcp'
AND status = 'active'
AND execution_readiness = 'ready'
AND transport_action_key = 'http_generic_api'
```

Imported inventory rows without canonical identity or execution readiness are not execution authority.

## Mutation governance

Read operations may dispatch after registry, schema, principal, credential, and policy validation.

PATCH, POST, PUT, and DELETE operations remain subject to the existing runtime mutation controls, including applicable resource authority, dry-run or preflight evidence, explicit approval, audit logging, and same-cycle readback. Registering an endpoint or Admin projection does not itself authorize a provider write.

## Example

```json
{
  "tool_args": {
    "parent_action_key": "github_api_mcp",
    "endpoint_key": "github_update_pull_request",
    "path_params": {
      "owner": "mad4bdigital-ai",
      "repo": "multi-business-multi-role-growth-intelligence-os",
      "pull_number": 1850
    },
    "body": {
      "title": "Document verified migration rollout"
    },
    "credential_scope": "platform",
    "preflight_only": true
  }
}
```

The corresponding method and path are loaded from `endpoints`; they are not accepted from this request.
