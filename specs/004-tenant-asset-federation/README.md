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
- `data-model.md` — reused and new authorities across all fourteen platform planes.
- `resolution-algorithm.md` — deterministic effective-context resolution.
- `permissions-matrix.md` — authority, preference, customization, and execution boundaries.
- `credential-installation-model.md` — tenant credentials and runtime readiness.
- `api-contracts.md` — planned resource-oriented interfaces.
- `acceptance-matrix.md`, `plan.md`, `rollout.md`, and checklists — delivery controls.

This package is design-only. It includes no migration, runtime mutation, credential mutation, provider call, grant activation, installation activation, or external write.
