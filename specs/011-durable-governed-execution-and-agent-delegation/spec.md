# Feature Specification: Durable Governed Execution and Agent Delegation

**Branch**: `gpt/spec-011-durable-governed-execution-20260721`  
**Status**: Draft specification  
**Delivery**: Multi-PR  
**Specification PR**: pending

## Problem

The platform has strong approval, capability, resource-authority, audit, and readback primitives, but complex work still requires Agents to coordinate too many low-level steps. Transport failures can obscure mutation outcomes, capability keys and runtime surfaces may require manual discovery, short-lived envelopes expire between dependent steps, CI failures often return only a generic check name, line-based patches fail after harmless repository drift, and completion evidence is assembled manually.

The result is excess tool traffic, repeated approvals, avoidable interruptions, delayed diagnosis, and a higher probability of retrying a mutation whose outcome is unknown. The platform needs one durable, policy-driven execution framework that keeps user authority explicit while allowing bounded Agent delegation.

## Objective

Provide an intent-first execution framework in which the user or Agent submits a goal and constraints, while the platform manages durable state, contract resolution, delegated authority, retries, reconciliation, verification, evidence, and the next safe action.

```text
Goal
→ Plan
→ Authority
→ Capability
→ Execute
→ Reconcile
→ Verify
→ Evidence
→ Next Action
```

The Agent may act only under an explicit delegation grant. It never impersonates the user and never converts recommendation authority into execution authority.

## Users and scenarios

### User-controlled execution

A user selects `user_approval_only`. The platform prepares plans and dry-runs but waits for the user before every state-changing step.

### Delegated low-risk execution

A user delegates bounded documentation, branch synchronization, readback, retry, and low-risk repair actions. The Agent executes only within the grant's plan, resource, risk, mutation, and expiry limits.

### Plan-bound delivery

A user approves one repository delivery plan while reserving merge, production deployment, migration apply, credential mutation, and destructive actions for separate approval.

### Human on exception

A repeatable, certified workflow runs automatically within a signed plan. It pauses when risk, resource identity, checksums, head/base SHA, provider behavior, cost, or required authority drifts.

### Auditor

An auditor reads the operation timeline, delegation decision, mutation receipt, reconciliation evidence, policy result, and final readback without receiving secrets or raw provider payloads.

## Scope

This specification includes:

1. Durable operation state and resumability.
2. Canonical execution contract and capability resolution.
3. Plan-bound mutation sessions.
4. Approval delegation modes and bounded Agent authority.
5. Unknown-outcome reconciliation and readback.
6. Production-compatible migration validation.
7. Structured CI diagnosis and fault injection.
8. Managed PR and release lifecycle.
9. Evidence auto-closeout.
10. Goal-filtered operational intelligence.
11. Explicit runtime policies and measurable degradation-prevention gates.

This specification does not itself authorize runtime implementation, database migration apply, provider write, external send, deployment, merge, credential read, or secret exposure.

## Approval delegation modes

| Mode | Agent authority | Default use |
|---|---|---|
| `user_approval_only` | Plan and explain only until every mutation is approved by the user | Critical and unfamiliar operations |
| `agent_recommend_only` | Produce a machine-readable recommendation but never approve or execute | Evaluation and onboarding |
| `agent_queue_for_approval` | Bundle compatible steps into one approval request | Reducing interruption without delegation |
| `delegated_low_risk` | Execute allowlisted low-risk actions inside fixed limits | Readback, retries, docs, branch sync |
| `delegated_plan_bound` | Execute approved plan steps within exact bindings | Standard repository workstreams |
| `human_on_exception` | Execute certified steps and stop on drift or exception | Stable recurring workflows |
| `multi_agent_approval` | Independent planner and reviewer before executor dispatch | Medium-risk operations |
| `break_glass` | Short emergency grant with enhanced audit and mandatory review | Incident response only |

Initial implementation must support the first five modes. `multi_agent_approval` and `break_glass` remain later phases until the core delegation and audit contracts are certified.

## Risk model

- **Read only**: no mutation, no provider write, bounded and redacted.
- **Low**: reversible internal or repository mutation with deterministic readback.
- **Medium**: external or production-adjacent mutation with bounded impact and rollback.
- **High**: production deploy, migration apply, credential or authority mutation, financial impact, protected branch merge, external send, or difficult rollback.
- **Critical**: destructive, broad, emergency, irreversible, or cross-tenant impact.

Default policy denies Agent delegation for high and critical actions. A separate policy may permit a high-risk action only when the user explicitly delegates the exact plan, intent, resource, mode, checksum or SHA, risk ceiling, expiry, and confirmation contract. Destructive, permission-expanding, secret-revealing, and billing actions remain user-controlled by default.

## Functional requirements

### Durable execution kernel

- **FR-001**: Every long-running or state-changing operation receives an `operation_id` before provider dispatch.
- **FR-002**: Unsafe retryable operations require an idempotency key before execution.
- **FR-003**: Operation state is persisted and resumable after transport or process failure.
- **FR-004**: State transitions are validated and terminal states cannot return to execution without a new operation.
- **FR-005**: Every operation returns completed steps, blockers, evidence references, and one canonical `next_action`.
- **FR-006**: Cancellation is explicit and records whether compensation is required or complete.

### Canonical execution resolution

- **FR-007**: Callers submit intent, resource, and mode rather than selecting provider tools or capability keys.
- **FR-008**: The resolver returns canonical action, endpoint, capability, runtime surface, approval, retry, readback, and evidence contracts.
- **FR-009**: Ambiguous or missing bindings fail closed before provider access.
- **FR-010**: Routes and Agents cannot bypass the resolver for governed mutations.

### Plan-bound sessions and delegation

- **FR-011**: A mutation session binds plan ID, plan hash, principal, resource snapshot, allowed intents, risk ceiling, mutation limits, expiry, and evidence policy.
- **FR-012**: Short-lived envelopes may be issued or renewed automatically only inside the same plan, intent, resource, mode, checksum or SHA, and risk boundary.
- **FR-013**: Envelope renewal cannot expand permissions or approve a previously unapproved action.
- **FR-014**: Delegation grants are revocable, expiring, auditable, and deny by default.
- **FR-015**: The Agent's decision records the delegation grant and policy rule; it is never recorded as the user's direct action.
- **FR-016**: User approval is required when the plan, resource, hash, checksum, SHA, cost, risk, or required authority drifts.
- **FR-017**: Merge, deploy, migration apply, credential write, permission expansion, destructive actions, billing, and external sends remain excluded from delegation unless an explicit policy and grant allow the exact action.
- **FR-018**: The same Agent cannot plan, independently review, and execute a `multi_agent_approval` action.

### Mutation receipts and reconciliation

- **FR-019**: Every mutation emits a durable receipt or a durable pending-dispatch record.
- **FR-020**: Mutation outcomes are classified as `confirmed_success`, `confirmed_failure`, `unknown_outcome`, or `reconciliation_required`.
- **FR-021**: Transport failure after dispatch does not imply mutation failure.
- **FR-022**: A mutation cannot be retried after an unknown outcome until reconciliation proves absence or safe idempotency.
- **FR-023**: Readback compares expected state, provider state, internal ledger, schema state, and deployment state where applicable.
- **FR-024**: Recovered success requires same-operation evidence and cannot be inferred from narrative.

### Production-compatible validation

- **FR-025**: Migration apply authorization requires static validation and engine-native validation on a compatible production database version.
- **FR-026**: Validation records engine version, SQL mode, collation, storage engine, constraints, indexes, schema diff, and rollback assessment.
- **FR-027**: Static validation alone cannot produce `apply_allowed=true`.
- **FR-028**: Validation environments are isolated and receive no production credentials or data.

### Structured CI intelligence

- **FR-029**: Each failed CI check emits a structured failure artifact with check, step, code, file, path or line, evidence, and suggested action.
- **FR-030**: A CI check that fails without structured diagnosis is itself considered incomplete.
- **FR-031**: CI tests state transitions, idempotency replay, unknown-outcome recovery, policy drift, contract drift, and semantic patch behavior.
- **FR-032**: Migration CI runs against the current production-compatible engine and a supported upgrade candidate.
- **FR-033**: JSON, YAML, OpenAPI, and completion evidence changes use parser-aware mutation and validation.

### Managed PR and release lifecycle

- **FR-034**: One managed lifecycle coordinates branch creation, semantic patching, PR creation, base synchronization, CI, diagnosis, bounded repair, merge approval, merge, branch deletion, and release readback.
- **FR-035**: Head or base SHA changes invalidate prior merge approval.
- **FR-036**: The platform cancels superseded CI runs and evaluates only the final synchronized head.
- **FR-037**: Low-risk repairs may run under delegation only when the changed files and risk remain inside the approved plan.
- **FR-038**: Protected branch mutation and force push are forbidden.

### Evidence and operational focus

- **FR-039**: Completion evidence is generated from authoritative PR, CI, migration, schema, deployment, and audit sources.
- **FR-040**: Completion files are validated against published schemas before commit and in CI.
- **FR-041**: Operational attention can be filtered by goal and classifies blockers, related risks, platform-wide issues, and unrelated items.
- **FR-042**: Unrelated alerts remain available in diagnostic mode but do not interrupt the current goal by default.
- **FR-043**: Evidence and diagnostics never expose credentials, tokens, raw secrets, unbounded logs, or cross-tenant data.

## Explicit policies

1. No untracked mutation.
2. No completed status without declared readback.
3. Reconcile unknown outcomes before retry.
4. Approvals and delegation are plan, intent, resource, mode, checksum or SHA bound.
5. Migration apply requires engine-native validation.
6. Merge approval is freshness bound.
7. Generated files follow generator authority.
8. Boundary errors are structured and machine readable.
9. Structured files use semantic mutation.
10. Every operation returns a canonical next action.
11. Agent delegation cannot expand its own grant.
12. Human approval is required on drift beyond delegated limits.

## Non-functional requirements

- SQL remains runtime authority; Sheets remain mirror and recovery only.
- All public contracts use OpenAPI 3.1 and stable structured errors.
- Execution remains tenant isolated and deny by default.
- Audit records are append-only or lifecycle-governed and contain no raw secret material.
- Core state transitions and policy decisions are deterministic and testable.
- Responses are summary first, paginated or chunked, and bounded.
- Existing governed tools remain compatible during phased adoption.

## Success criteria

- **SC-001**: 100% of governed mutations have durable receipts and idempotency scope.
- **SC-002**: Zero mutation replay occurs after unknown outcome without reconciliation.
- **SC-003**: Agents perform zero manual provider-tool or capability-key discovery for registered operations.
- **SC-004**: 100% of migration apply candidates pass engine-compatible validation.
- **SC-005**: 100% of CI failures expose structured diagnosis.
- **SC-006**: 100% of JSON, YAML, OpenAPI, and completion changes use semantic validation.
- **SC-007**: 100% of merge approvals are bound to current head and base SHA.
- **SC-008**: 100% of operation responses expose `next_action`.
- **SC-009**: Automated closeout generates and validates all required evidence files.
- **SC-010**: A workstream comparable to Spec 009 uses at least 80% fewer Agent tool calls.
- **SC-011**: Delegated execution produces zero out-of-scope mutations in fault-injection tests.
- **SC-012**: Revoked or expired delegation is rejected before dispatch.
- **SC-013**: Production mutation pilots complete with no secret exposure and same-cycle readback.

## Delivery state

This branch opens the specification only. Runtime code, migrations, registry rows, policy enforcement, deployment, production pilots, and closeout evidence remain pending separate governed implementation PRs and approvals.
