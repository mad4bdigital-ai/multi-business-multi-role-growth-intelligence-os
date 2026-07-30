# Governed Execution Runtime Architecture and Topology

## 1. Purpose

This document defines the complete runtime composition between Specs 011, 012, and 013. It is an integration architecture, not an additional functional authority.

The design removes caller-driven orchestration, duplicate context and policy resolution, ordinary child-plan recursion, in-process HTTP loopback, and synchronous non-authoritative projection work from the critical path while preserving or strengthening every authorization, approval, idempotency, readback, reconciliation, audit, and tenant-isolation guarantee.

## 2. Architectural objectives

1. One authenticated request enters through any supported surface and becomes one governed operation identity.
2. One exact execution context is resolved by Spec 012 and carried by reference and revision through the operation.
3. One canonical descriptor and consequence contract is resolved by Spec 013.
4. One governed plan, state machine, scheduler, provider dispatch, readback, receipt, and reconciliation authority is owned by Spec 011.
5. The model or caller is not required to coordinate each internal step.
6. Independent work may execute concurrently; conflicting mutations remain serialized.
7. Fast and durable execution are selected from plan properties, not connector names.
8. Provider outcome and same-cycle readback remain authoritative even when reporting projections are delayed.
9. Compact responses expose outcome and next action without removing full evidence.
10. Legacy surfaces remain compatible until measured retirement.

## 3. Logical layers

```text
+-----------------------------------------------------------------------+
| Entry adapters                                                        |
| Custom GPT | Tenant API | Admin API | Agent runtime | Worker | Cron   |
+-----------------------------------+-----------------------------------+
                                    |
                                    v
+-----------------------------------------------------------------------+
| Spec 013 — intent and exact-operation surface                         |
| authentication projection | descriptor snapshot | interpretation      |
| compatibility adapter | response projection                          |
+-----------------------------------+-----------------------------------+
                                    |
                                    v
+-----------------------------------------------------------------------+
| Spec 012 — shared execution context kernel                            |
| principal | effective subject | tenant/workspace | exact resource     |
| exact connection | authority path | capability readiness | capsule    |
+-----------------------------------+-----------------------------------+
                                    |
                                    v
+-----------------------------------------------------------------------+
| Spec 011 — governed execution kernel                                  |
| canonical contract | governance decision | plan compiler | lane       |
| scheduler | approval frontier | provider adapter | readback           |
| operation ledger | reconciliation | result authority | outbox         |
+----------------------+--------------------------+---------------------+
                       |                          |
                       v                          v
+--------------------------------+   +----------------------------------+
| Provider and repository plane  |   | Projection workers               |
| APIs | DB | Git | local worker |   | Drive | JSONL | Search | Alerts  |
+--------------------------------+   +----------------------------------+
```

## 4. Control plane and data plane

### 4.1 Control plane

The control plane resolves and validates:

- authenticated principal and effective subject;
- exact tenant, workspace, brand, resource, and connection;
- operation descriptor and version;
- operation consequence and risk class;
- capability, authority, policy, and delegation decisions;
- plan graph and step contracts;
- lane assignment;
- approval frontier;
- idempotency and resource-lock scope;
- response and projection obligations.

The control plane MUST NOT perform provider mutation while a request remains unresolved, ambiguous, unauthorized, unapproved, stale, or mismatched.

### 4.2 Data plane

The data plane performs:

- provider or repository dispatch;
- same-cycle readback;
- mutation receipt finalization;
- external-wait observation;
- compensation where declared;
- projection delivery through outbox workers.

The data plane consumes immutable control-plane artifacts. It cannot expand intent, select a new target, change the capability, or weaken the consequence contract.

## 5. Authoritative components

### 5.1 Entry Adapter

Responsibilities:

- authenticate through the existing middleware;
- normalize transport-specific input;
- attach request, trace, and correlation identifiers;
- call the Spec 013 application surface;
- project the returned status or result.

It MUST NOT:

- enumerate arbitrary provider tools to build its own plan;
- infer tenant or resource authority;
- issue approvals;
- retry provider mutation;
- reconstruct context or governance decisions.

### 5.2 Intent and Operation Gateway

Owned by Spec 013.

Responsibilities:

- exact operation lookup by stable operation key;
- principal-visible descriptor snapshot;
- bounded intent interpretation;
- ambiguity and clarification outcomes;
- compatibility translation from certified legacy calls;
- request schema validation;
- public status/result/cancel/resume contract;
- compact and full result projection.

It produces a `ResolvedOperationRequest` and does not grant execution authority.

### 5.3 Execution Context Kernel

Owned by Spec 012.

Responsibilities:

- principal and effective-subject validation;
- authorized candidate enumeration;
- deterministic exact selection;
- context pin validation;
- exact resource and connection binding;
- authority-path and capability-readiness projection;
- context hash and revision vector;
- Execution Capsule creation, validation, and invalidation.

It produces one `ExecutionCapsule` or a typed unresolved result.

### 5.4 Governance Compiler

Owned by Spec 011.

Inputs:

- resolved operation descriptor;
- execution capsule;
- operation input and constraints;
- policy and capability revisions;
- requested completion and response modes.

Outputs:

- canonical execution contract;
- governance decision;
- approval requirements;
- retry, idempotency, readback, and evidence policies;
- compiled plan and plan hash.

Static decisions MAY be revision-bound and reused. Dynamic authority MUST be refreshed at the mutation frontier.

### 5.5 Plan Compiler

The compiler creates an immutable dependency graph.

Each step contains:

- `step_id` and `step_key`;
- operation key and operation kind;
- exact input projection;
- dependencies;
- success contract;
- failure and retry contract;
- consequence and risk class;
- resource lock key;
- idempotency scope;
- approval group;
- readback contract;
- result projection;
- lane compatibility;
- timeout and external-wait behavior.

The compiler rejects:

- cycles;
- duplicate step identities;
- unresolved dependencies;
- missing result dependencies;
- incompatible approval groups;
- unsupported consequence/lane combinations;
- unbounded retries;
- mutations without idempotency/readback where required;
- steps that require a target outside the capsule.

### 5.6 Lane Selector

The selector evaluates the complete plan before provider mutation.

#### Fast lane criteria

All MUST be true:

- plan fits the configured synchronous time budget;
- no approval pause remains;
- no external wait or long CI/deploy observation exists;
- no expected process restart is needed;
- every mutation has same-cycle readback;
- provider count and retry bounds fit the synchronous budget;
- response can be safely returned before transport timeout;
- no policy forces durable execution.

#### Durable lane criteria

Any of the following is sufficient:

- approval or human review pause;
- external wait, callback, CI, deployment observation, or provider polling;
- multi-minute provider work;
- process-restart recovery requirement;
- multiple mutation stages with reconciliation risk;
- explicit durable policy;
- synchronous budget cannot be guaranteed.

#### Promotion

A fast operation may be promoted to durable before mutation when the budget is no longer safe. The same operation identity, plan identity, context hash, idempotency scope, and audit chain are retained.

After provider mutation, execution MUST NOT create a replacement operation merely to continue asynchronously.

### 5.7 Governed Dispatcher

`DispatchGovernedOperation` is the single in-process application boundary.

It validates:

- operation and plan identity;
- capsule validity;
- governance decision and revisions;
- approval state;
- lane and policy compatibility;
- idempotency reservation;
- current dynamic mutation evidence;
- resource-lock eligibility.

It delegates provider-specific behavior to declared adapters only after all required gates pass.

For handlers hosted in the same process, dispatch is a direct application call. HTTP is used only when the target is an independently deployed service with a declared service boundary.

### 5.8 Graph Scheduler

The scheduler operates on the durable plan graph.

Algorithm:

1. Read the current operation and plan version.
2. Reconcile any expired claims or leases.
3. Determine all non-terminal steps whose dependencies are satisfied.
4. Exclude steps blocked by approval, interpretation, drift, reconciliation, or cancellation.
5. Group ready steps by resource lock and consequence constraints.
6. Select a bounded ready set under global, tenant, provider, and resource concurrency limits.
7. Atomically claim each selected step with lease, attempt, and claim token.
8. Execute claimed steps.
9. Persist transitions, receipts, outputs, readbacks, and emitted dependency data.
10. Recompute the ready set until the operation reaches a frontier or terminal state.

The scheduler MUST NOT choose only one arbitrary ready step for the entire plan when multiple independent steps are eligible.

### 5.9 Resource Lock Manager

A lock key identifies the mutation conflict domain, not merely the connector.

Examples:

```text
repository:{owner}/{repo}:ref:{branch}
resource:{tenant}:{resource_type}:{resource_id}
connection:{connection_id}:configuration
provider:{provider}:{external_object_id}
database:{schema}:{logical_entity}:{entity_id}
```

Rules:

- read steps generally do not require exclusive locks unless the provider contract says otherwise;
- mutations with the same lock key cannot overlap;
- disjoint mutations may overlap only when policy allows both consequence classes;
- lock acquisition is lease-based and durable;
- lease expiry does not authorize immediate replay when provider outcome is unknown;
- lock fencing tokens prevent an expired worker from committing late results;
- lock ownership and release are recorded in step events.

### 5.10 Provider Adapter

A provider adapter receives:

- exact operation contract;
- sanitized operation input;
- exact resource and connection references;
- short-lived credential binding or credential resolver handle;
- idempotency key where supported;
- expected version/SHA;
- timeout and readback contract;
- trace and operation identity.

It returns a structured dispatch classification, never an untyped success boolean.

It MUST NOT:

- choose a different resource or connection;
- broaden requested fields;
- auto-retry unknown mutation outcomes;
- log credentials or raw secret-bearing payloads;
- silently treat HTTP/transport failure as provider failure.

### 5.11 Readback and Reconciliation Service

Readback compares:

- expected postcondition;
- provider or repository state;
- operation receipt;
- internal execution state;
- schema or deployment state where applicable.

Reconciliation handles unknown outcomes and projection mismatches. Provider mutation retry is blocked until reconciliation proves the mutation absent or confirms safe idempotent replay.

### 5.12 Execution Ledger

The ledger is the authoritative lifecycle and result store.

It contains or references:

- operation and plan identity;
- step and attempt state;
- capsule and governance hashes;
- approval binding;
- idempotency reservation;
- provider dispatch classification;
- mutation receipt;
- same-cycle readback;
- authoritative result hash;
- blockers and canonical next action;
- outbox events and projection obligations;
- cancellation and compensation state.

### 5.13 Projection Workers

Projection workers consume committed outbox events and update:

- Drive/session documents;
- segmented JSONL archives;
- search and retrieval indexes;
- analytics;
- notifications;
- reporting views.

Projection workers cannot alter provider outcome or execution terminal state. They expose their own pending, processing, completed, failed, dead-letter, and reconciled states.

## 6. End-to-end flows

### 6.1 Exact-operation fast read

```text
Client
 -> executeOperation
 -> descriptor lookup
 -> resolve/validate capsule
 -> compile governance and one-step plan
 -> select fast lane
 -> direct in-process dispatch
 -> read result
 -> ledger/result hash
 -> compact response
```

Expected properties:

- no catalog traversal;
- no internal localhost HTTP;
- one context resolution per revision vector;
- no durable worker unless policy requires it;
- result hash identical to full projection.

### 6.2 Intent-driven durable workflow

```text
Custom GPT
 -> executeIntent
 -> bounded interpretation
 -> exact descriptor set
 -> execution capsule
 -> compiled graph and lane selection
 -> durable operation accepted
 -> scheduler continues server-side
 -> approval frontier if required
 -> provider steps and readbacks
 -> ledger and projections
 -> status/result reads by operation ID
```

The Custom GPT does not orchestrate each internal step.

### 6.3 Approval frontier

```text
resolve -> inspect -> prepare diff -> validate -> compute plan hash
       -> pause awaiting exact approval
       -> refresh dynamic evidence
       -> apply compatible approved mutations
       -> readback -> receipt -> result
```

A new approval is required only when declared binding fields drift.

### 6.4 Unknown provider outcome

```text
reserve receipt -> dispatch provider mutation -> transport fails
 -> classify unknown_outcome
 -> keep resource lock/reconciliation guard
 -> read provider state using operation evidence
 -> confirmed success OR confirmed absence OR manual reconciliation
 -> retry only when absence/idempotency is proven
```

### 6.5 Projection outage

```text
provider success -> same-cycle readback -> ledger commit + outbox event
 -> compact success with projection pending
 -> projection worker fails
 -> retry/dead-letter/reconcile
 -> no provider replay
```

### 6.6 Process restart

```text
worker claim -> process terminates
 -> lease expires
 -> scheduler recovers claim
 -> inspect dispatch/receipt state
 -> resume safe step OR reconcile unknown outcome
 -> never blindly repeat mutation
```

## 7. Concurrency controls

Concurrency is bounded at multiple levels:

- global worker limit;
- per-tenant limit;
- per-provider limit;
- per-operation ready-set limit;
- per-resource lock;
- per-credential or connection limit;
- provider quota and rate limit;
- risk-class policy.

The effective limit is the minimum of all applicable limits.

No concurrency optimization may bypass approval, lock, idempotency, rate limit, or readback contracts.

## 8. Deterministic result aggregation

Parallel steps must not make final output ordering nondeterministic.

Rules:

- outputs are keyed by immutable step ID;
- downstream inputs reference named step outputs, not completion order;
- arrays are sorted by declared deterministic keys before hashing;
- timestamps and volatile provider fields are excluded or normalized in comparison hashes;
- final result hash is computed from a canonical serialization version;
- legacy/new parity compares canonical result and readback hashes, not incidental transport ordering.

## 9. Service-boundary rules

Use direct in-process calls when:

- caller and handler are in the same deployment/process;
- no independent scaling or trust boundary exists;
- the handler can consume the governed execution input directly.

Use HTTP or another transport when:

- the target is independently deployed;
- it has a distinct trust boundary;
- independent scaling or failure isolation is required;
- the transport contract is versioned and authenticated.

Internal HTTP MUST NOT be used merely to reuse a route. Shared behavior belongs in an application service called by both the route and the dispatcher.

## 10. Configuration and feature flags

Required controls are additive and default off during rollout:

- instrumentation only;
- shadow composition;
- in-process read dispatch by exact operation key;
- graph scheduler pilot by plan type;
- approval-frontier pilot;
- ledger/outbox projection split;
- fast-lane mutation pilot;
- durable-lane pilot;
- Spec 013 execution surface;
- percentage rollout per principal, tenant, operation, and risk class;
- emergency global kill switch;
- per-operation kill switch;
- legacy fallback enablement.

Flags select paths; they do not create authority.

## 11. Non-functional requirements

- deny by default;
- tenant isolation at every read and write;
- no secret-bearing capsule, plan, receipt, metric, or result projection;
- deterministic canonical hashes;
- append-only or governed lifecycle event history;
- bounded result and evidence projections;
- restart-safe durable operations;
- no duplicate mutation after transport or process failure;
- no completed state without required readback;
- no silent target substitution;
- no hidden consequential mutation;
- no performance acceptance without safety equality.

## 12. Architectural completion criteria

This architecture is considered implemented only when:

1. selected Admin, Tenant, Agent, worker, and Custom GPT paths converge on one dispatcher;
2. context resolution is supplied through Spec 012 ports and duplicate resolvers are measurably retired;
3. exact descriptor and consequence metadata come from Spec 013 snapshots;
4. one governed plan identity spans all internal steps;
5. scheduler concurrency and resource serialization are proven by execution evidence;
6. fast/durable selection is plan-derived;
7. mutation frontier, idempotency, readback, and reconciliation fault tests pass;
8. authoritative ledger and outbox projection behavior pass outage tests;
9. compact/full result integrity and authorization match;
10. rollback restores the legacy path without evidence loss.