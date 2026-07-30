# Security and Threat Model

## 1. Purpose

This document analyzes security risks introduced or affected by runtime composition, server-side orchestration, context reuse, graph concurrency, durable execution, compact result references, and deferred projections.

The architecture is acceptable only when speed improvements preserve or strengthen tenant isolation, explicit authority, approval binding, idempotency, readback, audit, secret containment, and recovery.

## 2. Protected assets

- tenant, workspace, brand, resource, and connection identity;
- authenticated principal and effective subject;
- authority, capability, policy, delegation, and approval decisions;
- operation descriptors and consequence metadata;
- context capsules and revision vectors;
- governed plans and plan hashes;
- idempotency reservations and resource locks;
- short-lived credentials and credential resolver handles;
- provider mutation requests and receipts;
- readback and reconciliation evidence;
- operation/result/projection references;
- repository branches, files, PRs, CI, deployments, and migrations;
- audit/event history;
- platform availability and provider quotas.

## 3. Actors

### Legitimate actors

- Tenant user;
- Tenant service principal;
- Platform Admin;
- delegated Agent;
- internal worker/scheduler;
- projection worker;
- provider adapter;
- auditor/read-only operator.

### Threat actors or faulty components

- authenticated user attempting cross-tenant access;
- compromised or over-broad service principal;
- delegated Agent acting outside grant;
- malicious or stale tool descriptor;
- compromised provider response;
- stale worker retaining a claim;
- client replaying approval/idempotency/result references;
- projection destination returning malicious content;
- internal code path bypassing shared kernel;
- accidental developer regression;
- resource-exhaustion attacker.

## 4. Trust boundaries

```text
Client / Custom GPT
  | authentication boundary
API adapter / Spec 013 gateway
  | execution-context authority boundary
Spec 012 Context Kernel
  | governance/approval boundary
Spec 011 Governed Execution Kernel
  | credential and provider boundary
Provider / Git / DB / local worker

Execution Ledger
  | projection boundary
Drive / JSONL / Search / Analytics / Notifications
```

Every transition across a boundary has explicit schema, identity, scope, and no-secret rules.

## 5. Security invariants

1. Catalog visibility is not execution authority.
2. Semantic intent ranking cannot create authority.
3. A capsule is not execution authority by itself.
4. Admin visibility cannot silently become Tenant mutation authority.
5. The exact tenant/workspace/resource/connection cannot change after plan approval without invalidation.
6. Consequence metadata reflects the selected operation, not the generic transport shell.
7. Dynamic authorization is refreshed at the mutation frontier.
8. Approval and delegation are exact-plan and exact-context bound.
9. Unknown outcome blocks blind retry.
10. Resume cannot widen authority or change target/input.
11. Resource concurrency cannot bypass mutation serialization or provider limits.
12. Result references are authorized, expiring, integrity-bound, and non-enumerating.
13. Projection content is not authoritative execution evidence.
14. No cross-spec artifact contains raw credentials or unrestricted provider payloads.
15. Every mutation produces durable receipt/readback or reconciliation state.

## 6. Threat catalogue

### T-001 — Confused deputy through generic execution shell

**Scenario:** A low-privilege caller invokes a generic endpoint and supplies a high-impact tool/operation name, expecting the generic shell's own metadata or authentication to grant access.

**Mitigations:**

- principal-scoped descriptor visibility;
- exact operation lookup;
- Spec 012 context and target authorization;
- Spec 011 capability/authority/policy/approval compilation;
- operation-derived consequence metadata;
- handler cannot dispatch without governed input;
- hidden descriptor indistinguishable from absent where required.

**Tests:** Tenant cannot execute Admin-only descriptor; generic endpoint does not alter consequence/approval requirement.

### T-002 — Semantic intent privilege escalation

**Scenario:** Natural-language interpretation selects an operation beyond caller authority or intentionally ambiguous text is resolved to a more privileged action.

**Mitigations:**

- intent resolution over visible descriptors only;
- interpretation is discovery, not authority;
- material ambiguity returns `interpretation_required`;
- context/authority evaluation after interpretation;
- no provider call from unresolved state;
- bounded candidate evidence.

### T-003 — Cross-tenant context substitution

**Scenario:** A caller or internal layer supplies a resource/connection from another tenant or a platform Admin context is reused for Tenant execution.

**Mitigations:**

- shared Spec 012 kernel;
- principal/effective-subject separation;
- exact candidate and tenant/workspace/resource/connection binding;
- context hash and dependency vector;
- tenant-scoped persistence queries;
- no silent fallback to another connection;
- capsule validation by all entry points.

### T-004 — Stale capsule grants outdated authority

**Scenario:** Cached context is reused after authority revocation, connection expiration, capability change, or resource transfer.

**Mitigations:**

- revision-bound reuse, not TTL alone;
- explicit dependency invalidation;
- dynamic mutation-frontier refresh;
- revocation/authority revision invalidates dependent plan/approval;
- low-risk stale-while-revalidate limited to non-widening reads.

### T-005 — Descriptor/runtime mismatch

**Scenario:** Catalog metadata says read-only/low-risk while handler performs mutation or requires stronger approval/readback.

**Mitigations:**

- descriptor/runtime parity registry;
- consequence metadata included in snapshot hash;
- mismatch fails closed before dispatch;
- CI compares schema, descriptor, handler, capability, and consequence contracts;
- runtime handler accepts only declared governed input.

### T-006 — Approval replay or scope widening

**Scenario:** An approval for one plan/resource/SHA is reused for a changed plan, broader mutation set, different provider, or later operation.

**Mitigations:**

- approval hash binds plan/context/operations/resources/versions/risk/limits/readback/expiry;
- exact step consumption;
- invalidation on drift;
- renewal cannot widen;
- approval state/version locked at mutation frontier;
- no broad session authority.

### T-007 — Delegated Agent self-expansion

**Scenario:** Agent alters its own grant, selects a broader operation, or converts recommend authority into execution authority.

**Mitigations:**

- canonical delegation modes;
- exact grant and plan binding;
- independent policy decision;
- Agent action recorded as delegated actor, not user action;
- self-modifying authority operations excluded by default;
- high/critical risk remain user-controlled unless exact policy/grant permits.

### T-008 — Idempotency collision or key abuse

**Scenario:** Same key is reused with different input/target, or attacker guesses a key to retrieve another operation.

**Mitigations:**

- store key hash only;
- canonical scope includes tenant, operation, target, input hash, and consequence class;
- same key/different scope is conflict;
- result retrieval separately authorized;
- high-entropy caller keys where required;
- no raw key in logs or public projections.

### T-009 — Duplicate mutation after timeout/restart

**Scenario:** Client/worker retries after unknown transport outcome.

**Mitigations:**

- pending receipt before dispatch;
- unknown-outcome state;
- idempotency reservation remains blocked;
- logical mutation guard;
- provider readback/reconciliation before retry;
- process recovery inspects receipt/dispatch evidence;
- fault injection across all failure windows.

### T-010 — Resource-lock bypass or stale worker commit

**Scenario:** Two workers mutate same resource; expired worker commits after a replacement worker.

**Mitigations:**

- canonical resource lock keys;
- atomic leases;
- fencing tokens checked on commit;
- mutation conflict serialization;
- unknown-outcome logical guard beyond lease expiry;
- per-provider/tenant concurrency limits.

### T-011 — Concurrent independent mutations are actually conflicting

**Scenario:** Different apparent resources share hidden provider/global constraints.

**Mitigations:**

- descriptor declares conflict/lock domain;
- provider adapter may add broader lock key;
- concurrency permitted only under explicit policy;
- provider quota and connection locks;
- canary read/preparation before mutation concurrency.

### T-012 — Result reference enumeration

**Scenario:** Caller guesses operation/result IDs and reads another tenant's result.

**Mitigations:**

- opaque high-entropy references;
- current principal and tenant/resource authorization on every retrieval;
- non-enumerating not-found behavior;
- expiration;
- result/reference/hash binding;
- bounded fields and redaction;
- rate limiting and anomaly detection.

### T-013 — Compact response hides failure or missing evidence

**Scenario:** Transport compaction reports success but omits missing readback, partial effects, or projection obligations.

**Mitigations:**

- compact schema requires terminal classification, receipts, readback summary, blockers, projection status, and next action;
- state/result hash bound to authoritative full result;
- completed requires readback;
- partial/compensation/reconciliation states explicit.

### T-014 — Projection poisoning

**Scenario:** Drive/JSONL/search content is modified or malicious and later treated as execution truth.

**Mitigations:**

- SQL ledger/provider readback authoritative;
- projection payload/result hashes;
- destination idempotency and ordering;
- projection reconciliation from authoritative source;
- never derive mutation success/authority from projection;
- sanitize content before retrieval indexing.

### T-015 — Projection replay or cross-tenant delivery

**Scenario:** Outbox event delivered twice or to wrong document/index.

**Mitigations:**

- event/destination unique key;
- tenant/destination binding;
- ordering key;
- payload hash;
- destination adapter scope validation;
- duplicate successful delivery classified idempotently;
- no provider mutation in projection adapters.

### T-016 — Secret leakage through capsule, logs, metrics, errors, or result

**Scenario:** Raw token, credential, JWT, provider secret, checkout path, or request body appears in durable state/telemetry.

**Mitigations:**

- reference-only capsule;
- short-lived credential handles and in-memory containment;
- structured allowlisted evidence;
- secret-like key/value scanner tests;
- metrics prohibit raw input/result labels;
- bounded errors without stacks/raw bodies;
- serialization tests for every contract.

### T-017 — SSRF or route recursion through tool descriptors

**Scenario:** A descriptor points to arbitrary localhost/private URL or recursively invokes generic tool-call endpoints.

**Mitigations:**

- in-process handler registry for local operations;
- HTTP only for registered service boundaries;
- destination allowlist and service identity;
- recursive generic dispatcher wrappers forbidden;
- no caller-supplied URL as runtime handler authority;
- egress controls for provider adapters.

### T-018 — Malicious provider payload or schema drift

**Scenario:** Provider returns oversized, malformed, secret-bearing, or adversarial content.

**Mitigations:**

- response size/time bounds;
- schema validation and safe projection;
- raw provider payload not automatically persisted/indexed;
- HTML/error envelope normalization;
- parser-safe handling;
- schema drift produces typed block/reconciliation.

### T-019 — Plan injection or output substitution

**Scenario:** A step output modifies downstream operation key/target/authority unexpectedly.

**Mitigations:**

- immutable plan and declared output schemas;
- downstream input mappings allowlisted;
- outputs cannot change operation/target unless plan explicitly declares a re-resolution frontier;
- canonical hashes;
- dynamic values separated from authority fields.

### T-020 — Cancellation used to hide committed effects

**Scenario:** Caller cancels after mutation and UI reports cancelled without showing effect.

**Mitigations:**

- cancellation distinct from compensation;
- in-flight mutation reconciled;
- terminal state reflects confirmed effects;
- receipts remain visible;
- compensation separately governed/read back.

### T-021 — Denial of service through broad intent or graph explosion

**Scenario:** Caller submits huge intent/plan, excessive branches, or expensive status polling.

**Mitigations:**

- input length and candidate bounds;
- maximum plan steps/edges/depth;
- compiler complexity limits;
- concurrency/rate limits;
- per-tenant quotas;
- bounded evidence/results;
- status polling backoff/cursors;
- cost ceilings and approval.

### T-022 — Policy/registry cache poisoning

**Scenario:** Wrong revision or tenant scope is stored/reused.

**Mitigations:**

- cache key includes scope and exact revision vector;
- canonical source read on miss/mismatch;
- signed/hash-bound compiled artifacts where applicable;
- no shared mutable object across tenants;
- cache is optimization, never authority;
- invalidation events scoped by dependency domain.

### T-023 — Audit gap caused by optimized path

**Scenario:** Fast/in-process path skips events that legacy HTTP/middleware path produced.

**Mitigations:**

- audit obligations belong to governed dispatcher/ledger, not transport middleware alone;
- safety-equality vector includes audit coverage;
- legacy/new event parity tests;
- no cutover with unexplained audit delta.

### T-024 — Weak rollback creates split-brain execution

**Scenario:** Some entry points use composed path while receipts/status are read from legacy path or vice versa.

**Mitigations:**

- shared operation/result identity;
- feature flags route acceptance, dispatch, and readback coherently;
- rollback matrix per phase;
- compatibility adapters read authoritative shared ledger;
- no destructive migration before rollback proof.

## 7. Authorization decision order

Before dispatch:

1. Authenticate caller.
2. Establish actor and effective subject.
3. Resolve principal-visible descriptor.
4. Resolve exact Tenant/Workspace/Resource/Connection.
5. Resolve effective resource authority.
6. Resolve capability and runtime readiness.
7. Compile policy, risk, consequence, delegation, and approval decision.
8. Compile plan and exact mutation frontier.
9. Validate approval and limits.
10. Refresh dynamic evidence.
11. Reserve idempotency and lock.
12. Resolve short-lived credentials.
13. Dispatch provider.

No later step may compensate for a skipped earlier authority step.

## 8. Credential security

- credential lookup is by governed connection reference;
- credential payload is not part of capsule/plan/receipt;
- resolved credential lifetime is bounded by worker/operation policy;
- worker-specific binding and owner/resource scope;
- in-memory secret buffers are non-enumerable where applicable and zeroed after use;
- no credential files unless a separately governed adapter contract requires a secure ephemeral file;
- provider adapter receives minimum required credential scope;
- refresh/rotation invalidates readiness revision;
- authentication failure does not trigger automatic connection substitution for mutations.

## 9. Consequence and risk controls

Risk classes remain:

- read-only;
- low;
- medium;
- high;
- critical.

Defaults:

- read-only may run without approval when authority and policy allow;
- low-risk reversible mutation may use exact plan-bound approval/delegation;
- medium risk requires stronger approval/reviewer policy;
- high/critical actions default to user-controlled exact approval and separate release/migration/deploy gates;
- destructive, credential, permission-expanding, billing, and external-send actions remain excluded from broad automation.

## 10. Data minimization and privacy

- store references/hashes rather than raw identities where practical;
- Tenant and Admin projections have separate allowlists;
- no cross-tenant aggregate metrics with identifying dimensions unless explicitly authorized;
- result retention is policy-bound;
- search projection excludes secret/raw provider payload;
- bounded evidence supports diagnosis without copying full content;
- deletion/retention honors audit and active-operation constraints.

## 11. Security observability

Required counters/alerts:

- cross-tenant mismatch/block;
- target/connection substitution attempt;
- descriptor/runtime mismatch;
- stale capsule/approval/envelope rejection;
- idempotency conflict;
- unknown outcome and reconciliation age;
- duplicate provider mutation detected;
- stale fencing-token commit attempt;
- unauthorized result lookup;
- secret scanner finding;
- projection destination scope mismatch;
- recursive/forbidden handler dispatch;
- rollback activation;
- safety-vector parity mismatch.

Labels are bounded and must not include raw user input, token, URL with secrets, or high-cardinality payload values.

## 12. Security test matrix

Required tests:

- Tenant A cannot resolve/use Tenant B capsule, operation, result, receipt, or projection;
- Admin read visibility does not permit tenant mutation without effective subject and exact authority;
- hidden descriptor is non-enumerating;
- intent ambiguity performs no dispatch;
- descriptor consequence mismatch fails closed;
- capsule revision/authority revocation blocks mutation;
- approval replay after plan/SHA/resource drift fails;
- Agent cannot widen delegation;
- same idempotency key with different target/input conflicts;
- unknown outcome cannot be retried;
- stale fencing token cannot commit;
- result reference guess fails non-enumerating;
- compact result exposes partial/reconciliation/projection state correctly;
- projection poison cannot alter authoritative result;
- recursive localhost/generic tool wrapper blocked;
- provider oversized/malformed/HTML error is structured and bounded;
- cancellation cannot hide committed effect;
- plan/output cannot substitute target;
- DoS limits for intent candidates, plan size, concurrency, polling, and result size;
- no-secret serialization and logs across success/failure/fault injection.

## 13. Security rollout gates

No traffic expansion is allowed until the current phase passes:

- threat-specific deterministic tests;
- cross-tenant and authorization parity;
- no-secret evidence;
- descriptor/runtime/consequence parity;
- approval/idempotency/readback fault tests;
- rollback drill;
- zero unexplained safety-vector mismatch in shadow/canary evidence.