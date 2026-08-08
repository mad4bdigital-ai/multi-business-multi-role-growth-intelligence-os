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

Supported endpoint keys include:

- `github_update_pull_request`
- `github_list_issue_comments`
- `github_create_issue_comment`
- `github_list_issue_labels`
- `github_add_issue_labels`
- `github_set_issue_labels`
- `github_remove_issue_label`

## Issue and pull request comments

`github_list_issue_comments` reads conversation comments from
`GET /repos/{owner}/{repo}/issues/{issue_number}/comments`. GitHub uses the
Issues API for both issues and pull-request conversation threads, so the same
endpoint reads ordinary discussion comments on either resource. It does not
read pull-request review comments, which are a separate GitHub REST resource.

The operation is read-only, accepts optional `since`, `page`, and `per_page`
query parameters, and remains bound to server-side GitHub App authentication.
The caller cannot provide a raw method, URL, or authorization header.

`github_create_issue_comment` creates an issue or pull-request conversation
comment through `POST /repos/{owner}/{repo}/issues/{issue_number}/comments`.
The canonical compiled GitHub schema already models the provider success as
`201 Created` with the `Comment` response object. The SQL endpoint row and its
Admin export must preserve that same response contract so a successful provider
write is not converted into local response-schema drift.

The create-comment export is admin-only and does not bypass mutation governance.
It remains dispatched through `runtime_endpoint_call` and requires the normal
preflight, approval, audit, and same-cycle readback evidence. The caller still
cannot supply a raw method, URL, or authorization header. The export only makes
the existing active/ready canonical endpoint discoverable through its intended
governed catalog instead of requiring a direct system-tool escape hatch.

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

## Response schema alignment

GitHub issue-label add, replace, and remove operations return the complete remaining label array on `200 OK`. Their canonical endpoint rows and exported registry copies must include the corresponding JSON response schema. A description-only success response is insufficient because the runtime response validator treats the missing content schema as contract drift even when GitHub completed the mutation successfully.

GitHub issue-comment creation follows the same rule at `201 Created`. The compiled provider schema defines the response as a `Comment` object, so `endpoints.schema_json` and `platform_endpoint_tool_exports.input_schema_json` must retain an object response schema for `github_create_issue_comment`. Migration `20260808_github_issue_comment_dispatch_parity.sql` reconciles the existing active/ready endpoint row and exports it through `github_rest_endpoint_dispatch`; it does not register a new provider endpoint or execute a GitHub write.

`v_platform_endpoint_export_schema_parity` remains the canonical registry/export parity diagnostic. The create-comment export is not ready when its active export diverges from the source endpoint schema.

Response contracts should remain tolerant of additive provider fields while validating the stable provider response class used by the platform.

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

## Create-reference response contract

GitHub returns `201 Created` when a Git reference is created successfully. The
`github_create_branch_reference` endpoint contract must therefore retain a
`responses.201` schema in SQL registry authority. Migration
`1024_sprint69_github_create_reference_201_contract_reconciliation.sql` adds
that response to the existing endpoint row without registering or enabling any
additional tool, export, route, or dispatch binding.

This is an additive response-validation correction. It does not change the
public Admin route shape, authentication model, mutation approval gates, audit
requirements, or same-cycle readback requirements. A successful provider
response must still pass the existing mutation governance and readback flow.
