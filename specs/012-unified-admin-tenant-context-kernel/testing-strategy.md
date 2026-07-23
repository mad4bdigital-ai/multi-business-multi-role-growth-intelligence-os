# Testing Strategy

## Unit tests

- candidate eligibility and tenant predicates;
- deterministic ranking precedence;
- ambiguity detection;
- context hash generation;
- invalidation graph;
- high-risk fallback prohibition;
- approval and plan binding;
- unknown-outcome state transitions;
- structured error mapping.

## Property tests

- candidate order does not change the selected result;
- adding an unauthorized candidate never changes the execution decision;
- changing tenant invalidates every dependent reference;
- no execution context contains more than one tenant or exact connection;
- equivalent registry snapshots produce identical context hashes.

## Integration tests

- Admin with multiple tenants and workspaces;
- tenant user with one and multiple memberships;
- resource-first flow without brand;
- brand-scoped publishing flow;
- exact provider connection resolution;
- authority expiry between plan and dispatch;
- context pin read and invalidation;
- graph traversal with tenant isolation;
- provider timeout followed by reconciliation;
- repository branch bootstrap and continuation.

## Security tests

- cross-tenant direct-object reference attempts;
- user-supplied tenant override;
- Admin implicit impersonation attempt;
- connection substitution;
- stale approval replay;
- unsafe fallback attempt;
- secret-like payload and log redaction;
- raw provider error suppression.

## Contract tests

- OpenAPI 3.1 validation;
- unknown fields rejected where strictness is required;
- structured error envelope consistency;
- idempotency header behavior;
- cursor pagination;
- backward-compatible additive fields.

## Static analysis

- scan production paths for identifier literals;
- scan context resolvers for unqualified first-result selection;
- enforce import direction API to application to domain;
- prevent provider SDK imports in domain and application policies;
- verify every public route has OpenAPI coverage.

## Repository mutation regression tests

1. Default branch moves before branch creation: operation resolves current base at dispatch or returns `BASE_MOVED_BEFORE_WRITE` without side effects.
2. Branch exists and default branch moves without file overlap: continuation succeeds using expected branch head.
3. Branch head moves: continuation fails closed.
4. Default branch overlaps requested files: continuation returns an overlap conflict.
5. Transport fails after write: readback recovers the commit or leaves outcome unresolved without blind retry.

## Test data

Fixtures use generated or clearly synthetic references. No production tenant, user, workspace, brand, connection, or account identifiers may be copied into tests.

## Release gates

- all isolation tests pass;
- hardcoding scanner passes;
- OpenAPI validation passes;
- critical flow integration tests pass;
- threat-model cases have regression coverage;
- no unresolved high-severity security findings.
