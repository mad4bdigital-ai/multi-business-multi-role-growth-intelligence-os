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

**Approved decision:** Configurable Federated Principal Authority with Brand-scoped Departments above Groups and generic Business-Type Blueprint inheritance.

```text
Tenant
└─ Brand
   └─ Department
      └─ optional Sub-department
         └─ Group
            └─ User | Agent | Service
```

Existing `users`, `memberships`, and `agents` remain canonical. Additive authorities own Brand-scoped Departments, Groups, Services, Delegations, Separation of Duties, settings, and authority epochs.

Business Types may define reusable Department, Group, Role, member-profile, AI-Agent-profile, knowledge-tree, and shared-asset Blueprints. A compatible Brand selectively inherits them into Brand-scoped operational instances. Shared Skills, Workflows, Policies, Apps, Tools, Graph definitions, Engines, Logic, and Knowledge remain canonical references rather than per-Brand copies.

Configuration resolves through Platform hard bounds, Platform defaults, Business-Type Blueprint defaults, Tenant inheritance policy, Brand settings/profile, delegated Department and Group settings, eligible Workspace bindings, and Principal preference for non-authority fields. Lower scopes cannot weaken cross-tenant isolation, cycle prevention, service ownership, high-risk separation of duties, break-glass audit, mandatory policy, or fail-closed behavior.

Recommended defaults include Department depth 3, Group depth 5, cross-Brand Groups disabled, cross-Department Groups disabled, redelegation disabled by default, Service owner mandatory, high-risk separation of duties mandatory, optional Blueprint auto-adoption disabled, and security-revocation updates enforced.

**Decision evidence:** `principal-authority-decision.md` and `dynamic-layer-inheritance-model.md`.

**Status:** approved_design; implementation_not_authorized.

### DFR-002 — Tenant federation and lifecycle

**Approved decision:** Explicit Non-Transitive Tenant Federation Graph.

Each Tenant remains an independent data, authority, billing-accountability, and audit boundary. Ownership, management, billing, support, white-label, shared-service, and partnership relationships are represented as separate typed contracts. A relationship grants no access by itself and never becomes transitive authority.

Required defaults:

- direct contract required for every delegated capability;
- ownership, management, billing, support, white-label, and shared-service scopes remain separate;
- relationship authority is non-transitive;
- multiple managers are allowed through non-overlapping or explicitly conflict-resolved contracts;
- one active legal owner and one primary billing owner are identified;
- support access is short-lived, approved, visible, and audited;
- credentials are never inherited or transferred as values;
- ownership transfer requires current/new-owner acceptance and high-risk approval;
- Tenant offboarding is staged through freeze, export, connection/grant shutdown, settlement, legal-hold evaluation, archive/erasure, and completion evidence;
- legal hold is an independent overlay rather than a Tenant status;
- missing or ambiguous federation evidence fails closed.

Configuration may enable allowed relationship families, TTLs, recertification, support limits, and shared-service classes within immutable Platform isolation and non-transitivity bounds.

**Status:** approved_design; implementation_not_authorized.

### DFR-002A — Scoped member invitation and Google onboarding

**Approved decision:** Identity-first, Scope-aware Invitation Onboarding.

A Google invitation creates or links one global user identity, then joins that identity to the existing target Tenant with a minimal base membership and exact Brand, Workspace, Department, Group, Role/profile, and resource grants from an immutable invitation scope. Accepting an invitation never creates a new Tenant automatically.

A separate personal-account Tenant and personal Workspace are optional, lazy, and explicitly created. The same user may own a personal workspace while participating in multiple company Tenants through an explicit active-context switcher.

Required defaults:

- verified Google email must match the invited email during first acceptance;
- stable Google provider subject is linked after verification;
- invitation token is single-use, expiring, revocable, hash-stored, and delivered through an approved outbox channel;
- invitation scope is immutable after delivery or requires a disclosed revision/new invitation;
- base Tenant membership is minimal, normally `member`;
- broad default workspace grants are disabled for scoped invitations;
- exact scope grants and organizational assignments are transactional, idempotent, and read back;
- an inviter cannot delegate authority it does not hold;
- human users are never auto-created as Tenants and personal workspaces are never auto-created by invitation acceptance;
- multi-Tenant users select an active Tenant/Brand/Workspace context instead of being bound to the first membership;
- accepting one invitation cannot alter other Tenant memberships or personal resources.

**Decision evidence:** `member-invitation-onboarding-model.md`.

**Status:** approved_design; implementation_not_authorized.

### DFR-002B — Tenant and Workspace boundary

**Approved decision:** Tenant-Owned Operational Workspace Model.

Every verified global user may explicitly create and own a Tenant within configurable plan, verification, risk, and policy limits while retaining memberships in other Tenants. Tenant creation is never automatic on Google sign-in, invitation acceptance, or first membership.

A Tenant is the ownership, isolation, billing, governance, federation, data-policy, connection, audit, and lifecycle boundary. A Workspace is an operational context owned by exactly one Tenant and connected to Brands, Departments, Groups, Business Activities, Roles/profiles, Agents, and resources through explicit bindings and grants.

Required defaults:

- every Workspace has exactly one immutable owning Tenant;
- Workspaces are not mini-Tenants and do not independently own Brands, memberships, federation relationships, billing, or credential values;
- Workspace access requires active Tenant membership plus exact organizational and Workspace/resource authority;
- personal-account Tenant and personal Workspace are optional and explicitly/lazily created;
- multi-Brand Workspace is disabled by default and remains inside one Tenant when enabled;
- cross-Tenant Workspace is forbidden;
- creating a Tenant does not alter existing memberships;
- invitation acceptance never creates a Tenant;
- active context selection replaces implicit first-membership behavior;
- Workspace deletion does not delete Tenant or Brand; Tenant offboarding processes all owned Workspaces.

**Decision evidence:** `tenant-workspace-boundary-decision.md`.

**Status:** approved_design; implementation_not_authorized.

### DFR-003 — Data governance

**Approved decision:** Layered Purpose-Bound Data Governance.

Access authority is necessary but insufficient. Every consequential data operation must also satisfy the effective classification, registered purpose, lawful-basis or consent, residency and transfer, retention, legal hold, provider/model data-use, audience, destination, and most-restrictive applicable Platform, jurisdiction, Tenant, Brand, Workspace, resource, and subject policy.

Required defaults:

- classification is multi-dimensional: sensitivity tier plus category attributes;
- every consequential use declares a registered processing purpose;
- lawful basis and consent are versioned, purpose-bound, and revocable where applicable;
- residency covers storage, processing, providers/models, backups, exports, and transfer mechanisms;
- retention resolves by data class, purpose, scope, artifact type, source contract, jurisdiction, subject request, and legal hold;
- legal hold is an independent overlay and grants no read authority;
- correction, restriction, erasure, objection, or consent withdrawal propagates through lineage to summaries, embeddings, indexes, Agent memory, evaluations, artifacts, provider copies, analytics, and backups;
- provider/model fallback is blocked when retention, training, region, deletion, contract, or purpose requirements are incompatible;
- raw cross-Tenant learning is forbidden; only privacy-governed aggregate evidence may be eligible;
- the most restrictive applicable rule wins and missing, stale, conflicting, revoked, or ambiguous evidence fails closed;
- the Effective Runtime Manifest binds an immutable data-use decision and governance version vector.

**Decision evidence:** `data-governance-decision.md`.

**Status:** approved_design; implementation_not_authorized.

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