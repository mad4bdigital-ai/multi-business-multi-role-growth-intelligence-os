# Spec 012 — EC1 Execution Capsule Shadow Closeout

## Status

`in_progress`

This addendum closes the remaining EC1 work after the core shadow adapter merged in PR `#3678` at `71475ad136684da1ec86dfb2c9d1f4ff50af7b54`.

EC1 remains a default-off, framework-independent shadow contract. This follow-up does not wire the shadow into route construction, enable Production traffic, grant execution authority, call a provider, or write to a database.

## Selected composition

`http-generic-api/contextKernel/integration/executionCapsuleShadowComposition.js`

The selected composition is the existing Resource API read shadow. The factory:

- requires the exact legacy resolution service;
- returns the exact original service when disabled;
- decorates the service only when `enabled === true` is explicitly injected;
- injects the decorated service into the existing post-response Resource API shadow middleware;
- keeps capsule telemetry and Resource API telemetry separate;
- has no environment-variable or ambient configuration activation;
- changes no route, OpenAPI contract, response, dispatch decision, or persistence state.

## Controlled parity evidence

`http-generic-api/test-execution-capsule-shadow-composition.mjs` executes three deterministic, in-process read contexts.

The sample requires:

- three of three legacy resolution objects returned by identity;
- three of three capsule targets matching the authorized selected context;
- zero provider dispatches;
- zero automatic writes;
- `executionAllowed=false` for every event;
- `secretsIncluded=false` for every event;
- unchanged Resource API response status;
- no authorization value copied into either telemetry stream.

This sample is contract evidence only. It is not a live Tenant canary, Production deployment, provider call, or database operation.

## Rollback evidence

The enabled composition exposes `rollback()`.

Rollback:

- restores the exact pre-EC1 resolution service object;
- returns the existing disabled Resource API shadow middleware;
- schedules no further shadow work;
- requires no route edit, database cleanup, migration rollback, provider action, or credential mutation.

The regression emits a response `finish` event after rollback and proves that no capsule or Resource API shadow task is scheduled.

## Repository registration

Both EC1 contract tests must be registered exactly once beside the canonical EC0 test:

```text
node test-execution-capsule-shadow-adapter.mjs
node test-execution-capsule-shadow-composition.mjs
```

Registration is applied by a bounded self-deleting workflow and then verified by repository generator authority. Generated files are never edited manually.

## Completion gates

EC1 is complete only after:

1. exact-once repository test registration;
2. generator-owned operation-governance and surface-dispatch evidence refresh;
3. required CI success on the final head;
4. relevant side-workflow success;
5. Human Architecture/Security Review on the final head;
6. latest-main non-overlap or governed reconciliation;
7. post-merge readback and documentation reconciliation.

## Safety boundaries

- `runtime_authority=false`;
- `production_activation=false`;
- no route or OpenAPI behavior change;
- no provider call or external send;
- no database write or migration application;
- no credential mutation;
- no response or dispatch modification;
- no approval, retry, idempotency, or readback change;
- no automatic context or connection substitution;
- no deployment or Production synchronization.
