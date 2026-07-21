# Spec Kit 011: Database-Driven Operation Fabric

This Spec Kit defines a registry-first operation fabric that turns high-level platform intents into governed, dynamically bound executions without requiring the caller to discover low-level tools, query runtime tables, or manually coordinate capability envelopes, Git operations, generated artifacts, CI, and readback.

## Status

- Delivery: multi-PR
- Current branch: `gpt/no-docs-agent/011-database-driven-operation-fabric-20260721`
- Specification scope: design-only
- Runtime mutation: none
- Database migration: none in this specification branch
- Provider calls: none
- Deployment: none

## Documents

1. `spec.md` — product requirements, boundaries, and success criteria.
2. `plan.md` — implementation architecture and delivery DAG.
3. `tasks.md` — phased work breakdown.
4. `completion.json` — machine-readable completion and evidence state.
5. `architecture.md` — target control-plane and runtime boundaries.
6. `data-model.md` — registry-first persistence model and reuse map.
7. `dynamic-binding-resolution.md` — operation, adapter, health, and fallback resolution.
8. `tool-projection-contract.md` — generated Admin and Tenant tool projection.
9. `managed-git-worker-contract.md` — real isolated Git execution contract.
10. `ci-diagnosis-contract.md` — step-level CI diagnosis and recovery contract.
11. `generated-artifact-reconciliation.md` — generated-file ownership and regeneration policy.
12. `migration-and-rollout.md` — additive migration, projection, deployment, and cutover plan.
13. `acceptance-matrix.md` — positive, negative, resilience, and security acceptance cases.
14. `risk-register.md` — material risks, mitigations, and stop conditions.
15. `contracts/operation-orchestrator.openapi.yaml` — future OpenAPI 3.1 contract preview.
16. `contracts/registry-contracts.md` — conceptual SQL registry contracts.
17. `checklists/requirements.md` — specification and implementation readiness checklist.

## Core decision

`operation_registry` becomes the active source for operation contracts and dynamic execution bindings. Existing endpoint and tool registries become governed projections. The runtime keeps executable code in registered handlers and adapters; SQL stores identifiers, schemas, policies, compatibility, priorities, lifecycle, and evidence, never arbitrary JavaScript, shell commands, or secrets.
