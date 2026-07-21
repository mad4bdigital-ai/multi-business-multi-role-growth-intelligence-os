# Implementation Plan: Database-Driven Operation Fabric

## Outcome

Deliver a registry-first control plane where callers invoke stable operation keys and the platform dynamically resolves the operation contract, steps, execution binding, adapter, capability authority, health, fallback, evidence, and projection. Replace caller-side orchestration with one durable operation runtime.

## Architecture layers

1. **Operation contract layer**
   - SQL authority for operation identity, scope, schemas, risk, lifecycle, and version.
   - Code-side contract registry remains a bootstrap/fallback validator during migration.

2. **Plan layer**
   - Versioned ordered steps with typed input mappings, success conditions, retry policy, and failure policy.
   - Immutable plan snapshot for every operation run.

3. **Dynamic binding layer**
   - Operation-to-adapter/runtime bindings with compatibility predicates, priority, fallback order, health, and capacity.
   - Hard constraints applied before preferences and scoring.

4. **Execution layer**
   - Registered code handlers and infrastructure adapters.
   - Real managed ephemeral Git worker for repository execution.
   - Existing GitHub REST, patch, local connector, CI, browser, workflow, and provider adapters remain independent bindings.

5. **Authority layer**
   - Just-in-time capability envelope lifecycle.
   - Existing approval, budget, credential, Tenant scope, concurrency, and readback kernels.

6. **Projection layer**
   - Compiler generates Admin/Tenant tool rows from active operation authority.
   - Tool registries become materialized projections with revision and rollback evidence.

7. **Evidence layer**
   - Durable operation, step, event, artifact, idempotency, worker lease, CI diagnosis, and projection revision records.

## Authority precedence

```text
platform safety
→ authenticated scope and Tenant membership
→ operation contract
→ capability and credential availability
→ operation-step contract
→ adapter/runtime compatibility
→ health and capacity
→ approval and budget
→ preference ranking
→ immutable plan snapshot
```

## Minimal registry set

New conceptual registries:

- `operation_registry`
- `operation_step_registry`
- `operation_execution_bindings`
- `execution_adapter_registry`
- `operation_tool_projections`
- `generated_artifact_registry`

Reuse existing surfaces for operation runs, step runs, capability envelopes, endpoint/tool registries, execution plans/events, approval, budget, connections, runtime health, and audit evidence.

## Delivery DAG

1. **D0 specification and current-state mapping**
   - Finalize contracts, reuse map, security boundaries, and acceptance gates.

2. **D1 registry foundation**
   - Add additive SQL registries, constraints, revisions, readback views, and seed the current high-level operations in shadow.

3. **D2 projection compiler**
   - Compile Admin tool projections, then Tenant projections with strict schema and manifest checks.
   - Keep generated rows disabled/shadow until parity evidence passes.

4. **D3 operation runtime cutover**
   - Load active operation contracts and steps from SQL.
   - Retain code fallback behind a kill switch.

5. **D4 managed Git worker**
   - Implement isolated checkout, merge/rebase policy, generated-artifact regeneration, validation, no-force push, and readback.

6. **D5 CI diagnosis and recovery**
   - Add run/job/step/log normalization, reason codes, recovery recipes, and bounded retry.

7. **D6 production projection and compatibility**
   - Enable Admin operation tools, then selected Tenant-safe tools.
   - Observe dual-read parity before retiring manual projections.

8. **D7 closeout**
   - CI, migration evidence, production parity, operation smokes, rollback drill, post-merge audit, and legacy retirement decision.

## Repository structure

```text
specs/011-database-driven-operation-fabric/
http-generic-api/
  operationOrchestrator.js
  operationContextService.js
  operationCapabilityLifecycleService.js
  managedGitWorkerLifecycleService.js
  application/operations/
  domain/operations/
  infrastructure/operations/
  scripts/operation-projection-compile.mjs
  scripts/operation-registry-validate.mjs
  migrations/
```

Exact implementation paths must follow current repository conventions and avoid catch-all files.

## Security boundary

- SQL stores no executable source and no credentials.
- Handlers are allowlisted by `handler_key` in code.
- Tenant identity is server-derived.
- Operation preferences cannot override hard constraints.
- Worker credentials are short-lived and scoped to one repository operation.
- Git writes require expected SHA, non-protected target, no-force update, readback, and audit.
- CI logs are normalized and redacted before persistence.
- Projection compiler refuses invalid, open, or missing Tenant schemas.

## Validation

- Schema and constraint tests.
- Contract/compiler determinism tests.
- Projection parity and rollback tests.
- Binding resolution and deny-wins tests.
- Worker isolation and conflict tests.
- CI diagnosis fixtures.
- Capability renewal and consumption tests.
- Operation resume/idempotency tests.
- Generated-artifact regeneration tests.
- Admin/Tenant listing and dispatch integration tests.
- Staging and production smoke evidence.
