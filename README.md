# Multi-Business Multi-Role Growth Intelligence OS

This repository is a governed, registry-driven execution system. It is not primarily a generic web application stack, even though it contains application runtime code.

The architecture is centered on canonical authority documents, registry-backed execution control, validation-first runtime behavior, and governed logging/writeback.

## Canonical authority order

When understanding or changing this repository, use the following authority order:

1. `system_bootstrap.md`
2. `memory_schema.json`
3. `direct_instructions_registry_patch.md`
4. `module_loader.md`
5. `prompt_router.md`

Supporting but secondary:
- runtime implementation files
- `http-generic-api/*`
- this `README.md`

If this README conflicts with canonicals, the canonicals win.

## Core execution model

The intended execution chain is:

1. `prompt_router`
2. `module_loader`
3. `system_bootstrap`
4. runtime tool or connector execution
5. governed logging and writeback
6. durable memory persistence through `memory_schema.json`

Execution is expected to be:
- governed
- registry-centered
- validation-first
- evidence-preserving

Execution without validation evidence is not considered complete.

## Architecture overview

### Canonical governance layer

The root canonical files define:
- routing expectations
- loading and readiness expectations
- activation and bootstrap rules
- hard enforcement constraints
- durable memory structure

These documents are the real architecture spine of the project.

### Memory schema layer

`memory_schema.json` is the persistent state contract root. It has been decomposed into 11 domain sub-schemas under `schemas/`, each referenced via JSON Schema `$ref`:

| Sub-schema | Domain |
|---|---|
| `shared` | Primitive types shared across domains |
| `business_identity` | Company, catalog, destinations, modules |
| `brand` | Brand context, identity, writing engine |
| `execution` | Runtime validation, activation, Google Workspace |
| `analytics` | Measurement, revenue signals, tracking bindings |
| `governance` | Schema state, drift detection, variable contracts |
| `repair_audit` | Repair memory, audit state, anomaly clusters |
| `routing_transport` | Routing context, HTTP transport, surface roles |
| `graph_addition` | Graph intelligence, governed addition pipeline |
| `operations` | System context, monitoring, writeback rules |
| `wordpress_api` | WordPress state, API inventory, credential resolution |

The root schema enforces `additionalProperties: false` and all 92 required fields. All 169 `$ref` values resolve with zero broken references.

### Registry-centered authority layer

Important governed surfaces include:
- `Registry Surfaces Catalog`
- `Validation & Repair Registry`
- `Task Routes`
- `Workflow Registry`
- `Actions Registry`
- `API Actions Endpoint Registry`
- `Execution Policy Registry`
- `Execution Log Unified`
- `JSON Asset Registry`
- `Brand Registry`
- `Hosting Account Registry`
- `Brand Core Registry`

Runtime behavior should prefer live registry truth over local assumptions, stale memory, or narrative summaries.

### Runtime implementation layer

The main runtime subtree currently visible is [`http-generic-api`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api>).

That subtree currently contains:
- the main route/orchestration runtime in `server.js`
- connector support modules
- governed registry and writeback helpers
- async job orchestration
- a modularized WordPress migration subsystem

### Connector and subsystem layer

`http-generic-api` is the clearest connector-style boundary in the repo today. It demonstrates:
- policy-enforced transport execution
- explicit connector-oriented boundaries
- registry-backed execution decisions
- governed logging and sink handling

Its WordPress subsystem is split into:
- shared helpers
- a top-level orchestrator in `wordpress/phaseA.js`
- phase modules `B` through `P` for governed migration domains

## Current repository status

The project has completed Sprint 2 (WordPress modular extraction), Sprint 3 (http-generic-api decomposition), and Sprint 4 (memory schema decomposition). The runtime and schema layer are both materially modular.

Current state:
- `http-generic-api/server.js` is decomposed — reduced from ~29,000 lines to ~4,636 lines; authority-based modules extracted
- `http-generic-api/wordpress/` — 16 phase modules (A–P), shared.js, index.js barrel (545 exports)
- `http-generic-api/normalization.js` — canonical normalization layer successfully implementing all A-H domains (Execution Intent, Policy State, Endpoint Identity, Route/Workflow State, Surface Classification, Mutation Intent, Execution Result, Sink Write Contract)
- `memory_schema.json` decomposed into 11 domain sub-schemas in `schemas/` (112 KB root + 276 KB sub-schemas; 83 `$defs`, 169 `$ref` all resolving)
- `http-generic-api/mutationGovernance.js`, `governedChangeControl.js`, `governedSheetWrites.js` — centralized mutation and writeback governance
- `http-generic-api/registryResolution.js`, `routeWorkflowGovernance.js`, `registryMutations.js` — registry-backed routing and execution control
- `http-generic-api/executionRouting.js` — isolated HTTP execution context resolution with dependency-injected guard chain
- `http-generic-api/auth.js` — Google OAuth scope resolution, policy enforcement, and resilience helpers; fully wired
- `http-generic-api/driveFileLoader.js` — schema and OAuth config loader with `supportsAllDrives: true` for shared-drive artifact reads
- governed sink handling for `Execution Log Unified` and `JSON Asset Registry` is stable
- 168 automated tests passing across 6 suites: utility, job runner, execution routing, connectors, WordPress, and route-level
- `/health` reports degraded dependency truth for Redis/BullMQ instead of assuming queue connectivity
- async job submission returns `503` when the queue backend cannot accept work (safely rejects to prevent job loss)
- runtime instances can run in API-only mode with `QUEUE_WORKER_ENABLED=FALSE`, or connect to Memorystore/Upstash/Hostinger Redis for background workers

## Upgrade direction

All 9 upgrade phases are complete. The project is in a production-ready, fully governed state.

Ongoing priorities:
- maintain canonical/runtime alignment on every change
- keep test coverage and architecture checks green
- treat deployment parity as a required verification step, not optional

## Documentation map

Primary documents:
- [`system_bootstrap.md`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/system_bootstrap.md>)
- [`memory_schema.json`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/memory_schema.json>) — root schema; domain sub-schemas in [`schemas/`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/schemas/>)
- [`direct_instructions_registry_patch.md`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/direct_instructions_registry_patch.md>)
- [`module_loader.md`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/module_loader.md>)
- [`prompt_router.md`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/prompt_router.md>)

Operations and validation:
- [`canonical_validation_checklist.md`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/canonical_validation_checklist.md>)
- [`runtime_boundary_map.md`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/runtime_boundary_map.md>)
- [`governed_mutation_playbook.md`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/governed_mutation_playbook.md>)
- [`connector_contracts.md`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/connector_contracts.md>)
- [`deployment_parity_checklist.md`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/deployment_parity_checklist.md>)
- [`runtime_confirmation_procedure.md`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/runtime_confirmation_procedure.md>)

Agent-facing guide:
- [`AI_Agent_Knowledge_Guide.md`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/AI_Agent_Knowledge_Guide.md>)

## Canonical editing workflow

The four root canonical markdown files are generated outputs with a `Domain Index` at the top. Edit the source files under [`canonicals/`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/canonicals/>) and rebuild the roots:

```powershell
node build-canonicals.mjs
```

To verify generated roots are current without rewriting them:

```powershell
node build-canonicals.mjs --check
```

Do not edit generated root canonical files directly unless the same change is also applied to the matching source file under `canonicals/`.

## Working rules for contributors and agents

- Read canonicals before proposing major runtime changes.
- Do not treat README text as authority when canonicals disagree.
- Preserve governed terminology and explicit status classification.
- Treat logging and writeback as part of execution, not afterthoughts.
- Prefer validation evidence over narrative certainty.
- Keep module boundaries explicit.
- Avoid bypassing the canonical chain with route-local improvisation.

## Immediate next implementation focus

All 9 upgrade phases are complete. The project is in a production-ready, fully governed state.

For ongoing operations:
- run `npm test` after every code change (168 tests across 6 suites)
- run `npm run validate` to check architecture invariants (104 checks)
- run `npm run verify` (with `RUNTIME_BASE_URL`) after every deployment — see [`runtime_confirmation_procedure.md`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/runtime_confirmation_procedure.md>)
- CI runs automatically on every push/PR (syntax → tests → architecture drift → export floor)

This repository should be approached as a governed operating model with executable runtime modules, not as a conventional app-first project.
