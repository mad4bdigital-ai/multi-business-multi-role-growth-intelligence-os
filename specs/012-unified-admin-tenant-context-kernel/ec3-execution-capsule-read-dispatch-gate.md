# Spec 012 — EC3 Execution Capsule Read Dispatch Gate

## Status

`complete`

EC3 introduces a framework-independent, default-off integration gate between the canonical Execution Capsule validation port and an injected read-only dispatcher.

## Authority separation

The capsule never grants dispatch authority. The gate requires all of the following independently:

1. an operation contract classified exactly as `operationKind=read` and `mutationRequired=false`;
2. a canonical capsule validation result with status `valid` against current context and dependency evidence;
3. a separate governance decision with `status=allowed`, `dispatchAllowed=true`, `mutationAllowed=false`, the same operation key, and the same context hash;
4. an injected read dispatcher.

A missing or stale capsule, context mismatch, dependency mismatch, expiry, interpretation requirement, governance denial, operation mismatch, mutation classification, or unsafe dispatch input fails closed before dispatcher invocation.

## Dispatch envelope

The gate passes the dispatcher a bounded, deeply immutable envelope containing:

- the normalized read operation contract;
- the bounded independent governance decision;
- safe execution-context references from the canonical validated capsule;
- a secret-safe structured projection of `dispatchInput`.

Enabled mode never forwards the caller-owned input object directly. The projection accepts only bounded plain objects, arrays, strings, finite numbers, booleans, and null values. It rejects cycles, accessors, symbols, prototype-sensitive keys, unsupported object types, excessive depth or size, authority-bearing field names, and secret-like values before current-evidence resolution or dispatcher invocation.

The raw capsule, invalidation vector, principal assertion, credential readiness evidence, authorization headers, cookies, credentials, tokens, raw grants, and provider payloads are not copied into the dispatch envelope or telemetry.

## Legacy mode and rollback

When disabled, the gate passes the original `dispatchInput` directly to the legacy injected dispatcher and returns the exact result by identity.

`rollback()` restores the same disabled path. No route edit, provider operation, database cleanup, migration rollback, credential mutation, or deployment is required.

## Telemetry

`execution_capsule_read_dispatch` telemetry records bounded control facts only:

- operation key;
- validation and governance status;
- whether the dispatcher was invoked;
- whether dispatch succeeded;
- fixed `mutationAllowed=false`;
- fixed `capsuleGrantedAuthority=false`;
- bounded duration and reason codes;
- fixed `secretsIncluded=false`.

Telemetry failure cannot change validation or dispatch behavior. A dispatcher exception is rethrown unchanged while bounded telemetry records that invocation occurred and failed.

## Regression contract

`http-generic-api/test-execution-capsule-read-dispatch-gate.mjs` proves:

- disabled legacy input/result identity;
- canonical capsule snapshot before evidence and dispatch;
- valid capsule plus independent governance permits one injected read dispatch;
- safe input is projected into a new deeply frozen structure;
- authority-bearing or secret-like input fails before evidence resolution and dispatch;
- raw capsule is not passed to the dispatcher;
- governance denial blocks dispatch;
- mutation classification blocks dispatch;
- context mismatch blocks dispatch;
- dispatcher failure evidence records invocation accurately without copying the error message;
- telemetry outage does not alter a successful dispatch result;
- rollback restores the exact legacy call shape;
- no environment, network, database, cloud SDK, or provider dependency.

## Completion evidence

- merged PR: `#3858`;
- validated exact head: `413aaada58655ad4d6bcf898e96021b3d98dd28c`;
- merge SHA: `2ce9f7e43f7a3c5e9ee6cb7322d46af1c0ba5c83`;
- required CI run `30584106526`: 4/4 required jobs passed;
- generator run `30584106613`: passed on the exact head;
- Frontend Surface Dispatch run `30584106628`: passed;
- Custom GPT Contract Guard run `30584106505`: passed;
- overlap, hardcoding, fanout, docs, scorecards, and cleanup workflows passed;
- two Human Architecture/Security Reviews passed on the exact head;
- unresolved review threads: zero;
- post-merge `main` readback confirmed the gate, exact-once test registration, and generator-owned evidence;
- runtime authority and Production activation remain false.

## Safety boundaries

- `runtime_authority=false`;
- `production_activation=false`;
- gate remains unmounted and default-off;
- no route or OpenAPI behavior change;
- no provider adapter is wired or called;
- no database write or migration application;
- no credential mutation;
- no approval, retry, idempotency, or response behavior change;
- no deployment or Production synchronization.
