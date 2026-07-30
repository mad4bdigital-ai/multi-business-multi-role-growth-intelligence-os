# Spec 012 — EC2 Execution Capsule Selected Read Pilot

## Status

`in_progress`

EC2 selects the existing Context Kernel `GET /context-resolutions/{resolutionId}` read contract as the first bounded capsule-consuming pilot. The package remains unmounted and default-off.

## Selected Tenant and Admin paths

The existing controller already supports trusted `tenant` and `admin` view modes over the same canonical `getContextResolution` operation.

`createExecutionCapsuleSelectedReadPilot` creates two explicit controller compositions:

- `tenant`: the existing Tenant-safe projection;
- `admin`: the existing Admin-safe diagnostic projection.

Both compositions wrap only `operations.getContextResolution`. Every other operation remains the original injected function.

## Capsule consumption and parity

For each selected read:

1. the exact legacy `getContextResolution` operation runs first;
2. the returned resolution object is passed to the canonical EC0 capsule service through the hardened EC1 shadow adapter;
3. the capsule target is compared with the authorized selected context;
4. bounded telemetry is tagged with the trusted `viewMode`;
5. the exact legacy resolution object is returned unchanged to the existing controller projection.

The Tenant and Admin HTTP projections remain byte-for-byte equivalent to their disabled baseline for the same input. EC2 does not expose capsule contents, hashes, credentials, raw grants, provider payloads, or revision evidence.

## Default-off and rollback

When `enabled !== true`, the factory returns controllers backed by the exact original operations object and emits no capsule telemetry.

`rollback()` restores the same disabled composition. It requires no route edit, database cleanup, migration rollback, provider operation, credential mutation, or deployment.

## Regression contract

`http-generic-api/test-execution-capsule-selected-read-pilot.mjs` proves:

- exact legacy resolution identity for Tenant and Admin reads;
- Tenant and Admin response parity with the disabled baseline;
- Tenant projection excludes Admin authority/readiness fields;
- Admin projection preserves only the existing safe diagnostics;
- one matched capsule event per selected view;
- zero provider dispatches and zero automatic writes;
- no secret-like value in telemetry or projections;
- rollback stops capsule telemetry and restores the original operations object;
- no environment, network, database, cloud SDK, or provider dependency.

## Completion gates

EC2 completes only after:

1. the pilot test is registered exactly once in the canonical test manifest;
2. generator-owned evidence is refreshed;
3. required CI and relevant side workflows pass on the final head;
4. Human Architecture/Security Review passes with no unresolved threads;
5. latest-main non-overlap or governed reconciliation succeeds;
6. post-merge readback marks only EC2 complete.

## Safety boundaries

- `runtime_authority=false`;
- `production_activation=false`;
- selected read pilot only;
- no route mount or OpenAPI behavior change;
- no response or dispatch modification;
- no provider call or external send;
- no database write or migration application;
- no credential mutation;
- no automatic context or connection substitution;
- no deployment or Production synchronization.
