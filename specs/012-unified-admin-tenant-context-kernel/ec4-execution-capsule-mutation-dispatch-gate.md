# Spec 012 — EC4 Execution Capsule Mutation Dispatch Gate

## Status

`complete`

This gate complements, and does not replace, the default-off EC4 mutation-validation pilot already present on `main`. The pilot proves the reversible validation boundary with a controlled in-memory executor. This gate adds the bounded dispatch contract required before any future mutation adapter may be connected.

## Required independent authority

The Execution Capsule never grants mutation authority. Enabled dispatch requires:

1. an operation contract classified as `operationKind=mutation`, `mutationRequired=true`, and `reversible=true`;
2. a declared rollback operation key;
3. a canonical capsule valid against current context and its complete dependency vector;
4. the complete non-reducible dynamic-evidence frontier: approval, capability envelope, effective authority, resource version, provider version, connection status, and expected SHA;
5. a separate governance decision bound to the same operation key and context hash with mutation explicitly allowed;
6. an injected mutation dispatcher.

The operation contract cannot reduce the canonical evidence frontier. Missing any one of the seven evidence keys invalidates the contract before the evidence provider or mutation dispatcher is invoked.

## Dynamic evidence and dispatch-input binding

Each mandatory evidence item must be current, bound to the same operation and context, and must not substitute tenant, workspace, brand, resource, or connection identity.

The bounded mutation input is independently bound to the capsule before dispatch. Any supplied `tenantRef`, `workspaceRef`, `brandRef`, `resourceType`, `resourceRef`, or `connectionRef` must equal the capsule. A resource-specific alias derived from `resourceType`, such as `repositoryRef`, must also equal the capsule resource. The input must carry a bounded `expectedSha` that exactly matches the refreshed expected-SHA evidence.

A changed target returns `context_re_resolution_required`; expected-SHA mismatch, stale or missing evidence, governance denial, non-reversible classification, incomplete evidence contract, input identity substitution, or unsafe input fails closed before dispatch.

Only bounded references, status, revision, and matched expected SHA are forwarded. Raw approval bundles, envelopes, credentials, provider payloads, principal assertions, and raw evidence are excluded.

## Relationship to the validation pilot

The pilot remains the controlled proof of reversible validation and receipt handling. The dispatch gate is a stricter downstream boundary for future adapters. Both remain default-off, unmounted, independently tested, and exported through the integration index. Neither changes route, OpenAPI, provider, database, migration, credential, deployment, or Production behavior.

## Rollback and safety

Disabled mode preserves the legacy dispatcher input and result identity. `rollback()` restores that mode without runtime activation.

## Completion gates

The EC4 dispatch gate completes after exact-once test registration, generated evidence refresh, exact-head CI and side workflows, Human Architecture/Security Review, merge, and post-merge `main` readback.

## Delivery closeout evidence

EC4 Mutation Dispatch Gate was delivered through PR #4397 and merged at `2533d3836fb004ec5835043a49b497011e44f4b0`. Exact-head CI, phased E2E evaluation and execution, the complete diagnostic matrix, Architecture/Security Review, and post-merge `main` readback succeeded. The implementation remains default-off and unmounted; runtime authority, Production activation, provider calls, credential access, database writes, migration apply, deployment, and automatic legacy retirement remain false.
