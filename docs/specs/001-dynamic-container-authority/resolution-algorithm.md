# Deterministic Resolution Algorithm

## Input

```text
principal
tenant_id
target_container_id
dimension_requests[]
request_time
mode = preview | shadow | enforce
expected_authority_epoch?
```

## Safety limits

```text
max_depth = 16
max_paths = 256
max_visited_containers = 2048
max_traversed_relationships = 4096
max_candidate_bindings = 5000
```

Limits are startup-validated configuration. Exceeding a limit returns `container_resolution_limit_exceeded` and no partial allow.

## Algorithm

```text
1. Authenticate principal and pin tenant.
2. Read authority epoch E0.
3. Validate target type, status, and tenant boundary.
4. Load active containment paths with bounded set-oriented traversal.
5. Reject cycles, cross-tenant edges, invalid type relationships, and overflow.
6. Load versioned classifications, roles, bindings, shares, delegations, and policies.
7. Partition candidates by requested dimension/resource/operation.
8. Resolve each path: validity → role ceiling → dimension merge → deny propagation.
9. Merge paths: deny_wins; catalogs union but execution needs grant; numeric minimum;
   replacement nearest then priority; equal precedence blocks.
10. Add read-only shares.
11. Add exact delegations only when delegator authority contains the operation.
12. Apply final policy, readiness, compatibility, budget/quota, and risk gates.
13. Read epoch E1; retry preview/shadow once if changed, otherwise block.
14. Canonicalize evidence and compute path, snapshot, and resolution hashes.
15. Persist immutable no-secret evidence where required.
16. Return decision. Credential materialization remains a later enforce-stage gate.
```

## Stable hashing

Paths sort by root and edge IDs. Rows sort by depth, priority descending, and stable row ID. JSON uses canonical key order and UTC timestamps. Resolver and merge-strategy versions are included.

## Cache

Key: tenant + principal + target + normalized requests + authority epoch + resolver version. A hit requires matching epoch, request hash, and expiry. Deny/revocation events invalidate affected entries; TTL is fallback only.

## Concurrency

Relationship/authority mutations use optimistic versions. Override consumption atomically changes `ready` to `consumed`. Enforced execution revalidates epoch, snapshot, override, envelope, action, endpoint, and binding before provider-client creation.

## Complexity

Bounded traversal is `O(V + E + B log B)` where `B` is candidate bindings requiring deterministic sort. Per-node database I/O is forbidden.

The resolver never guesses: unknown type, invalid classification, missing role, incompatible binding, unresolved tie, epoch drift, stale override, or limit exhaustion blocks with typed evidence and `secrets_included=false`.
