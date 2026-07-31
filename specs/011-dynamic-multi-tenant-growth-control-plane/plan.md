# Implementation Plan

## Delivery strategy

The Spec Kit is delivered in one specification PR. Runtime implementation is multi-PR because it requires additive migrations, registry seeds, resolver shadowing, Admin/Tenant APIs, UI work, staging validation, cohort rollout, production parity, and post-merge audit.

## Architectural decision

Use the existing MySQL-primary registries and capability assurance graph as authority. Add only missing logical resources and source links. Do not create a competing generic configuration database or a second workflow/capability authority.

## Workstreams

### 1. Canonical scope and resource descriptors

- Define logical resources for Activity Packs, brand activity bindings, configuration definitions/versions, workflow composition, UI manifests, and rollout cohorts.
- Declare Admin and Tenant operation matrices.
- Add field allowlists, revisions, changes, lifecycle, permissions, and readback contracts.

### 2. Configuration registry and resolver

- Register typed configuration definitions and JSON Schemas.
- Add sparse scope values and immutable published versions.
- Implement deterministic precedence, merge operators, lineage, revision vectors, and hashes.
- Shadow-compare against existing settings paths before cutover.

### 3. Activity Pack registry

- Define manifests, entity schemas, knowledge pointers, KPI definitions, capabilities, workflow templates, policies, providers, and tests.
- Onboard travel as the first reference pack without copying Brand Core data.
- Validate multi-activity brand bindings and ambiguity behavior.

### 4. Plan composition

- Resolve context through the governed resource/context layer.
- Resolve semantic capabilities before workflow/provider selection.
- Compile immutable workflow plans from DAG definitions.
- Persist the exact resolved versions and policy requirements.

### 5. Policy and execution boundaries

- Compile effective mutation, approval, resource, certification, idempotency, rollback, quota, and readback requirements.
- Separate internal draft, staging, canary, and production effects.
- Revalidate all authority at the final execution boundary.

### 6. Provider abstraction

- Register provider-independent operation contracts.
- Certify adapters against shared readiness/dispatch/readback ports.
- Introduce deterministic ranking and ambiguity blocking.
- Keep credentials and provider payloads outside control-plane responses.

### 7. Dynamic Admin and Tenant UI

- Render configuration forms from schemas and manifests.
- Show effective values with source lineage and unresolved blockers.
- Expose bounded change previews and approval requests.
- Keep Admin diagnostics and Tenant-safe views separate.

### 8. Events, cache, analytics, and operations

- Add typed events for version activation, invalidation, plan lifecycle, and readback failures.
- Partition queues, caches, leases, and concurrency by tenant/brand.
- Normalize KPI identity without flattening activity semantics.
- Add SLOs, alerts, drift reconciliation, and rollback dashboards.

## Layering

```text
interfaces/api
  -> application use cases and orchestration
    -> domain resolvers, policy, compatibility and state machines
      <- infrastructure repositories, cache, queue, provider and event adapters
```

No controller may assemble policy or call provider repositories directly.

## Initial reference slice

The first vertical slice is internal-only:

1. Read a tenant, workspace, brand, and travel activity binding.
2. Resolve one versioned configuration family.
3. Compile an internal artifact workflow with three capabilities.
4. Persist the resolution snapshot and output artifacts.
5. Create execution approval holds for any provider nodes.
6. Return no-secret readback and lineage.

No provider mutation is allowed in the first slice.

## Validation approach

- Static JSON Schema and OpenAPI validation.
- Deterministic resolver golden tests.
- Cross-tenant and cross-brand denial tests.
- Workflow DAG compilation and cycle tests.
- Policy strictness and approval-boundary tests.
- Adapter ambiguity and certification tests.
- Cache invalidation and historical snapshot replay tests.
- Shadow parity before any active enforcement.

## Exit criteria for implementation

- All logical resources have complete operation matrices.
- Migrations are applied and verified through governed ledger/readback.
- Required CI and release-readiness checks pass.
- Dev/staging shadow evidence meets minimum sample and mismatch thresholds.
- Production canary has explicit approval and rollback.
- Production parity and post-merge audit are recorded in `completion.json`.
