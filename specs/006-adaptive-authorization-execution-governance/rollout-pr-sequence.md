# Rollout PR Sequence

## Purpose

Split implementation into reviewable, reversible pull requests with explicit gates. No PR may combine broad refactoring, schema cutover, provider execution, and production enforcement.

## PR 1 — State semantics and projections

### Scope

- define independent grant, approval, authorization, execution, and verification states;
- correct active-grant counts;
- introduce `ready_requires_approval`;
- correct dynamic-tab and operational summary projections;
- remove presentation logic that treats approval-required as inactive or blocked.

### Non-goals

- no new authority tables;
- no provider calls;
- no execution-envelope enforcement;
- no route deprecation.

### Required evidence

- unit and projection integration tests;
- before/after count reconciliation;
- no change to existing execution authorization;
- backward-compatible response additions.

## PR 2 — Canonical capability and alias resolver

### Scope

- define immutable capability identity and version;
- map existing skills, actions, routes, tools, intents, and UI keys as aliases;
- detect missing and ambiguous mappings;
- provide read-only resolver diagnostics.

### Gate

The resolver remains shadow-only. Alias resolution cannot grant authority.

## PR 3 — Relationship authority read model

### Scope

- map existing tenant, workspace, brand, user, agent, and resource relationships;
- define bounded traversal and cycle handling;
- record relationship revision evidence;
- provide read-only relationship explanation for administrators.

### Gate

No new relationship store is created until existing SQL authority mapping is approved.

## PR 4 — Authorization decision kernel

### Scope

- typed subject/action/resource/context input;
- relationship, grant, and policy composition;
- obligations and stable reason codes;
- revision vectors and bounded expiry;
- append-only shadow decision evidence.

### Gate

Decision output cannot execute providers or override legacy enforcement.

## PR 5 — Shadow parity for read pilot

### Scope

- integrate `activation.skills.read`;
- compare legacy and adaptive decisions;
- classify mismatches;
- expose bounded parity metrics.

### Gate

All adaptive-allow/legacy-deny mismatches require resolution.

## PR 6 — Approval policy and append-only decisions

### Scope

- versioned approval policies;
- request, session, resource, bounded-automatic, multi-party, and break-glass modes;
- typed confirmation;
- immutable approval requests and decisions;
- expiry and invalidation rules.

### Gate

No approval decision by itself dispatches execution.

## PR 7 — Execution envelopes and idempotency

### Scope

- normalized request hashing;
- revision-bound envelopes;
- atomic dispatch reservation;
- idempotency ledger;
- stale, expired, revoked, consumed, and conflict behavior.

### Gate

Use an internal no-provider pilot first.

## PR 8 — Internal write pilot

### Scope

- integrate `platform.output-artifact.write`;
- use shared enforcement kernel;
- add row/hash readback;
- exercise approval and idempotency;
- run shadow, then bounded canary.

### Gate

No external provider mutation. Canary requires complete readback and rollback evidence.

## PR 9 — Adapter registry and certification

### Scope

- adapter contract;
- deterministic candidate resolution;
- certification evidence;
- shadow/canary/active/fallback/disabled modes;
- ambiguity denial;
- circuit-breaker readiness state.

### Gate

Uncertified and stale adapters cannot execute.

## PR 10 — Evidence and reconciliation

### Scope

- execution and verification evidence;
- outbox events;
- relationship, grant, policy, approval, adapter, connection, readback, and projection reconcilers;
- controller checkpoints and leases;
- mismatch and compensation states.

### Gate

A recovered state requires same-cycle readback evidence.

## PR 11 — Compatibility wrappers

### Scope

- existing routes invoke the adaptive kernel in shadow or enforcement mode;
- maintain response compatibility;
- measure legacy path use;
- add deprecation metadata without removing routes.

### Gate

No route removal until usage, parity, client compatibility, and rollback requirements pass.

## PR 12 — External high-impact shadow pilot

### Scope

- integrate `content.wordpress.publish` in shadow mode;
- validate brand/site authority and credential references;
- compare adapter preflight and request normalization;
- no provider write.

### Gate

External mutation remains disabled.

## PR 13 — External canary enablement

### Scope

- per-request approval;
- certified WordPress adapter;
- bounded tenant/resource cohort;
- provider-specific idempotency or uncertain-effect handling;
- post-state readback;
- manual intervention and compensation classification.

### Gate

Requires explicit typed approval, release readiness, security review, rollback rehearsal, and production verification plan.

## PR 14 — Measured cutover

### Scope

- move approved capability cohorts from legacy enforcement to adaptive enforcement;
- preserve compatibility wrappers;
- monitor SLOs and mismatch indicators;
- maintain immediate feature-flag rollback.

### Gate

No global cutover. Expansion is capability-by-capability and cohort-by-cohort.

## PR 15 — Closeout and deprecation planning

### Scope

- record merged implementation PRs and SHAs;
- update completion evidence;
- document remaining legacy usage;
- propose deprecation windows;
- run post-merge audit;
- track residual backlog.

### Gate

Spec Kit completion status remains `in_progress` until CI, migration evidence, production verification, and post-merge audit are complete.

## Database sequencing

For each physical schema change:

1. additive migration;
2. deploy code that can read old and new forms;
3. bounded backfill with checkpoints;
4. verify counts and hashes;
5. enable dual-write only when justified;
6. shadow-read new authority;
7. cut over reads;
8. stop obsolete writes;
9. retain compatibility window;
10. remove obsolete schema only in a separately approved destructive change.

## Rollback principles

- schema rollback is not the primary rollback for additive migrations;
- enforcement mode is feature-flagged per capability and cohort;
- disabling a new adapter does not authorize fallback without a new decision;
- rollback preserves evidence and does not delete decisions or approvals;
- external uncertain effects require readback before retry or rollback claims.

## PR template requirements

Every implementation PR states:

- exact problem and capability scope;
- files and architecture layers changed;
- authority and trust boundaries affected;
- API and database impact;
- backward compatibility;
- tests and evidence;
- security and performance risks;
- rollout mode and cohort;
- rollback action;
- follow-up work.

## Stop conditions

Pause rollout when any of the following occurs:

- cross-tenant authorization defect;
- adaptive allow where legacy denies without approved explanation;
- replay or duplicate dispatch;
- stale decision executes;
- credential scope mismatch;
- unresolved adapter ambiguity;
- provider mutation without readback;
- evidence contains sensitive values;
- reconciliation lag exceeds the approved threshold;
- rollback cannot restore safe enforcement behavior.
