# Dynamic Capability Resolution Graph

## Goal

The platform should not ask users to make a flat `managed` versus `dedicated` choice for every tool. Capabilities are resolved dynamically from context, authority, available credentials, runtime surfaces, and risk.

```text
Capabilities are resolved, not assigned.
```

## Current constraint

`workspace_registry.workspace_type` currently supports only:

```text
brand
project
campaign
sandbox
```

Extended archetypes such as `freelancer_workspace`, `agency_workspace`, `client_workspace`, and `personal_workspace` are policy-context labels in `dynamic_capability_resolution_policy_v1` until a separate schema migration explicitly expands the enum.

## Resolution context

A capability request is evaluated using these dimensions:

```text
tenant_id
workspace_id
workspace_type
user_id
user_role
brand_key
business_activity_type
app_key
capability_key
operation_intent
runtime_surface
```

The resolver reads platform evidence from live registry surfaces:

```text
workspace_registry
workspace_resource_grants / v_workspace_resource_grant_effective
brand_core
business_activity_types
app_integrations
v_app_integration_capability_map
user_app_connections
credential_bindings
runtime_dispatch_certification_registry
```

## Source tiers

The policy registry stores source tiers in `dynamic_capability_source_tiers_v1`:

```text
user_owned_personal
workspace_owner_managed
freelancer_managed_service
agency_managed_service
tenant_managed
brand_managed
client_dedicated
local_device_runtime
remote_dedicated_runtime
platform_managed_fallback
blocked_requires_setup
```

The selected tier is evidence-driven. The resolver must not assume a credential exists just because a policy tier exists.

## Mandatory gates

Every dry-run envelope must enforce:

```text
no_secrets_returned = true
dry_run_before_dispatch = true
audit_required = true
brand_core_required_when_activity_requires_brand_core = true
resource_grant_required_for_high_risk = true
dispatch_certification_required_for_high_risk = true
platform_fallback_requires_quota_audit_disclosure = true
admin_personal_oauth_must_not_be_shared = true
write_publish_deploy_require_approval_or_policy_grant = true
```

## Output contract

The resolver returns an execution envelope. It does not execute the capability.

```json
{
  "request_context": {},
  "capability": {},
  "selected_source": {},
  "authority": {},
  "gates": {},
  "fallback_chain": [],
  "blocking_gaps": [],
  "decision": "ready_for_dispatch | ready_requires_approval | blocked_missing_authority_or_binding | blocked_requires_setup",
  "secrets_included": false
}
```

The output must not include raw secrets, OAuth tokens, API key values, private keys, or decrypted credentials.

## Initial target families

The first families to bind into this resolver are:

```text
Codex
OpenRouter / OpenClaude
WordPress
Remote SSH / Hostinger
Browser Runtime
GitHub
Google Workspace
Automation MCP
```

These cover personal/local tools, tenant app credentials, platform-managed fallback, and high-risk infrastructure runtimes.

## Realistic simulation suite

`dynamic_capability_use_case_simulation_suite_v1` captures realistic, policy-only use cases before schema or runtime expansion. It currently covers:

```text
freelancer_wordpress_publish_managed_service
client_owned_wordpress_publish_dedicated
codex_user_owned_local_review
codex_platform_managed_fallback_review
remote_ssh_production_deploy
hostinger_dns_update
github_docs_pr_platform_managed
google_analytics_read_brand_dashboard
google_ads_budget_change
google_tag_manager_publish
n8n_activate_workflow
make_mcp_trigger_read_only
browser_visual_inspection
custom_api_webhook_write
```

Run the governed simulation tool:

```text
capability_resolution_simulation_suite
```

Optional flags:

```text
--family wordpress
--scenario freelancer_wordpress_publish_managed_service
--no-live-registry
--explain
```

The simulation suite does not execute tools or provider calls. It compares each scenario to live app registry coverage and reports:

```text
covered_by_policy
registry_gap
policy_gap
```

Recommended expansions are recorded as proposals only. For example, `workspace_enum_expansion` is explicitly `defer_until_impact_review`, while `budget_and_quota_authority_registry` remains a candidate future schema change.

## Envelope ledger

`capability_resolution_envelope_ledger` stores the no-secret output of a dry-run resolution before execution. The stored row is an immutable authority reference with a SHA-256 hash, TTL, selected source tier, gates, blocking gap count, and execution status.

Create an envelope with:

```text
capability_resolution_envelope_create
```

Example:

```text
--tenant-id <tenant>
--user-id <user>
--app-key wordpress_rest
--operation-intent publish
--requested-by gpt_admin
--ttl-minutes 60
```

The ledger creator does not execute the selected capability. It runs `capability_resolution_dry_run`, redacts dangerous keys defensively, stores the envelope JSON and hash, and returns an `envelope_id`. Future execution tools should require this ID and must reject expired envelopes or envelopes whose gates do not permit dispatch/apply.

## First enforced family: WordPress write/publish

`wordpress_write_capability_envelope_requirement_v1` makes WordPress post creation require a valid `capability_envelope_id` before the orchestrator calls WordPress. Credential intake and diagnostics remain available without an envelope because they do not execute a WordPress write.

Runtime enforcement checks:

```text
envelope_status = ready_for_dispatch
dispatch_allowed = true
approval_required = false
blocking_gap_count = 0
app_key = wordpress_rest
tenant/user match when present
not expired
secrets_included = false
```

A blocked envelope produces no WordPress POST and returns a governed blocked response.

## Dry-run tool

The governed tool is:

```text
capability_resolution_dry_run
```

Example flags:

```text
--tenant-id <tenant>
--user-id <user>
--workspace-id <workspace>
--brand-key <brand>
--business-activity-type <activity>
--app-key wordpress_rest
--operation-intent publish
--explain
```

The tool reads registry metadata and returns the resolution envelope only.
