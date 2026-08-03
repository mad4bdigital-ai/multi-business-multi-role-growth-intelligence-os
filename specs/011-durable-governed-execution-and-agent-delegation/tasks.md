# Tasks: Durable Governed Execution and Agent Delegation

## Specification and authority

- [x] T001 Define the problem, objectives, users, scope, risks, and success criteria.
- [x] T002 Define approval delegation modes and default-deny boundaries.
- [x] T003 Define the target framework, delivery order, and compatibility strategy.
- [x] T004 Define explicit runtime policies and degradation-prevention gates.
- [x] T005 Define proposed data model and OpenAPI draft.
- [x] T006 Define CI automation and fault-injection framework.
- [x] T007 Define Spec Kit completion contract and requirements checklist.

## Phase 0 — Baseline and contract design

- [x] T010 Inventory reusable operation, plan, approval, envelope, idempotency, receipt, reconciliation, and audit tables.
- [x] T011 Produce a gap analysis and table-reuse decision record.
- [x] T012 Finalize operation, delegation, policy, receipt, and evidence JSON Schemas.
- [x] T013 Finalize OpenAPI 3.1 draft governance and stable error codes.
- [x] T014 Define compatibility adapters for existing governed tools.
- [x] T015 Add registry and runtime contract drift tests before runtime implementation.

## Phase 1 — Durable Execution Kernel

- [x] T100 Add durable operation and step lifecycle persistence.
- [x] T101 Add transition guards and terminal-state invariants.
- [x] T102 Add idempotency scope and pending mutation receipt before dispatch.
- [x] T103 Add status, resume, cancel, and explain operations.
- [x] T104 Add canonical `next_action` and blocker response.
- [x] T105 Add bounded operation timeline and evidence references.
- [x] T106 Add read-only pilot and low-risk internal mutation pilot.

## Phase 2 — Canonical Execution Resolver

- [x] T120 Add execution-contract registry and exact resolution rules.
- [x] T121 Resolve action, endpoint, capability, runtime surface, approval, retry, readback, and evidence policy.
- [x] T122 Reject ambiguous, missing, stale, or conflicting bindings before dispatch.
- [x] T123 Convert selected operations to intent-first input.
- [x] T124 Add Admin and Tenant isolation and no-secret resolver tests.

## Phase 3 — Plan-Bound Sessions and Delegation

- [x] T140 Add execution session shadow with plan hash, resource snapshot, risk ceiling, limits, and expiry.
- [ ] T141 Add delegation grant preview, create, inspect, revoke, and expire.
- [x] T142 Implement `user_approval_only`.
- [x] T143 Implement `agent_recommend_only`.
- [x] T144 Implement `agent_queue_for_approval`.
- [x] T145 Implement `delegated_low_risk`.
- [x] T146 Implement `delegated_plan_bound`.
- [x] T147 Add human-on-drift pause and typed escalation.
- [x] T148 Add separation-of-duties foundation for later `multi_agent_approval`.
- [x] T149 Prove that Agent renewal cannot widen authority or approve itself.

## Phase 4 — Reconciliation and Readback

- [x] T160 Add outcome classifier.
- [x] T161 Add read-before-retry enforcement after unknown outcomes.
- [x] T162 Add repository and PR reconcilers.
- [x] T163 Add migration schema and ledger reconciler.
- [x] T164 Add deployment and production-parity reconciler.
- [x] T165 Add provider adapter reconciliation contract.
- [x] T166 Add duplicate-mutation fault-injection suite.

## Phase 5 — Validation Lab and Structured CI

- [x] T180 Add disposable MariaDB-compatible validation environment.
- [x] T181 Record engine, SQL mode, collation, constraints, indexes, schema diff, and rollback assessment.
- [x] T182 Block migration apply authorization without engine validation.
- [x] T183 Add structured CI failure artifact schema and reporter.
- [x] T184 Add contract drift gate.
- [x] T185 Add state-machine model gate.
- [x] T186 Add idempotency replay and unknown-outcome gates.
- [x] T187 Add delegation-boundary and policy-drift gates.
- [x] T188 Add semantic JSON, YAML, OpenAPI, and completion mutation gates.
- [x] T189 Fail CI checks that do not emit structured diagnosis.

## Phase 6 — Managed PR and Release Lifecycle

- [x] T200 Add managed delivery operation on top of the durable kernel.
- [x] T201 Add semantic patch intent and stable anchors.
- [x] T202 Add automatic base synchronization and stale-run cancellation.
- [x] T203 Add bounded delegated repair for allowlisted low-risk CI failures.
- [x] T204 Bind merge approval to final head and base SHA.
- [x] T205 Add merge, branch-delete, deployment receipt, and production readback.
- [x] T206 Prove no force push and protected-branch bypass.

## Phase 7 — Evidence Auto-Closeout

- [x] T220 Add authoritative evidence collector.
- [x] T221 Add schemas for manifest, completion, checklist, tasks, and delivery-state updates.
- [x] T222 Generate closeout changes with semantic mutations.
- [x] T223 Validate generated evidence before commit and in CI.
- [x] T224 Create closeout PR through governed repository automation.

## Phase 8 — Goal-Filtered Operational Intelligence

- [ ] T240 Add goal-to-operation correlation.
- [ ] T241 Classify blocking, related risk, platform-wide, and unrelated attention.
- [ ] T242 Add summary-first bounded goal projection.
- [ ] T243 Preserve full diagnostic detail through governed references.

## Completion governance

- [ ] T260 Record every implementation PR and merge SHA.
- [ ] T261 Record migrations, checksums, authorization, and ledger evidence.
- [ ] T262 Record delegation and fault-injection certification evidence.
- [ ] T263 Record CI, staging, and production parity for every rollout phase.
- [ ] T264 Complete post-merge audit and closeout PR.