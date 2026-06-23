# Rollout and Recovery

## Rollout sequence

1. Merge only after all required CI checks pass on the reviewed head SHA.
2. Use the existing `main` release path; this branch performs no deployment.
3. Verify a tenant with no operational installations reports a known zero only when the query succeeds.
4. Verify an unvalidated tenant capability reports a stable blocker.
5. Verify a fully authorized capability reports `dispatch_ready`.
6. Compare dashboard readiness with actual execution preflight for representative tenants.

## Monitoring

Observe:

- `capability_mapping_missing`
- `capability_resolution_failed`
- connector count query degradation
- unexpected dashboard latency
- differences between displayed readiness and dispatch preflight
- increases in blocked operational categories after truthful classification

## Recovery

The changes are additive and read-only. Recovery is a revert of the merge commit. No database rollback, credential rotation, provider cleanup, or external-write reversal is required.

## Known behavior change

Some actions or integrations previously shown as ready may become blocked, pending, or unknown until tenant-effective evidence is present. This is intentional fail-closed behavior.
