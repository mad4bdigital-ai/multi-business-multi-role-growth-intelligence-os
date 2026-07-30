# 011 — Unified Effective Authority Control Plane

This Spec Kit defines the long-term authority architecture for platform administrators, tenant users, service principals, agents, workspaces, brands, resources, connections, projections, and governed runtime execution.

The design introduces one Unified Effective Authority Control Plane (UEACP). Admin and Tenant requests use the same decision pipeline. Their behavior differs through explicit principal type, subject scope, grants, policy, resource relationships, risk, and runtime readiness—not through separate authorization implementations.

## Status

- Specification: recovered and merged into `main` through PR `#3498`
- Specification recovery head: `d375a56bfc5df11517e53ea6ead595f3b14033f4`
- Specification recovery merge SHA: `fc3494944c25d025331dec3b0a8b38a6535995f3`
- Stale cumulative source PR `#2888`: closed without merge
- Implementation: in progress through separate governed PRs
- Merged implementation slice: PR `#3471` for T010 Principal Resolver and T011 Subject Scope & Delegation Resolver
- Superseded implementation recovery: PR `#3351`
- Delivery: multi-PR, additive, shadow-first
- Runtime effect of the specification recovery: none
- Runtime wiring or enforcement cutover from PR `#3471`: none
- Migration execution, provider calls, external writes, deployment, or Production promotion from this recovery path: none

The recovery chain is closed. The overall Spec remains `in_progress`; remaining tasks must be delivered through bounded PRs based on current `main`.

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

The recovered directory preserves authority inventory, compatibility semantics, implementation, SQL census, performance/retention, and security-review evidence from the former mixed-scope branch. These files are historical snapshots. Their old PR numbers, branch SHAs, CI results, and implementation claims are not current merge, deployment, migration, or Production evidence.

Current merged evidence for T010/T011 is recorded separately in `completion.json` and `RECOVERY_PROVENANCE.md` using PR `#3471`, reviewed head `9452d47d628ca17985c998720b56060b6a82c7e7`, and merge SHA `0ff39a85661a9552daa52d3a56338a24fe6bf560`.

## Relationship to existing specifications

This specification consolidates the authority boundary across existing authorization, activation, connector, capability, projection, and execution work. It extends—not silently replaces—`006-adaptive-authorization-execution-governance`, `007-dynamic-capability-governance`, `003-activation-operational-count-integrity`, and `009-platform-request-execution-hardening`. Existing contracts remain authoritative until an explicitly approved migration phase cuts each surface over.
