# 011 — Unified Effective Authority Control Plane

This Spec Kit defines the long-term authority architecture for platform administrators, tenant users, service principals, agents, workspaces, brands, resources, connections, projections, and governed runtime execution.

The design introduces one Unified Effective Authority Control Plane (UEACP). Admin and Tenant requests use the same decision pipeline. Their behavior differs through explicit principal type, subject scope, grants, policy, resource relationships, risk, and runtime readiness—not through separate authorization implementations.

## Status

- Specification: complete
- Implementation: pending
- Delivery: multi-PR, additive, shadow-first
- Runtime effect of this commit: none
- Provider calls or external writes: none

## Core documents

- `spec.md` — normative requirements and success criteria
- `adr-001-unified-effective-authority-control-plane.md` — architectural decision
- `architecture.md` — control-plane/data-plane design
- `formal-decision-model.md` — typed decision and invariants
- `data-model.md` — logical SQL authority model
- `use-cases.md` — Admin, Tenant, agency, support, agent, and connector scenarios
- `threat-model.md` — threats, controls, and residual risks
- `api-contracts.md` — proposed OpenAPI-facing contracts and error taxonomy
- `migration-and-rollout.md` — additive migration and cutover sequence
- `testing-and-reconciliation.md` — parity, drift, synthetic-principal, and release gates
- `concerns-and-tradeoffs.md` — operational and architectural concerns

## Relationship to existing specifications

This specification consolidates the authority boundary across existing authorization, activation, connector, capability, projection, and execution work. It extends—not silently replaces—`006-adaptive-authorization-execution-governance`, `007-dynamic-capability-governance`, `003-activation-operational-count-integrity`, and `009-platform-request-execution-hardening`. Existing contracts remain authoritative until an explicitly approved migration phase cuts each surface over.
