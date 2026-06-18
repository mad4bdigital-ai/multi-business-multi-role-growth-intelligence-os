# Implementation Plan

No phase authorizes work from a later phase.

## Phase 0 — Specification freeze

Approve domain, security, database, API, testing, rollout, and rollback decisions. No runtime/schema/provider changes.

## Phase 1 — Auth lifecycle repair

Separate bug-fix PR:

- passive preview/dry-run;
- remove actionless provider-client creation;
- fix obsolete Drive dependencies;
- authorization/schema before credential materialization;
- regression proof of zero secret/token/provider access during preview.

## Phase 2 — Container foundation

Additive schema only: types, containers, relationship registry, relationships, closure, classifications, and integrity views. Seed the default topology but allow multi-parent and future types. No enforcement.

## Phase 3 — Roles and resource dimensions

Add role templates, explicit assignments, dimension registry, resource bindings, and compatibility projections from current registries. No provider changes.

## Phase 4 — Canonical identity and graph projection

Project tenants/workspaces, adopt `brands.target_key`, reconcile brand links, hold ambiguity, project Activity/Workflow containers, and publish read-only Platform Graph projections with taxonomy validation.

## Phase 5 — Shadow resolver

Implement `resolveEffectiveContainerContext` and attach shadow evidence to execution readiness, capability dry-run, and tenant-effective capability resolution. Record legacy/new comparisons without changing dispatch.

## Phase 6 — Override governance

Add container override records, path/snapshot hashing, explicit `platform_owner` overrides, two distinct approvers for destructive/credential/deployment, TTL caps, consumption, audit, and readback.

## Phase 7 — Read-only canary

Canary explicit low-risk scopes only after zero cycles, zero unresolved mappings/conflicts, complete connection links, and 100% effective-context audit coverage.

## Phase 8 — Mutation preview and bounded apply

Order:

```text
preview-only mutations
→ internal SQL writes
→ low-risk provider writes
→ publish/spend
→ credential/deployment/destructive
```

Every apply requires effective context, capability envelope, approvals, exact binding, credential reference readiness, audit, and same-cycle readback.

## Phase 9 — Legacy retirement

Remove direct connection bypasses, highest-permission selection, implicit admin targeting, and legacy identity drift only after measured adoption.

## Rollback

Disable new consumers or return rollout to shadow; preserve evidence; keep legacy dispatch until explicit promotion; disable rows instead of deleting them; drop schema only in a separate cleanup.

## Required documentation during implementation

Update canonical sources/generated indexes, AI guide, dynamic capability docs, semantic capability docs, resource authority docs, runtime boundary map, patch index, deployment parity, OpenAPI, and focused tests as applicable.
