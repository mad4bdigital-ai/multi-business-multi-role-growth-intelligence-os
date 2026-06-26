# ADR: Policy-Driven Resource Surface Governance

- Status: Accepted
- Date: 2026-06-24

## Context

The initial Resource API live audit treated every database table, view, and enabled tool as if it must be a public logical resource. That produced false positives for internal registries, immutable logs, governance ledgers, and internal read models. It also obscured a key governance distinction: a surface can be intentionally internal, but that decision must still be explicit and reviewable.

## Decision

Introduce `platform_resource_surface_policy_registry` as the authoritative exposure decision for every active table, view, and enabled tool.

Each policy declares exposure class, logical resource association when applicable, descriptor and operation requirements, archive and version strategy requirements, rationale, and source policy.

New relations and tools are fail-closed unless the same change provides either logical Resource API coverage or an explicit surface-policy decision. Internal surfaces use explicit `not_applicable` requirement states rather than broad exemptions.

The live audit evaluates requirements from the policy registry. Physical archive/version columns are required only when the policy says so. Resource-facing surfaces may instead resolve those concerns through explicit descriptor operation states such as `blocked_by_policy`, `completed_state_only`, or `readback_guarded`.

## Consequences

- Internal tables are not forced into artificial public APIs.
- New feature surfaces cannot silently bypass Resource API governance.
- Lifecycle classification, exposure policy, and logical resource descriptors remain separate authorities with explicit joins.
- Migration 1025 backfills policies for current tables, views, and tools and resolves existing `runtime_unclassified` metadata without mutating business data.
- The migration is additive and metadata-only; it performs no provider call, external send, hard delete, archive execution, or secret read.

## Alternatives considered

1. Add descriptors for every table and view. Rejected because it leaks persistence structure into public resource design.
2. Add broad regex exemptions. Rejected because future features could bypass governance silently.
3. Keep bounded findings as accepted debt. Rejected because the findings mixed real gaps with classifier defects.
