# Tasks

## Design and governance

- [x] Define shared-by-default assets.
- [x] Remove automatic tenant-copy assumption.
- [x] Separate runtime composition from asset variants.
- [x] Define tenant/workspace/brand/activity/role/user layers.
- [x] Define guarded union, strict intersection, and typed operators.
- [x] Define optional user/role/workspace/brand/activity/tenant variants.
- [x] Define personalization as ranking/narrowing, not authority.
- [x] Define governed adaptive proposal and experiment loop.
- [x] Document current code and database evidence.
- [x] Add current and target relationship diagrams.
- [ ] Approve terminology and frozen decisions.
- [x] Approve layered purpose-bound privacy, consent, retention, residency, model/provider data-use, derived-data disposition, and aggregate-learning governance.

## Repository continuity

- [x] Preserve and repair the current PR branch.
- [x] Run branch reconciliation and confirm zero file overlap.
- [x] Use governed stale-branch patch without force-push.
- [x] Merge latest `main` into the current branch with a signed no-force merge commit.
- [x] Verify branch state is `ahead_only` with `behind_by=0`.
- [x] Run required CI checks successfully after reconciliation.
- [x] Re-run final CI after the last documentation evidence commit.
- [x] Verify final tree scope and generated docs for the DFR-003 design update; merge remains separately unauthorized.

## Deep design

- [x] Define aggregate boundaries, identities, invariants, state machines, and transaction boundaries.
- [x] Add constrained policy DSL examples and deterministic resolution cases.
- [x] Add tenant/user journeys and progressive disclosure.
- [x] Define adaptive scoring, confidence, calibration, and promotion thresholds.
- [x] Add threat model, abuse cases, and security acceptance gates.
- [x] Add SLOs, metrics, tracing, alerting, dashboards, and runbook requirements.
- [x] Add migration lanes, backfills, compatibility modes, parity classes, cutover units, and rollback hierarchy.
- [x] Add governance roles, decision rights, delegation, approval routing, and review cadence.
- [x] Add platform growth flywheel, maturity states, opportunity detection, and growth debt.

## Extended platform planes

- [x] Complete live code/database gap analysis for identity, tenant lifecycle, privacy, FinOps, models, async consistency, provenance, temporal/environment semantics, supply chain, portability, resilience, human operations, capability ontology, localization, and quality drift.
- [x] Add the fourteen-plane target architecture and revised Design Freeze gate.
- [x] Add FR-031 through FR-060 to the core specification.
- [x] Add proposed authority-plane data structures and reuse boundaries.
- [ ] Approve principal/group/service identity and delegation authority.
- [ ] Approve tenant federation, ownership transfer, offboarding, export, legal hold, and erasure lifecycle.
- [x] Approve data-purpose, consent/lawful-basis, classification, retention, residency/transfer, jurisdiction, legal-hold, privacy-request, derived-data, provider/model, and aggregate-learning rules.
- [ ] Approve commercial entitlement, cost estimate, reservation, settlement, refund, and attribution contract.
- [ ] Approve contextual model routing, fallback constraints, evaluation suites, and quality thresholds.
- [ ] Approve universal operation, outbox/inbox, delivery, cancellation, compensation, and concurrency contract.
- [ ] Approve artifact/knowledge provenance, verification, correction, retraction, and disposition schema.
- [ ] Approve unified temporal `as_of`, environment, region, and jurisdiction semantics.
- [ ] Approve plugin/package publisher, signing, SBOM, vulnerability, license, update, and revocation policy.
- [ ] Approve compatibility registry, tenant portability, disaster integration, human SLA, and capability ontology.
- [ ] Define initial quality, fairness, calibration, and cross-tenant aggregate-learning gates.

## Canonical alignment

- [ ] Add ADRs for shared assets, typed policy algebra, personalization boundaries, and adaptive promotion.
- [ ] Update `AI_Agent_Knowledge_Guide.md`.
- [ ] Update `system_bootstrap.md`.
- [ ] Update `memory_schema.json`.
- [ ] Update `direct_instructions_registry_patch.md`.
- [ ] Update `module_loader.md` and `prompt_router.md`.
- [ ] Update canonicals and run `node build-canonicals.mjs`.

## Dynamic Blueprint and Layer Inheritance

- [x] Approve Business-Type Blueprint inheritance as a generic platform model.
- [x] Place Departments under Brands and Groups under Departments.
- [x] Generalize inheritance to Roles, members, AI Agents, Business Activities, knowledge, Skills, Workflows, Policies, Apps, Tools, Graphs, Engines, Logic, and future layer families.
- [x] Define specialized canonical tables plus generic type/relationship/closure/inheritance/provenance authorities.
- [x] Define primary/secondary Business-Type bindings and per-layer inheritance profiles.
- [x] Define no-copy shared-resource references and Brand-scoped organizational/profile instances.
- [x] Define multi-Business-Type merge semantics, equivalence, supersession, conflict, pin, upgrade, rebase, and revocation.
- [x] Define Blueprint and instance acceptance scenarios, APIs, provenance, version vectors, and rollout stages.
- [ ] Approve the initial registered layer-type list and allowed parent/child relationships.
- [ ] Approve the first pilot Business Type and Brand.
- [ ] Approve required/recommended/optional Blueprint adoption rules.
- [ ] Approve Brand inheritance profile settings schema and Platform/Tenant hard bounds.
- [ ] Approve Brand Department/Group/Role/member/Agent specialized schemas.
- [ ] Approve equivalence, conflict, replacement, and supersession governance.
- [ ] Approve Blueprint publisher, certification, upgrade-channel, and security-revocation policy.
- [ ] Implement read-only Blueprint registry diagnostics.
- [ ] Implement inheritance preview with no mutations or provider calls.
- [ ] Implement transactional Brand layer-instance apply and readback.
- [ ] Implement upgrade, pin, rebase, conflict, removal, and disposition lifecycle.
- [ ] Prove inherited shared assets are referenced and never automatically copied.

## Scoped member invitation and active contexts

- [x] Approve identity-first, scope-aware Google/email invitation onboarding.
- [x] Decide that accepting an invitation never creates a new Tenant or personal workspace automatically.
- [x] Define one global user identity with multiple Tenant memberships and optional isolated personal account/workspace.
- [x] Define exact Brand/Workspace/Department/Group/Role/resource invitation scopes and minimal base Tenant membership.
- [x] Define invitation token hashing, single use, expiry, revoke, outbox delivery, immutable scope checksum, and transactional readback.
- [x] Define existing/new user, stronger-role, duplicate acceptance, and conflicting-assignment behavior.
- [x] Define active-context selection and switching instead of implicit first-membership binding.
- [ ] Approve `user_identities` schema and identity-link/unlink recovery rules.
- [ ] Approve invitation scope type registry and delegation-ceiling validation.
- [ ] Approve personal-account Tenant and personal Workspace enum/schema additions.
- [ ] Approve active-context token/session lifetime, renewal, revocation, and device/session behavior.
- [ ] Implement invitation email outbox and remove raw token from administrative responses/logs.
- [ ] Implement hash-only token storage and migration for pending legacy invitations.
- [ ] Implement typed scope preview, disclosed revisions, and exact acceptance transaction.
- [ ] Disable broad default workspace grants for scoped invitations while preserving legacy compatibility during migration.
- [ ] Implement context list/switch/revalidation and remove implicit first-membership selection from new clients.
- [ ] Add Google issuer/audience/nonce/state/email-verified/provider-subject tests.
- [ ] Add cross-Tenant, replay, revoke, expiry, no-downgrade, and personal-isolation tests.

## Tenant creation and Workspace boundary

- [x] Approve that every verified global user may explicitly create and own a Tenant within plan/policy limits.
- [x] Approve that Tenant creation is never automatic on Google sign-in, invitation acceptance, or first membership.
- [x] Define Tenant as the ownership, isolation, billing, governance, federation, data-policy, connection, audit, and lifecycle boundary.
- [x] Define Workspace as a Tenant-owned operational context rather than a mini-Tenant.
- [x] Define organizational and operational axes connected through explicit bindings and grants.
- [x] Define personal, brand, project, campaign, operations, and sandbox Workspace types.
- [x] Define optional personal-account Tenant/personal Workspace coexistence with company memberships.
- [x] Define one-Tenant Workspace ownership, multi-Brand opt-in, and cross-Tenant prohibition.
- [x] Define Tenant provisioning, owner assignments, Workspace lifecycle, and active-context dependencies.
- [ ] Approve Tenant and Workspace type registries and migration mapping for existing rows.
- [ ] Approve owned-Tenant and active-Workspace limits per plan/entitlement.
- [ ] Approve Tenant provisioning state machine, verification/risk rules, and setup templates.
- [ ] Approve explicit owner-assignment and ownership-transfer schema.
- [ ] Approve Workspace Brand/Department/Group/Activity binding schemas and conflict semantics.
- [ ] Approve multi-Brand Workspace policy and allowed use cases.
- [ ] Approve personal-account plan, privacy, export, and deletion behavior.
- [ ] Implement tenant-creation capability and asynchronous provisioning APIs.
- [ ] Implement Workspace type/binding/context authorities and readback.
- [ ] Remove implicit first-membership context from new clients while preserving migration compatibility.
- [ ] Implement Workspace archive/deletion disposition and Tenant offboarding integration.
- [ ] Add one-Tenant ownership, cross-Tenant rejection, access-chain, sandbox/production, plan-limit, and lifecycle tests.

## Layered purpose-bound data governance

- [x] Approve access-plus-data-use eligibility and most-restrictive-rule resolution.
- [x] Approve sensitivity-tier plus category-attribute classification.
- [x] Approve registered purpose, lawful-basis, consent, residency/transfer, retention, and legal-hold semantics.
- [x] Approve privacy-request and derived-data lineage/disposition behavior.
- [x] Approve provider/model data-use fields, compatible fallback restrictions, and zero-retention behavior.
- [x] Forbid raw cross-Tenant learning and define privacy-governed aggregate-learning prerequisites.
- [x] Define immutable data-use decisions, governance epochs, stable blocker codes, APIs, and acceptance cases.
- [ ] Approve initial classification-category and purpose registry seed values for implementation.
- [ ] Approve jurisdiction-specific lawful-basis, residency, transfer, and retention policy packs.
- [ ] Approve consent UX, evidence schema, withdrawal propagation, and dispute/recovery behavior.
- [ ] Approve provider data-processing profile certification and refresh ownership.
- [ ] Approve exact minimum cohort, contribution/dominance, re-identification, fairness, and opt-out thresholds for aggregate learning.
- [ ] Implement read-only classification, purpose, residency, retention, and provider-profile diagnostics.
- [ ] Implement no-effect data-use decision preview and explanation.
- [ ] Implement lineage discovery and derived-data disposition preview before any deletion apply.
- [ ] Implement legal-hold and privacy-request lifecycle with object-level authorization and readback.
- [ ] Add classification/purpose/consent/residency/retention/hold/provider/model/lineage/aggregate-learning tests.
- [ ] Prove previews perform no provider call, transfer, deletion, credential read, or external write.

## Shared catalog

- [ ] Design additive catalog migration.
- [ ] Register source mappings for all initial asset families.
- [ ] Add visibility, entitlement, risk, customization, capability, and connection metadata.
- [ ] Implement Resource API list/get/search/permissions/changes/revisions/readback.
- [ ] Add catalog readiness states and tests.

## Dynamic Container projection

- [ ] Project tenants, workspaces, brands, activities, and workflows.
- [ ] Create deterministic relationship edges and closure.
- [ ] Add projection consistency views.
- [ ] Add idempotent backfill and same-cycle readback.
- [ ] Keep enforcement disabled.

## Legacy bridges

- [ ] Bridge current roles and memberships.
- [ ] Bridge skill grants and workflow bindings.
- [ ] Bridge app action and workspace resource grants.
- [ ] Bridge execution policies and target policy rules into policy atoms.
- [ ] Add shadow comparisons and parity dashboard.

## Typed composition

- [ ] Add policy-field semantics registry.
- [ ] Implement pure domain algebra operators.
- [ ] Add field schemas and explanation templates.
- [ ] Add deterministic/property/conflict/fuzz tests.
- [ ] Integrate composition profiles and selections.
- [ ] Add impact preview and reset.

## Personalization

- [ ] Add allowlisted user runtime preference profile.
- [ ] Bridge compatible existing preference tables.
- [ ] Add ranking, hiding, language, tone, dashboard, autonomy, and notification settings.
- [ ] Add consent, visibility, opt-out, history, revisions, export, and reset.
- [ ] Prove preferences cannot grant authority.

## Optional variants

- [ ] Add generic shared-asset variants and patches.
- [ ] Define modifiable-path profiles.
- [ ] Add versioning, publish, disable, reset, and conflict states.
- [ ] Add base upgrade preview/apply.
- [ ] Add approval and certification by risk.
- [ ] Prove ordinary use creates no variant.

## Effective runtime manifest

- [ ] Add manifest ledger and explanation API.
- [ ] Include authority epoch, profiles, atoms, assets, variants, preferences, and readiness.
- [ ] Add cache/version invalidation.
- [ ] Link execution and outcome evidence.
- [ ] Add no-secret and reconstruction tests.

## Connections and operational cleanup

- [ ] Integrate eligible connection selection without secret reads.
- [ ] Classify current pending connectors.
- [ ] Backfill only validated installation evidence.
- [ ] Correct approval-sensitive versus pending-request awareness labels.
- [ ] Add readiness parity tests.

## Adaptive growth

- [ ] Add proposal, simulation, experiment, measurement, and promotion-candidate authorities.
- [ ] Connect recommendation, intent, execution, readiness, and KPI evidence.
- [ ] Implement proposal classes A–E.
- [ ] Add simulation, guardrails, canary, rollback, expiry, and promotion criteria.
- [ ] Add privacy-safe aggregation and cross-tenant promotion controls.
- [ ] Prove Class E cannot self-approve.

## APIs and architecture

- [ ] Implement under `src/api`, `src/application`, `src/domain`, and `src/infrastructure` boundaries.
- [ ] Add OpenAPI 3.1 contracts and examples.
- [ ] Add structured errors, cursor pagination, filtering, sorting, and idempotency.
- [ ] Update Resource API coverage and test manifest.
- [ ] Review performance, security, and observability.

## Verification and rollout

- [ ] Migration preflight and rollback tests pass.
- [ ] Cross-tenant isolation and secret rejection tests pass.
- [ ] Shadow sample and parity thresholds pass.
- [ ] Resolution latency budgets pass.
- [ ] Personal preference canary passes.
- [ ] Read-only profile/variant canaries pass.
- [ ] Family-by-family cutover and rollback pass.
- [ ] Development verification and release readiness pass.
- [ ] Governed production merge, parity, and behavioral readback pass.
