# Rollout and Recovery

1. Land pure service and tests with no route effect.
2. Enable Catalog V2 routes behind the existing System Layer boundary.
3. Preserve no-query compatibility mode with explicit deprecation metadata.
4. Monitor legacy full-list usage, direct lookup misses, snapshot mismatch, and descriptor/runtime mismatch.
5. Migrate internal clients to cursor pagination, direct lookup, or capability resolution.
6. Remove compatibility mode only in a later versioned change after usage reaches zero.

Rollback disables V2 routing and restores the previous list projection. No provider state, credentials, approvals, or operations are changed.

## Durable chunk persistence degradation

Durable response chunk storage remains the primary path for large responses. When, and only when, the runtime reports `response_chunk_persistence_unavailable`, Catalog V2 may return the same bounded response inline with `persistence_degraded=true`, `fallback_mode=bounded_inline_response`, and no secrets. The inline fallback is capped at 150000 serialized characters. Responses above that ceiling fail closed with HTTP 503 and `response_chunk_persistence_unavailable_inline_limit_exceeded`.

Operators should alert on persistence-degraded responses, restore the chunk-store dependency, and verify that subsequent requests return durable chunk envelopes again. The fallback must not be enabled for unrelated errors and must not be used to increase the 200-tool catalog projection limit.
