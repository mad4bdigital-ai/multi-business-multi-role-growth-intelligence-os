# AI Agent Knowledge Guide
**Repository:** Multi-Business-Multi-Role-Growth-Intelligence-OS

## Purpose
This document is an agent-facing knowledge summary for working inside this repository.
It translates the canonical architecture into an operational guide for AI agents, orchestrators, and governed automation layers.

## 1. Canonical authority order
Agents should treat these files as the primary knowledge sources, in this order:

1. `system_bootstrap.md`
2. `memory_schema.json`
3. `direct_instructions_registry_patch.md`
4. `module_loader.md`
5. `prompt_router.md`

### Supporting but secondary
- `server.js`
- `http-generic-api/*`
- `README.md`

`README.md` is not the authoritative architectural source unless aligned with the canonicals.

### Canonical source workflow

The four root canonical markdown files are lightweight generated indexes:
- `system_bootstrap.md`
- `direct_instructions_registry_patch.md`
- `module_loader.md`
- `prompt_router.md`

Agents should edit the matching source files under `canonicals/`, then run:

```powershell
node build-canonicals.mjs
```

Before completing canonical edits, verify generated roots are current:

```powershell
node build-canonicals.mjs --check
```

Do not edit generated root canonical files directly. The authoritative canonical body lives in the matching `canonicals/` source file.

## 2. Core execution model
The architecture is governed, registry-driven, and validation-first.

### Required execution chain
All meaningful execution should conceptually follow:
- `prompt_router`
- `module_loader`
- `system_bootstrap`
- runtime tool / connector execution
- governed logging + writeback
- memory persistence through `memory_schema.json`

### No-bypass rule
Agents should not bypass the canonical chain with ad hoc reasoning or direct execution assumptions.

## 3. What each canonical does

### `system_bootstrap.md`
Primary execution authority.

Use it for:
- activation behavior
- tool-first execution rules
- live validation requirements
- writeback and logging expectations
- degraded vs validating vs active state classification

### `memory_schema.json`
Persistent state contract (root of a decomposed schema set).

Use it for:
- durable execution memory
- state field shape
- structured persistence expectations

Domain sub-schemas live in `schemas/` and are referenced via `$ref` from the root.
Sub-schemas: `shared`, `business_identity`, `brand`, `execution`, `analytics`,
`governance`, `logic_knowledge`, `repair_audit`, `routing_transport`, `graph_addition`, `operations`, `wordpress_api`.

After memory schema changes, run `node validate-memory-schema.mjs`.

### `direct_instructions_registry_patch.md`
Hard enforcement patch layer.

Use it for:
- direct overrides
- authority constraints
- non-negotiable runtime behaviors

### `module_loader.md`
Preparation and dependency wiring layer.

Use it for:
- loading target modules
- preparing validation targets
- same-cycle retry context
- execution mode preparation

### `prompt_router.md`
Intent and route selection layer.

Use it for:
- mapping user intent to flows
- activation routing
- preventing invalid routing shortcuts

## 4. Activation model
Activation is not considered complete unless the required execution and validation conditions are met.

Agents should assume activation requires:
- canonical loading
- at least one real native Google API attempt when available
- live validation
- registry validation
- execution evidence

Narrative-only activation is not a valid activation outcome.

## 5. Registry-centered architecture
Important registry families include:
- Registry Surfaces Catalog
- Validation & Repair Registry
- Task Routes
- Workflow Registry
- Actions Registry
- API Actions Endpoint Registry
- Execution Policy Registry
- Execution Log Unified
- JSON Asset Registry

When making execution decisions, agents should prefer live registry truth over:
- prior turns
- conversational assumptions
- local summaries
- stale memory

## 6. Logging and evidence
Important sinks:
- `Execution Log Unified`
- `JSON Asset Registry`

Execution should preserve:
- execution trace id
- route / workflow context
- status classification
- output summary
- mutation evidence where relevant

`Execution Log Unified` is a special governed sink and may require special duplicate-handling behavior.

## 7. Mutation governance
Agents should assume:
- live header reads are required before writes
- relevant existing row windows may be required
- duplicate/equivalence checks may apply
- mutation evidence may be required
- postwrite validation or readback may be required

Do not assume a write is safe merely because the intended value looks correct.

## 8. Connector model
The repo includes a root runtime and a connector subtree.

### `http-generic-api`
This is the clearest connector-style boundary currently visible.

Key modules and their authority domains:
- `server.js` (~4,636 lines) - orchestration and route handlers only
- `executionRouting.js` - HTTP execution context resolution, guard chain, transport/native routing classification
- `auth.js` - Google OAuth scope resolution, policy enforcement, resilience and retry mutation helpers
- `normalization.js` - canonical normalization layer successfully implementing all A-H domains
- `mutationGovernance.js` / `governedChangeControl.js` - mutation classification, duplicate detection, exemption rules
- `jobRunner.js` / `jobUtils.js` - async job dispatch and lifecycle management
- `authInjection.js` / `authCredentialResolution.js` - credential resolution and auth header injection
- `driveFileLoader.js` - Drive-backed schema and OAuth config loading (`supportsAllDrives: true`)
- `github.js` / `hostinger.js` - narrow connector entrypoints (2 exports each)
- `wordpress/` - 16 phase modules (A-P) for governed site migration

Use it as a pattern for:
- policy-enforced transport execution
- explicit module boundaries
- provider-specific dispatch
- reduced hidden runtime coupling

## 9. Documentation trust model
High trust:
- canonicals
- validated runtime modules
- explicit registry-backed logic

Medium trust:
- connector readmes
- implementation summaries

Low trust until aligned:
- generic public architecture text in `README.md`

## 10. Recommended agent behavior
An AI agent operating in this repository should:
- read canonicals before proposing major runtime changes
- avoid treating README as sole source of truth
- preserve governed terminology
- prefer validation over explanation
- prefer registry truth over memory
- classify uncertainty explicitly
- avoid inventing unsupported policy semantics
- keep module boundaries explicit
- treat logging and writeback as part of execution

## 11. Upgrade priorities for agents
Prioritize:
1. canonical/runtime alignment
2. documentation alignment
3. module boundary cleanup
4. policy normalization
5. test coverage
6. monolith decomposition by authority boundary complete (schema layer complete - `memory_schema.json` -> 12 domain sub-schemas in `schemas/`)

## 12. Current documentation status

All previously suggested docs now exist:
- `canonical_validation_checklist.md` complete
- `runtime_boundary_map.md` complete
- `governed_mutation_playbook.md` complete
- `connector_contracts.md` complete
- `deployment_parity_checklist.md` complete
- `runtime_confirmation_procedure.md` complete

Schema layer:
- `memory_schema.json` - root schema (~41 KB, 123 properties, 92 required)
- `schemas/` - 12 domain sub-schemas, including `logic_knowledge.schema.json`
  - `shared`, `business_identity`, `brand`, `execution`, `analytics`, `governance`,
    `logic_knowledge`, `repair_audit`, `routing_transport`, `graph_addition`, `operations`, `wordpress_api`

Test and validation baselines (as of 2026-04-26):
- 200 automated tests across 8 suites (`npm test` from `http-generic-api/`)
- architecture checks via `npm run validate` from `http-generic-api/`
- memory schema `$ref` checks via `node validate-memory-schema.mjs`
- CI enforces canonical generated-output checks, memory schema reference checks, syntax, tests, drift detection, export floors on every push

## 13. Short operational summary
If you are an AI agent working in this repo:
- the canonicals are the real architecture
- routing, loading, bootstrap, validation, and logging are governed
- registry truth outranks assumptions
- execution without evidence is not enough
- documentation should be aligned with canonicals before large refactors
