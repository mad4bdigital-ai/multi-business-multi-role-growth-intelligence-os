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
