# Threat Model

## Protected assets

Tenant isolation; role/policy integrity; connection and credential-binding references; provider-write authority; budgets/quotas; approval/override integrity; effective-context snapshots; audit evidence; canonical topology.

## Trust boundaries

```text
client → API validation/authentication → resolver → SQL authority
→ capability/approval gates → credential materialization → provider adapter → provider
```

Platform Graph, caches, UI state, imported schemas, and provider responses cannot independently grant authority.

## Abuse cases and mitigations

- **Cross-tenant path injection:** pin tenant from auth context; tenant-qualified joins; reject cross-tenant edges.
- **Privilege laundering through a second parent:** evaluate every path; deny/restrict wins; edge changes increment epoch.
- **Read share converted to write:** sharing remains read-only; write requires exact delegation and normal grants.
- **Delegation beyond delegator authority:** intersect delegation with delegator effective authority at creation and resolution.
- **Implicit platform-owner bypass:** normal resolution first; exact scoped approved override only.
- **Self/duplicate approval:** unique approver constraint and policy-controlled self-approval prohibition.
- **Override replay:** exact request/path/resource/operation binding, atomic one-time consumption, expiry, and trace linkage.
- **TOCTOU:** authority epoch and snapshot revalidated immediately before credentials.
- **Stale cache grant:** epoch-bound keys, event invalidation, bounded TTL, and mismatch block.
- **Path-explosion DoS:** type constraints, relationship quotas, traversal limits, indexed closure, rate limits.
- **Secret leakage:** metadata-only interfaces, schema rejection of secret-like fields, redaction, and log/ledger tests.
- **Confused deputy adapter:** immutable context reference, exact action/endpoint/operation, and delayed credential binding.
- **Projection poisoning:** SQL authority remains canonical; projections are versioned no-authority read models.

## Security invariants

1. No provider client before authorization.
2. No raw secret in resolver input/output, cache, snapshot, or audit.
3. Child or added parent cannot widen deny/restrict ceilings.
4. Sharing never grants write.
5. Delegation never exceeds delegator authority.
6. Override is exact, expiring, approved, and one-time.
7. Epoch drift or unresolved conflict blocks.
8. Enforced execution is reconstructable.

## Required tests

Cross-tenant rejection; cycle/path explosion; broad allow + narrow deny; shared write without delegation; over-delegation; platform owner without override; duplicate/self approver; stale epoch; expired/replayed override; cache invalidation after deny; secret-field injection; provider-client factory ordering.
