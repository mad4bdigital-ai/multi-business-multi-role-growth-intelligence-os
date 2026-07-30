# Evidence, Traceability, and Functional Results

## Purpose

This document maps observed runtime behavior to the authoritative Spec extension, required functional result, and measurable acceptance evidence. It prevents the integration kit from becoming a parallel source of functional requirements.

## Evidence-to-owner matrix

| Observed runtime evidence | Consequence | Authoritative extension | Required functional result |
|---|---|---|---|
| Generic GPT/System tool shells list and call one named tool per request | caller/model remains the orchestration loop | Spec 013 intent execution addendum | one request starts an intent or exact-operation plan; legacy tools remain fallback |
| `dispatchTool` resolves descriptor and preflight, then the implementation path can resolve related authority again | repeated SQL/policy work and fragmented evidence | Spec 011 runtime composition addendum | one compiled governed execution input is passed through the complete operation |
| execution-policy and platform-rule loaders read active sets and filter in application code | repeated static registry work grows with catalog/policy size | Specs 011 and 012 | revision-bound compiled reuse for static decisions; dynamic facts remain fresh |
| capability-family authorization loads policy bindings and may validate session/envelope | correct fail-closed behavior, but can be repeated across layers | Spec 011 | retain one decision artifact and refresh dynamic envelope state at mutation frontier |
| some registered tool handlers call a localhost HTTP URL inside the same application | repeated middleware/auth/serialization and inability to share request context | Spec 011 | in-process application dispatch for in-process handlers; HTTP only for real service boundaries |
| `sequentialPlanOrchestrator` claims one ready step per tick | independent work remains serialized | Spec 011 | bounded ready-set scheduling with deterministic merge |
| default sequential workflow executor creates a child plan then calls `dispatchPlan` | repeats plan, workflow, connector, policy, and run lifecycle resolution | Spec 011 | execute ordinary steps in the parent plan; child operation only by explicit isolation policy |
| `connectorExecutor` selects sync/async primarily by connector type | a short operation and long operation on the same connector cannot choose different lanes | Spec 011 | lane selection from compiled plan, latency class, approvals, waits, and readback obligations |
| Context Kernel application layer and shadow integrations intentionally do not replace runtime authority yet | correct staged rollout, but resolved context cannot yet serve as shared execution input | Spec 012 execution-capsule addendum | immutable capsule used by all entry points and plans under revision/invalidation rules |
| current context architecture already defines exact execution set and invalidation graph | foundation exists and should not be duplicated | Spec 012 | extend, do not replace, context hash/revision and dependency invalidation |
| tool responses may require chunk continuation for large result bodies | model/client may need extra calls merely to learn outcome and next action | Spec 013 | compact receipt always exposes state, readback, and next action; full result remains available |
| session/Drive/JSONL projection is awaited in the tool response path | non-authoritative projection latency extends critical path | Spec 011 | authoritative SQL ledger plus transactional outbox and verified projections |
| existing transactional outbox supports immutable event/delivery state, retries, dead letter, and reconciliation | reusable durable mechanism already exists | Spec 011 | reuse outbox; do not introduce a second queue or best-effort background write |
| repository change-set implementation uses one tree/commit/ref but prepares files sequentially | atomicity is good; independent preparation remains serial | Spec 011 managed-delivery scope | bounded parallel reads/blob preparation while retaining one atomic commit and readback |

## Functional result catalogue

### FRSLT-001 — One orchestration authority

**Before:** Custom GPT, generic tool dispatcher, connector executor, sequential planner, and agent loop each perform part of orchestration.

**After:** entry points normalize input and call one `DispatchGovernedOperation`; Spec 011 owns plan state, scheduling, dispatch, readback, and next action.

**Proof:** one operation/trace identity spans adapter, context capsule, plan, steps, provider call, readback, receipt, and result projection.

### FRSLT-002 — One exact execution context

**Before:** tenant, workspace, resource, connection, and capability evidence may be reconstructed by multiple runtime layers.

**After:** Spec 012 emits one immutable Execution Capsule; all downstream components validate it and refresh only declared dynamic dependencies.

**Proof:** identical context hash for equivalent Admin/Tenant requests, no target substitution, and invalidation tests for every dependency class.

### FRSLT-003 — Plan execution without model-per-step coordination

**Before:** a multi-step task returns through the model between tool invocations.

**After:** a compiled plan continues server-side until completion, approval, interpretation, drift, unknown outcome, or non-repairable failure.

**Proof:** a 3-6 step fixture completes with at least 60 percent fewer caller round trips and equivalent final result/readback hashes.

### FRSLT-004 — Safe concurrency

**Before:** one ready plan step is claimed per tick.

**After:** all dependency-ready, non-conflicting steps can run under bounded concurrency; resource locks serialize conflicts.

**Proof:** execution spans overlap for independent reads and never overlap for identical mutation lock keys.

### FRSLT-005 — Approval once at the correct frontier

**Before:** dependent mutation steps can trigger repeated approval/model cycles because preparation and execution are fragmented.

**After:** preparation produces an exact plan and mutation frontier; one approval covers compatible steps only.

**Proof:** approved steps continue without new approval, while any plan/context/resource/SHA/risk/readback drift pauses before mutation.

### FRSLT-006 — Fast and durable execution selected by work

**Before:** sync/async behavior is tied mainly to connector path.

**After:** lane selection uses compiled latency, step graph, external waits, approvals, provider calls, and readback requirements.

**Proof:** short fixture completes synchronously; long fixture returns durable identity and survives disconnect/restart without duplicate mutation.

### FRSLT-007 — Authoritative result separated from projections

**Before:** Drive/JSONL projection can extend response latency.

**After:** provider result, same-cycle readback, receipt, result hash, and outbox event are durable before response; projections reconcile separately.

**Proof:** induced Drive outage does not change confirmed provider result and does not replay mutation; projection later reaches completed state.

### FRSLT-008 — Compact response without feature loss

**Before:** oversized result may require continuation before the caller understands the outcome.

**After:** compact response exposes operation state, changed resources, receipt, readback, blockers, projection state, next action, and full-result reference.

**Proof:** compact and full projections share the same authoritative result hash; unauthorized result retrieval is non-enumerating.

### FRSLT-009 — Existing clients remain compatible

**Before/after transition:** `listTools` and `callTool` remain supported.

**Proof:** certified compatibility adapters produce equivalent authority, provider, readback, receipt, and result hashes; uncertified tools remain on legacy path.

### FRSLT-010 — Measured acceleration without weaker guarantees

**Target bands after instrumentation:**

- single read: approximately 1.4x-2.2x end-to-end improvement where internal resolution dominates;
- single mutation with readback: approximately 1.8x-3.5x where projection and repeated orchestration are material;
- 3-6 step workflow: approximately 3x-7x reduction in interactive completion time primarily from eliminating model-per-step cycles;
- repository workflow to PR: approximately 1.5x-4x wall-clock improvement and 3x-10x lower active interaction time, depending on external CI;
- broad independent-step graph: potentially 5x-12x, bounded by provider and CI critical path.

These are engineering target ranges, not production claims. They become valid only after X0 baselines and safety-equivalent benchmark runs.

## Safety equality vector

Every performance comparison MUST assert equality or stricter behavior for:

```text
principal identity
selected tenant/workspace/resource/connection
authority decision
capability decision
operation consequence class
approval requirement and binding
idempotency scope
provider request identity
provider mutation count
same-cycle readback
unknown-outcome classification
receipt/result hash
audit event coverage
projection obligations
secret and tenant-isolation projection
```

A benchmark with a different safety vector is invalid.

## Cross-spec requirement map

| Integration concern | Spec 011 | Spec 012 | Spec 013 |
|---|---|---|---|
| intent request accepted | consumes | supplies context constraints | owns public operation |
| exact descriptor/version | consumes | no authority from descriptor | owns catalog/lookup |
| execution capsule | validates/uses | owns | carries safe reference |
| governed plan and DAG | owns | binds context hash/revision | projects state |
| lane selection | owns | invalidation can force recompile | exposes requested completion mode |
| approval frontier | owns | context drift invalidates | projects approval next action |
| provider dispatch/readback | owns | exact target remains fixed | cannot bypass |
| receipt/result hash | owns authoritative state | scopes projection | owns compact/full transport |
| legacy compatibility | owns semantic equivalence | same context rules | owns adapters and deprecation |
| performance/cutover | provides runtime metrics | provides resolution metrics | provides caller/continuation metrics |

## Completion evidence required

The integration package cannot close until it records:

- merged implementation PRs per X phase;
- exact main and production SHAs where deployment applies;
- migration IDs, checksums, authorization, dry-run, ledger, and schema readback where persistence changes apply;
- benchmark artifact references and safety-equality results;
- shadow mismatch counts and dispositions;
- duplicate-mutation and unknown-outcome fault-injection results;
- cross-tenant and context-substitution security results;
- projection outage and reconciliation results;
- legacy usage and retirement evidence;
- rollback drill results;
- final Spec 011/012/013 traceability updates.
