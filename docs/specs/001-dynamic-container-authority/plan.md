# Implementation Plan

No phase authorizes a later phase.

## Phase 0 — Design freeze

Approve domain, security, database, API, performance, testing, rollout, and rollback decisions. No runtime/schema/provider changes.

## Phase 1 — Auth lifecycle repair

Separate bug-fix PR: passive preview, remove actionless clients, authorization/schema before credentials, zero side effects in preview, focused regression tests.

## Phase 2 — Container foundation

Additive schema: types, containers, relationships, closure, authority epoch, classifications, issue views, and indexes. Seed default topology; no enforcement.

## Phase 3 — Roles and dimensions

Add templates, assignments, dimension registry, bindings, and compatibility projections. No provider changes.

## Phase 4 — Identity and graph projection

Project tenants/workspaces, use `brands.target_key`, hold ambiguous links, project Activity/Workflow, publish read-only graph projections.

## Phase 5 — Shadow resolver

Implement bounded traversal, deterministic hashing, epoch validation, immutable snapshots, and comparison evidence. Legacy result remains authoritative.

## Phase 6 — Override governance

Add exact path/snapshot binding, explicit platform-owner exceptions, dual approval for critical classes, TTL caps, atomic consumption, audit, and readback.

## Phase 7 — Read-only canary

Require zero cycles, no unresolved high-risk mapping, complete links, acceptable latency, and 100% audit coverage.

## Phase 8 — Bounded mutation

```text
preview-only → internal SQL → low-risk provider writes
→ publish/spend → credential/deployment/destructive
```

Every apply requires effective context, envelope, approvals, exact binding, credential readiness, audit, and same-cycle readback.

## Phase 9 — Legacy retirement

Remove bypasses and identity drift only after measured adoption.

## Promotion gates

Approved mismatch threshold; zero unresolved high-risk conflict; approved p95/p99 latency; zero preview side effects; stale/replay tests; rollback drill; CI and release readiness green.

## Rollback

Return rollout to shadow or disable consumers; preserve evidence; keep legacy dispatch until promotion; disable rows rather than delete; schema removal is a separate cleanup.
