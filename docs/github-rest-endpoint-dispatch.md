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
  -> executionFacade
  -> http_generic_api
  -> GitHub REST
```

## Responsibilities

- `actions.github_api_mcp` defines the parent provider capability and authentication ownership.
- `endpoints` defines each operation's canonical method, path, provider domain, schema, readiness, and delegated transport.
- `platform_endpoint_tool_exports` exposes only reviewed canonical endpoint rows.
- `platform_tool_dispatch_bindings` binds callable tools to capability, operation intent, runtime surface, and readback policy.
- `runtime_endpoint_call` resolves the system-layer principal/context and delegates the actual endpoint operation to `executionFacade`.
- `executionFacade` performs resolution, preflight/dry-run, provider dispatch, response validation, writeback, and the executable issue-comment same-cycle readback described below.
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
The actual `executionFacade.execute` path used by `runtime_endpoint_call` blocks
the live provider dispatch unless all of the following are present on the same
request:

- explicit mutation/operator approval;
- completed dry-run/preflight evidence;
- explicit `live_execution_approved=true`;
- `readback.required=true`;
- `readback.policy_key="github_issue_comment_exact_readback_v1"`.

For `github_rest_endpoint_dispatch`, the three mutation-governance facts are
carried inside `readback.governance`, not as top-level `tool_args` evidence.
This is intentional: `normalizePlatformEndpointCallArgs` preserves the complete
`readback` envelope when it converts a catalog binding into the
`runtime_endpoint_call` payload, while unrelated top-level mutation metadata is
not part of that normalization contract. The dispatcher therefore fails closed
when approval/preflight/live evidence is supplied only at the top level. Direct
`runtime_endpoint_call` remains backward-compatible with top-level or nested
governance evidence, but the exported dispatcher contract uses the nested form
so validated evidence cannot disappear between binding selection and execution.

An arbitrary non-empty readback mode is not accepted as proof of executable
readback. The policy key must match the exact runtime implementation.

A create-comment request with `preflight_only=true` and no `dry_run` fails
closed before execution resolution, so the flag cannot fall through into a live
POST. The public `github_rest_endpoint_dispatch` also rejects `dry_run` or
`preflight_only` mutation calls and points callers to `runtime_endpoint_preview`.
`runtime_endpoint_preview` adds `dry_run=true` internally and therefore follows
the passive execution branch without a provider mutation.

After a successful live POST, `executionFacade` does not immediately claim
governed success. It extracts the returned GitHub comment id and performs a
same-cycle read through the existing `github_list_issue_comments` endpoint
using the same `owner`, `repo`, and `issue_number` context and a bounded
`since`/`per_page` query. The live result is returned with
`governance_readback.status="verified"` only when that read response contains
the exact provider-returned comment id.

If the provider response lacks a readable comment id, the readback call fails,
or the exact id is not observed, execution returns a typed no-secret governance
error with `mutation_executed=true` and `automatic_retry_allowed=false`. The
runtime does not silently retry the POST or describe the unverified write as a
verified success.

The caller still cannot supply a raw method, URL, or authorization header. The
export only makes the existing active/ready canonical endpoint discoverable
through its intended governed catalog instead of requiring a direct system-tool
escape hatch.

Migration `20260808_github_issue_comment_dispatch_parity.sql` fails closed
unless there is exactly one matching active/ready canonical endpoint row with a
non-null `endpoint_id` and exactly one canonical enabled Admin dispatcher row:
`POST /system/tools/call` with `fixed_body.name=runtime_endpoint_call`. Endpoint
schema mutation, dispatcher allowlist mutation, export creation, and binding
creation all require both cardinalities to equal one; the migration does not
perform an endpoint-only partial mutation when dispatcher identity is missing
or ambiguous.

The migration only appends `github_create_issue_comment` to the shared endpoint
allowlist. It does not add `minLength` to the shared `body.body` schema because
that field is also used by operations such as pull-request update where an empty
body is a legitimate request to clear the description.

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

For `github_create_issue_comment`, the operation-specific guard is enforced in
the shared execution facade reached by the Admin dispatcher, not only in the
dynamic catalog selector. This prevents `fixed_body.name=runtime_endpoint_call`
from bypassing the approval/preflight/live/readback contract. The guard is
intentionally operation-specific and does not replace the broader mutation
policy for other GitHub or provider operations.

The public descriptor for a multi-binding `github_rest_endpoint_dispatch`
contains an endpoint-specific JSON Schema condition for
`github_create_issue_comment`. That condition requires the exact readback policy
and a `readback.governance` object containing approved mutation, completed
preflight, and live-execution evidence. Other endpoint keys retain their
existing schemas and are not forced into this create-comment-specific envelope.

## Response schema alignment

GitHub issue-label add, replace, and remove operations return the complete remaining label array on `200 OK`. Their canonical endpoint rows and exported registry copies must include the corresponding JSON response schema. A description-only success response is insufficient because the runtime response validator treats the missing content schema as contract drift even when GitHub completed the mutation successfully.

GitHub issue-comment creation follows the same rule at `201 Created`. The compiled provider schema defines the response as a `Comment` object, so `endpoints.schema_json` and `platform_endpoint_tool_exports.input_schema_json` must retain an object response schema for `github_create_issue_comment`. Migration `20260808_github_issue_comment_dispatch_parity.sql` reconciles the existing active/ready endpoint row and exports it through `github_rest_endpoint_dispatch`; it does not register a new provider endpoint or execute a GitHub write during migration apply.

`v_platform_endpoint_export_schema_parity` remains the canonical registry/export parity diagnostic. The create-comment export is not ready when its active export diverges from the source endpoint schema.

For this exact operation, `v_github_issue_comment_dispatch_parity` provides a bounded registry post-apply readback. `parity_status='ready'` requires exactly one ready `http_generic_api` canonical endpoint with a non-null identity and a 201 JSON object response, exactly one canonical enabled Admin dispatcher whose allowlist contains the endpoint, exactly one active source-bound Admin export whose schema equals the endpoint schema, and exactly one active governed dispatch binding joined to that same export and endpoint source. Runtime live-execution success additionally requires the executable comment-id readback described above.

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

For `github_create_issue_comment`, first use `runtime_endpoint_preview` for the
no-provider-call preflight. A later live `github_rest_endpoint_dispatch` call
must carry the approved preflight evidence and mutation approvals in the
normalized envelope:

```json
{
  "tool_args": {
    "parent_action_key": "github_api_mcp",
    "endpoint_key": "github_create_issue_comment",
    "path_params": {
      "owner": "mad4bdigital-ai",
      "repo": "multi-business-multi-role-growth-intelligence-os",
      "issue_number": 4451
    },
    "body": {
      "body": "Governed comment body"
    },
    "readback": {
      "required": true,
      "policy_key": "github_issue_comment_exact_readback_v1",
      "governance": {
        "mutation_approval": {
          "approved": true
        },
        "approved_preflight_dry_run_validated": true,
        "live_execution_approved": true
      }
    }
  }
}
```

The live call is not reported as verified until the created comment id is
observed through the same-cycle readback.

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
