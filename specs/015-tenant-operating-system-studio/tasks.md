# Dependency-Ordered Tasks

No runtime task is complete in this specification PR.

## Phase 0 — Convergence and classification

- [ ] T001 Validate this Spec Kit and all contracts in CI.
- [ ] T002 Inventory current-main Spec 006/010/011/012 and Dynamic Container Authority implementations.
- [ ] T003 Produce field-level reuse matrix for package/component/installation logical entities.
- [ ] T004 Inventory PR #3922 and classify generic substrate versus Retail Commerce child-pack content.
- [ ] T005 Inventory PR #4432 and classify generic assurance template versus Evidence Intelligence child-pack content.
- [ ] T006 Resolve duplicate Spec 014 identities and canonical target paths.
- [ ] T007 Update Work Map and schema-domain classification.
- [ ] T008 Approve architecture, product, security, privacy, agency/client ownership, and portability decisions for Phase 1.

## Phase 1 — Package/component foundation

- [ ] T010 Define package/component canonical resource types and capabilities.
- [ ] T011 Map package definitions/versions to existing asset authorities.
- [ ] T012 Implement package publication policy model.
- [ ] T013 Implement component definition/version registry or exact existing mapping.
- [ ] T014 Implement package-component bindings and dependency graph.
- [ ] T015 Add strict schema, no-secret, provenance, cycle, compatibility, and lifecycle validators.
- [ ] T016 Add read-only Admin/Tenant package/component catalog APIs.
- [ ] T017 Add tenant-safe list/get/search/changes/revisions/readback descriptors.
- [ ] T018 Add unit/contract/security tests for package and component registries.

## Phase 2 — Installation compiler

- [ ] T020 Implement installation identity and exact target scope.
- [ ] T021 Implement sparse overrides and bounded extensions.
- [ ] T022 Implement resource/connection/role/policy requirement bindings without credentials.
- [ ] T023 Implement deterministic package compiler.
- [ ] T024 Integrate Effective Business Profile and Activity Pack applicability.
- [ ] T025 Persist immutable installation revisions, lineage, conflicts, revision vector, and context hash.
- [ ] T026 Implement impact preview and readiness/gap projection.
- [ ] T027 Add stale, ambiguity, wrong-scope, conflict, and deterministic-hash tests.

## Phase 3 — Entities, relationships, and lifecycles

- [ ] T030 Select approved custom-entity persistence strategy.
- [ ] T031 Implement entity type/field/relationship definition components.
- [ ] T032 Implement schema compatibility and migration preview.
- [ ] T033 Implement lifecycle definitions/states/transitions using stable runtime primitives.
- [ ] T034 Implement bounded transition guards and effect bindings.
- [ ] T035 Implement SLA/timer/event/approval/compensation definitions.
- [ ] T036 Add entity, relationship, lifecycle, optimistic-lock, invalid-transition, and migration tests.

## Phase 4 — Forms, surveys, files, and client links

- [ ] T040 Implement form definitions, versions, sections, fields, branching, and dynamic options.
- [ ] T041 Implement prefill, bounded client-link identity, receipts, and idempotent submissions.
- [ ] T042 Implement form-to-entity/workflow/capability handler bindings.
- [ ] T043 Implement package file-policy definitions over existing file authorities.
- [ ] T044 Implement folder template, naming, routing, sharing, retention, quarantine, duplicate, and recovery contracts.
- [ ] T045 Add mobile, Arabic RTL, accessibility, replay, copied-link, cross-client, and file-isolation tests.

## Phase 5 — AI, UI, and reports

- [ ] T050 Implement draft-only AI package authoring service.
- [ ] T051 Implement AI use-case component definitions and provider abstraction bindings.
- [ ] T052 Add structured output, semantic validation, sensitivity, budget, safety, and fallback gates.
- [ ] T053 Implement UI surface component definitions.
- [ ] T054 Integrate generated surfaces with unified frontend dispatch and Resource/Application services.
- [ ] T055 Implement report definitions, audience allowlists, redaction, and delivery-policy refs.
- [ ] T056 Add prompt-injection, authority-invention, field/action visibility, accessibility, and localization tests.

## Phase 6 — Publication and installation lifecycle

- [ ] T060 Implement private/tenant/shared/curated publication states.
- [ ] T061 Implement planned/installing/configuration/validation/ready/active lifecycle.
- [ ] T062 Implement sandbox/sample data and canonical acceptance evidence.
- [ ] T063 Implement fresh-authority activation with compare-and-set and readback.
- [ ] T064 Implement three-way upgrade comparison and migration planning.
- [ ] T065 Implement rollback, suspend, archive, uninstall-request, deprecation, and retirement.
- [ ] T066 Add exact-candidate, stale-evidence, upgrade-conflict, rollback, and continuity tests.

## Phase 7 — Agency/client operating models

- [ ] T070 Productize clients-as-Brands installation journey.
- [ ] T071 Productize client-owned Tenant with delegated agency operation.
- [ ] T072 Implement bounded delegation lifecycle and revocation readback.
- [ ] T073 Implement portfolio-safe summary projections.
- [ ] T074 Implement export manifests and handover cases.
- [ ] T075 Implement package IP, installation, data, file, connection, and deliverable ownership matrix.
- [ ] T076 Add cross-Brand, cross-Tenant, revoked-delegation, portability, and post-handover continuity tests.

## Phase 8 — Candidate PR extraction and reference packs

- [ ] T080 Reconstruct generic Business Profile/Activity/Blueprint substrate from PR #3922 on current main.
- [ ] T081 Reconstruct Retail Commerce child package from PR #3922.
- [ ] T082 Reconstruct generic development/CI assurance template from PR #4432.
- [ ] T083 Reconstruct Evidence Intelligence child package from PR #4432.
- [ ] T084 Validate both packages against Spec 015 contracts.
- [ ] T085 Confirm no duplicate Spec identity, stale base, or copied generated artifact remains.

## Phase 9 — Pilot and closeout

- [ ] T090 Pilot individual freelancer authoring and installation.
- [ ] T091 Pilot one agency with two client Brands and distinct connections/overrides.
- [ ] T092 Pilot client-owned Tenant delegation and agency revocation.
- [ ] T093 Run Evidence Intelligence Pack end-to-end.
- [ ] T094 Run Retail Commerce Pack in sandbox/staging scope.
- [ ] T095 Run load, recovery, backup/restore, provider outage, and manual fallback tests.
- [ ] T096 Verify production migration/runtime/surface/health/rollback evidence separately.
- [ ] T097 Update runbooks, documentation, training, Work Map, manifest, and completion state.

## Completion rule

Tasks may be marked implemented only with exact change evidence. Verified and closed require the additional test, runtime, migration, deployment, readback, and operational evidence declared by the task and acceptance matrix. A merged Spec or green documentation workflow is not runtime completion.