# Tasks: Database-Driven Operation Fabric

## Specification

- [x] T001 Record the current platform gap: high-level operation code exists but tool projection and real Git execution remain incomplete.
- [x] T002 Define registry-first authority and projection boundaries.
- [x] T003 Define dynamic binding, capability, health, fallback, and preference resolution.
- [x] T004 Define real managed Git worker and generated-artifact reconciliation contracts.
- [x] T005 Define CI diagnosis, migration, rollout, acceptance, and risk contracts.
- [x] T006 State that the specification branch performs no runtime, migration, provider, credential, deployment, or production mutation.

## D1 registry foundation

- [ ] T100 Add `operation_registry` with version, scope, risk, schema references, lifecycle, and status.
- [ ] T101 Add `operation_step_registry` with ordering, handler key, mappings, success, retry, and failure policy.
- [ ] T102 Add `operation_execution_bindings` and compatibility predicates.
- [ ] T103 Add `execution_adapter_registry` and health/capacity references.
- [ ] T104 Add `operation_tool_projections` and generated projection revisions.
- [ ] T105 Add `generated_artifact_registry`.
- [ ] T106 Add constraints, indexes, readback views, lifecycle timestamps, and no-secret metadata.
- [ ] T107 Seed current operation keys in shadow state.
- [ ] T108 Add migration ledger, rollback/disable path, and documentation updates.

## D2 projection compiler

- [ ] T200 Implement deterministic operation-to-tool projection compiler.
- [ ] T201 Join operation, endpoint, schema, manifest, auth, policy, binding, and readiness evidence.
- [ ] T202 Generate Admin projections in shadow and compare with current tool registry.
- [ ] T203 Generate Tenant projections with strict top-level JSON Schema and capability-manifest guards.
- [ ] T204 Add revision digest, source fingerprint, rollback pointer, and cache-version update.
- [ ] T205 Add projection lint, drift check, and duplicate/conflict rejection.
- [ ] T206 Add readback proving listed and directly dispatched tools use identical authority.

## D3 operation runtime

- [ ] T300 Load operation contracts and steps from SQL with bounded cache and revision invalidation.
- [ ] T301 Retain code fallback behind a kill switch during migration.
- [ ] T302 Persist immutable contract, step, binding, policy, and schema revisions per run.
- [ ] T303 Implement operation-scoped capability acquisition, renewal, consumption, and failure handling.
- [ ] T304 Implement transparent chunk collection and bounded detail references.
- [ ] T305 Implement durable status, resume, approval, callback, cancellation, and recovery.
- [ ] T306 Add idempotency receipts and same-cycle readback for writes.

## D4 dynamic binding

- [ ] T400 Implement eligibility filtering and hard constraints.
- [ ] T401 Implement health, capacity, cost, reliability, and preference scoring.
- [ ] T402 Implement bounded ordered fallback with typed exclusions.
- [ ] T403 Add adapter/runtime kill switches.
- [ ] T404 Add resolver explain output and candidate evidence.
- [ ] T405 Add negative tests proving preferences do not create authority.

## D5 managed Git worker

- [ ] T500 Replace virtual lease-only behavior with an isolated ephemeral checkout executor.
- [ ] T501 Implement short-lived repository credential binding.
- [ ] T502 Implement fetch, checkout expected SHA, merge/rebase policy, validation, commit, push, and readback.
- [ ] T503 Implement conflict classification and generated-artifact regeneration.
- [ ] T504 Enforce no force-push and protected-branch denial.
- [ ] T505 Add resource/time/file-size budgets and cleanup.
- [ ] T506 Add interruption checkpoint and deterministic resume.
- [ ] T507 Add integration tests for behind-only, diverged, conflicts, moved main, and generated files.

## D6 CI diagnosis

- [ ] T600 Resolve check run, workflow run, job, and failing step.
- [ ] T601 Normalize logs and annotations into bounded reason codes.
- [ ] T602 Persist affected paths, command class, retryability, and safe recovery action.
- [ ] T603 Add recovery recipes for branch freshness, generated drift, transient infrastructure, and deterministic test failures.
- [ ] T604 Require readback before rerunning any check after a possible write.

## D7 rollout

- [ ] T700 Enable Admin operation tools for internal pilot.
- [ ] T701 Run dual-read parity against current direct tools.
- [ ] T702 Enable selected Tenant-safe operation tools.
- [ ] T703 Exercise projection rollback and operation kill switches.
- [ ] T704 Deploy latest `main` and prove production SHA parity.
- [ ] T705 Run positive, negative, resilience, and security smokes.
- [ ] T706 Complete post-merge audit and legacy retirement decision.

## Completion governance

- [x] T800 Use multi-PR delivery.
- [ ] T801 Record implementation PRs and merge SHAs.
- [ ] T802 Record migration ledger and readback evidence.
- [ ] T803 Record CI, staging, and production parity evidence.
- [ ] T804 Record rollback drill and post-merge audit.
