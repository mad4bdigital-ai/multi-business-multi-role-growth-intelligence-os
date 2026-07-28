# System Tool Catalog V2 Rollout

## Compatibility window

Requests with explicit pagination or filters use Catalog V2 immediately. Requests without catalog query parameters receive a bounded legacy projection with deprecation metadata during the transition.

## Client migration

1. Use cursor traversal for browsing.
2. Use `/system/tools/{toolName}` for known descriptors.
3. Use `/system/capabilities/resolve` for intent discovery.
4. Never treat catalog presence as execution authority; call effective capability preview next.

## Metrics

Track list requests, direct lookups, lookup misses, legacy full-list requests, intent resolutions, snapshot mismatches, and descriptor/runtime mismatches.

## Removal gate

Remove legacy compatibility only through a later reviewed contract change after usage reaches zero, all clients have migrated, and CI/production verification pass.

## Chunk-store dependency degradation

Durable governed response chunks remain the normal behavior for oversized catalog responses. If the durable store is unavailable with the exact error `response_chunk_persistence_unavailable`, the System Layer can return a bounded inline response marked with `persistence_degraded=true` and `fallback_mode=bounded_inline_response`. The response is limited to 150000 serialized characters and remains secret-free.

If that ceiling is exceeded, or the failure has any other code, the request fails closed. Monitor the structured warning, repair the chunk-store dependency, and confirm that later requests use durable chunk persistence before treating the incident as resolved.
