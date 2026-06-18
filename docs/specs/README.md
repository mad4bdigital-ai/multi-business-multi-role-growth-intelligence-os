# Specification Packages

This directory contains design-freeze packages for cross-cutting platform changes that require coordinated domain, persistence, API, security, rollout, and test decisions before implementation.

A specification package is documentation-only. It does not authorize a migration, runtime cutover, provider call, credential read, external write, deployment, or secret handling.

## Required package structure

```text
docs/specs/<number>-<feature>/
├── spec.md
├── research.md
├── data-model.md
├── inheritance-matrix.md
├── resolution-algorithm.md
├── threat-model.md
├── plan.md
├── tasks.md
├── quickstart.md
├── contracts/
│   └── openapi-fragment.yaml
└── checklists/
    └── requirements.md
```

## Lifecycle

```text
draft
→ design_freeze
→ implementation_planned
→ shadow
→ canary
→ enforced
→ superseded
```

Every implementation PR must reference the relevant specification package and identify which requirements and tasks it satisfies. Runtime behavior remains governed by live SQL registries, application guards, capability envelopes, approvals, audit, and same-cycle readback.
