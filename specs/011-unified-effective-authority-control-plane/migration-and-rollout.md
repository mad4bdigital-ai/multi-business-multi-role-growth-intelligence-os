# Migration and Rollout

## Principles

- Additive before subtractive.
- Shadow before enforcement.
- Read surfaces before write surfaces.
- Capability-by-capability rather than global cutover.
- Exact-ID parity rather than count-only parity.
- Rollback and evidence in every phase.
- No provider mutation in specification or shadow phases.

## Phase 0: Inventory and terminology

- Catalog every Admin and Tenant authorization implementation and local SQL filter.
- Define current meanings of `active`, `connected`, `visible`, `installed`, and `ready`.
- Map Admin, Tenant, service, support, agency, and agent identity sources.
- Record existing tables and avoid duplicate authority stores.

**Exit:** approved authority map and compatibility glossary.

## Phase 1: Contracts and code invariants

- Add decision types, readiness vector, reason taxonomy, and actor/subject model.
- Add hard invariants for Tenant scope, ambiguity, shadow execution, approval reuse, projection non-authority, and no-secret manifests.
- Introduce no enforcement change.

## Phase 2: Shadow PDP

- Compute new decisions beside legacy behavior.
- Persist bounded decision evidence.
- Classify mismatches by layer and affected resource ID.
- Never trigger provider calls from shadow output.

**Exit:** approved parity thresholds and zero unexplained critical over-grants.

## Phase 3: Admin diagnostics and connector inventory

- Cut over read-only platform diagnostics.
- Expose connector readiness dimensions.
- Preserve legacy fields as compatibility projections.
- Treat `platform_admin_all + zero visible registered systems` as an invariant violation.

## Phase 4: Dynamic projections

Cut over in this order:

1. Connector Inventory
2. Dynamic Tabs
3. Dashboard
4. Tool Catalog listing
5. Agent and skill recommendations

Each surface compares exact IDs, capabilities, and reason codes before enforcement.

## Phase 5: Read-only dispatch canary

- Select low-risk capabilities.
- Use bounded Tenant and Admin cohorts.
- Enable final PEP revalidation.
- Monitor latency, mismatch rate, denial changes, stale decisions, and error budget.

## Phase 6: Reversible writes

- Draft-only or internal-registry writes first.
- Require typed approval, idempotency, readback, and rollback.
- Do not permit publish, deploy, delete, or external send until capability certification passes.

## Phase 7: High-risk execution

- Review each capability independently.
- Require stronger approval and delegation policies.
- Perform production verification and post-merge audit.
- Maintain an automatic disable or rollback policy.

## Phase 8: Legacy deprecation

A legacy path may be removed only when usage is measured, callers migrated, parity SLO sustained, rollback rehearsal passed, deprecation documented, release readiness approved, and post-merge production audit completed.

## Multi-PR sequence

1. Types, glossary, and invariants
2. Logical schema and additive migrations
3. Shadow resolver and decision ledger
4. Resource graph and delegation
5. Projection compiler and connector dimensions
6. Invalidation and reconciliation
7. Admin diagnostics
8. Dynamic Tabs and Dashboard
9. Tool Catalog
10. Read-only PEP canary
11. Reversible write pilot
12. Canonical docs and OpenAPI alignment
13. Release verification and closeout

## Rollback

Every enforcement phase retains the legacy path behind a governed feature policy until cutover acceptance. Rollback disables new enforcement, invalidates affected manifests, restores the legacy projection source, and records the reason and versions. Rollback MUST NOT reactivate revoked grants or consumed approvals.
