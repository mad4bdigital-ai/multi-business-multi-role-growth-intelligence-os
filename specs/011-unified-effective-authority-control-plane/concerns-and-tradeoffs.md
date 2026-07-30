# Concerns and Trade-offs

## Centralization versus resilience

One PDP prevents semantic drift but becomes critical infrastructure. Mitigation: stateless horizontal deployment, SQL-primary evidence, bounded caches, version checks, health isolation, and fail-closed mutations.

## Latency

Relationship and policy evaluation can add latency. Mitigation: bounded graph traversal, batch loading, versioned read models, stage tracing, and capability-specific resolution.

## Policy complexity

RBAC + ABAC + ReBAC + capabilities is powerful but harder to reason about. Mitigation: constrained vocabulary, templates, simulation, review, stable reason codes, and scenario tests.

## Resource graph growth

Unbounded inheritance becomes slow and unsafe. Mitigation: allowlisted relations, maximum depth, restriction precedence, indexed edges, and selective closure materialization.

## Admin blast radius

Global visibility is useful but dangerous when coupled to writes. Separate view, diagnose, propose, approve, execute, impersonate, and manage-policy operations.

## Explainability versus confidentiality

Detailed reasons help remediation but may leak resource existence. Use Tenant-safe codes, privileged Admin evidence, and no credential details.

## Eventual consistency

Events may be delayed. Version vectors and final revalidation provide correctness; events improve freshness.

## Audit volume

Decision evidence can grow rapidly. Store hashes and bounded metadata, define retention tiers, sample low-risk reads where policy permits, and retain high-risk evidence.

## Backward compatibility

Legacy `active` and `connected` fields are widely consumed. Preserve them as documented derived fields, add readiness dimensions, measure usage, then deprecate.

## Migration risk

This architecture crosses many surfaces. Big-bang implementation is rejected; multi-PR shadow-first delivery is mandatory.

## Policy engine choice

Do not select OPA, Cedar, Zanzibar-style infrastructure, or a custom DSL solely from this specification. Stabilize typed contracts, invariants, resource graph, and operational requirements first. A later ADR may select technology using measured needs.

## Human operations

Operators need remediation, not only denial. Reason codes, decision tracing, projection diagnostics, delegation lifecycle, and drift ownership are first-class requirements.
