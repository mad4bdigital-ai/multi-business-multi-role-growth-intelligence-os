# Phase 1 Slice A — Shadow Durable Execution Kernel

## Purpose

Introduce the first runtime slice of Spec 011 without adding mutation authority, provider dispatch, delegation activation, or database schema. The slice reads existing `execution_plans`, `execution_plan_steps`, and `execution_plan_events` and projects them into the Spec 011 durable-operation contract.

## Boundaries

- Read only.
- Shadow projection only.
- No public route or OpenAPI promotion.
- No mutation receipt creation yet.
- No state transition write.
- No delegation grant evaluation.
- No capability-envelope issue or renewal.
- No provider call, external send, deployment, or migration.
- Tenant callers require exact Tenant and user ownership in the persisted execution plan.

## Application service

`http-generic-api/durableExecutionShadowService.js` is an application-level compatibility projection over existing persistence. It does not replace `sequentialPlanOrchestrator.js` and does not become a dispatch authority.

The service returns:

- canonical operation state;
- conservative `user_approval_only` mode;
- read-only risk classification;
- completed step keys;
- bounded blockers;
- canonical `next_action`;
- safe event references;
- sanitized step and event summaries;
- `runtime_authority=false` and `secrets_included=false`.

## State mapping

| Existing state | Canonical shadow state |
|---|---|
| draft | requested |
| validated without ready step | preflight |
| approved or ready step | ready |
| claimed, running, or executing | executing |
| verifying | verifying |
| awaiting approval | awaiting_approval |
| paused, blocked, or retrying | failed_recoverable |
| completed | completed |
| failed | failed_terminal |
| cancelled | cancelled |

Step evidence takes precedence over plan status where it is more specific.

## Canonical next actions

- `requested` → `validate_plan`
- `preflight` → `compile_or_validate_plan`
- `awaiting_approval` → `provide_approval`
- `ready` → `dispatch_next_step`
- active states → `read_operation_status`
- `failed_recoverable` → `resume_operation`
- `failed_terminal` → `start_new_operation`
- terminal success or cancellation → `none`

These actions are descriptive only. They do not dispatch tools or grant authority.

## Security

The SQL projection selects only identity, status, attempts, timestamps, and safe references. It does not read step input, output, error, approval-policy, or event evidence payloads. Tenant queries include plan, Tenant, and user identity. Missing or inaccessible operations return the same not-found classification.

## Follow-up slices

1. Persisted canonical step and event transition certification.
2. Pending mutation receipt before dispatch.
3. Read-only status and explain endpoints with canonical OpenAPI promotion.
4. Resume and cancel operations after policy and transition tests.
5. Low-risk internal mutation pilot after reconciliation support.
