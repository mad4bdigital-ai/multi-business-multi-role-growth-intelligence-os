# Traceability

## Dependency boundaries

| Authority | Reused by Spec 011 | Not redefined |
|---|---|---|
| Spec 006 Dynamic Workflow Runtime | workflow states, idempotency, leases, outbox, adapters, readback | worker/state-machine implementation |
| Spec 007 Dynamic Capability Governance | semantic capability registry, assurance graph, authorizations, resource adapters | capability authority and execution grants |
| Governed context resolution canonicals | tenant/workspace/resource context | principal and graph authority |
| Logic/knowledge pointer canonicals | pointer-first active versions | direct file or Drive resolution |
| Growth execution authority | approval and no-write/no-send boundaries | provider execution bypass |
| `memory_schema.json` | configuration precedence/merge concepts | arbitrary free-form memory authority |

## Functional requirement mapping

- FR-001..005 -> `architecture.md`, `data-model.md`, UC-01/10/15, isolation tests.
- FR-006..009 -> `architecture.md`, threat T-03/T-14, architecture drift tests.
- FR-010..013 -> `data-model.md`, pointer-first model, registry tests.
- FR-014..020 -> `configuration-and-versioning.md`, JSON Schema, config tests.
- FR-021..024 -> `activity-capability-workflow-model.md`, UC-02/03/10.
- FR-025..029 -> capability/workflow model, compiler tests, risk R-06/R-07.
- FR-030..035 -> `policy-provider-ui-events.md`, policy/adapter/event tests.
- FR-036..040 -> approval/effect sections, UC-07/08/15, replay/readback tests.
- FR-041..045 -> analytics/observability/lifecycle documents and tests.
- FR-046..050 -> OpenAPI, acceptance matrix, architecture and PR sequence.

## Success criterion mapping

- SC-001 -> UC-01/02 and Activity Pack/config APIs.
- SC-002 -> UC-03 and PR-5.
- SC-003 -> deterministic resolver tests.
- SC-004 -> isolation/security suite.
- SC-005 -> immutable version repository tests.
- SC-006 -> provider/approval/readback end-to-end tests.
- SC-007 -> effective configuration lineage API/UI.
- SC-008 -> feature cohort and rollback evidence.
- SC-009 -> KPI projection tests.
- SC-010 -> `rollout-pr-sequence.md`.

## Threat-to-control mapping

- T-01/T-07/T-15 -> canonical scope, resource authority, tenant allowlists.
- T-02 -> semantic capability and canonical identity.
- T-03/T-16 -> JSON Schema, bounded operators and limits.
- T-04 -> deny-wins and immutable mandatory controls.
- T-05 -> DAG/effect compiler.
- T-06 -> credential references and secret scanning.
- T-08 -> hash/resource/effect/expiry-bound approvals.
- T-09 -> invalidation plus final-boundary revalidation.
- T-10/T-11 -> idempotency, leases, inspect/reconcile.
- T-12/T-17 -> certification, immutable versions, checksums and rollout.
- T-13 -> event schema/auth/dedupe.
- T-14 -> backend authorization.
- T-18 -> append-only transitions and immutable snapshots.

## Task mapping

Tasks in `tasks.md` reference the requirements, threats, and acceptance rows they satisfy. A task cannot be marked complete with only narrative evidence when its acceptance row requires tests, migrations, runtime readback, or production parity.
