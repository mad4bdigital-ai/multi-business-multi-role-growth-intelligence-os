# Spec 012 — EC4 Execution Capsule Mutation Validation Pilot

## Status

`in_progress`

EC4 introduces a framework-independent, default-off mutation validation pilot. It validates one reversible mutation against the canonical Execution Capsule, refreshed dynamic evidence, an independent governance decision, and an independent approval decision before invoking an injected executor.

The pilot remains unmounted and does not connect a provider, route, database, migration, credential, deployment, or Production surface.

## Authority separation

The capsule never grants mutation authority. Enabled execution requires all of the following independently:

1. an operation contract classified exactly as `operationKind=mutation` and `mutationRequired=true`;
2. `reversible=true` plus a declared bounded set of dynamic evidence keys;
3. a canonical immutable capsule snapshot;
4. refreshed current context and dependency evidence;
5. an exact selected target equal to the capsule Tenant, workspace, brand, resource, and connection;
6. complete current evidence for every declared dynamic key;
7. canonical mutation validation status `valid` with `dynamicRefreshComplete=true`;
8. a separate governance decision with mutation permission bound to operation key and context hash;
9. a separate approval decision bound to the same operation key and context hash;
10. an injected reversible executor.

Any missing refresh, stale dependency, expiry, context mismatch, target substitution, interpretation requirement, governance denial, approval denial, incomplete dynamic evidence, non-mutation contract, or non-reversible contract fails closed before executor invocation.

## Dynamic evidence contract

The operation contract declares its dynamic evidence frontier explicitly through `dynamicEvidenceKeys`.

The pilot requires one current revision for every declared key and rejects duplicate, missing, unexpected, or non-current entries. The controlled EC4 sample covers:

- approval state;
- capability-envelope state;
- connection status;
- owner or effective authority;
- resource version.

The dynamic evidence provider may validate the existing target only. A different Tenant, workspace, brand, resource, or connection produces `context_re_resolution_required`; the pilot never substitutes the new target.

## Mutation envelope

The injected executor receives a deeply immutable bounded envelope containing:

- the normalized mutation operation contract;
- bounded governance and approval decisions;
- safe execution-context references from the canonical capsule;
- a bounded mutation descriptor with expected and next resource versions;
- current revision summaries for the declared dynamic evidence frontier.

The executor does not receive the raw capsule, raw evidence payloads, credentials, tokens, principal assertions, grants, provider payloads, or an automatically selected replacement target.

## Reversible pilot receipt

The controlled executor must return a receipt that proves:

- `mutationApplied=true`;
- `reversible=true`;
- a bounded `rollbackRef`;
- `providerDispatchPerformed=false`;
- `databaseWritePerformed=false`.

The standalone regression applies an in-memory version transition and restores the previous version through the returned rollback reference. This proves the reversible mutation contract without any provider, network, database, migration, or Production effect.

## Default-off and rollback

When disabled, the pilot preserves the exact legacy executor input and result.

`rollback()` restores the disabled legacy path. It does not undo a real external mutation because EC4 does not connect any external mutation authority. The controlled sample separately proves reversal of its in-memory mutation receipt.

## Telemetry

`execution_capsule_mutation_validation` telemetry contains bounded control facts only:

- operation key;
- validation, governance, and approval statuses;
- dynamic refresh completion;
- exact-target retention;
- executor invocation and mutation application;
- reversible flag;
- fixed provider/database false values;
- fixed `capsuleGrantedAuthority=false`;
- bounded duration and reason codes;
- fixed `secretsIncluded=false`.

Telemetry failure cannot alter validation or executor behavior. Executor errors are rethrown unchanged without copying their messages or payloads into telemetry.

## Regression contract

`http-generic-api/test-execution-capsule-mutation-validation-pilot.mjs` proves:

- disabled legacy input/result identity;
- canonical immutable capsule snapshot;
- complete dynamic evidence and exact target retention;
- independent governance and approval enforcement;
- one reversible in-memory mutation and rollback;
- exact executor receipt identity;
- incomplete dynamic refresh blocks before execution;
- target substitution stops with `context_re_resolution_required`;
- incomplete dynamic evidence blocks execution;
- governance or approval denial blocks execution;
- non-mutation contracts fail before evidence refresh;
- executor failure evidence records invocation safely;
- telemetry outage does not alter a successful receipt;
- no environment, network, database, cloud SDK, or provider dependency.

## Completion gates

EC4 completes only after:

1. the standalone test is registered exactly once in the canonical test manifest;
2. generator-owned evidence is refreshed;
3. required CI and relevant side workflows pass on the final head;
4. Human Architecture/Security Review passes with no unresolved threads;
5. latest-main non-overlap or governed reconciliation succeeds;
6. post-merge readback marks only EC4 complete.

## Safety boundaries

- `runtime_authority=false`;
- `production_activation=false`;
- pilot remains unmounted and default-off;
- capsule does not grant mutation authority;
- no target substitution;
- no route or OpenAPI behavior change;
- no provider call or external send;
- no database write or migration application;
- no credential mutation;
- no deployment or Production synchronization.
