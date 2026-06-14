# Supervisor Agent Runtime Readiness

## Purpose

Admin GPT and Tenant GPT may coordinate sub-agents, but they must not be described as fully execution-ready master agents until the runtime proves the required safety contracts.

The repeatable readiness command is:

```powershell
cd http-generic-api
npm run supervisor:readiness
```

To add a read-only check of the configured live database schema:

```powershell
npm run supervisor:readiness:live
```

Both commands emit JSON and never emit secrets. A non-zero result means the supervisor execution claim remains blocked.

## Enforced Now

- `dispatchPlan` claims validated or approved plans with a compare-and-set update before creating a workflow run. Concurrent dispatch attempts receive `plan_already_claimed`.
- If workflow-run creation fails after the claim, the plan transitions to `failed` and returns `workflow_run_create_failed` instead of remaining stuck in `executing`.
- Planner and chain agent selection require `health_status='active'` and use deterministic `agent_id` ordering.
- Connector skill grants are validated fail-closed before plan claim; missing grants and unavailable grant authority block execution.
- Chain dispatch attempts at most one configured healthy fallback agent after primary-agent failure.
- Chain events persist root/parent lineage, workflow path, and bounded depth; cycles and depth overflow are recorded as `skipped`.
- One-time handoff state includes tenant scope, expiry, revocation, and atomic consumption.
- Shared dispatch requires capability envelopes before claim for MCP execution and WordPress `apply=true`; specialized mutation paths retain their narrower envelope guards.

## Activation Boundary

The static readiness audit now returns `execution_ready=true` only when every source-contract guard above is present. Live activation still requires:

- migration `1003_sprint68_supervisor_chain_runtime_guards.sql` authorized, applied, and confirmed by `npm run supervisor:readiness:live`;
- live route-to-agent `logic.evaluate_pack` grant coverage and configured fallback-agent health checks pass;
- targeted controlled-tenant behavior tests for duplicate prevention, fallback, cycle rejection, depth rejection, and envelope rejection;
- operational monitoring confirming no unexpected `failed` or `skipped` chain-event growth.

Until live and behavioral evidence is current, sequential governed orchestration remains the supported production default.

## Readiness Evidence

Static readiness reads source contracts only. Live readiness additionally reads `information_schema` plus active route/grant and fallback-agent relationships. Neither mode mutates application data.

The live schema check proves presence, not behavioral correctness. Production activation still requires targeted dispatch, duplicate-prevention, handoff-consumption, cancellation, and chain-boundary tests against a controlled tenant.
