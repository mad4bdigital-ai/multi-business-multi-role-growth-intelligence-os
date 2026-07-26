# Task Breakdown

All checked tasks are complete for specification, implementation, tests, and governed rollout controls on branch `gpt/dynamic-container-authority-foundation-20260619`. Checkmarks do **not** authorize production migration apply, enforcement enablement, provider writes, credential payload reads, live canary promotion, or bypass retirement. Those remain explicit post-merge operational gates in `completion-evidence.md`.

## Specification

- [x] Domain/tenancy, merge, threat, DB/index, API, performance, and rollout reviews completed across `spec.md`, `plan.md`, `research.md`, `data-model.md`, `inheritance-matrix.md`, `resolution-algorithm.md`, `threat-model.md`, and `contracts/`.
- [x] Design freeze completed for the branch implementation scope; production rollout remains separately approval-gated.

## Auth lifecycle

- [x] Authorization/schema validation occurs before credential materialization.
- [x] Actionless provider clients are absent from Dynamic Container preview/shadow execution.
- [x] Preview/shadow prove zero secret, token, provider-call, external-send, and external-write side effects.
- [x] Regression tests cover forbidden secret-like metadata, pre-credential blocking, and passive preview.

## Container foundation

- [x] Type/container registries.
- [x] Relationship registry and rows.
- [x] Transaction-safe cycle preflight.
- [x] Closure and bounded rebuild.
- [x] Authority epoch and invalidation events.
- [x] Readiness views, indexes, and default topology.

## Classifications, roles, and bindings

- [x] Classification schema, assignment, eligibility, and merge.
- [x] Role templates, composition, assignments, and authority ranks.
- [x] Resource dimension registry and exact resource bindings.
- [x] Deny/restrict precedence and operation matching.
- [x] Delegator-authority validation and over-delegation blocking.
- [x] Legacy adapters and shadow comparison inputs.

## Identity and projections

- [x] Project Platform, Tenant, and Workspace containers.
- [x] Project Brands through `brands.target_key`.
- [x] Hold ambiguous workspace-brand links as projection issues.
- [x] Project Activity and Workflow containers.
- [x] Project to Platform Graph with `projection_only`/`context_only` taxonomy and `runtime_enforced=0`.

## Resolver

- [x] Bounded multi-parent loader and path enumeration.
- [x] Classification, role, binding, sharing, and delegation resolution.
- [x] Typed conflicts and limit exhaustion.
- [x] Authority-epoch retry/block behavior.
- [x] Immutable no-secret resolution snapshots.
- [x] Epoch-bound cache and invalidation.
- [x] Shadow comparison, mismatch, performance, and audit dashboards.

## Overrides

- [x] Envelope-linked request/approval records.
- [x] Normal resolution executes before override evaluation.
- [x] Exact path, dimension, resource, operation, and snapshot binding.
- [x] 15/60 minute TTL caps.
- [x] Distinct second approver for critical/destructive classes.
- [x] Atomic one-time consumption.
- [x] Implicit `platform_owner` bypass removed from canary behavior.
- [x] Use/readback/stale/expiry evidence.

## API and tests

- [x] Resolution, relationship, role, binding, override, Co-workspace, Workspace-team, and Brand-team resources.
- [x] Structured 400/401/403/404/409/422/429/503 examples and stable error envelopes.
- [x] Idempotency and optimistic concurrency with authority epoch/`If-Match`.
- [x] Multi-parent, cycle, conflict, deny, sharing/delegation, over-delegation, pre-credential block, platform owner, dual approval, stale epoch, replay, cross-tenant, preview side effects, audit hash, cache invalidation, and query-plan tests.
- [x] Cursor pagination for Co-workspace and team lists.
- [x] User-JWT-only Workspace/Brand team management with last-admin protection.

## Rollout

- [x] Mismatch, critical-mismatch, p95, p99, audit-coverage, and minimum-sample thresholds defined and enforced.
- [x] Read-only canary candidates selected in `shadow` for preview resolution and rollout readiness.
- [x] 100% audit coverage required before promotion.
- [x] Rollback drill completed with dry-run, typed confirmation, transaction rollback/commit, and policy readback.
- [x] Single-canary promotion gate permits exactly one read-only capability at a time after `ready_for_review`; no production promotion executed.
- [x] Bypass-retirement gate requires enforced adoption, stable readiness windows, 100% audit coverage, zero mismatch, and zero active overrides; no production bypass retired.

## Completion evidence

- [x] Migration 319 static preflight: 22/22 statements, risk count 0, destructive count 0.
- [x] Migration 320 static preflight: 25/25 statements, risk count 0, destructive count 0.
- [x] Governed migration authorization rows included for both migrations.
- [x] Executable `EXPLAIN` preflight covers four critical resolver queries and expected indexes.
- [x] Resolver benchmark remains below p95 <= 150 ms and p99 <= 400 ms budgets.
- [x] Activation surface coverage: 18 candidates, 18 explicit internal exclusions, 0 missing.
- [x] Full repository test manifest: 514/514 passed.
- [x] Architecture validation: 173/173 passed.
- [x] Detailed evidence and post-merge holds recorded in `completion-evidence.md`.
