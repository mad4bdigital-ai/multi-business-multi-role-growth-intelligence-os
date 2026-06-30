# Dynamic Capability Governance and Universal Tool Projection

**Spec key:** `007-dynamic-capability-governance`  
**Status:** Deep design complete; implementation pending  
**Specification branch:** `gpt/007-dynamic-capability-governance-20260629`  
**Delivery:** The complete Spec Kit is introduced in one specification PR. Runtime implementation remains a governed multi-PR rollout because migrations, production verification, and post-merge audit are required.

## Purpose

This Spec Kit defines one platform-wide governance model for every current and future tool, action, endpoint, workflow, engine, connector, semantic capability, and projected Admin or Tenant surface.

It replaces one-off remediation with a registry-driven pipeline:

```text
inventory -> canonical identity -> effect/risk classification
-> requirement compilation -> authority and readiness evaluation
-> safe projection -> execution envelope -> certified adapter
-> dispatch -> readback -> evidence -> debt reconciliation
```

The specification does not create a second capability authority. It consolidates and operationalizes the existing Capability Assurance Graph, semantic capability foundation, adaptive authorization design, resource authority, dispatch bindings, certification, evidence, and debt registries.

## Specification PR boundary

This PR is specification-only. It performs no migration, provider call, tenant export, runtime cutover, credential read, external write, or production enforcement change.

## Normative dependencies

- `.specify/memory/constitution.md`
- `specs/001-capability-security-hardening/`
- `specs/001-resource-api-coverage/`
- `specs/002-resource-surface-policy-governance/`
- `specs/005-dynamic-mcp-schema-surfaces/`
- `specs/006-adaptive-authorization-execution-governance/`
- `specs/006-platform-dynamic-workflow-runtime/`
- `canonicals/system_bootstrap/22_capability_assurance_graph.md`
- `canonicals/system_bootstrap/23_semantic_capability_resolution.md`
- `canonicals/system_bootstrap/24_resource_api_coverage.md`

When a conflict exists, platform safety policy and the constitution take precedence. This Spec Kit narrows and implements the existing architecture; it does not weaken prior invariants.

## Document index

- `SPEC_KIT_OVERVIEW_AR.md` — executive Arabic overview.
- `spec.md` — scenarios, requirements, resource coverage, and success criteria.
- `plan.md` — implementation architecture and validation plan.
- `architecture.md` — components, ports, and transaction boundaries.
- `data-model.md` — existing authorities and additive proposed storage.
- `source-consolidation-map.md` — source precedence and compatibility map.
- `decision-model.md` — classification, gates, outputs, and reason codes.
- `migration-and-compatibility.md` — additive migration and cutover rules.
- `rollout-pr-sequence.md` — bounded implementation PR sequence.
- `testing-strategy.md` — deterministic, isolation, parity, and performance tests.
- `threat-model.md` — abuse cases and mitigations.
- `operational-model.md` — SLOs, reconciliation, alerts, and rollback.
- `contracts/dynamic-capability-governance.openapi.yaml` — draft OpenAPI 3.1 contract.
- `checklists/` — requirements, security, and release-readiness gates.
- `tasks.md` and `completion.json` — governed delivery tracking.

## Current live baseline

The design was informed by the live MySQL-primary capability report observed on 2026-06-29: 604 capabilities, 71 assurance gaps, 48 hard-blocked capabilities, and 14 apply-allowed capabilities. These values are evidence for planning only and must not be hard-coded or treated as permanent acceptance thresholds.
