# Feature Specification: Dynamic Multi-Tenant Growth Control Plane

**Branch:** `gpt/011-dynamic-multi-tenant-growth-control-plane-20260720`  
**Status:** Deep design complete; implementation pending

## Problem statement

The platform must support growing numbers of tenants, workspaces, users, brands, business activities, channels, providers, policies, workflows, and configuration variants. Hard-coded tenant, brand, activity, provider, and workflow branches would create unsafe coupling, duplicated logic, inconsistent authorization, and costly releases.

The feature MUST provide a schema-driven and registry-first control plane that composes the existing workflow runtime and capability governance authorities without turning arbitrary configuration into executable code.

## Goals

1. Make tenant, brand, activity, workflow, policy, provider, and UI configuration declarative, typed, versioned, auditable, and reversible.
2. Preserve a small stable runtime kernel for security, isolation, orchestration, state, audit, and readback.
3. Resolve every business request through explicit tenant, workspace, brand, activity, objective, capability, workflow, policy, and resource context.
4. Allow new activities, capabilities, workflows, and providers to be added through governed registration and certification.
5. Support safe overrides without copying platform canonicals or weakening mandatory controls.
6. Produce deterministic resolution snapshots that explain every effective value and decision.
7. Enable phased internal, staging, canary, and production execution with separate approvals and readback.

## Non-goals

- No arbitrary JavaScript, SQL, prompt, or executable expression stored as configuration authority.
- No automatic provider write, tenant export, workflow activation, or production rollout in the specification PR.
- No replacement of Spec 006 workflow runtime, Spec 007 capability governance, signed principal context, or MySQL-primary authority.
- No implicit tenant, brand, or activity selection from conversation history.
- No shared credential or resource binding across tenants unless an explicit governed platform-owned resource contract permits it.
- No destructive migration in the initial rollout.

## Actors

- Platform administrator.
- Tenant owner or administrator.
- Workspace administrator.
- Brand manager.
- Growth strategist or analyst.
- Workflow operator and reviewer.
- Developer adding an Activity Pack, capability, provider adapter, or UI field type.
- Auditor and security reviewer.

## Core user scenarios

1. A tenant administrator creates two workspaces and five brands, each with independent activity and provider bindings.
2. A brand manager activates a travel Activity Pack and configures markets, locales, channels, freshness, and approval rules without a code deployment.
3. A platform administrator publishes a new workflow version and limits adoption to a pilot cohort.
4. A developer registers a new activity package with schemas, KPIs, workflows, policies, tests, and compatibility rules.
5. A workflow operator generates internal artifacts, reviews them, then requests a separately approved staging execution.
6. A tenant portfolio analyst compares normalized KPIs without exposing another tenant or mixing incompatible raw metrics.
7. A provider adapter becomes unavailable and the resolver selects another certified compatible adapter or blocks on ambiguity.
8. A configuration change fails validation or introduces a policy conflict and remains draft without affecting active runs.
9. A historical run is reproduced using its immutable resolution snapshot after newer configuration versions are active.
10. A platform administrator rolls back a workflow, Activity Pack, policy, or configuration version for a bounded cohort.

## Functional requirements

### Context and tenancy

- **FR-001** Every business operation MUST resolve authenticated principal, tenant, workspace where applicable, brand, business activity, objective, locale, channel, and target environment before planning or dispatch.
- **FR-002** Tenant/user identity MUST come from signed principal context; caller overrides are forbidden.
- **FR-003** Brand, activity, resource, credential, cache, queue, plan, run, artifact, approval, and evidence records MUST carry canonical scope keys.
- **FR-004** Ambiguous or missing brand/activity resolution MUST fail closed with typed remediation guidance.
- **FR-005** Containment, authority, and configuration inheritance MUST remain independent typed graphs.

### Stable kernel and control plane

- **FR-006** The stable kernel MUST own authentication, isolation, authorization enforcement, schema validation, workflow orchestration, state transitions, idempotency, audit, readback, and rollback coordination.
- **FR-007** The control plane MUST own registries, schemas, versions, bindings, policies, workflow graphs, provider preferences, UI manifests, events, and rollout definitions.
- **FR-008** Dynamic definitions MUST NOT bypass the shared capability, resource authority, approval, certification, or readback gates.
- **FR-009** Configuration MUST be data, not unrestricted executable code.

### Registry and identity

- **FR-010** Activity, capability, workflow, logic, knowledge, policy, provider adapter, KPI, event, UI manifest, and feature flag definitions MUST use immutable canonical keys and versions.
- **FR-011** Display names, routes, tool names, aliases, and UI keys MUST NOT grant authority.
- **FR-012** Duplicate active canonical identities or equal top-ranked bindings MUST block resolution.
- **FR-013** Pointer-first resolution MUST select active logic and knowledge versions without embedding file paths in workflows.

### Configuration and inheritance

- **FR-014** Every configurable family MUST have a JSON Schema with `additionalProperties: false` unless a bounded extension point is explicitly defined.
- **FR-015** Effective settings MUST resolve through a declared precedence and merge operator per field.
- **FR-016** Security and compliance settings MUST use deny-wins or most-restrictive semantics.
- **FR-017** Overrides MUST be sparse, versioned, scope-bound, validated, and attributable.
- **FR-018** Active versions MUST be immutable; edits create new drafts.
- **FR-019** Every plan and run MUST persist resolved values, source lineage, revision vector, and SHA-256 snapshot.
- **FR-020** Unknown, stale, invalid, incompatible, or ambiguous configuration MUST block activation or execution.

### Activity Packs

- **FR-021** An Activity Pack MUST declare entity schemas, knowledge profile, KPI taxonomy, compatible capabilities, workflow templates, policies, provider compatibility, tests, and migration compatibility.
- **FR-022** Brands MUST bind to activities explicitly with markets, locales, channels, goals, allowed capabilities, and active versions.
- **FR-023** A brand MAY bind multiple activities only when each binding has independent scope and compatibility evidence.
- **FR-024** Activity Packs MUST NOT copy Brand Core facts; they reference brand-scoped evidence through governed contracts.

### Capabilities and workflow graphs

- **FR-025** Capabilities MUST be small, typed, provider-independent operations with input, output, effect, risk, approval, audit, and readback contracts.
- **FR-026** Workflow versions MUST be immutable DAGs of capability nodes and typed edges.
- **FR-027** Graph validation MUST detect cycles, missing dependencies, incompatible schemas, unavailable capabilities, policy conflicts, and unbounded fan-out.
- **FR-028** Generated workflows MUST remain draft until compilation, compatibility, policy, security, and approval validation pass.
- **FR-029** Provider writes MUST be represented by distinct nodes and cannot be implied by internal artifact generation.

### Policy, provider, UI, events, and rollout

- **FR-030** Policy decisions MUST resolve from canonical policy definitions and bounded conditions, not ad hoc code branches.
- **FR-031** Provider adapters MUST implement a shared readiness, validation, dispatch, inspection, cancellation, readback, and normalization contract.
- **FR-032** Adapter selection MUST be deterministic and certification-gated; ambiguity blocks.
- **FR-033** UI forms and dashboards MAY be generated from schemas and manifests, but UI manifests never grant execution authority.
- **FR-034** Internal events MUST be typed, versioned, tenant/brand scoped, idempotent, and no-secret.
- **FR-035** Feature flags and cohorts MUST support platform, tenant, workspace, brand, activity, and percentage rollout with bounded rollback.

### Approval and execution

- **FR-036** Approval MUST bind actor, capability, plan version, action IDs, target resources, environment, request hash, expiry, and allowed effect.
- **FR-037** Internal draft approval MUST NOT authorize staging or production writes.
- **FR-038** Staging, production canary, and broad production rollout MUST use separate approval boundaries.
- **FR-039** Unknown provider effect permits reconciliation/readback only, not blind retry.
- **FR-040** Every mutation requiring readback MUST produce same-cycle evidence before success classification.

### Analytics, observability, and lifecycle

- **FR-041** Cross-brand portfolio analytics MUST use normalized KPI identities while retaining activity-specific definitions and lineage.
- **FR-042** Runtime caches MUST include scope and version keys and support event-driven invalidation.
- **FR-043** Queues and leases MUST partition by tenant and brand and enforce configured concurrency limits.
- **FR-044** Every decision MUST expose bounded reason codes, source versions, evaluated gates, and evidence references.
- **FR-045** Every dynamic definition MUST support draft, validation, activation, deprecation, archive, and rollback lifecycle states.

### API and resource coverage

- **FR-046** Control-plane APIs MUST use OpenAPI 3.1, strict schemas, stable structured errors, and cursor pagination.
- **FR-047** Every new logical resource MUST define list, get, search, permissions, changes, revisions, and readback or an explicit not-applicable state.
- **FR-048** Tenant responses MUST use field allowlists and exclude credentials, internal policy payloads, and cross-tenant data.
- **FR-049** Existing routes and active workflow versions MUST remain compatible during shadow and cohort rollout.
- **FR-050** Implementation MUST preserve `api -> application -> domain`, with infrastructure adapters behind ports.

## Non-functional requirements

- Deterministic resolution for identical revision vectors.
- Horizontal-safe state transitions, idempotency, leases, retries, and outbox dispatch.
- Additive migrations and reversible activation.
- No-secret logs, traces, manifests, events, errors, or evidence.
- Bounded catalog, search, preview, and graph compilation latency.
- Testable change units and explicit compatibility contracts.

## Success criteria

- **SC-001** A new brand and existing Activity Pack can be configured without runtime code changes.
- **SC-002** A new activity can be added without modifying the stable kernel.
- **SC-003** Identical context and revision inputs produce identical resolution hashes.
- **SC-004** Cross-tenant and cross-brand tests deny before resource or credential access.
- **SC-005** No active workflow or config version is mutated in place.
- **SC-006** All provider writes require separate effect-aware approval and certified readback.
- **SC-007** A tenant administrator can identify the source of every effective setting.
- **SC-008** Feature cohorts can be rolled back without deleting evidence or historical runs.
- **SC-009** Portfolio metrics preserve activity-specific definitions and source lineage.
- **SC-010** The specification can be implemented through bounded additive PRs without a global cutover.
