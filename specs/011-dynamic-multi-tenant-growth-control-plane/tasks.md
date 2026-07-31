# Tasks

All tasks are implementation-pending unless marked complete. The Spec Kit itself does not activate runtime behavior.

## Phase A — Specification

- [x] T001 Define scope, goals, non-goals, actors, requirements and success criteria.
- [x] T002 Define architecture, independent graphs and stable/dynamic boundaries.
- [x] T003 Define logical data model and immutable versioning.
- [x] T004 Define Activity Packs, capabilities and workflow graphs.
- [x] T005 Define policy, provider, UI, event and rollout models.
- [x] T006 Define use cases, threats, risks, testing and observability.
- [ ] T007 Validate OpenAPI, JSON Schema, manifest, completion and inventory.
- [ ] T008 Complete Spec PR review and merge.

## Phase B — Authority and schema mapping

- [ ] T101 Run repository/DB census and map every logical resource to existing authority.
- [ ] T102 Define Admin/Tenant resource operation matrices and field allowlists.
- [ ] T103 Update affected canonicals and knowledge guide design references.
- [ ] T104 Design additive migrations, constraints, indexes and rollback.

## Phase C — Configuration control plane

- [ ] T201 Implement configuration definition/schema/version repositories.
- [ ] T202 Implement strict schema validation and bounded merge operators.
- [ ] T203 Implement deterministic effective resolver, lineage and revision vector.
- [ ] T204 Implement publish/rollback transaction and invalidation events.
- [x] T205 Add read-only Admin/Tenant APIs and OpenAPI operations.
- [x] T206 Add shadow parity comparison against existing behavior.

## Phase D — Activity Packs and brand bindings

- [x] T301 Implement Activity Pack manifest and compatibility validation.
- [x] T302 Implement brand activity binding lifecycle and readiness.
- [x] T303 Create travel reference pack from governed pointers and schemas.
- [x] T304 Add multi-activity ambiguity and isolation tests.

## Phase E — Plan composition

- [x] T401 Integrate semantic capability resolution from Spec 007.
- [x] T402 Compile immutable workflow DAGs on Spec 006 runtime contracts.
- [x] T403 Persist plan/config/policy/version snapshots and hashes.
- [x] T404 Create explicit approval holds for provider-effect nodes.
- [x] T405 Implement internal-only reference workflow and readback.

## Phase F — Policy, resources and providers

- [ ] T501 Implement bounded policy compiler and approval profiles.
- [ ] T502 Enforce final-boundary capability/resource/approval/certification checks.
- [ ] T503 Implement adapter registry, ranking, readiness and tie blocking.
- [ ] T504 Implement unknown/partial effect reconciliation and rollback contracts.
- [ ] T505 Add idempotency, lease and outbox integration tests.

## Phase G — UI, events, analytics and operations

- [ ] T601 Implement schema/manifest-driven Admin forms and diff/lineage views.
- [ ] T602 Implement Tenant-safe views with role/field allowlists.
- [ ] T603 Implement typed event schemas, outbox consumers and invalidation.
- [ ] T604 Implement KPI definition/mapping and portfolio projections.
- [ ] T605 Implement SLO metrics, traces, dashboards, alerts and reconciliation.

## Phase H — Rollout

- [ ] T701 Complete migration dry-run/apply/readback in dev.
- [ ] T702 Meet shadow sample and mismatch thresholds.
- [ ] T703 Run internal-only pilot and approve readback.
- [ ] T704 Run staging provider cohort with rollback.
- [ ] T705 Run production canary with typed approval.
- [ ] T706 Verify production parity and post-merge audit.
- [ ] T707 Update `completion.json`, canonicals, OpenAPI and knowledge guide.

## Cross-cutting gates

- [ ] G001 Cross-tenant and cross-brand isolation passes.
- [ ] G002 No-secret scans pass.
- [ ] G003 Architecture boundaries pass.
- [ ] G004 Active versions are immutable and rollback tested.
- [ ] G005 Unknown provider effect never blind-retries.
- [ ] G006 Required readback exists for every mutation.
