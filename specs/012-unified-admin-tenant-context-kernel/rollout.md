# Rollout Plan

## Phase 0: Inventory and observation

- inventory all current context resolvers and routing branches;
- identify customer-specific defaults and hardcoded identifiers;
- record existing decision outcomes in shadow telemetry;
- make no execution changes.

## Phase 1: Shared domain model

- introduce principal, effective subject, context candidate, context decision, and execution context types;
- add adapters around existing registries;
- preserve existing public responses through compatibility mappers.

## Phase 2: Shadow resolution

- run the new kernel beside current routing for read-only comparison;
- record decision differences and ambiguity rates;
- do not alter provider dispatch;
- block promotion when cross-tenant candidates appear.

## Phase 3: Low-risk reads

- enable the kernel for selected read-only routes;
- use request-scoped and short-lived context pins;
- monitor latency, error rates, ambiguity, and projection safety.

## Phase 4: Tenant writes

- enable for bounded tenant write operations with exact resource and connection binding;
- require idempotency and readback;
- preserve route-level kill switches.

## Phase 5: Admin writes

- enable Admin tenant-scoped writes only after effective-subject and isolation evidence passes;
- prohibit implicit impersonation and fallback;
- require elevated approval where policy demands it.

## Phase 6: Deprecation

- remove legacy first-result selection and customer-specific defaults;
- retain compatibility telemetry until traffic reaches zero;
- archive deprecated routes and adapters.

## Feature flags

Flags are generic by capability and risk class, never by customer identifier. Examples:

- context kernel shadow mode;
- context kernel low-risk reads;
- context kernel tenant writes;
- context kernel Admin writes;
- strict ambiguity blocking;
- strict connection binding;
- unknown-outcome reconciliation.

## Kill switches

- disable new resolver and fall back to legacy read-only routing;
- disable all high-risk writes;
- disable context pin reuse;
- disable provider dispatch while preserving planning and diagnostics.

A kill switch MUST NOT enable a less secure implicit fallback.

## Migration strategy

- additive tables or columns first;
- backfill context references from existing memberships and grants;
- dual-read during verification;
- dual-write only when idempotent and observable;
- no destructive change until compatibility evidence is complete.

## Rollback

Rollback returns traffic to the previous routing implementation but keeps audit and execution ledgers intact. Any operation already dispatched continues through readback or reconciliation. Pending approvals and execution contexts from the new kernel are invalidated, not silently translated.

## Observability

Metrics:

- resolution success and ambiguity rates;
- cross-tenant candidate rejection count;
- stale pin rejection count;
- context and plan invalidation count;
- fallback prevention count;
- unknown outcomes and reconciliation results;
- duplicate prevention count;
- latency by resolution stage.
