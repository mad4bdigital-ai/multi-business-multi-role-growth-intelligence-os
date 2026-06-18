# Task Breakdown

## Specification
- [ ] Domain/tenancy, merge, threat, DB/index, API, performance, and rollout reviews.
- [ ] Design-freeze approval.

## Auth lifecycle
- [ ] Authorization/schema before credential materialization.
- [ ] Remove actionless provider clients.
- [ ] Prove preview has zero secret/token/provider side effects.
- [ ] Add regression tests.

## Container foundation
- [ ] Type/container registries.
- [ ] Relationship registry and rows.
- [ ] Transaction-safe cycle preflight.
- [ ] Closure and bounded rebuild.
- [ ] Authority epoch/invalidation.
- [ ] Readiness views/indexes/default topology.

## Classifications, roles, and bindings
- [ ] Classification schema/assignment/merge.
- [ ] Role templates/composition/assignments.
- [ ] Resource dimension registry/bindings.
- [ ] Deny/restrict and operation matching.
- [ ] Delegator-authority validation.
- [ ] Legacy adapters.

## Identity and projections
- [ ] Project Platform/Tenant/Workspace.
- [ ] Project Brands via `brands.target_key`.
- [ ] Hold ambiguous workspace-brand links.
- [ ] Project Activity/Workflow.
- [ ] Project to Platform Graph with taxonomy validation.

## Resolver
- [ ] Bounded multi-parent loader.
- [ ] Classification/role/binding/share/delegation resolution.
- [ ] Typed conflicts and limit exhaustion.
- [ ] Authority-epoch retry/block.
- [ ] Immutable no-secret snapshots.
- [ ] Epoch-bound cache/invalidation.
- [ ] Shadow comparison dashboard.

## Overrides
- [ ] Envelope-linked request/approval records.
- [ ] Normal resolution first.
- [ ] Exact path/dimension/resource/operation/snapshot.
- [ ] 15/60 minute caps.
- [ ] Distinct second approver for critical classes.
- [ ] Atomic one-time consumption.
- [ ] Remove implicit platform-owner bypass in canary.
- [ ] Use/readback/stale/expiry evidence.

## API and tests
- [ ] Resolution, relationship, role, binding, override resources.
- [ ] Structured 400/401/403/404/409/422/429/503 examples.
- [ ] Idempotency and optimistic concurrency.
- [ ] Multi-parent, cycle, conflict, deny, share/delegation, over-delegation, pre-credential block, platform owner, dual approval, stale epoch, replay, cross-tenant, preview side effects, audit hash, cache invalidation, and query-plan tests.

## Rollout
- [ ] Define mismatch/latency thresholds.
- [ ] Select read-only canaries.
- [ ] Require 100% audit coverage.
- [ ] Run rollback drill.
- [ ] Promote one capability at a time.
- [ ] Retire bypasses only after adoption evidence.
