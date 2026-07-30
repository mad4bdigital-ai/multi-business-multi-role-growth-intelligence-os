# Architecture

## Architectural decision

Implement one `Context Kernel` as a domain and application capability shared by Admin, Tenant, service, and delegated-agent entry points. Entry points differ only in authentication adapters and projection policy. They MUST NOT contain separate customer-specific resolution logic.

## Layer placement

### API layer

Responsibilities:

- authenticate requests;
- validate input schemas;
- pass authenticated principal evidence to application use cases;
- map structured domain errors to API responses;
- project only customer-safe fields.

The API layer MUST NOT query provider adapters or choose tenants, workspaces, or connections directly.

### Application layer

Use cases:

- `ResolveExecutionContext`;
- `CreateContextPin`;
- `SwitchContext`;
- `CompileExecutionPlan`;
- `ValidateExecutionContext`;
- `DispatchGovernedOperation`;
- `ReconcileUnknownOutcome`.

The application layer orchestrates domain policies and repository abstractions.

### Domain layer

Core types:

- `AuthenticatedPrincipal`;
- `EffectiveSubject`;
- `AuthorizedScope`;
- `ContextCandidate`;
- `ContextDecision`;
- `ContextPin`;
- `TargetResource`;
- `ExactConnectionBinding`;
- `AuthorityPath`;
- `CapabilityDecision`;
- `ExecutionContext`;
- `ExecutionPlan`;
- `OutcomeState`.

Core policies:

- candidate eligibility;
- deterministic ranking;
- ambiguity detection;
- context invalidation;
- high-risk fallback prohibition;
- cross-tenant isolation;
- approval and plan binding;
- retry and unknown-outcome policy.

The domain layer MUST remain independent of SQL table names, provider SDKs, and transport details.

### Infrastructure layer

Adapters:

- authenticated-principal adapter;
- SQL scope and authority repositories;
- resource graph repository;
- capability registry repository;
- connection and credential metadata repository;
- context pin repository;
- execution ledger repository;
- provider adapters;
- repository/GitHub adapter;
- observability and audit adapters.

Infrastructure translates provider and storage errors into stable internal categories.

## Context sets

The kernel maintains three distinct sets:

1. `visibilitySet`: everything the principal may inspect.
2. `candidateSet`: resources eligible for the current request intent.
3. `executionSet`: the single fully resolved target allowed to execute.

Admin can have a large visibility set. The execution set remains one tenant, one workspace, one target resource, one connection, and one authority path.

## Resolution algorithm

1. Load principal evidence and registry revision.
2. Enumerate authorized scopes.
3. Apply explicit request constraints.
4. Build candidate sets with tenant predicates.
5. Resolve effective subject.
6. Rank candidates using deterministic precedence.
7. Reject ambiguity when more than one valid candidate remains.
8. Resolve exact resource and connection.
9. Validate authority and capability.
10. Create immutable execution context with context hash.

## Ranking precedence

1. explicit authorized stable reference;
2. active verified request/workflow/conversation pin;
3. exact resource-authority binding;
4. exact connection-resource binding;
5. single authorized candidate;
6. last-confirmed context for low-risk read only;
7. interpretation required.

Labels and semantic similarity are explanatory signals, not authority signals.

## Context hash

The context hash covers:

- principal type and stable principal reference;
- effective subject references;
- tenant and workspace references;
- operational workspace type, workspace ownership type, and their relevant revisions;
- optional brand reference and brand revision;
- target resource reference and resource revision;
- resolution status;
- exact selected connection reference when resolved;
- selected connection owner-scope type and stable owner-scope reference when resolved;
- owner-scope revision, connection revision, and authorization revision when resolved;
- candidate revision vector when unresolved;
- authority evidence revision;
- capability decision revision;
- registry snapshot revision.

A plan, approval, pin, or execution envelope MUST be invalidated when any hashed owner-scope or revision field changes. Substituting owner-scope evidence while retaining the connection reference cannot preserve the same context hash.

Secrets, credential payloads, raw provider-account identifiers that policy forbids retaining, and claim tokens are never included.

## Invalidation graph

- principal change invalidates everything;
- tenant change invalidates workspace and all descendants;
- workspace change invalidates brand, resource, connection, plan, approval, and execution envelope;
- workspace ownership or owner-scope change invalidates the context hash, connection decision, plan, approval, and execution envelope;
- resource change invalidates connection, authority, capability, and plan;
- connection, authorization, provider-account binding, or owner-scope revision change invalidates credential readiness and plan;
- authority or registry revision change invalidates affected execution contexts;
- plan change invalidates approval and idempotency binding.

## Repository bootstrap reliability

Repository mutations use two stages:

1. Create a non-protected work branch through a minimal governed operation that resolves the current default branch at dispatch time.
2. Continue on the branch using exact `expected_branch_sha` and overlap detection against the current default branch.

This prevents default-branch automation from repeatedly invalidating long authorization cycles.

## Extension model

New principal, resource, provider, and capability types are added through registry-backed adapters and domain-compatible descriptors. No tenant-specific or brand-specific switch statements are allowed in shared domain or application code.