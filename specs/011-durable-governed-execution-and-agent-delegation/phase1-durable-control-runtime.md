# Phase 1 Durable Control Runtime

## Purpose

Complete the bounded Phase 1 runtime contract for tasks T100-T106 by extending the existing sequential plan orchestrator rather than creating a parallel operation kernel.

## Reused authority

- `execution_plans` remains the durable operation anchor.
- `execution_plan_steps` remains the durable step lifecycle authority.
- `execution_plan_events` remains the append-only timeline.
- `approval_holds` remains the human approval authority.
- `sequentialPlanOrchestrator.js` remains the execution engine.
- `plannerRoutes.js` remains the backend-key-protected plan control surface.

## Added control contract

`durableExecutionControlService.js` adds:

- explicit plan transition guards and terminal-state invariants;
- canonical status, explain, cancel, tick, run, and bounded timeline projections;
- one canonical `next_action` and bounded blocker response;
- generic pending mutation receipt creation before workflow dispatch;
- idempotent replay from successful receipts;
- fail-closed `unknown_outcome` handling that blocks retry until readback;
- no-secret result and evidence boundaries.

## Mutation receipt decision

The existing `repository_automation_receipts` table is repository-specific because it requires repository automation run and step semantics. Reusing it for generic execution plans would create false ownership and coupling. Therefore the additive `execution_plan_mutation_receipts` table is introduced as the generic receipt authority for plan steps.

The receipt lifecycle is:

1. create or lock a `pending` receipt before workflow dispatch;
2. return the stored result without dispatch when the same request already succeeded;
3. mark a deterministic pre-dispatch rejection as `failed_pre_dispatch`;
4. classify a transport or uncertain provider failure as `unknown_outcome`;
5. block retry while a receipt is `pending` or `unknown_outcome`;
6. require a later governed reconciler to record readback and move it to `reconciled`.

## T100-T106 coverage

| Task | Coverage |
|---|---|
| T100 | Existing plan, step, and event persistence is certified as the common durable lifecycle. |
| T101 | Explicit transition graph, terminal invariants, compare-and-update control, and guarded cancellation. |
| T102 | Step-scoped idempotency plus pending mutation receipt before workflow dispatch. |
| T103 | Status, resume, cancel, explain, tick, and run operations. |
| T104 | Canonical `next_action` and bounded blockers. |
| T105 | Bounded timeline and evidence-reference projection. |
| T106 | Read-only status/explain pilot and low-risk internal analysis/checkpoint execution pilot. |

## Safety boundaries

- The migration is not applied by this slice.
- No Production database write is performed.
- No provider credentials are read or stored.
- No public unauthenticated route is added.
- Existing approval and capability boundaries are not bypassed.
- Unknown outcomes are never retried automatically.
- No force push, deployment, or Production promotion is performed.

## Follow-on dependency

Phase 4 must add the governed reconciler that reads pending or unknown receipts before retry and records the final `reconciled` state with bounded readback evidence.
