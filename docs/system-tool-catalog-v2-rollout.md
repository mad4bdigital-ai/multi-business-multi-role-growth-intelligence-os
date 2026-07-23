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
