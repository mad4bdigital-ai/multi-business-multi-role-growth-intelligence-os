# Requirements Checklist

## Shared assets

- [x] Shared canonical assets remain the default.
- [x] Ordinary use and grants create no asset copy.
- [x] Catalog projection references canonical tables.
- [x] Platform base assets remain immutable to tenant principals.
- [x] Optional variants require explicit customization.
- [x] Variants support user, role, workspace, brand, activity, and tenant scopes.
- [x] Reset to shared default is defined.
- [x] Base upgrade and variant conflict behavior are defined.

## Context and composition

- [x] Tenant, workspace, brand, activity, role, user, and task layers are represented.
- [x] Dynamic Container Authority is reused.
- [x] Multi-parent paths and ambiguity are addressed.
- [x] Composition mode is selected per dimension/policy family.
- [x] Guarded union and strict intersection are defined.
- [x] Typed operators cover deny, risk, quota, scalar, ordered, and prompt semantics.
- [x] Missing required intersection layers fail closed.
- [x] Mandatory platform policy cannot be removed.
- [x] Field-level explanation and provenance are required.

## Personalization

- [x] User preference is separate from authorization.
- [x] Preferences can rank or narrow only authorized candidates.
- [x] Personalization covers language, depth, workflow, agent, dashboard, channels, and autonomy bounds.
- [x] Users can inspect, reset, and opt out of eligible adaptation.
- [x] Preferences contain no secrets or cross-tenant references.

## Connections and readiness

- [x] Tenant/user credentials remain in governed vault/connection authorities.
- [x] Assets and variants store opaque connection references only.
- [x] Catalog, grants, connections, installations, certifications, and approvals are distinct.
- [x] Registry active status is not treated as installation evidence.
- [x] Approval-sensitive grants are distinguished from pending requests.

## Dynamic growth

- [x] Existing signals and outcomes are reused.
- [x] Adaptation is proposal-driven.
- [x] Proposal classes A–E are defined.
- [x] Simulation, canary, metrics, guardrails, rollback, and expiry are defined.
- [x] Class E cannot self-approve.
- [x] Tenant-local to platform promotion is separate and privacy-reviewed.
- [x] Dark patterns and proxy-metric optimization are forbidden.

## Runtime and APIs

- [x] Effective runtime manifest is defined.
- [x] Decisions are deterministic, hashed, versioned, no-secret, and reconstructable.
- [x] Existing authorities remain until parity and cutover certification.
- [x] OpenAPI 3.1, resource-oriented APIs, structured errors, pagination, idempotency, and readback are covered.
- [x] Architecture layer boundaries are defined.
- [x] Family-by-family rollout and rollback are defined.

## Dynamic Blueprint and Layer Inheritance

- [x] Business Types may own versioned reusable Layer Blueprints.
- [x] Brands use explicit primary/secondary Business-Type bindings.
- [x] Brand inheritance profiles select required, recommended, and optional Blueprints.
- [x] Departments are Brand-scoped and Groups are Department-scoped.
- [x] Roles, member profiles, AI Agent profiles, Activities, Knowledge, Skills, Workflows, Policies, Apps, Tools, Graphs, Engines, Logic, and future layers use the same inheritance/provenance framework.
- [x] Specialized canonical tables remain authoritative while generic registries manage type, relationship, closure, inheritance, compatibility, and provenance.
- [x] Shared assets are referenced and never automatically copied by inheritance.
- [x] Human users are not auto-created from member-profile Blueprints.
- [x] Base AI Agents are not duplicated; Brand-scoped Agent profiles/assignments reference them.
- [x] Multiple Business Types compose per layer family through registered semantics.
- [x] Blueprint and instance graphs are bounded, cycle-safe, versioned, and checksummed.
- [x] Inherited instances record source Business Type, Blueprint/version, profile/version, merge operator, overrides, and authority epoch.
- [x] Upgrade, pin, rebase, replace, supersede, conflict, revoke, and removal/disposition lifecycles are defined.
- [x] Business-Type binding or inheritance profile alone grants no execution authority.
- [ ] Initial layer-type and relationship registries approved.
- [ ] Initial pilot Business Type/Brand and Blueprint package approved.
- [ ] Brand inheritance settings schema and parent bounds approved.
- [ ] Blueprint publisher/certification/security-update policy approved.

## Extended platform planes

- [x] Organizational principal/group/service gaps are documented.
- [x] Tenant federation, ownership transfer, offboarding, export, legal hold, and erasure are specified.
- [x] Data classification, purpose, consent, retention, residency, and jurisdiction are included.
- [x] Commercial entitlement, estimate, reservation, settlement, refund, and cost attribution are included.
- [x] Contextual model routing, fallback constraints, evaluation, and drift are included.
- [x] Universal operation identity, delivery, idempotency, cancellation, compensation, concurrency, and backpressure are included.
- [x] Artifact/knowledge provenance, verification, correction, retraction, and disposition are included.
- [x] Unified temporal, environment, region, and jurisdiction semantics are included.
- [x] Plugin/package publisher, signing, dependency, vulnerability, license, update, and revocation requirements are included.
- [x] Contract compatibility, client negotiation, portability, and tenant exit are included.
- [x] Backup/restore, disaster mode, human workload/SLA, and capability ontology are included.
- [x] Localization, accessibility, quality evaluation, fairness, and cross-tenant learning are included.
- [ ] P0 source-of-truth ownership approved.
- [ ] P0 manifest contribution schemas approved.
- [ ] P0 fail-closed and degraded-mode behavior approved.
- [ ] Initial evaluation suites and thresholds approved.

## Review status

- [ ] Product terminology approved.
- [ ] Typed field/operator registry approved.
- [ ] Privacy and consent policy approved.
- [ ] Initial pilot family and context approved.
- [ ] Implementation scope authorized.
