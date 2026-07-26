# Architecture and Domain Model

## Independent graphs

Use three independent typed graphs:

1. **Containment/ownership** — what organizational scope owns a resource.
2. **Authority/delegation** — which principal may perform which operation on which resource.
3. **Configuration inheritance** — where policies, settings, and preferences are resolved from.

A single `parent_container_id` cannot safely represent all three.

## Canonical entities

### Containers and authority

- `containers`
- `container_relationships`
- `principals`
- `authority_grants`
- `resource_authority_bindings`

Relationship types include:

- `contains`
- `owns`
- `governs`
- `administers`
- `attached_to`
- `operates_for`
- `delegated_to`
- `inherits_policy_from`
- `inherits_settings_from`

### Shared and tenant assets

- `asset_definitions`
- `asset_versions`
- `asset_publication_policies`
- `asset_installations`
- `asset_overrides`
- `asset_extensions`
- `asset_forks`
- `asset_upgrade_policies`
- `asset_compatibility_results`

Platform canonicals are referenced, not copied, for normal installations. Structural divergence uses extension or fork. Fork lineage never copies authority or credentials.

### Workflow model

- `workflow_definitions`
- `workflow_versions`
- `workflow_steps`
- `workflow_edges`
- `workflow_compiled_plans`
- `workflow_validation_results`

Active versions are immutable.

### Runtime records

- `workflow_runs`
- `workflow_step_runs`
- `workflow_run_transitions`
- `workflow_run_claims`
- `workflow_idempotency_records`
- `workflow_approval_holds`
- `workflow_callbacks`
- `workflow_retry_schedules`
- `workflow_compensation_records`
- `workflow_outbox`
- `workflow_readback_evidence`

### Settings

- `workflow_setting_definitions`
- `workflow_setting_scope_values`
- `workflow_setting_resolution_snapshots`
- `workflow_setting_resolution_events`
- `workflow_runtime_adapter_preferences`
- `workflow_runtime_adapter_constraints`

## Settings resolution

Non-security precedence from least to most specific:

1. Platform
2. Tenant
3. Workspace
4. Business Activity Type
5. Brand
6. Department/Group
7. Role/Profile
8. AI Agent
9. User
10. Workflow Version
11. Workflow Step
12. Task/Session

Platform-owned execution may omit tenant scopes. Tenant-owned execution must resolve tenant and workspace.

Merge operators:

- `strict_intersection`
- `deny_wins`
- `minimum`
- `maximum`
- `priority_replace`
- `guarded_union`
- `append_unique`
- `block_on_ambiguity`

Each run persists canonical resolved JSON, source lineage, decision events, and a SHA-256 hash before dispatch.

## Runtime adapter contract

Adapter keys:

- `platform_native`
- `n8n_webhook`
- `n8n_api`
- `make_mcp`
- `generic_mcp`
- `http_action`
- `agent_runtime`

Required interface:

```text
resolveReadiness(context)
validateInput(plan, context)
dispatch(plan, context, idempotency)
inspect(receipt, context)
cancel(receipt, context)
readback(receipt, context)
normalizeOutput(raw, context)
```

Readiness states:

- `ready`
- `ready_requires_approval`
- `degraded`
- `blocked`
- `unsupported`

The platform owns workflow definition, version, policy, approval, state, audit, and readback. Adapters execute bounded plans only.

## State machine

Workflow version lifecycle:

`draft -> compiled -> validated -> awaiting_approval -> active -> deprecated -> retired`

Run states:

- `draft`
- `compiled`
- `validated`
- `awaiting_approval`
- `ready`
- `claimed`
- `running`
- `awaiting_external_callback`
- `verifying`
- `completed`
- `completed_with_warnings`
- `paused`
- `retry_scheduled`
- `compensating`
- `cancelled`
- `failed`
- `blocked`

Every transition supplies `expectedState` and `expectedVersion`. Invalid or stale transitions return `409 STATE_VERSION_CONFLICT`.

## Authority rules

A principal is not a container. Administrative access is expressed by grants, not by moving tenant resources under an admin workspace.

Platform-owned resources may be operated without fake tenant/workspace identities only when:

1. the principal has a verified platform-admin assertion;
2. the resource is platform-owned;
3. an exact resource binding exists;
4. capability and endpoint are certified;
5. risk policy and approval are satisfied;
6. same-cycle readback exists.

Tenant-owned resources still require tenant/workspace scope and isolation.

`execution_class`, preferences, forks, and runtime selection never grant authority.
