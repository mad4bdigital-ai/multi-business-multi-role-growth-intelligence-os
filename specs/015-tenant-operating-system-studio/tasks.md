# Dependency-Ordered Tasks

No runtime task is complete in this specification PR. Completed Phase 0 items below are specification/convergence work only. T006/T008 closure records owner decisions only and does not claim cutover, persistence implementation, migration, deployment, provider effects, or Production verification.

## Phase 0 — Convergence and classification

- [x] T001 Validate this Spec Kit and all contracts in CI.
- [x] T002 Inventory current-main Spec 006/010/011/012, Dynamic Container Authority, MCP, tool-catalog, operation, and external-surface implementations. Evidence: `docs/spec-portfolio/spec015-current-main-authority-reuse-matrix-20260906.{md,json}` at exact `main` SHA `0faee775cd0572b737fed8bc74e2580d9fca2878`; this closes repository-inventory evidence only.
- [x] T003 Produce field-level reuse matrix for package/component/installation/tool/external-surface logical entities. Evidence uses `reuse_exact`, `reuse_with_extension`, `compatibility_only`, `projection_only`, `gap_requires_owner_decision`, and `retire_after_cutover`; no concrete new persistence is approved by this task closure.
- [x] T004 Inventory PR #3922 and classify generic substrate versus Retail Commerce child-pack content.
- [x] T005 Inventory PR #4432 and classify generic assurance template versus Evidence Intelligence child-pack content.
- [x] T006 Resolve duplicate numeric Spec identities 011 and 014, the duplicate `013-system-tool-catalog-v2` feature cluster, historical capability-authority aliases, legacy `actions` semantics, and approve canonical semantic target paths. Owner approval recorded 2026-09-06; `cutover_executed=false`, physical rename is not authorized, and capability cutover still requires shadow parity and rollback proof.
- [x] T007 Update Work Map and schema-domain classification.
- [x] T008 Approve architecture, product, security, privacy, agency/client ownership, portability, tool-catalog, external-integration, package-authority-extension, component-gap, installation-revision, and reference-first runtime-manifest decisions for Phase 1. Owner approval recorded 2026-09-06; bounded implementation PR design is authorized, while `runtime_mutation_authorized=false` and every implementation candidate still requires external SHA-bound exact-head attestation.
- [x] T009 Inventory and classify all 34 observed open Draft PRs as 12 primary Specs or 22 related delivery/repair PRs, including divergence, trains, overlaps, truthfulness findings, and dispositions.

## Phase 1 — Package/component foundation

- [ ] T010 Define package/component canonical resource types and capabilities using the approved T006/T008 decisions; `platform_private_packages`, `platform_package_versions`, canonical shared asset tables, and `tenant_package_installs` are mandatory reuse inputs.
- [ ] T011 Map package definitions/versions to existing asset authorities. No wholesale `solution_package_*` persistence is authorized; any additive persistence requires a proven semantic gap, bounded schema review, compatibility path, and exact-head evidence.
- [ ] T012 Implement package publication policy model.
- [ ] T013 Implement component definition/version registry or exact existing mapping. Any generic component registry must reference canonical source assets rather than duplicate Agent/Skill/Workflow/Policy payloads.
- [ ] T014 Implement package-component bindings and dependency graph.
- [ ] T015 Add strict schema, no-secret, provenance, cycle, compatibility, and lifecycle validators.
- [ ] T016 Add read-only Admin/Tenant package/component catalog APIs.
- [ ] T017 Add tenant-safe list/get/search/changes/revisions/readback descriptors.
- [ ] T018 Add unit/contract/security tests for package and component registries.

## Phase 2 — Installation compiler

- [ ] T020 Implement installation identity and exact target scope by extending/bridging `tenant_package_installs`; do not create a competing live installation authority.
- [ ] T021 Implement sparse overrides and bounded extensions; legacy JSON fields remain compatibility inputs and never become grant/policy authority.
- [ ] T022 Implement resource/connection/role/policy requirement bindings without credentials or copied grants.
- [ ] T023 Implement deterministic package compiler.
- [ ] T024 Integrate Effective Business Profile and existing Growth Control Plane Activity Pack applicability.
- [ ] T025 Persist immutable installation revisions, lineage, conflicts, revision vector, and context hash only after a concrete storage gap is proven and reviewed; keep the active installation pointer single-authority.
- [ ] T026 Implement impact preview and readiness/gap projection.
- [ ] T027 Add stale, ambiguity, wrong-scope, conflict, copied-authority, and deterministic-hash tests.

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

## Phase 5 — AI, UI, reports, and external projections

- [ ] T050 Implement draft-only AI package authoring service.
- [ ] T051 Implement AI use-case component definitions and provider abstraction bindings.
- [ ] T052 Add structured output, semantic validation, sensitivity, budget, safety, and fallback gates. Package/Skill model requirements are eligibility requirements, never raw ungoverned provider authority.
- [ ] T053 Implement UI surface component definitions.
- [ ] T054 Integrate generated surfaces with unified frontend dispatch and Resource/Application services.
- [ ] T055 Implement report definitions, audience allowlists, redaction, and delivery-policy refs.
- [ ] T056 Add prompt-injection, authority-invention, field/action visibility, accessibility, localization, focused tool projection, and external-surface authorization tests.

## Phase 6 — Publication and installation lifecycle

- [ ] T060 Implement private/tenant/shared/curated publication states.
- [ ] T061 Implement planned/installing/configuration/validation/ready/active lifecycle.
- [ ] T062 Implement sandbox/sample data and canonical acceptance evidence.
- [ ] T063 Implement fresh-authority activation with compare-and-set and readback; Installation Revision or Effective Runtime Manifest never substitutes current mutation-frontier authority.
- [ ] T064 Implement three-way upgrade comparison and migration planning.
- [ ] T065 Implement rollback, suspend, archive, uninstall-request, deprecation, and retirement.
- [ ] T066 Add exact-candidate, stale-evidence, upgrade-conflict, rollback, disable/revocation, and continuity tests.

## Phase 7 — Agency/client operating models

- [ ] T070 Productize clients-as-Brands installation journey.
- [ ] T071 Productize client-owned Tenant with delegated agency operation.
- [ ] T072 Implement bounded delegation lifecycle and revocation readback.
- [ ] T073 Implement portfolio-safe summary projections.
- [ ] T074 Implement export manifests and handover cases.
- [ ] T075 Implement package IP, installation, data, file, connection, external exposure, and deliverable ownership matrix.
- [ ] T076 Add cross-Brand, cross-Tenant, revoked-delegation, external-connection revocation, portability, and post-handover continuity tests.

## Phase 8 — Candidate PR extraction and related subsystem convergence

- [ ] T080 Reconstruct generic Business Profile/Activity/Blueprint substrate from PR #3922 on current main.
- [ ] T081 Reconstruct Retail Commerce child package from PR #3922.
- [ ] T082 Reconstruct one generic repository delivery/development/CI assurance subsystem from PRs #2284, #2949, and #4432, and one canonical System Tool Catalog v2 from #3139/#3145/#3159. Callable technical primitives must converge on canonical Operation semantics; legacy `actions` naming follows the approved compatibility disposition.
- [ ] T083 Reconstruct Evidence Intelligence child package from PR #4432.
- [ ] T084 Reconstruct Hostinger Storage and Local Connector Recovery as bounded services or reference packages from PRs #4386 and #2385.
- [ ] T085 Validate all four package/service targets, Content Intelligence fitness case, Operation Fabric integration, System Tool Catalog projection, Spec 016 external exposure contract, canonical paths, and absence of duplicate identities or stale copied artifacts.

## Phase 9 — Pilot and closeout

- [ ] T090 Pilot individual freelancer authoring and installation.
- [ ] T091 Pilot one agency with two client Brands and distinct connections/overrides.
- [ ] T092 Pilot client-owned Tenant delegation and agency revocation.
- [ ] T093 Run Evidence Intelligence Pack end-to-end.
- [ ] T094 Run Retail Commerce Pack in sandbox/staging scope.
- [ ] T095 Run load, recovery, backup/restore, provider outage, manual fallback, MCP read-only Developer mode, disable, and revocation tests.
- [ ] T096 Verify production migration/runtime/generated-and-external-surface/health/rollback evidence separately.
- [ ] T097 Update runbooks, documentation, training, Work Map, portfolio registry, manifest, and completion state.

## Completion rule

Tasks may be marked implemented only with exact change evidence. T002/T003 completion means repository-inventory/reuse evidence is complete for the recorded current-main SHA. T006/T008 completion means the documented owner decisions are approved; it does **not** mean runtime cutover, a concrete persistence migration, deployment, provider effect, or Production verification has occurred. Verified and closed require the additional test, runtime, migration, deployment, readback, external-integration, and operational evidence declared by the task and acceptance matrix. A merged Spec or green documentation workflow is not runtime completion.
