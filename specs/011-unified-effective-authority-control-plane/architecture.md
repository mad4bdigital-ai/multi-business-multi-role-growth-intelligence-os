# Architecture

## 1. System view

```text
Authenticated request
  -> Principal Resolver
  -> Subject Scope Resolver
  -> Semantic Capability Resolver
  -> Resource Graph Resolver
  -> Policy Information Point
  -> Policy Decision Point
  -> Effective Authority Manifest
       -> Projection Compiler
          -> Tool Catalog
          -> Dynamic Tabs
          -> Dashboard
          -> Connector Inventory
          -> Agent/Skill surfaces
       -> Policy Enforcement Point
          -> Runtime Dispatch
          -> Provider Adapter
          -> Readback Verification
  -> Decision Ledger + Audit + Reconciler
```

## 2. Control Plane

The Control Plane is the sole interpreter of authority semantics. It owns principal normalization, actor/subject separation, scope derivation, resource-relationship traversal, semantic capability resolution, policy/grant evaluation, provider binding, deterministic connection selection, endpoint/certification resolution, approval requirements, projection eligibility, and version evidence.

It MUST remain provider-neutral. Provider metadata is considered only after capability and resource authority are established.

## 3. Data Plane

The Data Plane receives a bounded manifest and operation input. It MUST verify manifest integrity and expiry, bind the request to the manifest, revalidate high-risk mutable gates, execute only the resolved canonical action/endpoint, enforce timeout/retry/idempotency/origin controls, perform capability-specific readback, and append execution evidence.

It MUST NOT infer authority from role labels, UI controls, tool registration, or tenant IDs supplied in request bodies.

## 4. Decision components

### Principal Resolver

Supported principal types include platform administrator, tenant user, tenant service account, platform service principal, assigned agent, support operator, and agency operator. The resolver emits immutable actor identity and authentication strength.

### Subject Scope Resolver

Supported modes include signed membership, platform-global visibility, explicit tenant diagnostic, delegated support, agency-managed tenant, agent assignment, and approved break-glass. Scope expansion is explicit, bounded, and auditable.

### Resource Graph Resolver

Resolves typed nodes and edges, including explicit restrictions. Traversal depth and relation types are bounded and indexed. Inheritance is policy-driven rather than implied by nesting alone.

### Semantic Capability Resolver

Resolves intent to `capability_key + operation` before provider or tool selection. Aliases and UI labels aid discovery but never grant authority.

### Policy Information Point

Loads the minimum evidence needed for a decision: roles, memberships, grants, relationships, connections, action grants, endpoint aliases, certifications, policies, and revisions.

### Policy Decision Point

Is side-effect-free except for optional immutable ledger persistence after calculation. It returns a typed decision and stable reason codes.

### Policy Administration Point

Controls policy publication, role templates, capability definitions, delegation policy, rollout scopes, and approval policy. Policy changes require versioning, validation, review, and rollback metadata.

### Policy Enforcement Points

Exist at every material boundary: listing, detail read, recommendation, dispatch, provider adapter, and mutation. PEPs consume the shared decision contract and MUST NOT embed divergent authorization SQL.

## 5. Projection Compiler

Projection eligibility is surface-specific:

- `tool_catalog`
- `dynamic_tabs`
- `dashboard`
- `connector_inventory`
- `recommendation`
- `execution`

A resource may be visible but blocked for execution. The compiler includes safe readiness reasons while omitting unauthorized resource existence.

## 6. Read models

The system SHOULD materialize bounded read models for high-volume listing while preserving the live PDP as authority. Read models carry source versions and cannot be used after invalidation.

Recommended logical views:

- `v_effective_authority_inputs`
- `v_authorized_resources`
- `v_authority_projection_status`
- `v_connector_readiness_dimensions`

## 7. Invalidation plane

Events include membership revocation, scope-grant change, resource-edge change, connection disablement, credential validation failure, policy publication, endpoint change, certification revocation, and approval expiry.

Consumers invalidate affected decision caches and projections. Events improve freshness; version checks remain the correctness backstop.

## 8. Failure behavior

- Authentication unavailable: `authorization_gated` or `503`, based on available evidence.
- Required policy data unavailable: fail closed for execution; safe reads may return explicitly incomplete degraded results.
- Projection cache unavailable: use bounded live resolution when safe.
- PDP unavailable: no state-changing execution.
- Decision ledger unavailable: no high-risk operation requiring audit persistence.
- Reconciler unavailable: alert immediately and enforce freshness limits.

## 9. Performance strategy

- Resolve only requested capability/resource scopes.
- Batch-load graph edges and grants.
- Avoid per-item I/O in projection loops.
- Cache versioned low-risk listing decisions.
- Use cursor pagination for large inventories.
- Precompute relationship closures only when invalidation is understood.
- Instrument latency by resolver stage.

## 10. Repository boundaries

```text
src/domain/authority/
src/application/authority/
src/infrastructure/authority/
src/api/authority/
tests/unit/authority/
tests/integration/authority/
```

Domain owns invariants and decision types. Application owns orchestration. Infrastructure owns SQL, cache, graph, and event adapters. API owns validation and response mapping only.
