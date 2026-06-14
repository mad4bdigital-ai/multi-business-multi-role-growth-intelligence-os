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

To certify the dispatcher behavior without external provider execution:

```powershell
npm run supervisor:certify
npm run supervisor:certify:live
```

The live certification command creates controlled fixtures inside a database transaction, verifies the runtime behavior, and rolls the transaction back. These commands emit JSON and never emit secrets. A non-zero result means the corresponding supervisor execution claim remains blocked.

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

- migrations `1003_sprint68_supervisor_chain_runtime_guards.sql` and `1006_sprint69_supervisor_route_logic_skill_grants.sql` authorized, applied, and confirmed by `npm run supervisor:readiness:live`;
- live route-to-agent `logic.evaluate_pack` grant coverage and configured fallback-agent health checks pass;
- targeted controlled behavior tests for duplicate prevention, fallback, cycle rejection, depth rejection, terminal-plan guards, and one-time handoff controls;
- operational monitoring confirming no unexpected `failed` or `skipped` chain-event growth.

Until live and behavioral evidence is current, sequential governed orchestration remains the supported production default.

## Readiness Evidence

Static readiness reads source contracts only. Live readiness additionally reads `information_schema` plus active route/grant and fallback-agent relationships. Neither mode mutates application data.

The live schema check proves presence, not behavioral correctness. `npm run supervisor:certify:live` proves the targeted dispatch, duplicate-prevention, fallback, cancellation, handoff-consumption, and chain-boundary contracts against controlled transaction-rollback fixtures. It deliberately does not prove external provider execution.

## Production Checkpoint - 2026-06-15

- `1003_sprint68_supervisor_chain_runtime_guards.sql` and `1006_sprint69_supervisor_route_logic_skill_grants.sql` are applied through the governed migration runner.
- Migration `1006` inserted 13 deterministic global `logic.evaluate_pack` grants. Its idempotency readback inserted 0 additional rows.
- Live readiness returned `execution_ready=true`, `blockers=[]`, 17 eligible routed agents, and 0 missing grants.
- Governed migration ledger evidence:
  - initial `1006` apply run: `9016f9dd-e378-49b0-8ed7-23d30a511d22`;
  - idempotency apply/readback run: `20e6f824-afd1-4beb-9d16-550400722d5a`;
  - checksum: `d737039acbcb8e6108dd343aa83bc56015eae3e13b8ef0ef2d03e1a11c57b953`.
- Authoritative SQL execution evidence: `execution_log.id=15010`, trace `supervisor_production_activation:2026-06-15:1006:d737039acbcb`, status `success_with_warnings`.
- Controlled live behavioral certification passed with atomic claim, workflow-run creation, fallback dispatch, cycle rejection, depth rejection, terminal-plan protection, and one-time handoff controls.
- Behavioral certification used transaction rollback, left no fixture plans/events/runs, and made 0 external provider calls.
- Authoritative behavioral evidence: `execution_log.id=15015`, trace `supervisor_behavioral_certification:2026-06-14:15b5dfb2-b3bf-4b15-839e-f23467942404`, status `success`.

The original activation warning remains historically accurate: no real supervisor workflow dispatch was observed in the preceding 48 hours. Four historical pending events were found to contain an unresolved semicolon-delimited composite workflow identity and have no replay authority. Migration `1007_sprint69_archive_invalid_historical_chain_events.sql` classifies only those invalid historical events as `skipped`; they must never be automatically replayed. This checkpoint claims controlled, provider-free behavioral certification, not real provider execution. See `execution-log-supervisor-production-activation-2026-06-15.md`.
