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

Approve a `ready_requires_approval` envelope with:

```text
capability_resolution_envelope_approve
```

The approval helper writes an `approval_holds` row, flips the envelope to `ready_for_dispatch`, updates the envelope hash, and still does not execute the target capability. It rejects expired envelopes, secret-marked envelopes, envelopes with blocking gaps, and envelopes that are not already `dispatch_allowed`.

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

## Second enforced family: Hostinger SSH deploy

`hostinger_deploy_capability_envelope_requirement_v1` makes Hostinger SSH deploy execution require a valid `capability_envelope_id` before the executor resolves SSH credentials or spawns SSH. Dry-run planning and read-only SSH probes remain available without a deploy envelope.

Runtime enforcement checks:

```text
envelope_status = ready_for_dispatch
dispatch_allowed = true
approval_required = false
blocking_gap_count = 0
app_key in remote_ssh_runtime | hostinger
tenant/user match when present
not expired
secrets_included = false
operation_intent in deploy/restart/write/deploy_release
```

The existing Hostinger deploy protections still apply: `REMOTE_RUNTIME_HOSTINGER_SSH_EXECUTOR_ENABLED=true`, approval reason, fixed expected main commit SHA, target path allowlist, bounded output, and no freeform shell.

## Shared envelope guard

`capabilityResolutionEnvelopeGuard.js` is the shared runtime verifier for family-specific execution gates. New state-changing families should call `resolveCapabilityExecutionEnvelope` rather than duplicating SQL checks.

Each family supplies only its context:

```text
acceptedAppKeys
acceptedIntents
expectedTenantId
expectedUserId
optional expectedCommitSha
executionRef for markCapabilityEnvelopeReferenced
```

The shared guard enforces the common contract:

```text
ready_for_dispatch
dispatch_allowed
no approval_required
no blocking gaps
not expired
not already consumed/cancelled
secrets_included = false
tenant/user match when present
```

WordPress and Hostinger currently use this helper while keeping their family-specific wrappers and response style.

## Third enforced family: n8n state-changing workflow control

`n8n_state_changing_capability_envelope_requirement_v1` makes local n8n state-changing connector actions require `capability_envelope_id` before connector forwarding.

Envelope is required for:

```text
start
stop
restart
activate_workflow
deactivate_workflow
run_workflow
execute_workflow
```

Envelope is not required for read-only actions:

```text
status
diagnose
health
list_workflows
get_workflow
list_executions
open
```

The gate runs before `buildForwardOptions`, so the platform n8n API-key bridge is not injected unless the state-changing action has a valid envelope.

## Budget + quota authority registry

`budget_quota_authority_registry_policy_v1` introduces the scoped authority layer required before spend-changing or platform-cost actions execute. It is dry-run only and does not call providers, forward connector requests, or change spend.

Use:

```text
budget_quota_authority_dry_run
```

Authority can be scoped by:

```text
tenant
workspace
brand
app
capability
operation_intent
meter
```

The dry-run returns one of:

```text
blocked_missing_budget_quota_authority
blocked_budget_quota_limit
ready_requires_approval
ready_for_dispatch
```

This is the prerequisite layer for Google Ads budget changes, OpenRouter/Codex platform fallback quota, Make/custom API writes, and browser side-effect sessions.

## Fifth enforced family foundation: Google Ads budget change preflight

`google_ads_budget_change_preflight_policy_v1` introduces the first spend-changing family gate. It is preflight only and does not call Google Ads, read Google Ads credentials, or mutate campaign budgets.

The preflight requires:

```text
capability_envelope_id with app_key = google_ads
budget_quota_authority_dry_run decision = ready_for_dispatch
requested_amount_minor > 0
```

Blocked outputs include:

```text
blocked_invalid_requested_amount
capability_resolution_envelope_required / not ready
blocked_missing_budget_quota_authority
blocked_budget_quota_limit
```

A future Google Ads execution adapter must call this preflight before any Google Ads API mutation.

`google_ads_budget_preflight_binding_policy_v1` keeps that separation explicit:

```text
google_ads_budget_change_preflight credential_source = none
googleads_api credential_source = user_connection
```

That means preflight envelopes can be created without Google Ads credentials, while real Google Ads execution remains blocked until a genuine user connection and execution adapter exist.

`google_ads_budget_preflight_ledger_policy_v1` records every Google Ads budget preflight result in `google_ads_budget_preflight_ledger`. The result includes `preflight_id`, `preflight_sha256`, decision, envelope ID, matched budget authority, blocking gap count, and no-provider/no-spend markers. A future Google Ads execution adapter must require a ready `preflight_id` and verify the ledger hash/readback before any API mutation.

`google_ads_budget_preflight_ledger_policy_v1` records every Google Ads budget preflight result in `google_ads_budget_preflight_ledger`. The result includes `preflight_id`, `preflight_sha256`, decision, envelope ID, matched budget authority, blocking gap count, and no-provider/no-spend markers. A future Google Ads execution adapter must require a ready `preflight_id` and verify the ledger hash/readback before any API mutation.

## Fourth enforced family: GitHub repository patch apply

`repo_patch_apply_capability_envelope_requirement_v1` makes `repo_patch_apply` require `capability_envelope_id` before GitHub App token resolution or repository content mutation.

`repo_inspect` remains read-only and does not require an envelope.

Runtime order:

```text
input/path validation
protected-branch guard
capability envelope guard
GitHub App token resolution
branch compare / stale-branch preflight
GitHub contents mutation
```

The existing repository protections still apply: protected branch blocking, stale/diverged branch guard, path denylist, single-file patch scope, and governed preflight.

## Generic preflight ledger validator

`preflight_ledger_validator_policy_v1` adds the generic validator:

```text
preflight_ledger_validate --family-key google_ads_budget --preflight-id <id>
```

The validator checks active registry authority, table allowlist, ready state, optional envelope match, no-provider/no-spend markers, no-secret markers, and `preflight_sha256` against the stored JSON payload. Future execution adapters should call this validator instead of reading family ledgers directly.

`preflight_execution_gate_helper_policy_v1` adds the importable helper:

```text
requireValidatedPreflightForExecution(...)
```

Execution adapters must use this helper before any mutation. The helper wraps `preflight_ledger_validate`, requires `ready_for_dispatch`, optionally enforces envelope match, returns the validated preflight context, and does not call providers or connectors.

## Google Ads execution adapter skeleton

`google_ads_budget_execution_adapter_skeleton_policy_v1` adds a disabled/no-op skeleton for future Google Ads budget execution. It calls `requireValidatedPreflightForExecution`, records an audit row, then blocks with `blocked_google_ads_execution_adapter_not_implemented`. The admin endpoint registry row remains `is_enabled=0`; real Google Ads credentials and a separate execution implementation are still required before any provider call or spend mutation can exist.

`google_ads_credential_readiness_gate_policy_v1` adds a separate readiness gate for future execution. It checks only `user_app_connections` and `credential_bindings` metadata: active Google Ads connection, credential reference presence, validation freshness, and active binding. It does not read encrypted credentials, decrypt tokens, call Google Ads, or mutate spend.

`google_ads_credential_readiness_ledger_policy_v1` records every readiness result in `google_ads_credential_readiness_ledger`. Each row includes `credential_readiness_id`, decision, connection metadata, binding counts, validation freshness, `readiness_sha256`, and no-payload/no-provider/no-spend markers. Future execution must require a ready `credential_readiness_id` with hash/readback instead of using a transient readiness response.

`ads_provider_capability_profile_registry_policy_v1` starts the provider-agnostic ads governance layer. `ads_provider_capability_profile_registry` maps a provider such as `google_ads`, `meta_ads`, or `tiktok_ads` to its spend capability key, budget meter, credential source, preflight tool, ledgers, validators, readiness gate, execution adapter, and enablement family. `google_ads` is the first active profile; every future ads provider must have a profile and remains `execution_enabled_default=false`.

`ads_provider_profile_onboarding_flow_policy_v1` governs future provider onboarding:

```text
ads_provider_profile_request
→ approval_holds pending approval
→ ads_provider_profile_approve
→ draft ads_provider_capability_profile_registry row
→ ads_provider_profile_disable
```

Approval creates a `draft` profile only. It does not create preflight tools, credential readiness tools, execution adapters, provider credentials, or spend surfaces.

`ads_provider_preflight_contract_policy_v1` defines the generic contract that must pass before any provider-specific preflight surface can be designed. The validator reads the provider profile, confirms core capability/meter/credential/governance fields, enforces `execution_enabled_default=false`, and returns either `ready_for_preflight_surface_design` for draft profiles or `ready_existing_preflight_surface_contract` for providers that already have preflight surfaces. It does not create provider tools or call providers.

`execution_enablement_registry_policy_v1` adds the final explicit enablement gate. Provider execution remains disabled unless `execution_enablement_registry` contains an active row for the exact family/adapter scope. The Google Ads skeleton now calls `execution_enablement_gate` after preflight validation and blocks with `blocked_execution_enablement_missing_or_disabled` when no row exists. This registry is intentionally empty by default.

`execution_enablement_approval_flow_policy_v1` adds the governed lifecycle for those rows:

```text
execution_enablement_request
→ approval_holds pending approval
→ execution_enablement_approve
→ scoped expiring execution_enablement_registry row
→ execution_enablement_revoke
```

The flow is governance-only. It creates/approves/revokes enablement rows, but does not call providers, read credentials, or mutate spend.

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
