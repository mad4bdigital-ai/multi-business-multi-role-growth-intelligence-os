# Sequential Plan Orchestration Architecture

## Decision

The platform accepts multi-step plans as durable compiled work instead of
treating `steps_json` as a preview. `execution_plans` owns the goal and overall
state, `execution_plan_steps` owns executable step intent and dependencies,
`step_runs` and `workflow_runs` remain execution evidence, and
`execution_plan_events` is the append-only transition timeline.

## Execution Loop

1. Create or resolve an execution plan.
2. Compile up to 100 ordered steps.
3. Validate unique keys and backward-only dependencies.
4. Mark dependency-free work `ready`.
5. Atomically claim one ready step.
6. Stop and create an approval hold when policy requires approval.
7. Execute the claimed step with its idempotency key.
8. Record result, retry, failure, and checkpoint events.
9. Promote newly unblocked steps to `ready`.
10. Continue until completed, blocked, paused, cancelled, or awaiting approval.

`POST /planner/plans/{plan_id}/tick` executes at most one step.
`POST /planner/plans/{plan_id}/run` repeats bounded ticks until a stop condition.
`POST /planner/plans/{plan_id}/enqueue` submits that bounded run to the existing
background job worker with an idempotency key.

## Safety Contract

- Dependency validation forbids references to unknown or later steps.
- Claims are transactional and carry a unique claim token.
- Each step has a stable idempotency key and bounded attempts.
- Retryable step failures remain visible in the timeline but do not fail a run
  that later recovers or stops correctly at an approval gate.
- Approval decisions update the hold, step, plan, and event timeline together.
- Approval resumes readiness but never directly dispatches the next step.
- Provider-capable workflow authority remains governed by the existing connector
  preflight and approval policies.
- Recompilation is forbidden after execution starts or the plan is terminal.

## Interfaces

- `POST /planner/plans/{plan_id}/compile`
- `POST /planner/plans/{plan_id}/tick`
- `POST /planner/plans/{plan_id}/run`
- `POST /planner/plans/{plan_id}/enqueue`
- `POST /planner/plans/{plan_id}/resume`
- `GET /planner/plans/{plan_id}/timeline`

## Validation

```text
node http-generic-api/test-sequential-plan-orchestrator.mjs
node http-generic-api/test-execution-plan-dispatch-route.mjs
node http-generic-api/test-platform-recomposition-docs.mjs
node build-canonicals.mjs --check
```

## Supervisor Runtime Boundary

Supervisor-agent orchestration may select only healthy active agents with active route-derived `logic.evaluate_pack` authority. Migrations `1003_sprint68_supervisor_chain_runtime_guards.sql` and `1006_sprint69_supervisor_route_logic_skill_grants.sql` establish the chain-lineage and route-derived grant prerequisites.

`npm run supervisor:readiness:live` proves schema, grant coverage, and configured fallback health. It does not prove behavioral dispatch. A production claim must distinguish:

- `execution_ready=true`: static and live authority prerequisites pass;
- `behaviorally_certified`: controlled transaction-rollback dispatch, fallback, duplicate prevention, cancellation, handoff, cycle, and depth evidence has been observed;
- provider execution certified: an independently authorized real provider execution has been observed.

The 2026-06-15 production checkpoint has the first two states. The behavioral certification left no fixture records and made no provider calls. Real provider execution remains outside this checkpoint. See `supervisor-agent-runtime-readiness.md` and `execution-log-supervisor-production-activation-2026-06-15.md`.
