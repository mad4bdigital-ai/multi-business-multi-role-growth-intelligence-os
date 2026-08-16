# Platform Resource Identity and Brand Governance

This slice establishes a pure, additive, no-secret contract for resolving Platform Resource Identity and Brand candidates. It is intentionally shadow-only. The slice does not connect to MariaDB, read credentials, create grants, call a provider, send an external request, apply a migration, deploy runtime code, or activate Production authority.

## Contract boundary

The identity contract defines the difference between a canonical resource identity, a tenant or workspace relationship, an authority grant, a profile, and a projection. A global Brand identity is represented by an immutable canonical ID. Existing `target_key` values remain compatibility references until a separately authorized dual-read migration is complete.

The resolver returns one of five statuses: `EXACT`, `PROBABLE`, `NONE`, `CONFLICT`, or `AMBIGUOUS`. A unique fresh verified hard identifier can return `EXACT`. Name-only or weak identifiers can return `PROBABLE` or `AMBIGUOUS`. Multiple hard matches return `CONFLICT`. Conflict and ambiguity are fail-closed outcomes.

## Authority and privacy

The resolver filters candidates to the requested tenant scope before returning a result. It returns only identity-safe summaries, never the owner Tenant of a candidate. A relationship is not a grant. `authority_implied` is always false in identity and relationship outputs; future mutations must resolve principal, tenant/workspace context, grants, policy, operation descriptors, readiness, idempotency, and readback separately.

## Integration boundaries

The Brand Core dossier in Issue #4447 remains responsible for persisted Brand assets, profile inheritance, scoped invitations, resource-existence enforcement, monitoring, and exact production readback. This slice adds a pure operation descriptor contract that makes `brand.create` an honest `internal_write` with policy-resolved approval, same-cycle readback, idempotency, identity/relationship resolution, and no tool discovery. Full registry persistence and runtime integration remain the separate implementation path requested by Issue #7287. Root Workspace topology from PR #7286 is consumed as a relationship/projection foundation and is not replaced by this identity contract.

Future slices may add a read-only MariaDB repository port, identifier claims, verification evidence, alias reconciliation, revision-bound lifecycle operations, and canonical Operation Registry integration. Each slice requires its own tests, readback, and release evidence. Migration Apply, grant changes, and Production promotion require separate authorization.
