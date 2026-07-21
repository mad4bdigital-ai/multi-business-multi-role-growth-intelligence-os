# Implementation Plan

## P0
- Add operation contract registry and exact intent resolver.
- Add early principal/tenant/workspace/resource preflight.
- Enforce execution and response budgets.
- Normalize all upstream errors to JSON.
- Implement `repo_change_execute`, Managed Ephemeral Git Worker, `repo_reconcile_execute`, and `ci_diagnose`.
- Add generated-artifact reconciliation.
- Add Admin/Tenant authority projection tests.

## P1
- Implement `operation_context_get`.
- Add typed catalog APIs and remove routine SQL discovery.
- Add auto-renewing operation-scoped capability envelopes.
- Add transparent internal chunk aggregation.
- Persist operation checkpoints and resume.

## P2
- Add declarative change manifests and reusable recipes.
- Add preview/dry-run diffs.
- Generate PR summaries and evidence manifests.
- Add one-action retry/resume.

## Layer placement
- `src/api`: schemas, boundary validation, error mapping, pagination.
- `src/application`: orchestrators, preflight, budgets, checkpoints.
- `src/domain`: contracts, authority decisions, capabilities, outcomes.
- `src/infrastructure`: registries, repositories, Git workers, provider adapters, audit, telemetry.

## Rollout
Shadow → Admin pilot → selected Tenant pilot → bounded general availability. No production cutover until parity, isolation, resilience, rollback, and observability gates pass.
