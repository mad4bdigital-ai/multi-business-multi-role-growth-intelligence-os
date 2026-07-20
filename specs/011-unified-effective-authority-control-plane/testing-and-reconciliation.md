# Testing and Reconciliation Strategy

## 1. Unit tests

- Decision-state precedence
- Immutable actor and subject normalization
- Graph relation allowlist and restriction precedence
- Deterministic connection ranking
- Readiness derivation
- Reason-code stability
- Version-vector comparison
- No-secret serialization

## 2. Integration tests

- SQL authority loading
- Membership and role changes
- Resource graph traversal
- Connector readiness composition
- Projection compilation
- Delegation lifecycle
- Invalidation events
- Final PEP revalidation

## 3. Contract tests

- OpenAPI 3.1 validation
- Structured error envelopes
- Cursor pagination
- Authentication versus authorization status separation
- Backward-compatible legacy fields
- Caller-aware redaction

## 4. Principal matrix

Test at minimum:

- platform administrator
- tenant owner
- tenant administrator
- editor/member
- viewer
- support operator
- agency operator
- service principal
- assigned agent
- revoked member

Across own Tenant, other Tenant, shared workspace, platform resource, restricted resource, unlinked connection, ambiguous connection, stale certification, and expired delegation.

## 5. Property invariants

- Tenant cannot expand signed scope.
- Removing authority cannot increase readiness.
- Shadow cannot execute.
- Tool visibility cannot bypass PEP.
- Admin visibility does not imply mutation.
- Ambiguous top-ranked connections never auto-select.
- Consumed approvals never become ready again.
- Secret-like fields never serialize into manifests.
- Executable is always a subset of Projected, Authorized, and Registered.

## 6. Parity comparison

Compare exact identities, not only counts:

- resource IDs
- capability keys
- connection IDs
- tool/action keys
- exclusion reason codes
- readiness dimensions

Mismatch classes:

- legacy over-grant
- legacy under-grant
- new resolver over-grant
- new resolver under-grant
- data-quality mismatch
- stale projection
- unsupported legacy semantics

Security-relevant over-grants block rollout immediately.

## 7. Synthetic principals

Maintain non-production synthetic principals for global Admin visibility, Tenant owner isolation, multi-workspace membership, viewer denial, revoked membership, diagnostic support delegation, and service-principal assignment.

Run periodic decision and projection checks without provider mutation.

## 8. Reconciliation

The reconciler compares:

```text
Registered
Authorized
Projected
Executable
Observed
```

Findings include snapshot IDs, versions, exact missing/extra IDs, severity, first seen, last success, and owner.

Critical examples:

- Admin global scope with zero visible registered systems
- Executable resource absent from Authorized
- Tenant projection contains another Tenant's resource
- Revoked connection remains executable
- Tool Catalog and runtime disagree on operation authority

## 9. Release gates

Changes touching identity, membership, scope, resource graph, connections, capability bindings, endpoints, certifications, or projections MUST pass:

- cross-tenant isolation
- Admin visibility
- Tenant non-escalation
- authority/projection parity
- runtime enforcement
- no-secret response
- migration compatibility
- rollback rehearsal

## 10. Candidate SLOs

Final values require measurement and approval. Candidate objectives include immediate dispatch-time revocation enforcement, zero unexplained critical parity mismatches, measured p95 decision latency by workload, bounded projection invalidation, and reconciliation detection before routine activation can conceal drift.
