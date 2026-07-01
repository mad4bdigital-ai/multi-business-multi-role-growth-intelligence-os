# Canonical Data Model

## Design principles

1. Every durable resource has one canonical identifier and one owning container.
2. Containment, authority, configuration inheritance, runtime binding, and credential ownership are independent relationships.
3. Published and active versions are immutable.
4. Tenant customization is sparse local state or explicit lineage, never a silent rewrite of a platform canonical.
5. Every external dispatch and state transition is reconstructable from immutable evidence.

## Container graph

### `containers`

| Column | Purpose |
|---|---|
| `container_id` | Stable opaque identifier |
| `container_key` | Human-stable key unique within scope |
| `container_type` | `platform_scope`, `tenant_scope`, `workspace`, `business_activity`, `brand`, `department`, `group`, `agent`, `user_scope` |
| `scope_class` | `platform`, `tenant`, `shared` |
| `owner_container_id` | Organizational owner; null only for root platform/tenant scopes |
| `tenant_id` | Required for tenant-owned containers; absent for platform-owned containers |
| `status` | `draft`, `active`, `suspended`, `archived` |
| timestamps | Audit timestamps |

Required seed topology:

```text
platform:root
└── workspace:platform-admin
    └── brand:growth_intelligence_platform
```

Tenant workspaces are owned by their tenant scope and never by `workspace:platform-admin`.

### `container_relationships`

Typed edge table:

- `relationship_id`
- `source_container_id`
- `target_container_id`
- `relationship_type`
- `settings_inheritance_enabled`
- `authority_inheritance_enabled`
- `priority_order`
- `constraints_json`
- `effective_from`, `effective_until`
- `status`

Allowed relationship types:

- `contains`
- `owns`
- `governs`
- `administers`
- `attached_to`
- `operates_for`
- `delegated_to`
- `inherits_policy_from`
- `inherits_settings_from`

Graph validation MUST reject cycles for `contains`, `owns`, and configuration-inheritance edges.

## Principal and authority model

### `principals`

- `principal_id`
- `principal_type`: `platform_admin`, `tenant_member`, `service_principal`, `ai_agent`, `user`
- `external_subject_ref`
- `auth_mode`
- `status`
- timestamps

### `authority_grants`

- principal and exact target resource/container
- capability/permission key
- allow/deny effect
- constraints JSON
- approval and certification requirements
- validity window
- grant source and audit reference
- status

Deny edges override allow edges. Grants do not imply ownership or settings inheritance.

### `resource_authority_bindings`

Binds a governed resource reference to an authority domain:

- resource type and canonical URI
- exact provider/repository/workflow/asset reference
- owner container
- allowed capability families and modes
- readback contract
- expiry and status

## Asset catalog

### `asset_definitions`

Canonical identity:

- `asset_id`
- `asset_key`
- `asset_type`: `ai_agent`, `workflow`, `skill`, `prompt`, `knowledge_package`, `output_template`, `runtime_profile`
- owner container
- lifecycle status
- default publication policy reference

### `asset_versions`

Immutable payload:

- semantic version
- schema version
- canonical normalized payload
- content hash
- compatibility metadata
- certification status
- lifecycle status

`active`, `deprecated`, and `retired` rows are immutable.

### `asset_publication_policies`

- visibility: `private`, `platform_internal`, `tenant_available`, `tenant_default`, `mandatory_policy`, `deprecated`
- audience selector
- installation mode
- customization modes allowed
- version policy allowed
- mandatory constraints
- publication window
- approval requirements

### `asset_installations`

A tenant installation references the platform asset/version without copying the canonical payload:

- installation owner container
- platform asset/version
- version policy: `auto_upgrade`, `approval_required`, `version_pinned`
- binding targets: workspace, activity, brand, agent
- status
- installed/approved by and timestamps

### `asset_overrides`

Sparse values only:

- installation/version scope
- JSON pointer or setting key
- typed value
- validation schema version
- source principal
- status and timestamps

### `asset_extensions`

Explicit extension points:

- `pre`, `post`, or named extension point
- ordered tenant-owned steps
- compatibility requirements
- validation result

### `asset_forks`

- tenant-owned asset and current version
- immutable origin asset/version
- fork reason
- synchronization policy
- latest compatibility report
- no copied credentials, grants, or approvals

## Workflow definition model

### `workflow_definitions`

- canonical workflow identity
- owner container
- source asset/fork lineage
- publication/customization policy
- lifecycle status

### `workflow_versions`

- semantic version
- immutable normalized definition
- content hash
- status: `draft`, `compiled`, `validated`, `awaiting_approval`, `active`, `deprecated`, `retired`
- compiler and policy versions
- created/approved/activated audit references

### `workflow_steps`

Step types:

`action`, `workflow`, `agent`, `decision`, `condition`, `parallel`, `join`, `approval`, `wait`, `callback`, `checkpoint`, `transform`, `verification`, `compensation`, `stop`.

Each step declares:

- input/output schemas
- execution mode
- timeout/retry bounds
- authority requirements
- adapter capability requirements
- extension points
- compensation reference
- mandatory verification/readback policy

### `workflow_edges`

- source/target step
- deterministic condition
- priority
- join semantics
- error route
- compensation route

### `workflow_compiled_plans`

Compiler output is immutable and records:

- normalized DAG
- resolved extension composition
- required capabilities
- candidate adapter classes
- approval checkpoints
- compensation graph
- canonical hash

## Runtime model

### `workflow_runs`

- exact workflow version and compiled-plan hash
- owner/target container
- authenticated principal reference
- authority decision snapshot
- settings resolution snapshot
- selected adapter decision
- current state and monotonic version
- execution class as metadata only
- timestamps and terminal summary

### `workflow_step_runs`

- run and step key
- attempt number
- state/version
- input/output references and hashes
- adapter receipt
- timeout/retry/compensation data
- readback evidence reference

### `workflow_run_transitions`

Append-only transition ledger containing:

- expected/previous/target state
- expected/previous/new version
- transition reason and command source
- actor principal
- idempotency key
- evidence reference
- timestamp

### `workflow_run_claims`

Atomic lease:

- owner worker
- lease token
- acquired/heartbeat/expiry times
- attempt
- status

### `workflow_idempotency_records`

Unique key over operation scope, target resource, and idempotency key. Stores request hash and canonical response/result reference.

### `workflow_outbox`

Transactional dispatch/delivery queue:

- event/command type
- aggregate and version
- payload reference and hash
- destination adapter/action
- idempotency key
- attempt/next-at
- state and terminal evidence

### `workflow_callbacks`

- opaque callback token hash
- run/step/adapter binding
- expected event type
- signature policy and key reference
- nonce hash
- expiry
- idempotency result
- verification state

### `workflow_readback_evidence`

- provider receipt reference
- expected vs observed effect
- normalized status/output
- evidence hash
- verification time and freshness
- secret-redaction declaration

## Settings model

- `workflow_setting_definitions`
- `workflow_setting_scope_values`
- `workflow_setting_resolution_snapshots`
- `workflow_setting_resolution_events`
- `workflow_runtime_adapter_preferences`
- `workflow_runtime_adapter_constraints`

## Database invariants and indexes

- Unique `(owner_container_id, asset_key)` and `(workflow_definition_id, semantic_version)`.
- Unique idempotency scope/key.
- Unique active claim per run/step.
- Optimistic lock on run/step version.
- Foreign keys for canonical ownership; soft-retire instead of destructive deletion.
- Composite indexes for tenant/container/status, runnable-state/next-at, outbox-state/next-at, callback-token/expiry.
- No secret values in JSON payloads; only governed references.
