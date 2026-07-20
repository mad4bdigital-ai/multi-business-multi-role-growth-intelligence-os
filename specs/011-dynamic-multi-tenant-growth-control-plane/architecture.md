# Architecture

## Principle

Dynamic growth comes from composing governed data and versions, not from moving security and execution logic into editable configuration.

```text
Stable Runtime Kernel
├── principal and tenant isolation
├── resource authority
├── schema validation
├── capability governance
├── orchestration and state machine
├── idempotency, leases and outbox
├── audit and evidence
└── readback and rollback coordination

Dynamic Control Plane
├── registries and aliases
├── Activity Packs
├── configuration definitions and versions
├── capability and workflow composition
├── logic and knowledge pointers
├── policy and approval profiles
├── provider bindings and preferences
├── KPI and event definitions
├── UI manifests
└── feature cohorts
```

## Independent graphs

1. **Containment graph:** platform, tenant, workspace, brand, business activity, asset, plan, and run ownership.
2. **Authority graph:** principal, role, grant, capability, resource, connection, approval, certification, and readback.
3. **Configuration graph:** default, inheritance, override, dependency, compatibility, and effective version relationships.
4. **Workflow graph:** capability nodes and typed execution/data dependencies.
5. **Evidence graph:** plan, decision, run, output, provider receipt, readback, and audit lineage.

No single parent column may represent these graphs.

## Resolution pipeline

```text
request
→ authenticated principal
→ tenant/workspace membership
→ canonical resource and brand
→ business activity binding
→ active Brand Core version
→ active Activity Pack
→ objective and channel
→ semantic capabilities
→ compatible workflow versions
→ configuration and policy resolution
→ logic/knowledge pointers
→ provider/resource readiness
→ immutable plan snapshot
→ internal execution or approval holds
→ bounded dispatch
→ readback and evidence
```

Every stage returns `pass`, `deny`, `not_applicable`, or `not_evaluated`, with stable reason codes.

## Control-plane components

### Registry catalog

Provides canonical identities, versions, lifecycle, search, dependency references, and source provenance. Aliases never grant authority.

### Configuration service

Validates schemas, creates drafts, resolves inheritance, publishes immutable versions, computes hashes, and emits invalidation events.

### Activity Pack service

Validates package completeness and compatibility. It links activity-specific entities, knowledge, KPIs, policies, capabilities, workflows, and provider support.

### Plan compiler

Builds a deterministic DAG from the selected workflow and effective settings. It performs schema, capability, dependency, policy, and fan-out validation.

### Policy compiler

Combines platform mandatory controls with activity, tenant, brand, workflow, provider, and request-specific requirements. Less-specific security restrictions cannot be weakened.

### Adapter resolver

Ranks certified provider/runtime adapters by explicit scope, compatibility, health, rollout, and preference. Equal top rank blocks.

### UI manifest service

Projects schemas and bounded metadata into Admin/Tenant forms and dashboards. It never bypasses backend validation or authorization.

### Event and invalidation service

Publishes typed no-secret lifecycle events and invalidates affected caches, projections, plans, and readiness views.

## Tenancy and resource isolation

Every operational key includes `tenant_id` and, where applicable, `workspace_id`, `brand_id`, `activity_binding_id`, and `resource_id`. SQL predicates, cache keys, queues, leases, idempotency keys, provider bindings, analytics, audit, and readback use canonical IDs.

A user may hold different roles for different workspaces or brands. Platform administration is expressed through grants; tenant resources are never moved under a platform workspace to imply authority.

## Dynamic versus code boundaries

### Configuration-only changes

- activate an existing Activity Pack version;
- change a schema-valid override;
- publish a workflow graph using certified capabilities;
- update provider preference or rollout cohort;
- publish a UI manifest using supported field types;
- update bounded policy parameters.

### Code and governed release required

- new capability executor or merge operator;
- new provider adapter or field component;
- new policy operator;
- stable kernel or security behavior;
- new data transformation or event transport;
- destructive or incompatible schema change.

## Transaction boundaries

- Draft creation and validation are internal SQL operations.
- Publishing a version atomically records the immutable version, active pointer transition, audit event, and outbox invalidation.
- Plan compilation atomically stores the graph, resolution snapshot, hash, policy requirements, and approval holds.
- Provider dispatch uses an outbox or equivalent atomic boundary.
- Readback and terminal state transition use compare-and-set semantics.

## Failure posture

Missing context, schema, policy, capability, knowledge, adapter, credential, grant, approval, certification, or readback contract blocks. Unknown external effect allows inspection/reconciliation, not automatic retry.
