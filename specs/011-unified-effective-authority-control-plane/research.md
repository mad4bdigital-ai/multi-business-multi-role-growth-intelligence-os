# Research and Decision Notes

## Existing platform direction

The platform already resolves semantic capability before provider selection, treats tool exports as projections rather than authority, uses SQL-primary runtime registries, supports managed and dedicated connection tiers, and requires governed runtime certification and typed approvals for sensitive execution.

UEACP consolidates those principles into one Admin/Tenant decision boundary rather than introducing a competing authorization subsystem.

## Architectural patterns evaluated

### Role-only authorization

Insufficient for shared resources, delegation, connection selection, operation risk, and cross-workspace relationships.

### Separate Admin and Tenant resolvers

Rejected because duplicated security logic drifts and makes future roles harder to support.

### Provider-specific authorization

Rejected because providers are replaceable infrastructure and cannot define business authority.

### Unified effective-authority resolver

Selected because it centralizes semantics while preserving different scopes, roles, relationships, policies, and execution gates.

## Technology choice deliberately deferred

This specification does not mandate OPA, Cedar, a Zanzibar-style graph service, or a custom policy DSL. A later ADR may choose implementation technology after measuring:

- policy expressiveness needed
- graph traversal complexity
- decision latency and throughput
- versioning and audit requirements
- operational support burden
- migration compatibility with existing SQL registries

## Data model principle

Reuse live authoritative tables wherever possible. Add only missing semantics: resource relationships/restrictions, delegation lifecycle, version vectors, decision evidence, projection snapshots, and drift findings.

## Operational conclusion

A resolver alone is insufficient. Long-term correctness requires resolver + projection compiler + final enforcement + invalidation + continuous reconciliation.
