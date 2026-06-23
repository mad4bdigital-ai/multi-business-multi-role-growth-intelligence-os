# Shared Asset Fabric and Contextual Policy Composition

**Status:** Review open — model revision in progress  
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
- `data-model.md` — reused and new authorities.
- `resolution-algorithm.md` — deterministic effective-context resolution.
- `permissions-matrix.md` — authority, preference, customization, and execution boundaries.
- `credential-installation-model.md` — tenant credentials and runtime readiness.
- `api-contracts.md` — planned resource-oriented interfaces.
- `acceptance-matrix.md`, `plan.md`, `rollout.md`, and checklists — delivery controls.

This package is design-only. It includes no migration, runtime mutation, credential mutation, provider call, grant activation, installation activation, or external write.
