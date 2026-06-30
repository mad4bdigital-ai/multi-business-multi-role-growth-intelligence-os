# Feature Specification: Dynamic Capability Governance and Universal Tool Projection

**Branch**: `gpt/007-dynamic-capability-governance-20260629`  
**Status**: Deep design complete; implementation pending

## Problem statement

The platform contains multiple valid capability, tool, endpoint, policy, authority, certification, and evidence registries. They are not yet compiled into one deterministic governance manifest for every executable or previewable operation. Local fixes can close individual gaps but do not prevent the same class of gap from recurring on new tools or capabilities.

The feature MUST provide a platform-wide dynamic governance pipeline without introducing a competing capability authority or automatically enabling unsafe execution.

## User scenarios

### Scenario 1 — Platform administrator audits all surfaces

Given active tools, endpoints, actions, workflows, engines, connectors, and semantic capabilities, when an administrator compiles governance manifests, then every surface is mapped to exactly one canonical capability or receives a typed blocking gap.

### Scenario 2 — Tenant user discovers safe capabilities

Given a signed tenant principal and active workspace, when the user lists effective capabilities, then only tenant-safe projections with bounded schemas and current authority evidence are visible. Admin-only tools and cross-tenant details are absent.

### Scenario 3 — New provider capability is onboarded

Given a new provider binding, when it enters the registry, then it remains shadow-only until classification, policy requirements, resource authority, credential scope, certification, readback, and rollout conditions are complete.

### Scenario 4 — State-changing tool is invoked

Given a state-changing request, when it reaches the execution boundary, then the shared kernel revalidates the actor, resource, manifest version, approval, connection, certification, idempotency, and readback contract before dispatch.

### Scenario 5 — Existing specialized policy remains compatible

Given a legacy or provider-specific preflight, when the dynamic kernel is introduced in shadow mode, then both decisions are compared. The new decision cannot authorize an operation denied by legacy enforcement without an approved explanation and migration cohort.

### Scenario 6 — Operational alert lifecycle is repaired generically

Given a mutation tool missing declared policy metadata, when manifests are compiled, then the gap appears as capability debt. After policy and readback contracts are registered and reconciled, the same capability becomes eligible for governed execution without hard-coded tool-name logic.

## Scope

- Inventory and normalize all registered execution and preview surfaces.
- Resolve aliases to immutable canonical capability identities.
- Classify effect, risk, resource, and exposure dynamically.
- Compile governance requirements from declarative authority.
- Produce versioned manifests and typed gaps.
- Derive Admin and Tenant tool projections.
- Enforce a shared invocation-scoped execution decision.
- Select certified adapters deterministically.
- Require capability-specific readback and evidence.
- Reconcile debt, drift, stale certifications, and unsafe projections.
- Migrate existing surfaces through shadow and bounded cohorts.

## Non-goals

- No automatic activation of all capabilities.
- No direct tenant access to Admin tools.
- No replacement of authenticated principal context with caller-supplied tenant IDs.
- No plaintext credential movement or response exposure.
- No global one-step cutover.
- No provider write in the specification PR.
- No destructive schema removal in the initial implementation sequence.
- No monolithic service that combines authorization, transport, and provider serialization.

## Definitions

- **Canonical capability**: immutable provider-independent operation identity.
- **Surface**: action, endpoint, tool, route, intent, workflow, engine, connector, or UI entrypoint.
- **Governance manifest**: versioned compiled requirements and bindings for one canonical capability and scope class.
- **Projection**: Admin or Tenant callable descriptor derived from effective governance state; never independent authority.
- **Adapter**: provider-specific implementation of a canonical capability.
- **Invocation envelope**: short-lived evidence bound to actor, capability, resource, request hash, revisions, and expiry.
- **Readback contract**: capability-specific rule for proving the observed effect.

## Functional requirements

### Canonical inventory and identity

- **FR-001**: The system MUST inventory active and governed rows from actions, endpoints, Admin tools, Tenant tools, endpoint exports, app bindings, task routes, workflows, engines, connectors, semantic capabilities, and registered capability graph sources.
- **FR-002**: Every inventory row MUST map to exactly one canonical capability or a typed unresolved/ambiguous gap.
- **FR-003**: Tool, route, action, intent, endpoint, operationId, and UI keys MUST be aliases and MUST NOT grant authority.
- **FR-004**: Duplicate canonical identities with conflicting policy or resource semantics MUST fail closed.
- **FR-005**: Capability provenance MUST record source table, source key, revision, and no-secret manifest hash.

### Dynamic classification

- **FR-006**: Every capability MUST receive an effect class: `read_only`, `preview_only`, `internal_write`, `workspace_write`, `external_write`, `credential_touching`, `deployment_affecting`, or `destructive`.
- **FR-007**: Every capability MUST receive a risk class using an approved stable taxonomy.
- **FR-008**: Classification precedence MUST be explicit registry declaration, canonical operation semantics, certified binding metadata, bounded input-dependent rules, HTTP method/tags, then conservative fail-closed default.
- **FR-009**: POST or VIRTUAL alone MUST NOT prove mutation when a certified no-effect contract exists.
- **FR-010**: GET or read-like naming MUST NOT override an explicit state-changing effect declaration.
- **FR-011**: Input-dependent mutation classification MUST be deterministic and bounded; unknown variants fail closed.

### Requirement compilation

- **FR-012**: The compiler MUST derive scope guard, resource binding, connection, credential, approval, typed confirmation, capability envelope, idempotency, certification, audit, readback, rollback, compensation, and quota requirements.
- **FR-013**: Missing classification or required policy MUST produce a hard blocking gap.
- **FR-014**: Requirement sources and precedence MUST be visible in the manifest.
- **FR-015**: A surface override may only make requirements stricter than the canonical capability profile.
- **FR-016**: Provider or adapter metadata MUST NOT weaken principal, tenant, or resource authority.

### Admin and Tenant projection

- **FR-017**: Admin and Tenant projections MUST be derived independently.
- **FR-018**: Tenant projections MUST use signed principal context and MUST reject tenant/user identity overrides.
- **FR-019**: Tenant projections MUST expose bounded input/output schemas and no internal credential, policy, or cross-tenant metadata.
- **FR-020**: Admin-only tools MUST NOT be copied or inherited into the Tenant catalog.
- **FR-021**: A Tenant facade MAY target the same canonical capability as an Admin tool only through its own exposure policy, schema, grants, and authority checks.
- **FR-022**: Shadow bindings MUST NOT produce executable Tenant projections.
- **FR-023**: Projection drift and unsafe active exports MUST be release-blocking gaps.

### Shared execution enforcement

- **FR-024**: Every execution path MUST resolve the current governance manifest before provider or internal mutation.
- **FR-025**: The final execution boundary MUST revalidate actor, tenant, workspace, resource, capability, request hash, revision vector, grants, connection, credentials, approval, certification, and idempotency.
- **FR-026**: State-changing invocation envelopes MUST be single-use by default.
- **FR-027**: Preview MUST perform no provider mutation and MUST return the evaluated gates.
- **FR-028**: Stale manifests, envelopes, grants, resource bindings, credentials, or certifications MUST block execution.
- **FR-029**: Adapters MUST receive an already enforced context and MUST NOT select broader scope or credentials.
- **FR-030**: Adapter selection MUST be deterministic; unresolved top-rank ties fail with `ADAPTER_BINDING_AMBIGUOUS`.

### Dispatch, readback, and evidence

- **FR-031**: Provider acknowledgement MUST be distinct from verified success.
- **FR-032**: Every capability requiring readback MUST reference a current certified readback contract before dispatch.
- **FR-033**: Readback MUST produce bounded observed state, revision/hash evidence, verification level, and stable mismatch reason codes.
- **FR-034**: Unknown provider effect MUST allow readback/reconciliation only, not blind retry.
- **FR-035**: Audit and evidence events MUST exclude raw secrets and unrestricted provider payloads.
- **FR-036**: Compensation requires separately bounded authority unless explicitly included in the original approval.

### Reconciliation and debt

- **FR-037**: Compilation and reconciliation MUST be idempotent and revision-aware.
- **FR-038**: Every gap MUST map to persistent capability debt with severity, owner class, evidence, and lifecycle status.
- **FR-039**: Later success MAY resolve an execution alert only when operation and resource fingerprints match.
- **FR-040**: Recovered classification MUST require same-cycle readback evidence.
- **FR-041**: Stale, revoked, expired, or drifted certifications MUST be removed from eligible adapter selection.
- **FR-042**: Existing specialized registries MUST feed the generic assurance graph through explicit source links; they MUST NOT silently become competing authority.

### API, observability, and compatibility

- **FR-043**: Governance APIs MUST use OpenAPI 3.1 and stable structured errors.
- **FR-044**: List and gap APIs MUST be bounded and paginated.
- **FR-045**: Decisions MUST expose no-secret reason codes, evaluated/not-evaluated gates, manifest revision, and evidence references.
- **FR-046**: Existing routes MUST remain compatible during shadow and cohort migration.
- **FR-047**: The system MUST support per-capability and per-cohort rollback without deleting evidence.
- **FR-048**: Compiler and enforcement latency, mismatch rates, projection drift, stale certification, and readback failure MUST be observable.
- **FR-049**: No implementation PR may combine broad refactoring, provider mutation, enforcement cutover, and destructive schema change.
- **FR-050**: All implementation changes MUST preserve `api -> application -> domain` dependency direction with infrastructure adapters behind ports.

## Resource coverage matrix

| Resource | Sources/read models | Admin operations | Tenant operations | Search | Permissions | Changes | Revisions | Readback |
|---|---|---|---|---|---|---|---|---|
| Capability governance manifest | compiled manifest registry/view | compile, inspect, reconcile | effective summary only | yes | platform admin / tenant effective scope | append-only revisions | manifest version/hash | compilation readback |
| Capability assurance gap | assurance gap/debt views | list, assign, transition | bounded own-scope blockers | yes | scoped visibility | lifecycle events | evidence revision | debt state readback |
| Capability projection | Admin/Tenant projection candidates | preview, reconcile | list/get own effective tools | yes | exposure + authority | generated revisions | projection hash | export reconciliation |
| Certification | generic certification registry | create/revoke/recertify | status only when safe | yes | Admin or scoped owner | append-only evidence | adapter/code/contract revision | certification status |
| Readback contract | capability readback registry | register/version/disable | no raw contract internals | yes | Admin governance | version lifecycle | contract version/hash | self-test evidence |
| Invocation decision | envelope/evidence ledgers | inspect bounded evidence | own request preview/readback | by reference | actor-bound | immutable append | revision vector | execution/readback state |

## Success criteria

- **SC-001**: Every active inventory surface is classified or represented by a typed blocking gap; no silent omission.
- **SC-002**: Every state-changing active export has explicit policy requirements or is blocked.
- **SC-003**: No Tenant projection resolves to an Admin-only surface without a tenant-safe canonical facade.
- **SC-004**: Every external write cohort has certified adapter and readback contracts before canary execution.
- **SC-005**: Cross-tenant, stale authority, ambiguous selector, and missing credential tests deny before provider access.
- **SC-006**: Shadow comparison records no unexplained adaptive-allow/legacy-deny results before cohort cutover.
- **SC-007**: Compilation is deterministic for identical registry revisions and produces the same manifest hash.
- **SC-008**: Compiler and preview paths meet approved latency and bounded-response SLOs.
- **SC-009**: Existing callable routes retain compatible request/response behavior during migration.
- **SC-010**: No raw secret value appears in manifests, projections, evidence, logs, or error responses.
