# Spec 011 Addendum: Runtime Composition and Performance Closure

## Status and authority

This addendum extends `011-durable-governed-execution-and-agent-delegation`. It does not create a parallel execution architecture and does not authorize runtime cutover, provider mutation, database migration apply, deployment, merge, or protected-branch write.

Spec 011 remains the authority for durable operation lifecycle, plan execution, delegation, mutation receipts, reconciliation, provider readback, managed repository delivery, evidence closeout, and operational next actions. Spec 012 remains authoritative for execution-context resolution and invalidation. Spec 013 remains authoritative for catalog and public tool/intent access surfaces.

## Evidence for the extension

The existing specification already identifies excess low-level coordination, repeated approvals, tool traffic, and interrupted multi-step work as the platform problem. It requires intent-first execution, durable state, plan-bound authority, reconciliation, readback, and at least 80 percent fewer Agent tool calls for a representative workstream.

The current runtime nevertheless contains independent orchestration layers:

- `gptToolsRoutes` resolves and dispatches one tool invocation at a time and records the turn before returning.
- `connectorExecutor.dispatchPlan` resolves plan, brand, connected system, workflow, action, policy, capability envelope, and skill grant around a connector dispatch.
- `sequentialPlanOrchestrator` claims one ready step per tick; the default workflow-step executor creates a child execution plan and calls `dispatchPlan` again.
- `agentLoopRunner` separately resolves workflow, context, authorized tools, agent-loop policy, and dispatch authorization.
- some registered tools perform an internal localhost HTTP call rather than invoking one application dispatch service.

These paths preserve safety but repeat resolution and orchestration work. The missing contract is not another provider adapter; it is a single runtime composition contract that carries resolved evidence through the complete operation.

## Target functional architecture

```text
Intent or exact operation
  -> Context Capsule from Spec 012
  -> Canonical execution contract
  -> Compiled governed plan
  -> Lane selection
       -> fast synchronous lane
       -> durable graph lane
  -> One governed operation dispatcher
  -> Provider adapter and same-cycle readback
  -> Atomic execution ledger and outbox event
  -> Compact receipt plus governed full-result reference
```

The Custom GPT, Tenant API, Admin API, Agent runtime, worker, and internal scheduler are adapters to the same application service. None of them may reconstruct execution authority independently after a governed decision has been compiled.

## New functional requirements

### Runtime composition

- **FR-RC-001**: The platform MUST expose one internal `DispatchGovernedOperation` application boundary for Admin, Tenant, Agent, worker, and Custom GPT entry points.
- **FR-RC-002**: A dispatch MUST receive the compiled operation descriptor, execution context capsule, governance decision, plan identity, idempotency scope, and response contract as one execution input.
- **FR-RC-003**: In-process operations MUST invoke application handlers directly. Loopback HTTP is forbidden unless the target is a separately deployed service boundary.
- **FR-RC-004**: The dispatcher MUST reject missing, stale, mismatched, expired, or independently reconstructed context and governance evidence before provider access.
- **FR-RC-005**: Existing `listTools` and `callTool` contracts remain compatible adapters during migration and MUST NOT be retired before parity, usage, rollback, and contract evidence pass.

### Compiled governed plan

- **FR-RC-006**: A compiled plan MUST contain immutable step identity, dependency edges, operation key, operation kind, risk class, exact resource references, resource lock key, success contract, retry policy, approval policy, and readback contract.
- **FR-RC-007**: A workflow step MUST execute inside its parent governed plan unless an explicit isolation policy requires a child operation. Child plan creation is not the default orchestration mechanism.
- **FR-RC-008**: Static descriptor, policy, surface-authority, and capability-binding decisions MAY be reused only when bound to exact registry revisions.
- **FR-RC-009**: Dynamic authority, envelope status, approval state, provider version, resource version, branch SHA, idempotency reservation, and readback state MUST be checked at the required mutation boundary and MUST NOT be accepted from stale cache.

### Dependency graph execution

- **FR-RC-010**: The scheduler MUST claim all dependency-ready steps that can execute safely within bounded concurrency, rather than selecting one arbitrary ready step for the whole plan.
- **FR-RC-011**: Read-only steps over independent resources MAY execute concurrently.
- **FR-RC-012**: Mutations sharing a resource lock key MUST execute serially and validate expected resource version before dispatch.
- **FR-RC-013**: Concurrent mutation is permitted only for disjoint resource lock keys and an explicit policy that allows the relevant consequence classes.
- **FR-RC-014**: Every claimed step MUST retain a durable claim token, attempt count, idempotency key, transition event, result verification, and terminal or retry classification.
- **FR-RC-015**: The scheduler MUST stop at approval, interpretation, drift, unknown outcome, or non-repairable failure frontiers and return one canonical next action.

### Fast and durable lanes

- **FR-RC-016**: Lane selection MUST be derived from the compiled plan and descriptor metadata, not hardcoded solely by connector family.
- **FR-RC-017**: The fast lane is allowed only when expected completion fits the configured synchronous budget and no external wait, approval pause, long-running CI, deploy, or reconciliation dependency is present.
- **FR-RC-018**: The durable lane MUST allocate an operation identity before execution, persist state, begin execution without additional model orchestration, and support status, resume, cancel, and result reads.
- **FR-RC-019**: A plan MAY migrate from fast to durable execution before provider mutation when the latency budget is exhausted; after mutation it must preserve the same operation and receipt identity.

### Approval frontier

- **FR-RC-020**: The platform MUST complete authorized non-mutating preparation before requesting mutation approval where doing so does not disclose secrets or expand scope.
- **FR-RC-021**: An approval bundle MUST bind plan hash, context hash, exact resources, allowed operations, expected resource versions or SHAs, mutation and cost limits, expiry, and readback contract.
- **FR-RC-022**: One approval MAY authorize all compatible steps inside the exact approved boundary. It MUST NOT become broad session authority.
- **FR-RC-023**: A new approval is required when plan, context, resource, operation set, risk, cost, provider, expected SHA/version, or readback obligation drifts beyond the approved bundle.

### Ledger and projections

- **FR-RC-024**: Provider result, same-cycle readback, operation receipt, step events, idempotency state, and projection event MUST be committed through one durable execution-ledger boundary or a documented atomic protocol.
- **FR-RC-025**: SQL execution state is authoritative. Drive documents, JSONL files, search indexes, analytics, notifications, and reporting are verified projections.
- **FR-RC-026**: Projection work MUST use the existing transactional outbox and MUST expose pending, processing, completed, failed, and dead-letter states with reconciliation.
- **FR-RC-027**: Projection failure MUST NOT erase or downgrade a confirmed provider result, but MUST remain visible as an incomplete projection obligation.
- **FR-RC-028**: A strong projection mode MAY wait for declared projections. Normal mutation success MUST require durable ledger capture and same-cycle provider readback, not synchronous completion of every reporting projection.

### Response and result retrieval

- **FR-RC-029**: The default execution response MUST be summary-first and include operation ID, state, next action, receipt, readback summary, changed-resource references, and a hash-bound full-result reference when detail is omitted.
- **FR-RC-030**: Full result retrieval MUST preserve authorization, tenant isolation, expiry, pagination or chunking, integrity hash, and no-secret projection rules.
- **FR-RC-031**: Response compaction MUST NOT discard authoritative evidence; it changes transport projection only.

### Performance and observability

- **FR-RC-032**: Every execution MUST record stage durations for intent, context, descriptor, policy, approval, provider, readback, ledger, projection, and total time.
- **FR-RC-033**: Every execution MUST record SQL query count, provider-call count, internal HTTP-hop count, model-round-trip count, plan-step count, ready-set width, and critical-path step count.
- **FR-RC-034**: Performance acceptance MUST compare the legacy and composed paths using the same principal, intent, resource, provider fixture, and result/readback contract.
- **FR-RC-035**: A performance improvement is invalid if it weakens authorization, audit, readback, idempotency, reconciliation, result integrity, or recovery behavior.

## Functional outcomes

1. A multi-step repository task can continue from inspection through validated change-set preparation, approval frontier, atomic mutation, readback, PR creation, and CI handoff without one Custom GPT round trip per internal step.
2. A context and static governance decision are resolved once per revision set and reused across the plan; mutation-sensitive facts remain fresh.
3. Independent reads and preparations execute in parallel while conflicting writes remain serialized.
4. Long-running execution survives HTTP disconnects and model-session interruption.
5. A successful provider mutation can return after durable receipt and same-cycle readback while Drive and JSONL projections complete and reconcile separately.
6. Existing tool contracts remain available during adoption and receive the same governed result semantics through compatibility adapters.

## Acceptance scenarios

- **AC-RC-001**: A six-step plan with three independent read steps executes those reads concurrently, preserves deterministic downstream inputs, and produces the same verified output as sequential execution.
- **AC-RC-002**: Two mutations with the same resource lock never overlap; two explicitly permitted mutations with different lock keys may overlap.
- **AC-RC-003**: A legacy `callTool` request and an `executeOperation` request for the same operation produce equivalent authorization, provider mutation, readback, receipt, and result hashes.
- **AC-RC-004**: An expired envelope or changed branch SHA is rejected at the mutation frontier even when descriptor and policy revisions remain cached.
- **AC-RC-005**: An approval covering five exact compatible steps executes those steps without additional approval; a sixth out-of-scope step pauses with typed drift.
- **AC-RC-006**: After provider success and ledger commit, a Drive outage returns provider success with `projection_status=pending_or_failed`, then the outbox reconciles without replaying the provider mutation.
- **AC-RC-007**: A transport disconnect during durable execution does not create a second operation or duplicate mutation when the client resumes or polls.
- **AC-RC-008**: A compact response and subsequent full-result retrieval produce matching integrity hashes and no cross-tenant disclosure.
- **AC-RC-009**: Shadow comparison shows identical authority, mutation, and readback decisions before any cutover percentage is enabled.

## Performance targets

Targets are rollout gates, not claims about current production latency.

- representative 3-6 step governed task: at least 60 percent fewer model/tool round trips;
- representative repository workstream: at least 80 percent fewer Agent tool calls, preserving existing Spec 011 success criterion;
- internal dispatch path: zero localhost HTTP hops for in-process handlers;
- static descriptor/policy/context resolution: at least 40 percent lower median stage duration after revision-bound reuse;
- provider-complete mutation response: at least 20 percent lower median total duration when non-authoritative projections are moved behind the ledger boundary;
- no regression above 10 percent at p95 for single-step reads after warm-up;
- zero increase in duplicate mutation, cross-tenant access, stale-approval acceptance, unknown-outcome replay, or missing readback rates.

## Delivery slices

1. **RC0 instrumentation**: stage telemetry and legacy baseline only.
2. **RC1 execution input contract**: compiled descriptor, context capsule, governance decision, and no-dispatch shadow comparison.
3. **RC2 unified in-process dispatcher**: compatibility adapters and loopback removal for selected read-only operations.
4. **RC3 graph scheduler**: ready-set claims, resource locks, deterministic result merge, and read-only pilot.
5. **RC4 approval frontier**: approval bundle compiler and drift tests.
6. **RC5 ledger/outbox split**: shadow dual write while current synchronous projection remains active.
7. **RC6 fast-lane mutation pilot**: one reversible low-risk operation with same-cycle readback.
8. **RC7 durable-lane pilot**: one long-running repository or CI workflow.
9. **RC8 intent-first Custom GPT cutover**: percent rollout with legacy fallback and rollback evidence.

## Safety boundaries

- no feature removal;
- no weaker authorization or broad cached execution authority;
- no automatic retry after unknown outcome;
- no silent context or connection fallback for mutations;
- no provider mutation from specification-only changes;
- no synchronous projection removal until durable payload parity and reconciliation are proven;
- no legacy-path retirement until telemetry demonstrates safe migration and zero required callers.