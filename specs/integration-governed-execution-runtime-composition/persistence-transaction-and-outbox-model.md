# Persistence, Transaction, and Outbox Model

## 1. Purpose

This document defines the logical persistence boundaries required for the composed runtime. It does not authorize a migration or require a parallel data model where existing tables already satisfy the contract.

The implementation order is:

1. inventory and reuse existing execution, plan, receipt, delegation, approval, context, outbox, and projection surfaces;
2. extend existing tables or views additively where required;
3. introduce a new table only when no existing authoritative surface can satisfy the invariant;
4. preserve compatibility views/adapters during migration;
5. apply migrations only through the repository's governed migration workflow.

## 2. Persistence principles

- SQL is authoritative for operation lifecycle, step state, receipts, readbacks, idempotency, approval consumption, locks, and outbox state.
- Provider state is authoritative for the external resource and is reconciled through readback.
- Drive, JSONL, search, analytics, and notifications are projections, not primary mutation truth.
- Every unsafe dispatch is preceded by a durable reservation or pending-dispatch receipt.
- Every state transition is tenant/resource scoped and optimistic-concurrency protected.
- Unknown outcome is represented explicitly and blocks blind retry.
- Credentials and raw secret-bearing payloads are never persisted in execution-domain records.
- Large payloads are stored by bounded reference/hash, not copied across every lifecycle row.
- Events are append-only or lifecycle-governed; current-state projections may be mutable under transition guards.

## 3. Logical persistence aggregates

The exact physical names are determined by inventory. Logical aggregates are:

### 3.1 Operations

Fields:

- operation ID;
- tenant/workspace/principal safe references;
- operation key and descriptor version;
- capsule/context hash;
- governance decision and plan references;
- current state/version;
- selected lane;
- blocker and next action;
- cancellation/compensation state;
- result and projection summary;
- created/started/updated/terminal timestamps.

### 3.2 Plans and plan steps

Plan fields:

- plan ID/revision/hash;
- operation binding;
- context and governance hashes;
- lane policy;
- expiry;
- immutable canonical payload reference/hash.

Step-definition fields:

- plan/step identity;
- dependencies;
- operation/risk/consequence metadata;
- resource lock key;
- retry/approval/readback/result contracts;
- canonical definition hash.

Mutable step-state is stored separately or in a guarded projection so immutable definitions are not overwritten.

### 3.3 Step attempts and events

Attempt fields:

- attempt ID;
- operation/plan/step;
- state/version;
- claim/fencing token;
- lease owner/expiry;
- input hash;
- idempotency reservation;
- dispatch/receipt/readback/result references;
- retry classification;
- failure code and bounded details.

Event fields:

- event ID and sequence;
- aggregate identity;
- prior/next state;
- reason code;
- safe actor class/reference;
- trace ID;
- evidence references;
- occurred time.

### 3.4 Approval and delegation bindings

Store:

- approval/grant references;
- plan/context/operation/resource hashes;
- risk/mutation/cost/readback bounds;
- state/version;
- issued/expiry/revoke times;
- consumed step identities;
- approving principal class/reference;
- no raw approval secret or external token.

### 3.5 Idempotency reservations

Store:

- scope hash;
- hashed caller key;
- target/input hashes;
- operation/step/attempt bindings;
- state/version;
- provider-native idempotency reference where safe;
- receipt/result references;
- conflict reason.

Uniqueness is enforced on the canonical idempotency scope, not merely raw key text.

### 3.6 Resource locks

Store:

- lock key;
- owner operation/step/attempt;
- fencing token;
- lease state/version;
- acquired/heartbeat/expiry/release times;
- release reason.

A separate logical mutation guard may remain while an unknown outcome is reconciled even after the scheduling lease expires.

### 3.7 Mutation receipts and readbacks

Receipt fields:

- receipt ID;
- operation/step/attempt;
- target/provider identity;
- idempotency scope hash;
- provider request hash;
- dispatch classification;
- expected precondition hash;
- outcome classification;
- readback/result references;
- reconciliation state;
- timestamps.

Readback fields:

- readback ID;
- receipt/operation/step binding;
- expected/observed state hashes;
- source authority;
- observed version/SHA;
- status/mismatch class;
- collected time.

### 3.8 Results and result projections

Authoritative result fields:

- result ID;
- operation binding;
- canonical serialization version;
- result hash;
- bounded inline summary;
- large payload reference if required;
- tenant/resource visibility scope;
- created/expiry/retention metadata.

Projection fields:

- projection ID and mode;
- result hash;
- redaction and schema version;
- pagination/chunk snapshot;
- expiry;
- storage reference that is never an unrestricted raw URL.

### 3.9 Transactional outbox

Outbox event fields:

- event ID;
- aggregate type/ID/version;
- event type/schema version;
- ordering key;
- payload or payload reference/hash;
- created time;
- delivery obligation set.

Delivery fields:

- event/destination unique key;
- state/version;
- attempt count;
- claim lease;
- next retry time;
- last bounded error code;
- completed/dead-letter/reconciled times.

## 4. Transaction boundaries

No single SQL transaction can include an external provider call. The system uses a durable intent/receipt protocol around provider dispatch.

## 5. Read-only fast path transaction

1. Resolve or validate descriptor/capsule/governance artifacts.
2. Optionally persist operation/trace acceptance if policy requires lifecycle evidence.
3. Invoke the in-process or external read handler.
4. Validate and sanitize response.
5. Persist result hash, metrics, and completion event where the operation is durable/audited.
6. Return compact/full projection.

Read-only operations may use a lighter persistence profile only when the existing audit policy permits it. Tenant authorization and bounded evidence remain mandatory.

## 6. Unsafe mutation protocol

### 6.1 Transaction A — reserve before dispatch

Atomically:

- validate operation/plan/step state and version;
- validate active approval binding;
- validate capsule/context hashes;
- reserve idempotency scope;
- acquire resource lock/fencing token;
- create or transition step attempt to `pending_dispatch`;
- create pending mutation receipt;
- append transition/audit events;
- commit.

If Transaction A fails, no provider mutation is dispatched.

### 6.2 Provider dispatch — outside SQL transaction

The worker:

- revalidates short-lived dynamic evidence required immediately before dispatch;
- resolves a short-lived credential handle;
- sends the exact provider request;
- records safe local dispatch timing/classification in memory;
- never assumes transport failure means provider failure.

### 6.3 Transaction B — record immediate dispatch evidence

As soon as practical, persist:

- provider request hash;
- dispatch classification;
- safe provider operation reference;
- possible-mutation flag;
- attempt state/version;
- event.

Where the provider call returns synchronously, Transaction B may be combined with finalization only if no evidence gap or failure window is introduced.

### 6.4 Same-cycle readback

Read provider/repository state according to the declared readback contract.

Readback is outside the SQL transaction but is bound to the receipt and provider request identity.

### 6.5 Transaction C — finalize authoritative state

Atomically:

- verify current operation/step state and fencing token;
- persist readback evidence;
- classify receipt outcome;
- persist authoritative result/result hash;
- transition attempt, step, and operation state;
- update idempotency state;
- release or retain lock/guard according to outcome;
- append events;
- insert outbox event(s) for projections;
- commit.

Only after Transaction C may the normal compact success response be returned.

## 7. Unknown-outcome protocol

When provider mutation may have occurred but outcome/readback is uncertain:

1. Transition receipt and step to `unknown_outcome` or `reconciliation_required`.
2. Keep the idempotency reservation blocked.
3. Retain a logical mutation guard for the resource.
4. Persist provider request identity and bounded transport evidence.
5. Create reconciliation work, not provider retry work.
6. Read provider state using exact target, precondition, expected postcondition, provider request reference, and timestamps.
7. Classify:
   - reconciled success;
   - confirmed absence and safe retry;
   - confirmed failure;
   - unresolved/manual action required.
8. Retry only when absence or provider-native idempotency proves safety.

No timeout, 502, 503, 504, connection reset, or process failure is automatically classified as mutation failure.

## 8. Approval consumption transaction

Before each approved mutation step, atomically:

- lock/read approval state/version;
- compare plan/context/operation/resource/version/risk/readback bindings;
- verify expiry/revocation/delegation state;
- verify step not already consumed unless replay is idempotently returning prior result;
- record step consumption or usage reservation;
- append event.

If dispatch never occurs, usage reservation may be released only through a declared transition. The historical attempt remains auditable.

## 9. Step claim transaction

Atomically:

- select eligible ready steps under tenant/provider/global bounds;
- verify dependency completion;
- verify no blocker;
- acquire lock or confirm read-only eligibility;
- increment attempt;
- assign claim/fencing token and lease;
- transition to claimed;
- append events.

Selection must avoid multiple workers claiming the same step under concurrency.

## 10. Result and outbox atomicity

Authoritative completion and projection obligation are created in the same transaction.

The transaction includes:

- terminal operation/step state;
- receipt/readback/result hash;
- compact summary;
- one or more immutable outbox events.

This guarantees:

- a confirmed result cannot exist without declared projection obligations;
- a projection worker cannot observe an event before authoritative state commits;
- projection failure does not require provider replay.

## 11. Projection delivery semantics

The system provides at-least-once delivery with destination idempotency and hash verification.

Exactly-once external side effects are not assumed.

Each destination adapter must:

- use event/destination idempotency key;
- verify payload schema/hash;
- enforce tenant/destination scope;
- preserve ordering where required;
- treat duplicate successful delivery as idempotent success;
- return structured retry/dead-letter classification;
- never mutate provider execution state.

## 12. JSONL projection design

Avoid full-file read/rewrite on every append.

Preferred logical design:

- immutable segments partitioned by tenant/session/time or bounded size;
- per-ordering-key serialized writer;
- segment manifest with sequence and hashes;
- atomic segment create/finalize;
- compaction as a separate verified process;
- recovery from authoritative outbox/result ledger;
- bounded segment and manifest reads;
- no credentials or raw provider payloads.

Legacy monolithic JSONL remains until payload/order/hash parity and rollback are proven.

## 13. Drive/session projection design

- SQL/result ledger is source of truth.
- Drive append/update uses event/destination idempotency.
- Existing document content is read only when required for safe merge or integrity check.
- Large or frequent updates may use bounded append sections or segment references rather than rewriting the entire document.
- Projection records retain document/reference revision and payload hash.
- Drive outage moves delivery to retry/dead-letter without changing provider result.

## 14. Indexing guidance

Physical indexing depends on existing schema inventory, but logical access paths require efficient lookup by:

- operation ID plus tenant scope;
- operation state and next runnable time;
- plan ID/revision;
- step readiness/dependency state;
- claim lease expiry;
- resource lock key and active state;
- idempotency scope hash;
- receipt by operation/step and pending reconciliation state;
- approval by plan/context hash and active state;
- outbox event undispatched state/created time;
- delivery destination/state/next retry;
- result reference plus tenant visibility.

Indexes must not use raw secret values or unbounded payload columns.

## 15. Retention and archival

Retention classes:

- lifecycle/audit events: governed long-term retention;
- receipts/readbacks: at least the operation/audit retention period;
- operation current-state projections: retained while references/audit require them;
- full result payloads: policy-based expiration with hash/summary retained where allowed;
- projection delivery details: retained through reconciliation and audit window;
- telemetry: sampled/aggregated according to observability policy;
- credentials: never stored in these records.

Deletion/archival must preserve legal/audit requirements and must not orphan active operations or result references.

## 16. Tenant isolation

Every mutable query includes authoritative tenant/resource scope, not merely caller-supplied identifiers.

Required controls:

- composite scope conditions on reads/writes;
- no cross-tenant global lookup without explicit platform-admin policy;
- platform-admin visibility does not become tenant mutation authority;
- duplicate ID detection where exact single-row identity is required;
- hidden/unauthorized result references are non-enumerating;
- background workers carry tenant/operation scope in claims.

## 17. Data integrity constraints

Logical constraints include:

- unique operation ID;
- unique plan revision per plan;
- unique step key within plan revision;
- unique active idempotency scope;
- unique event sequence per aggregate;
- unique outbox event/destination delivery;
- one active lock lease per lock key;
- receipt target/input hashes match step definition;
- result hash immutable after terminal commit;
- approval consumption cannot exceed declared step/mutation limits;
- terminal state requires terminal classification/result rules.

## 18. Migration strategy

For each persistence slice:

1. inventory current tables/views/repositories and exact production engine/collation constraints;
2. define reuse/additive mapping;
3. produce migration plus rollback/recovery notes;
4. run parser/static validation;
5. run engine-native dry-run on compatible MariaDB/MySQL version;
6. verify schema, indexes, constraints, collations, and row compatibility;
7. deploy code in shadow/read-compatible mode before authority cutover;
8. apply migration under checksum-bound authorization;
9. perform same-cycle schema/ledger readback;
10. enable writes behind flags;
11. reconcile/backfill only through governed jobs;
12. retain compatibility views until usage and rollback gates pass.

## 19. Backfill rules

- no unbounded production transaction;
- resumable batches with cursor/checkpoint;
- tenant/resource scoping;
- idempotent writes;
- before/after counts and hashes;
- bounded error/dead-letter capture;
- no provider mutation;
- no synthetic authority expansion;
- explicit handling of legacy ambiguous or incomplete rows;
- final parity report before cutover.

## 20. Failure windows and required evidence

| Failure window | Required persisted evidence | Safe next action |
|---|---|---|
| before Transaction A commit | no dispatch evidence | retry request/compile |
| after A, before provider call | pending receipt, reservation, lock | release/retry under same operation |
| during provider call, no response | possible mutation, request hash | reconcile |
| provider response before B/C | recover from provider/readback and pending receipt | reconcile/finalize |
| readback unavailable | provider evidence + pending receipt | wait/reconcile, no blind retry |
| C commit unknown | transaction/receipt readback | read ledger before any retry |
| outbox delivery failure | authoritative completed result + pending delivery | retry projection only |
| worker crash after claim | lease/attempt state | recover claim, inspect dispatch state |

## 21. Persistence acceptance tests

- atomic reservation before every unsafe dispatch;
- duplicate idempotency key returns prior result or typed conflict;
- crash in each failure window produces safe next action;
- late fenced worker cannot commit;
- unknown outcome blocks provider replay;
- receipt/readback/result/outbox commit atomically;
- projection outage never changes confirmed provider state;
- destination duplicate delivery is idempotent;
- per-session JSONL ordering remains deterministic;
- cross-tenant read/write attempts fail;
- migration/backfill is resumable and idempotent;
- no secret-like fields or values in lifecycle rows or events.