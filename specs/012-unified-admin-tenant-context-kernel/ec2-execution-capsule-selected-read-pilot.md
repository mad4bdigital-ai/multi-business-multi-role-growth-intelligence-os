# Spec 012 — EC2 Execution Capsule Selected Read Pilot

## Status

`complete`

EC2 selects the existing Context Kernel `GET /context-resolutions/{resolutionId}` read contract as the first bounded capsule-consuming pilot. The package remains unmounted and default-off.

The implementation merged in PR `#3808` at `92c2c5f3a75d2669fea3290017726c56550bfea8` after exact-head certification on `b5d828b7fed0cd3dc6d1cec3364195eac5643d54`.

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

The Tenant and Admin HTTP projections remain equivalent to their disabled baseline for the same input. EC2 does not expose capsule contents, hashes, credentials, raw grants, provider payloads, or revision evidence.

## Certified parity and rollback

The certified regression proved:

- one Tenant and one Admin selected read;
- two of two capsule target matches;
- exact legacy resolution identity preservation;
- Tenant/Admin response parity with the disabled baseline;
- zero provider dispatches;
- zero automatic writes;
- no secret-like value in telemetry or projections;
- rollback restores the exact original operations object and emits no further capsule telemetry.

## Repository evidence

- Registration run `30578636119` registered `node test-execution-capsule-selected-read-pilot.mjs` exactly once, ran bounded EC0–EC2 regressions, verified the bounded write set, and removed the temporary workflow.
- Generator run `30578778057` refreshed the generated artifacts; final exact-head run `30578924307` passed with no further head movement.
- Required CI run `30578924257` passed Syntax Check, Architecture Drift Detection, Execution Resolver Gate, and Unit & Integration Tests.
- Frontend Surface Dispatch `30578924353`, Custom GPT Contract Guard `30578924101`, Automation Overlap Guard `30578924359`, Context Kernel Hardcoding Report `30578924237`, HTTP Generic API Fanout `30578924222`, Docs Agent `30578924362`, Remaining Scope Scorecard `30578924421`, and Completion Cleanup Readback `30578924426` passed.
- Human Architecture/Security Review passed with no unresolved review threads.
- Latest-main non-overlap and post-merge readback passed.

## Completion result

EC2 is complete. EC3–EC5 remain separately bounded delivery slices. Completion of EC2 does not mount the Context Kernel routes, replace dispatch authority, or authorize Production activation.

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
