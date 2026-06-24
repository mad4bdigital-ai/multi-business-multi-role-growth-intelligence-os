# Design Freeze Decision Register

## Purpose

This register separates decisions that are already frozen from decisions that must be approved before the Context Compiler and Effective Runtime Manifest become production contracts.

## Frozen decisions

| Decision | Status | Evidence |
|---|---|---|
| Shared assets remain canonical and shared by default | frozen | `spec.md`, `data-model.md` |
| Ordinary use/grants create no tenant copy | frozen | FR-001–FR-002 |
| Variants are explicit, sparse, scoped, and optional | frozen | FR-003–FR-005 |
| Preference is separate from authority | frozen | FR-013–FR-014 |
| Composition uses typed field semantics | frozen | FR-007–FR-012 |
| Mandatory deny/safety/approval/credential/readback controls cannot be weakened | frozen | policy composition and invariants |
| Existing specialized authorities remain until parity/cutover | frozen | FR-024–FR-026 |
| Adaptation is proposal/simulation/canary driven | frozen | FR-019–FR-023 |
| Provider writes are outside this design-only PR | frozen | manifest and README |
| Existing PR branch is repaired before replacement | frozen | plan and branch reconciliation evidence |

## P0 decisions required before contextual write implementation

### DFR-001 — Principal and organization authority

**Question:** Which table/service is canonical for users, agents, services, groups, nested membership, assurance, recertification, and delegation?

**Current evidence:** container assignments support multiple principal types, but group/service identity ownership is not operationally complete.

**Required outcome:** exact authority owner, membership/delegation algorithm, cycle/depth rules, separation of duties, lifecycle, and manifest contribution.

**Status:** open.

### DFR-002 — Tenant federation and lifecycle

**Question:** How do owns/manages/partners-with/white-label relationships affect administration, billing, support, and shared services without implicit access?

**Required outcome:** relationship policy, ownership transfer, suspension, offboarding, export, legal hold, erasure, orphan-resource disposition, and final evidence.

**Status:** open.

### DFR-003 — Data governance

**Question:** How are classification, purpose, consent/lawful basis, retention, residency, jurisdiction, legal hold, export, correction, and erasure evaluated?

**Required outcome:** source authorities, field semantics, purpose-to-use matrix, deletion propagation, audit exception, and fail-closed behavior.

**Status:** open.

### DFR-004 — Commercial and FinOps transaction

**Question:** What is the authoritative sequence for entitlement, estimate, reservation, execution, settlement, refund, and cost attribution?

**Required outcome:** idempotency, concurrency control, currency/unit rules, billing owner, overage/grace/past-due behavior, and manifest linkage.

**Status:** open.

### DFR-005 — Contextual model governance

**Question:** How are models/providers selected by capability, task, tenant/plan, risk, data policy, region, quality, cost, latency, and readiness?

**Required outcome:** capability schema, policy authority, evaluation suites, fallback restrictions, deprecation, and manifest contribution.

**Status:** open.

### DFR-006 — Universal runtime operation contract

**Question:** What delivery, idempotency, deadline, cancellation, retry, compensation, concurrency, fairness, and partial-success semantics apply to all effectful operations?

**Required outcome:** operation state machine, outbox/inbox, dead letter, saga, reservation/lock, replay and recovery rules.

**Status:** open.

### DFR-007 — Artifact and knowledge provenance

**Question:** What fields and authorities prove source, transformation, verification, freshness, sensitivity, audience, license, correction, retraction, retention, and erasure?

**Required outcome:** immutable artifact version/provenance schema and propagation rules.

**Status:** open.

### DFR-008 — Temporal, environment, region, and jurisdiction model

**Question:** How are `as_of`, scheduled changes, timezone, environment, region, jurisdiction, grace periods, historical replay, and future preview represented?

**Required outcome:** normalized types, precedence, manifest fields, invalidation, and production-preview separation.

**Status:** open.

### DFR-009 — Plugin/package supply chain

**Question:** What publisher, signature, digest, SBOM, vulnerability, license, permission, compatibility, update, rollback, and revocation evidence is mandatory by risk class?

**Required outcome:** trust tiers, publication/install gates, tenant policy, and emergency revocation.

**Status:** open.

### DFR-010 — Quality and cutover evaluation

**Question:** Which evaluation suites, datasets, languages, activities, risks, metrics, confidence, drift, fairness, and exposure thresholds are required before promotion/cutover?

**Required outcome:** evaluator authority, minimum coverage, zero-tolerance failures, calibration, and release gate.

**Status:** open.

## P1 decisions before ecosystem expansion

| ID | Decision | Status |
|---|---|---|
| DFR-011 | Contract/schema registry and compatibility/deprecation policy | open |
| DFR-012 | Tenant/user export, import, portability, and deletion certificate | open |
| DFR-013 | Backup/restore coverage, RPO/RTO, disaster and degraded-mode policy | open |
| DFR-014 | Human queues, availability, SLA, fallback, escalation, and support access | open |
| DFR-015 | Capability ontology, equivalence, substitution, supersession, and incompatibility | open |
| DFR-016 | Localization, accessibility, brand translation, and jurisdiction behavior | open |

## P2 decisions before broad adaptive automation

| ID | Decision | Status |
|---|---|---|
| DFR-017 | Cross-tenant aggregation cohorts, weighting, privacy, opt-out, and confidentiality | open |
| DFR-018 | Recommendation exposure, feedback-loop, fairness, and manipulation controls | open |
| DFR-019 | Economic experiments, plan/default optimization, and disclosure boundaries | open |
| DFR-020 | Tenant-local improvement nomination and platform promotion ownership/IP terms | open |

## Decision record requirements

A decision is not closed until it includes:

- canonical source-of-truth owner;
- scope and tenant boundary;
- data schema and versioning;
- read/write permissions;
- lifecycle/state machine;
- deterministic resolver behavior;
- unavailable/ambiguous fail behavior;
- API/event contracts;
- migration and compatibility;
- observability and SLO;
- security/privacy/threat review;
- test and evaluation evidence;
- rollback/disable path;
- ADR or equivalent approval reference.

## Freeze rule

The read-only shared catalog and diagnostic projections may proceed while P0 decisions remain open. The production Effective Runtime Manifest schema and contextual write enforcement may not be frozen or implemented until DFR-001 through DFR-010 are approved or explicitly deferred with a fail-closed boundary.