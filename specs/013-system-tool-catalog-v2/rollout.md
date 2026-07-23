# Rollout and Recovery

1. Land pure service and tests with no route effect.
2. Enable Catalog V2 routes behind the existing System Layer boundary.
3. Preserve no-query compatibility mode with explicit deprecation metadata.
4. Monitor legacy full-list usage, direct lookup misses, snapshot mismatch, and descriptor/runtime mismatch.
5. Migrate internal clients to cursor pagination, direct lookup, or capability resolution.
6. Remove compatibility mode only in a later versioned change after usage reaches zero.

Rollback disables V2 routing and restores the previous list projection. No provider state, credentials, approvals, or operations are changed.
