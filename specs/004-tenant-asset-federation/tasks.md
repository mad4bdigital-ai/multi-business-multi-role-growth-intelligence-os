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
- [ ] Approve privacy, consent, and promotion governance.

## Repository continuity

- [x] Preserve and repair the current PR branch.
- [x] Run branch reconciliation and confirm zero file overlap.
- [x] Use governed stale-branch patch without force-push.
- [x] Merge latest `main` into the current branch with a signed no-force merge commit.
- [x] Verify branch state is `ahead_only` with `behind_by=0`.
- [x] Run required CI checks successfully after reconciliation.
- [ ] Re-run final CI after the last documentation evidence commit.
- [ ] Verify final tree scope and generated docs immediately before merge.

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
- [ ] Approve data-purpose, consent, classification, retention, residency, and jurisdiction rules.
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
