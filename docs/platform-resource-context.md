# Platform Resource Context

## Purpose

The Platform Resource Context layer resolves governed operational context from any authorized resource reference. Brand, Workspace, Asset, CMS Site, and Connection are equal entry points.

The primary tool is:

```text
platform_resource_context_resolve
```

The older `brand_workspace_context_resolve` tool remains available as a compatibility surface for Brand-first callers. New agents and workflows should use the generic resource-first tool.

All tools are descriptor-backed and dispatched through:

```text
POST /system/tools/call
```

No raw duplicate HTTP route is added. The runtime resolves tool descriptors and handlers from registry authority.

## Supported resources

- `brand`
- `workspace`
- `asset`
- `site`
- `connection`
- `auto` for type detection

Accepted typed references include:

- `brand_name`
- `brand_ref`
- `target_key`
- `workspace_ref`
- `asset_ref`
- `site_ref`
- `site_url`
- `connection_id`

Generic callers may use:

```json
{
  "name": "platform_resource_context_resolve",
  "tool_args": {
    "reference": "All Royal Egypt Analytics",
    "resource_type": "auto"
  }
}
```

## Primary resolution

Resolution follows this sequence:

```text
signed principal
  -> membership and effective resource scope
  -> authorized resource catalog
  -> deterministic direct match
  -> optional candidate-only language interpretation
  -> deterministic ambiguity check
  -> related resource graph
  -> optional Brand context
```

The returned graph may contain:

- Brands
- Workspaces
- persisted Assets
- CMS Sites
- CMS access grants
- safe Connection metadata

A Brand is not required. A standalone authorized Connection can resolve without a Workspace, CMS Site, or Brand relationship.

## Language and spelling interpretation

When direct matching fails, the resolver returns:

```json
{
  "status": "interpretation_required",
  "skill": {
    "skill_key": "resource_reference_interpreter_v1",
    "role": "candidate_generation_only",
    "next_call_field": "candidate_refs"
  },
  "authorized_resource_catalog": []
}
```

The skill may generate up to eight spelling, spacing, script, transliteration, label, domain, or identifier variants. It receives only the authorized catalog and may not:

- choose authority;
- invent a resource key;
- expose another Tenant;
- request credentials;
- claim a final match.

The caller repeats the same resolver request with `candidate_refs`. Backend matching and ambiguity handling remain deterministic.

## Helper tools

### `platform_resource_context_catalog`

Lists resources authorized for the signed principal.

Input supports:

- `resource_type`
- `search`
- `cursor`
- `limit`

The response contains stable pagination metadata:

```json
{
  "items": [],
  "page": {
    "cursor": 0,
    "limit": 25,
    "next_cursor": null,
    "has_more": false,
    "total_count": 0
  }
}
```

Use this route for discovery, UI selectors, and pre-resolution inspection. Do not load the whole resource registry into prompts when a filtered catalog request is sufficient.

### `platform_resource_context_related`

Expands the one-hop authorized graph for one canonical key:

```json
{
  "name": "platform_resource_context_related",
  "tool_args": {
    "resource_type": "workspace",
    "resource_key": "workspace-id",
    "include_brand_context": true
  }
}
```

This helper is exact-key only. It does not return an interpretation catalog and does not invoke candidate generation.

### `platform_resource_context_diagnostic_handoff`

Resolves a resource and returns only safe diagnostic identifiers and authority metadata for linked CMS Sites and Connections.

The handoff separates:

- configuration status;
- credential-material presence;
- resource authority;
- live connectivity.

Registry metadata never proves live connectivity. The handoff always reports:

```json
{
  "connectivity_status": "not_checked",
  "live_verified_at": null
}
```

For WordPress resources it recommends:

- `wordpress_auth_context_diagnostic`
- `wordpress_publish_authority_diagnostic`

Provider diagnostics are separate governed calls.

### `platform_resource_context_readiness_smoke`

Admin-only read-only smoke that verifies:

- required SQL surfaces;
- all five descriptor tools;
- supported resource types;
- no provider call;
- no mutation;
- no external send;
- no secret return.

## Tenant and Admin scope

Tenant identity is derived only from the signed JWT. Caller-supplied `tenant_id` and `user_id` are ignored for Tenant principals.

Tenant Owner/Admin receives Tenant-level authorized resources. Member/Viewer resources are filtered before catalog generation using effective resource grants, user-owned Connections, and active CMS grants.

Admin may provide diagnostic Tenant/User scope overrides. Without an override, Admin may inspect the platform catalog, but no secret material is returned.

## Connection safety

Safe Connection fields may include:

- `connection_id`
- `app_key`
- display/account labels
- auth type
- API base URL
- status and validation status
- credential-material-present boolean

The following are never returned:

- encrypted credentials
- credential references
- passwords
- application passwords
- tokens
- authorization headers
- secret payloads

## Collation behavior

The resolver does not require a broad database collation migration.

Known cross-family relations are handled through bounded SQL reads and application-side exact-key joins. Human labels are normalized in Unicode-aware application logic. Exact identifiers are passed as query parameters.

Collation standardization remains a separate database-governance task and is not coupled to runtime context resolution.

## Statuses

- `resolved`: one authorized resource and its graph were resolved.
- `interpretation_required`: direct matching failed; generate bounded candidates.
- `not_found`: no authorized resource matched.
- `authorization_gated`: signed scope, membership, or resource authority is missing.
- `blocked`: request is invalid or ambiguous.
- `ready_for_live_diagnostic`: diagnostic handoff has Site, grant, Connection, and credential-presence evidence.
- `validating`: diagnostic handoff lacks one or more required surfaces.

## Agent routing rule

1. Use `platform_resource_context_resolve` when the user names any platform resource.
2. Use `platform_resource_context_catalog` when the reference is missing, uncertain, or a UI needs options.
3. On `interpretation_required`, apply `resource_reference_interpreter_v1`, then repeat the resolve call with `candidate_refs`.
4. Use `platform_resource_context_related` after a canonical key is already known.
5. Use `platform_resource_context_diagnostic_handoff` before provider-specific diagnostics.
6. Use `brand_workspace_context_resolve` only for backward compatibility or explicitly Brand-first workflows.
