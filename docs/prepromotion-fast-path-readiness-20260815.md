# Pre-Promotion Fast Path Readiness

## Scope

This readiness record covers the bounded Custom GPT operation surface and the per-operation execution capsule introduced after PR #7230. It is a source and synthetic-runtime readiness record only. It does not authorize Production promotion, database mutation, write-scope activation, or Break-Glass runtime transition.

## Implemented source contracts

Known tenant and admin intents now have bounded OpenAPI operation surfaces for contracts, context, preview, execute, status, and CI diagnosis. Generic `listTools`/`callTool` remains available as a governed fallback for unknown or unclassified intents. The operation routes continue to require their existing principal and capability gates.

The GPT tool dispatcher now supports an `Execution Capsule` scoped to one request or operation. The capsule can retain tenant manifest/schema evidence and compiled tool descriptors across internal dispatch steps. Descriptor reuse does not bypass dynamic authority, policy, approval, connection, resource, provider, expected-SHA, or readback checks.

## Synthetic evidence

The following checks are required before merging this source change:

| Evidence | Required outcome |
|---|---|
| OpenAPI parse and operation-surface validator | Tenant and admin bounded operation paths exist |
| Execution Capsule contract test | Capsule is secret-free, operation-keyed, and cache-capable |
| Operation route registration test | Tenant and admin operation routers remain mounted |
| Tenant GPT readiness test | OAuth and tenant surface contracts remain valid |
| GPT response chunking regression | Existing bounded response behavior remains valid |
| Repository diff hygiene | No generated or whitespace drift |

## Not yet proven

The following remain operational gates and are intentionally not represented as completed by this record:

1. Real Custom GPT model round-trip reduction.
2. X0 telemetry from the real legacy GPT entry point, System Tool entry point, Connector Plan, and Agent Loop.
3. Execution Capsule canary mount in a live tenant runtime.
4. Drive/archive removal from the response critical path.
5. Production migration application, Production runtime parity, or same-SHA readback.
6. Any new database privileges for session, audit, action, OpenAPI, or OAuth tables.

## Safety posture

The operation surface remains fail-closed. Preview is non-mutating. Execute is still governed by existing capability, authority, policy, approval, worker, credential, and readback controls. Production activation, write scopes, and live mutations remain disabled until independent runtime evidence and explicit promotion approval exist.

## Promotion prerequisites

Before any canary or Production cutover, collect matched fixture evidence for cold, warm, multi-step, and long-running sessions. The evidence must include model and tool round trips, SQL queries, provider calls, descriptor/context/policy resolution timings, Drive calls and bytes, candidate/policy/manifest/schema rows scanned, internal operation steps, and archive projection status. Only after those measurements are captured should performance thresholds or canary activation be considered.
