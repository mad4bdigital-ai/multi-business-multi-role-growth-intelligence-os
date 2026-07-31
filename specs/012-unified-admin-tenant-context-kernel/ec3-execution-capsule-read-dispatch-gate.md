# Spec 012 — EC3 Execution Capsule Read Dispatch Gate

## Status

`complete`

EC3 provides a framework-independent, default-off integration gate between the canonical Execution Capsule validation port and an injected read-only dispatcher.

## Authority separation

The capsule never grants dispatch authority. Enabled use requires independently:

1. a read operation contract with `mutationRequired=false`;
2. canonical capsule validation against current context and dependencies;
3. an allowed governance decision bound to the same operation key and context hash;
4. an injected read dispatcher.

Stale or invalid capsules, context or dependency mismatch, interpretation requirements, governance denial, mutation classification, and unsafe input fail closed before dispatcher invocation.

## Dispatch and privacy contract

The dispatcher receives a deeply immutable envelope containing the normalized read contract, bounded governance decision, safe execution-context references, and a secret-safe projection of caller input.

The raw capsule, principal assertion, invalidation vector, credentials, tokens, authorization headers, raw grants, and provider payloads are excluded. Enabled mode rejects authority-bearing fields, secret-like values, cycles, accessors, symbols, prototype-sensitive keys, unsupported object types, and oversized structures.

## Rollback and telemetry

Disabled mode and `rollback()` preserve the exact legacy input and result identity. Telemetry records bounded control facts only, cannot grant authority, and cannot change dispatch behavior.

## Completion evidence

- PR `#3858` merged;
- validated exact head: `413aaada58655ad4d6bcf898e96021b3d98dd28c`;
- merge SHA: `2ce9f7e43f7a3c5e9ee6cb7322d46af1c0ba5c83`;
- required CI run `30584106526`: 4/4 jobs passed;
- generator run `30584106613` passed;
- Frontend Surface Dispatch `30584106628` passed;
- Custom GPT Contract Guard `30584106505` passed;
- overlap, hardcoding, fanout, docs, scorecards, and cleanup workflows passed;
- two Human Architecture/Security Reviews passed on the exact head;
- unresolved review threads: zero;
- post-merge `main` readback confirmed source, exact-once test registration, and generator-owned evidence.

## Safety boundaries

- `runtime_authority=false`;
- `production_activation=false`;
- gate remains unmounted and default-off;
- no route or OpenAPI behavior change;
- no provider call, database write, migration apply, credential mutation, deployment, or Production synchronization.
