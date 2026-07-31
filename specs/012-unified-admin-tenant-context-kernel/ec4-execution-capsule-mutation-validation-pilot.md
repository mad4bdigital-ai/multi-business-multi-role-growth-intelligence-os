# Spec 012 — EC4 Execution Capsule Mutation Validation Pilot

## Status

`in_progress`

EC4 adds a framework-independent, default-off mutation validation pilot. It proves one reversible mutation boundary without mounting a route, connecting a provider, writing a database, applying a migration, or activating Production behavior.

## Independent authority requirements

The Execution Capsule never grants mutation authority. Enabled execution requires independently:

1. a mutation-only operation contract with `mutationRequired=true` and `reversible=true`;
2. the complete declared dynamic frontier: approval state, capability envelope, connection status, owner authority, and resource version;
3. a canonical immutable capsule snapshot;
4. an allowed governance decision bound to operation key and context hash;
5. an approved approval decision bound to the same operation key and context hash;
6. refreshed current context and dependency evidence;
7. exact Tenant, workspace, brand, resource, and connection retention;
8. revision equality between refreshed evidence and the approved/canonical expected revisions;
9. canonical mutation validation status `valid` with dynamic refresh complete;
10. an injected reversible executor.

## Dynamic evidence bindings

The five refreshed revisions are bound as follows:

- `approval_state` → approval revision;
- `capability_envelope` → capsule capability revision;
- `connection_status` → capsule credential-readiness revision;
- `owner_authority` → capsule authority revision;
- `resource_version` → mutation expected resource version.

Duplicate, missing, unexpected, non-current, or mismatched evidence fails closed before executor invocation.

The evidence provider may validate the capsule target only. A different Tenant, workspace, brand, resource, or connection returns `context_re_resolution_required`; no target is substituted silently.

## Executor envelope and receipt

The executor receives a deeply immutable bounded envelope containing only:

- normalized mutation contract;
- bounded governance and approval decisions;
- safe execution-context references;
- expected/next resource versions and rollback requirement;
- bounded refreshed revision summaries.

The raw capsule, raw context evidence, credentials, tokens, grants, provider payloads, and principal assertions are excluded.

A successful receipt is allowlisted to:

- `mutationApplied=true`;
- `reversible=true`;
- bounded `rollbackRef`;
- `providerDispatchPerformed=false`;
- `databaseWritePerformed=false`.

Extra receipt fields are rejected to prevent provider or secret payloads crossing the pilot boundary.

## Regression contract

`http-generic-api/test-execution-capsule-mutation-validation-pilot.mjs` proves:

- disabled legacy input/result identity;
- canonical immutable capsule snapshot;
- exact dynamic evidence revision binding;
- exact target retention;
- independent governance and approval;
- controlled in-memory version mutation and rollback;
- exact executor receipt identity;
- incomplete refresh/evidence and stale revision failures;
- target substitution failure;
- governance and approval denial before refresh;
- read-contract rejection before refresh;
- executor failure propagation with bounded telemetry;
- unbounded receipt rejection;
- telemetry outage isolation;
- exact disabled rollback;
- no environment, network, database, cloud SDK, or provider dependency.

## Completion gates

EC4 completes after exact-head required CI and side workflows, generator-owned evidence refresh, Human Architecture/Security Review, latest-main reconciliation, merge, and post-merge readback.

## Safety boundaries

- `runtime_authority=false`;
- `production_activation=false`;
- pilot remains unmounted and default-off;
- no route/OpenAPI change;
- no provider call or external send;
- no database write or migration apply;
- no credential mutation;
- no deployment or Production synchronization.
