# Phase 1G Implementation — SQL Runtime Contract Loader

## Purpose

Implement task T300: load operation contracts and ordered steps from the SQL-primary operation registries with a bounded in-process cache and revision invalidation.

## Loading contract

The loader reuses the Phase 1B repository as the full SQL read authority. Every request first performs a lightweight revision probe against `operation_registry`. A cached contract is returned only when:

- its TTL has not expired;
- the probed revision hash is unchanged;
- the probed lifecycle status is unchanged;
- the lifecycle remains allowed for runtime loading.

A changed revision or lifecycle invalidates the cache entry before the full operation and step contract is reloaded. The loader recomputes the semantic operation revision hash after readback and fails closed on any identity, status, hash, or step-count mismatch.

## Cache boundaries

- in-process only;
- bounded maximum entry count;
- deterministic least-recently-accessed eviction when capacity is reached;
- bounded TTL;
- single-flight coalescing for concurrent loads of the same operation version;
- explicit per-operation invalidation and full-cache clearing;
- no cache write to Redis, SQL, or another external system.

The lightweight SQL revision probe still runs on every load, so cache use never suppresses revision validation.

## Result boundary

The result contains a deeply frozen operation contract, ordered steps, revision metadata, and bounded cache evidence. It always reports:

- `read_only=true`;
- `database_writes_performed=false`;
- `provider_calls_performed=false`;
- `external_writes_performed=false`;
- `runtime_activation_changed=false`;
- `fallback_used=false`;
- `secrets_included=false`.

## Testing

Tests cover cache hit, TTL expiry, revision invalidation, bounded eviction, single-flight behavior, semantic revision mismatch, lifecycle blocking, immutable results, and invalid input before database access.

## Scope boundaries

This phase implements T300 only. It introduces no migration, seed, route, OpenAPI change, code fallback, kill switch, dispatcher integration, capability acquisition, runtime activation, provider call, deployment, or merge. T301 static-code fallback remains a separate governed phase.
