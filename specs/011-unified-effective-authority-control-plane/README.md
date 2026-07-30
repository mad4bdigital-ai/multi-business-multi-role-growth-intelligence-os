# 011 — Unified Effective Authority Control Plane

This Spec Kit defines the long-term authority architecture for platform administrators, tenant users, service principals, agents, workspaces, brands, resources, connections, projections, and governed runtime execution.

The design introduces one Unified Effective Authority Control Plane (UEACP). Admin and Tenant requests use the same decision pipeline. Their behavior differs through explicit principal type, subject scope, grants, policy, resource relationships, risk, and runtime readiness—not through separate authorization implementations.

## Status

- Specification: complete and recovered from stale PR `#2888`
- Implementation: in progress through separate governed PRs
- Current implementation recovery: PR `#3471` for T010/T011 only
- Superseded implementation recovery: PR `#3351`
- Delivery: multi-PR, additive, shadow-first
- Runtime effect of this specification recovery: none
- Migration execution, provider calls, external writes, deployment, or Production promotion: none

## Normative documents

- `spec.md` — normative requirements and success criteria
- `adr-001-unified-effective-authority-control-plane.md` — architecture decision
- `architecture.md` — Control Plane/Data Plane and PDP/PIP/PAP/PEP design
- `formal-decision-model.md` — typed states, set invariants, and revalidation
- `data-model.md` — logical authority model
- `use-cases.md` — Admin, Tenant, agency, support, agent, and connector scenarios
- `threat-model.md` — threats, controls, and residual risks
- `api-contracts.md` and `contracts/openapi.yaml` — additive API draft
- `migration-and-rollout.md` — phased migration and rollback
- `testing-and-reconciliation.md` — parity, drift, synthetic principals, and release gates
- `concerns-and-tradeoffs.md` — architectural and operational concerns
- `research.md` — alternatives and deferred technology choices
- `quickstart.md` — implementation sequencing guide
- `plan.md` and `tasks.md` — delivery plan and work breakdown
- `checklists/` — requirements and security gates

## Supporting and historical evidence

The recovered directory also preserves authority inventory, compatibility semantics, implementation, SQL census, performance/retention, and security-review evidence from the former mixed-scope branch. These files are historical snapshots. Their old PR numbers, branch SHAs, CI results, and implementation claims are not current merge, deployment, migration, or Production evidence.

See `RECOVERY_PROVENANCE.md` and `completion.json` for the current delivery boundary.

## Relationship to existing specifications

This specification consolidates the authority boundary across existing authorization, activation, connector, capability, projection, and execution work. It extends—not silently replaces—`006-adaptive-authorization-execution-governance`, `007-dynamic-capability-governance`, `003-activation-operational-count-integrity`, and `009-platform-request-execution-hardening`. Existing contracts remain authoritative until an explicitly approved migration phase cuts each surface over.
