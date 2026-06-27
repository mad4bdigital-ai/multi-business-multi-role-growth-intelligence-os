# Shared Asset Fabric and Contextual Policy Composition

**Status:** Deep design ready for review — corrected model  
**Pull request:** `#1898`  
**Branch:** `gpt/004-tenant-asset-federation-20260623`  
**Implementation authorized:** No

This Spec Kit defines a shared-by-default platform model in which agents, skills, policies, workflows, apps, plugins, actions, tools, logic, engines, and knowledge assets remain common platform assets. Tenants and users reference those assets directly. A separate variant is created only when an authorized user explicitly customizes an asset.

The primary design problem is not asset copying. It is runtime composition across contextual layers:

- platform safety floor;
- tenant;
- workspace;
- brand;
- business activity type;
- role;
- user preference;
- bounded session or task context.

Users may select allowed composition behavior such as `union` or `intersection` for eligible dimensions. Policy fields are merged through a typed policy algebra so a permissive selection can never bypass mandatory denies, approval, credentials, quotas, certification, or tenant isolation.

The model builds on the existing Dynamic Container Authority, shared registries, package variants, recommendation telemetry, and adaptation records. It adds a unified effective-runtime manifest and a governed learning loop:

```text
observe → explain → propose → simulate → approve → canary → measure → promote or roll back
```

No silent self-modification is allowed. High-risk policy, authority, credential, deployment, and provider-write changes remain approval-gated.

## Package map

- `spec.md` — product and platform requirements.
- `current-state.md` — evidence from current code and database.
- `relationship-diagrams.md` — current and target relationships.
- `policy-composition-model.md` — typed composition semantics.
- `personalization-adaptation-model.md` — user customization and optional variants.
- `growth-learning-loop.md` — dynamic growth and controlled adaptation.
- `platform-growth-operating-model.md` — activation, productivity, tenant maturity, business, and platform growth flywheels.
- `adaptive-scoring-confidence.md` — transparent opportunity scoring, confidence, calibration, and promotion thresholds.
- `domain-model-invariants.md` — aggregate boundaries, identities, state machines, transactions, and non-negotiable invariants.
- `policy-dsl-examples.md` — constrained policy atom/profile syntax and worked resolution examples.
- `user-experience-journeys.md` — shared-use, setup, personalization, variants, explanations, and adaptive user journeys.
- `governance-decision-matrix.md` — decision rights, delegation, approvals, conflicts, and review cadence.
- `threat-model.md` — assets, trust boundaries, 28 threats, abuse cases, tests, and security gates.
- `observability-slos.md` — events, metrics, SLOs, error budgets, alerts, dashboards, and runbooks.
- `migration-cutover-map.md` — current-to-target bridges, backfills, parity, cutover units, and rollback.
- `additional-dimensions-gap-analysis.md` — evidence-based review of identity, tenant lifecycle, privacy, FinOps, model governance, async consistency, provenance, temporal/environment semantics, supply chain, portability, resilience, human operations, capability ontology, localization, and quality drift.
- `expanded-platform-plane-architecture.md` — fifteen-plane relationship model, including Blueprint and Layer Inheritance, manifest contribution contracts, fail-closed behavior, version vectors, and the end-to-end decision pipeline.
- `dynamic-layer-inheritance-model.md` — generic Business-Type Blueprint inheritance for Brand-scoped Departments, Groups, Roles, members, AI Agents, knowledge trees, and linked shared assets.
- `principal-authority-decision.md` — approved configurable federated principal authority with Brand-scoped Departments above Groups.
- `member-invitation-onboarding-model.md` — approved Google/email invitation flow that links one global user identity to exact Tenant/Brand/Workspace/Department/Group/Role scopes without creating a Tenant automatically, plus optional isolated personal workspaces and active-context switching.
- `tenant-workspace-boundary-decision.md` — approved distinction between Tenant ownership/governance and Workspace operations, including explicit user Tenant creation rights, personal/company coexistence, Workspace types/bindings, lifecycle, commercial limits, and implementation dependencies.
- `data-governance-decision.md` — approved Layered Purpose-Bound Data Governance: access authority is necessary but insufficient; classification, purpose, lawful basis/consent, residency/transfer, retention/legal hold, provider/model controls, lineage/disposition, and the most restrictive rule determine eligibility.
- `commercial-finops-decision.md` — approved dynamic Commercial/FinOps transaction: database-driven billing models, user-configurable billing profiles, multi-dimensional metering beyond tokens, atomic reservation, verified settlement, and immutable double-entry accounting.
- `model-governance-decision.md` — approved capability-first contextual model governance: deterministic eligibility gates, evidence-ranked optimization, bounded preferences, contextual evaluation/readiness, independently eligible fallback, lifecycle/revocation, and manifest-bound commercial selection.
- `durable-workflow-effect-commit-decision.md` — approved fully dynamic deterministic durable Workflow and Effect Commit protocol: append-only replayable history, at-least-once Activities, scoped idempotency, Effect verification/reconciliation, fenced leases, durable timers/signals, compensation, recovery, and safe model fallback boundaries.
- `design-freeze-decision-register.md` — frozen/approved decisions plus remaining P0/P1/P2 decisions, closure evidence, and the rule that write enforcement cannot freeze before unresolved P0 boundaries close.
- `data-model.md` — reused and new authorities across all fourteen platform planes.
- `resolution-algorithm.md` — deterministic effective-context resolution.
- `permissions-matrix.md` — authority, preference, customization, and execution boundaries.
- `credential-installation-model.md` — tenant credentials and runtime readiness.
- `api-contracts.md` — planned resource-oriented interfaces.
- `acceptance-matrix.md`, `plan.md`, `rollout.md`, and checklists — delivery controls.

This package is design-only. It includes no migration, runtime mutation, credential mutation, provider call, grant activation, installation activation, or external write.
