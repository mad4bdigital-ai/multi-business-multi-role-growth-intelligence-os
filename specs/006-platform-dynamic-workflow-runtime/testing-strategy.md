# Verification and Testing Strategy

## Test pyramid

1. **Domain unit tests** — graph invariants, state transitions, merge operators, version immutability, upgrade/fork rules.
2. **Application tests** — authority/settings/adapter composition, transaction boundaries, idempotency, approval binding, compilation.
3. **Repository integration tests** — constraints, indexes, optimistic locking, claims, outbox, retention, tenant-scoped queries.
4. **Adapter contract tests** — readiness, dispatch, inspect, cancel, callback, readback, normalization, failure mapping.
5. **API contract tests** — OpenAPI request/response validation, auth, status codes, pagination, error catalog.
6. **End-to-end governed pilots** — platform-native first, then one external adapter at a time.
7. **Chaos and recovery tests** — worker death, timeout after dispatch, duplicate callback, provider outage, stale leases, readback mismatch.

## Required property tests

- `deny_wins` is commutative and idempotent.
- `strict_intersection` never widens the allowed set.
- `minimum` and `maximum` preserve declared bounds.
- Resolver output is deterministic for identical graph/version inputs.
- Different material inputs produce different snapshot hashes.
- A lower scope cannot widen authority or disable mandatory constraints.
- Graph cycle detection rejects all containment/settings cycles.
- Compare-and-set admits at most one winner for the same expected version.
- One idempotency key/request hash produces one canonical result.
- Forking never copies grants, credentials, approvals, or certification.

## Tenant-isolation matrix

For every tenant-owned endpoint, test:

- same tenant + authorized workspace/resource;
- same tenant + unauthorized workspace/resource;
- different tenant;
- platform administrator with no explicit target grant;
- platform administrator with explicit exact target grant;
- inactive/suspended tenant, membership, grant, resource, or credential;
- guessed IDs and pagination cursors;
- indirect references through installation, fork, callback, evidence, and run IDs.

## Concurrency tests

- simultaneous run creation with same/different idempotency hashes;
- simultaneous installation override using same expected version;
- simultaneous worker claims;
- lease expiry and reclaim while first worker resumes;
- callback and poll completion racing;
- cancellation racing completion;
- retry scheduler racing manual recovery;
- upgrade apply racing override/fork creation.

Expected outcomes must be deterministic and reconstructable from the ledger.

## Failure-injection matrix

Inject failures:

- before database transaction;
- during transaction;
- after commit before dispatcher observes outbox;
- before provider request;
- after provider accepts but before receipt persistence;
- after receipt persistence before canonical transition;
- callback before dispatcher response;
- callback duplication/out-of-order delivery;
- readback timeout/mismatch;
- output normalization failure;
- worker death/lease expiry;
- database deadlock/retry;
- provider rate limiting/outage.

No failure may produce an unauthorized duplicate external effect or an unaudited terminal state.

## Adapter certification suite

Each adapter implementation must prove:

- supported step and execution modes;
- request schema and payload limits;
- credential isolation;
- deterministic idempotency behavior or compensating controls;
- timeout and unknown-outcome handling;
- status inspection;
- cancellation semantics;
- callback signature/nonce validation where applicable;
- readback and normalization;
- provider error mapping;
- rate-limit behavior;
- secret redaction;
- versioned certification evidence and expiry.

## API and schema checks

- Both OpenAPI 3.1 contracts parse and lint.
- Every operation has `operationId`, tags, summary, security, success, and stable error responses.
- Unsafe retryable creates require `Idempotency-Key`.
- Unknown fields are rejected on mutation bodies where strictness is required.
- Cursor pagination does not leak cross-tenant resources.
- Examples and generated schemas remain synchronized.

## Performance and capacity

Measure:

- authority/settings/compiler p50/p95/p99;
- run creation and transition latency;
- claim throughput and lease contention;
- outbox oldest age and delivery throughput;
- callback verification throughput;
- readback latency;
- database query plans and index selectivity;
- payload and evidence growth;
- hot-tenant fairness and per-tenant quotas.

Load tests include noisy-neighbor scenarios and provider backpressure.

## Security tests

- object-level authorization and enumeration resistance;
- callback replay/signature/skew;
- approval hash mismatch/expiry/reuse;
- SSRF, path/query/header injection;
- unsafe deserialization and schema bombs;
- credential/reference substitution;
- secret logging and error leakage;
- fork/override policy escape;
- untrusted generated workflow activation;
- audit tamper detection.

## Release evidence

Each implementation PR links test IDs, migration IDs, OpenAPI operation IDs, dashboards/alerts, pilot run/evidence references, rollback rehearsal, known limitations, and explicit reviewer approvals.
