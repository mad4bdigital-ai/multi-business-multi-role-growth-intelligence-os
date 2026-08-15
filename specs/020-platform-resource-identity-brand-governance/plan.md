# Implementation Plan — Platform Resource Identity and Brand Governance

## Architecture boundary

This feature is an additive platform contract and a shadow resolver slice. Domain tables remain authoritative. The first executable slice is pure and no-secret: it validates identity descriptors, normalizes identifiers, resolves Brand candidates, validates relationships, and produces structured outcomes. It does not connect to MariaDB or call a provider.

## Phase 0 — Contract baseline

Freeze the identity scopes, canonical status values, relationship semantics, disclosure policy, and operation descriptor fields. Add JSON Schemas and pure contract tests. Exit requires schema parsing and deterministic tests.

## Phase 1 — Shadow Brand resolver

Expose the pure Brand resolver as a library boundary for future REST/GPT/MCP adapters. Keep `brand_id` and current `target_key` separate. Produce no authority, grant, credential, or projection mutation. Exit requires exact/probable/none/conflict/ambiguous coverage and cross-tenant disclosure tests.

## Phase 2 — Read-only repository adapter

Add a future repository port that reads `brands`, `tenant_brand_links`, identifier evidence, and aliases using bounded tenant filters. This phase must use the existing transaction/readback conventions and must not write or apply migrations. Exit requires parity reports against current `target_key` references and a no-leakage test matrix.

## Phase 3 — Relationship and claim shadow

Model tenant-to-brand claims and typed relationships in shadow output. Distinguish relationship, grant, policy, and Root Workspace containment. Do not activate ownership transfer, invitation, agency delegation, or provider credential changes.

## Phase 4 — Lifecycle operation contract

Integrate with the canonical Operation Registry from Issue #7287. Register identity resolution, relationship resolution, revision, idempotency, effect, approval, and readback requirements. Known-intent Brand Create must call the Root topology service and must not discover tools.

## Phase 5 — Migration readiness

Produce duplicate/collision/orphan/alias reconciliation reports and a dual-read compatibility plan. Migration files may be added only after separate review; migration Apply is explicitly out of this feature slice. Any apply requires explicit authorization, rollback, same-cycle readback, and exact evidence.

## Phase 6 — Staging and Production gates

Shadow parity, canary, runtime readback, and Production promotion are separate deliverables. No Production activation is implied by completion of this specification or its pure resolver tests.

## Design constraints

The implementation must preserve Spec 004 asset and context composition, Spec 006 workflow authority, Spec 007 capability governance, Spec 011 context/authority foundations, the Brand Core dossier in Issue #4447, and the separate Operation Governance work in Issue #7287. Spec 015 and `014-gemini-evidence-intake-automation` are excluded.
