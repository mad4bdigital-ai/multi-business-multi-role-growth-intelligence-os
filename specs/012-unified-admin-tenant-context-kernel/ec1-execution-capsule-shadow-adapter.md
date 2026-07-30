# Spec 012 — EC1 Execution Capsule Shadow Adapter

## Status

`in_progress`

EC1 introduces a framework-independent decorator around an existing Context Kernel resolution service. It builds an EC0 Execution Capsule beside the existing shadow resolution and emits bounded comparison telemetry without changing the resolution object, HTTP response, dispatch decision, provider behavior, or persistence state.

## Delivered implementation

### Adapter

`http-generic-api/contextKernel/integration/executionCapsuleShadow.js`

The adapter exposes:

```text
createExecutionCapsuleShadowResolutionService
```

It accepts:

- the existing `resolutionService`;
- the canonical EC0 `capsuleService`;
- an explicit `capsuleEvidenceProvider`;
- a bounded `emitTelemetry` function;
- an injectable clock.

The adapter returns a service with the same `resolve(input)` port. It calls the existing resolution service first and returns the exact same resolution object by identity.

### Explicit revision evidence

The adapter does not infer authority, capability, registry, or credential-readiness revisions from route names, Tenant IDs, resource keys, TTL, or ambient process state.

`capsuleEvidenceProvider` must supply the exact bounded evidence required by EC0:

- `authorityPathRef`;
- `authorityRevision`;
- `capabilityRevision`;
- `registryRevision`;
- `credentialReadinessRevision`;
- optional invalidation dependencies;
- optional expiry.

Only the declared fields are passed to the canonical EC0 service. A provider cannot replace the resolved context or selected candidate through the evidence payload.

## Shadow behavior

### Resolved context

For a resolved exact context, EC1:

1. requests explicit revision evidence;
2. calls the canonical EC0 `capsuleService.resolve`;
3. verifies the shadow result security invariants;
4. compares the capsule target with the authorized selected candidate;
5. emits a bounded telemetry result;
6. returns the legacy resolution object unchanged.

### Unresolved context

For a blocked, ambiguous, incomplete, or otherwise unresolved context:

- revision evidence is not requested;
- no capsule is created;
- telemetry records `not_attempted` and `context_not_resolved`;
- the original unresolved result is returned unchanged.

### Failure isolation

A revision-evidence failure, capsule creation failure, security-invariant violation, target mismatch, or telemetry outage:

- does not alter the legacy resolution;
- does not change the HTTP response;
- does not trigger a provider call;
- does not perform an automatic write;
- does not authorize execution;
- emits only a bounded reason code when telemetry is available.

Error messages, credentials, provider details, and raw evidence are never copied into telemetry.

## Telemetry contract

The `execution_capsule_shadow` event contains bounded fields only:

- shadow mode;
- duration;
- resolution status;
- candidate count;
- whether a selected candidate exists;
- whether capsule creation was attempted;
- whether a capsule was created;
- matched, mismatched, not-attempted, or build-failed outcome;
- capsule status;
- target parity;
- bounded reason codes;
- fixed security invariants.

It does not contain:

- the capsule object;
- capsule hashes or context hashes;
- principal or subject references;
- credentials or authorization headers;
- provider payloads;
- raw grants or revision evidence.

## Composition with the existing Resource API shadow

The existing Resource API shadow middleware already runs after the legacy response finishes and accepts an injected `resolutionService`.

EC1 composes by wrapping that service before injection:

```text
Resource API response finishes
        ↓
existing shadow middleware schedules work
        ↓
EC1 decorated resolution service
        ↓
legacy Context Kernel resolution
        ↓
EC0 capsule shadow construction
        ↓
bounded capsule telemetry
        ↓
original resolution returned to existing shadow comparison
```

No route changes are required for the adapter contract. Production composition remains intentionally disabled in this slice.

## Contract review evidence

The temporary read-only EC1 Contract Review succeeded and was removed from the branch. It ran:

- `test-execution-capsule-shadow-adapter.mjs`;
- `test-execution-capsule-contract.mjs`;
- `test-context-kernel-shadow-integration.mjs`;
- `test-context-kernel-domain.mjs`;
- `test-context-kernel-application-use-cases.mjs`.

The review also proved that execution left the checkout unchanged.

## Test coverage

`http-generic-api/test-execution-capsule-shadow-adapter.mjs` covers:

- exact legacy resolution identity preservation;
- canonical EC0 capsule creation;
- bounded and immutable success telemetry;
- unresolved-context no-attempt behavior;
- explicit revision-evidence requirement;
- sanitized evidence-provider failures;
- security-invariant violation handling;
- target mismatch detection;
- telemetry outage isolation;
- composition with the existing Resource API post-response shadow middleware;
- no credential or authorization leakage;
- no process environment, network, database, cloud SDK, or provider dependency.

## Remaining EC1 work

- repository-wide test-manifest registration;
- generator-owned evidence refresh;
- exact-head CI and architecture/security review;
- one explicit composition factory for selected runtime shadow configuration;
- measured parity evidence from a controlled non-production sample;
- rollback evidence proving removal of the decorator restores the prior shadow path exactly.

## Safety boundaries

- `runtime_authority=false`;
- no production activation;
- no provider call or external send;
- no database write or migration;
- no route or OpenAPI change;
- no response or dispatch modification;
- no approval, retry, idempotency, or readback change;
- no automatic context or connection substitution;
- no credential, token, JWT, raw grant, provider body, or unbounded evidence;
- no deployment or Production synchronization.
