# Implementation Plan: Durable Governed Execution and Agent Delegation

## Outcome

Build a shared execution substrate that reduces repeated Agent coordination while preserving explicit user authority, least privilege, deterministic policy, and same-cycle evidence.

## Architectural sequence

The sequence is intentionally dependency ordered. Each phase makes the following phases faster and safer.

1. Durable Execution Kernel.
2. Canonical Execution Contract Resolver.
3. Plan-Bound Mutation Sessions and delegation foundation.
4. Reconciliation and Readback Framework.
5. Validation Lab and Structured CI.
6. Managed PR and Release Lifecycle.
7. Evidence Auto-Closeout.
8. Goal-Filtered Operational Intelligence.

## Target architecture

```text
Execution API
  → Execution Kernel
  → Contract and Policy Resolver
  → Plan Session Manager
  → Delegation Decision Engine
  → Mutation Coordinator
  → Provider Adapters
  → Reconciliation Engine
  → Evidence Collector
  → Next Action Planner
```

### Execution Kernel

Owns operation identity, lifecycle, checkpoints, leases, cancellation, resume, timeouts, and terminal-state rules.

### Contract and Policy Resolver

Resolves semantic intent to canonical action, endpoint, capability, runtime surface, approval, retry, readback, and evidence policy. Provider-specific keys are infrastructure output, not caller input.

### Plan Session Manager

Pins plan hash, principal, resource snapshot, allowed intents, risk ceiling, limits, expiry, and approval bindings. It may issue short-lived child envelopes without widening authority.

### Delegation Decision Engine

Evaluates requested mode, user grant, policy ceiling, risk, drift, separation of duties, and human-on-exception rules. It records Agent authority separately from user identity.

### Mutation Coordinator

Creates pending receipts before dispatch, enforces idempotency, sequences mutations, and classifies transport and provider outcomes.

### Reconciliation Engine

Compares expected state with provider, ledger, schema, deployment, repository, and policy state before permitting retry or completion.

### Evidence Collector

Builds bounded evidence bundles from authoritative sources and writes no-secret references suitable for audit and Spec Kit closeout.

### Next Action Planner

Returns one typed next action, required input, policy reason, and blocking evidence.

## Delivery phases

### Phase 0 — Baseline and contracts

- Inventory existing operation, execution-plan, approval, capability-envelope, idempotency, receipt, reconciliation, and repository-automation surfaces.
- Identify reusable tables and avoid duplicate state stores.
- Publish JSON Schemas and OpenAPI draft.
- Establish compatibility adapters for current governed tools.

### Phase 1 — Durable kernel

- Add operation and step state persistence.
- Add pending mutation receipts before dispatch.
- Add transition guards, resume, cancel, and explain.
- Add canonical `next_action`.
- Pilot one read-only operation and one low-risk internal mutation.

### Phase 2 — Contract resolver

- Add execution-contract registry and resolver.
- Migrate selected operations from caller-provided capability keys to intent-first resolution.
- Add ambiguity and drift gates.
- Preserve current tools behind adapters.

### Phase 3 — Delegation and sessions

- Implement `user_approval_only`, `agent_recommend_only`, `agent_queue_for_approval`, `delegated_low_risk`, and `delegated_plan_bound`.
- Add revocation, expiry, mutation limits, resource bindings, risk ceiling, and audit.
- Add human-on-drift pause behavior.
- Keep high-risk classes user controlled by default.

### Phase 4 — Reconciliation

- Add outcome classifier and retry policy.
- Add provider, repository, schema, migration-ledger, and deployment reconcilers.
- Add fault injection after provider mutation and before response.
- Prove zero duplicate mutations.

### Phase 5 — Validation and CI

- Add disposable MariaDB-compatible migration validation.
- Add structured failure artifacts.
- Add contract drift, state-machine, idempotency replay, unknown outcome, policy drift, delegation-boundary, and semantic-file gates.
- Require structured diagnosis for failed checks.

### Phase 6 — Managed delivery

- Extend Repository Automation Control Plane with managed PR lifecycle built on the durable kernel.
- Add semantic patch intent, base synchronization, stale-run cancellation, bounded repair, SHA-bound merge approval, and release readback.

### Phase 7 — Auto-closeout

- Generate manifest, completion, requirements, tasks, and spec delivery-state updates from authoritative evidence.
- Validate completion contracts locally and in CI.
- Create closeout PR without runtime or provider mutation.

### Phase 8 — Operational focus

- Add goal-filtered attention projection.
- Rank only blockers and related risk by default.
- Preserve complete diagnostic access through bounded references.

## Migration strategy

Implementation will likely require additive SQL surfaces for durable operations, steps, receipts, execution contracts, sessions, delegation grants, decisions, and evidence references. Before creating migrations, the implementation PR must map existing tables and prove why each new table or column is required.

All migrations must be additive, tested on a compatible MariaDB engine, separately authorized, checksum bound, dry-run, applied through the governed runner, and verified by schema and ledger readback.

## Compatibility strategy

- Existing tool contracts remain callable during migration.
- Compatibility adapters translate legacy calls into durable operations.
- No legacy path is retired until parity, telemetry, and rollback evidence exist.
- Delegation defaults to `user_approval_only` for operations without explicit policy.

## Rollout strategy

1. Shadow resolution and evidence only.
2. Read-only pilot.
3. Low-risk internal mutation pilot.
4. Repository documentation and branch-sync delegation.
5. PR lifecycle delegation excluding merge.
6. Human-on-exception for certified low-risk workflows.
7. Separately reviewed expansion to medium-risk classes.

## Validation

- Unit and model-based state-machine tests.
- Transactional idempotency and receipt tests.
- Multi-tenant authorization and cross-scope denial.
- Delegation expiry, revoke, limit, drift, and separation-of-duties tests.
- Fault injection at every dispatch boundary.
- MariaDB engine matrix.
- OpenAPI and registry parity.
- Response bounds and no-secret checks.
- Production parity and post-merge audit for every implementation phase.

## Branch strategy

The specification is opened on `gpt/spec-011-durable-governed-execution-20260721`. Implementation must use multiple small PRs by phase. No implementation slice may claim completion for later phases, and every PR must update `completion.json` with exact evidence or remain explicitly pending.
