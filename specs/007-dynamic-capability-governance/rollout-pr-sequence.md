# Rollout PR Sequence

## PR 0 — This specification

Complete the deep-design Spec Kit in one PR. No runtime behavior, migration apply, provider call, Tenant export, or enforcement change.

## PR 1 — Inventory, classification, and manifest compiler

- source adapters;
- normalized surface descriptors;
- canonical identity and alias diagnostics;
- dynamic effect/risk classifier;
- requirement compiler;
- additive manifest/run/gap storage;
- Admin read-only APIs;
- no execution authority change.

**Gate:** complete inventory or typed gaps, deterministic hashes, no provider call.

## PR 2 — Projection compiler and reconciliation preview

- Admin/Tenant projection candidates;
- bounded Tenant schemas;
- existing catalog comparison;
- unsafe export gaps;
- preview/dry-run only.

**Gate:** no automatic callable export; no Tenant inheritance from Admin tools.

## PR 3 — Shared enforcement shadow kernel

- invocation decision model;
- manifest/revision validation;
- relationship, grants, resource, connection, credential, approval, quota, and certification gates;
- legacy/adaptive parity evidence;
- no new provider mutation.

**Gate:** zero unexplained adaptive-allow/legacy-deny results for pilot cohorts.

## PR 4 — Generic adapter certification and readback contracts

- adapter interface and deterministic resolver;
- generic versioned certification;
- readback contract registry and verifier;
- specialized-source reconciliation;
- acknowledgement/verification separation.

**Gate:** uncertified or readback-missing writes remain blocked.

## PR 5 — Operational alerts internal-write pilot

- migrate alert sync and lifecycle transitions;
- typed confirmation, envelope, idempotency, audit, and row readback;
- debt/alert fingerprint reconciliation.

**Gate:** same-cycle readback, no unrelated alert auto-resolution, rollback evidence.

## PR 6 — Provider read-only cohort

- selected provider reads through shared kernel;
- Tenant-safe projections where authority exists;
- latency and error normalization evidence.

**Gate:** tenant isolation and credential-reference tests pass; no provider write.

## PR 7 — WordPress validation and draft shadow

- stored connection validation capability;
- users/me readback;
- create-draft normalized preflight in shadow;
- no provider write in shadow.

**Gate:** resource/site authority, validated connection, deterministic adapter, bounded schemas.

## PR 8 — WordPress draft canary

- certified draft adapter;
- forced `status=draft`;
- idempotency and post-state readback;
- bounded tenant/site cohort;
- explicit approval according to compiled policy.

**Gate:** security review, rollback rehearsal, production verification plan.

## PR 9+ — Additional cohorts

Migrate internal writes, external writes, publish/send/spend, deployment, credential-touching, destructive, and device capabilities independently. Each PR names one capability family, cohort, rollback, and verification plan.

## Final closeout PR

- record implementation PRs and merge SHAs;
- verify migration ledger and production parity;
- complete post-merge audit;
- reconcile residual debt/backlog;
- update canonicals and knowledge guide;
- define deprecation windows;
- mark `completion.json` complete only when all gates pass.

## Stop conditions

Pause rollout for cross-tenant access, stale decision execution, credential mismatch, selector ambiguity, uncertified adapter use, provider mutation without readback, duplicate dispatch, secret exposure, rollback failure, or unresolved adaptive-allow/legacy-deny mismatch.
