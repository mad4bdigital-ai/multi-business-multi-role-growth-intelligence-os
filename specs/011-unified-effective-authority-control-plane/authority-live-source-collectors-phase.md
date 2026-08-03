# Live Authority Source Collectors Execution Foundation

## Objective

Complete the missing operational bridge between the merged Governed Live Evidence contracts and a separately authorized live T001/T002 evidence cycle.

This phase is delivered as one integrated wave. It does not treat the eight evidence families as independent task patches.

## Composition

The phase adds:

1. one governed read-only collector for each registered authority evidence family;
2. a fixed SQL allowlist over the existing platform registries only;
3. canonical row-to-authority-path normalization;
4. the operational runner that composes the eight source collectors with the hardened live census adapter and the merged live evidence orchestrator;
5. focused behavioral and static contract regressions;
6. canonical ordered-test registration.

## Registered live sources

| Evidence family | Existing authority source |
|---|---|
| `system_tool_registry` | `admin_platform_endpoint_tools` and `tenant_platform_endpoint_tools` |
| `admin_endpoint_catalog` | `endpoints` |
| `direct_http_routes` | route-backed rows from `endpoints` |
| `runtime_action_registry` | `actions` |
| `descriptor_catalog` | `platform_endpoint_tool_exports` |
| `provider_binding_catalog` | `app_integration_action_bindings` and `app_integration_tool_bindings` |
| `local_device_catalog` | device-tagged Admin and Tenant platform tools |
| `compatibility_alias_registry` | endpoint action aliases and exported tool aliases |

No new registry, authority table, or parallel catalog is introduced.

## Collector contract

Every collector:

- receives the immutable authorization-bound collector context from `authorityLiveEvidenceOrchestrator.js`;
- is bound to exactly one registered family;
- executes exactly one fixed `SELECT` statement from the source-plan allowlist;
- accepts no caller-supplied SQL or query parameters;
- rejects more than 8,192 rows;
- rejects secret-bearing keys and values;
- emits complete pagination evidence with a final null cursor;
- emits one content-addressed snapshot with read-only/no-effect/no-secret markers;
- maps each source row into the canonical Authority Path Inventory shape.

The same endpoint observed through the endpoint catalog and direct-route source produces one canonical path with merged provenance. Contract differences across sources remain blocking conflicts.

## Operational runner

`http-generic-api/scripts/authority-live-evidence-collect.mjs`:

1. reads a short-lived explicit authorization JSON file;
2. reads the hardened live census observation artifact;
3. adapts that observation through `adaptAuthorityLiveCensusObservation`;
4. executes the eight fixed source queries through the existing authenticated Admin DB control boundary;
5. invokes `collectGovernedAuthorityLiveEvidence`;
6. atomically writes the resulting no-secret packet with file mode `0600`;
7. prints only bounded status, count, and SHA-256 markers.

The runner does not generate an authorization, infer a schema, accept free-form SQL, perform provider calls, read credential payloads, or finalize a human ownership review.

## Execution sequence after merge

The implementation PR does not run Production evidence collection. The separately governed operational cycle must:

1. use trusted `main` containing this phase;
2. create one explicit authorization with a maximum one-hour lifetime and exact Production schema;
3. run the hardened live catalog observer;
4. run all eight source collectors inside the same authorization window;
5. keep total observation spread at or below ten minutes;
6. upload the live census and packet as no-secret artifacts;
7. inspect every authority, shared-authority, projection, evidence-ledger, and non-authoritative catalog object;
8. produce a human ownership review after the latest observation;
9. finalize the canonical review packet;
10. close T001 and T002 only through a separate evidence PR if all blockers are zero.

## Migration-readiness boundary

A passing live packet and ownership review may become input to the already merged Authority Data Foundation planner for T021-T024.

It does not itself:

- generate or apply migration SQL;
- authorize revision/version changes;
- create resource graph, delegation, decision, projection, invalidation, or drift storage;
- activate event publishers, consumers, PEP enforcement, or runtime cutover.

T021-T024 remain separately governed implementation work after explicit T001/T002 closeout.

## Safety boundaries

This implementation phase performs no:

- live database operation;
- SQL mutation or migration Apply;
- provider call;
- credential payload read;
- external write;
- deployment or Production promotion;
- runtime authority change;
- evidence persistence activation;
- task auto-closure.

All permanent code is fail-closed and no-secret. The future operational workflow must be temporary, exact-purpose, trusted-main, artifact-producing, and removed after evidence capture.
