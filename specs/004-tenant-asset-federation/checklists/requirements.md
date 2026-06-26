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

## Scoped member invitation and active contexts

- [x] One global human identity can hold multiple Tenant memberships.
- [x] Accepting a team invitation does not create a Tenant or personal workspace automatically.
- [x] New Google invitees create/link only a global user identity before target membership acceptance.
- [x] Invitation scope supports Tenant, Brand, Workspace, Department, Group, Role/profile, and exact resources.
- [x] Base Tenant membership is minimal and exact grants determine resource access.
- [x] Scoped invitations disable broad default workspace grants.
- [x] Existing users retain unrelated memberships and stronger authority.
- [x] Personal account/workspace is explicit, optional, lazy, and isolated.
- [x] Active context is selected and revalidated rather than inferred from first membership.
- [x] Invitation lifecycle covers delivery, preview, authentication, acceptance/decline, expiry, revoke, and readback.
- [x] Google provider subject and verified email linkage are separated from Tenant authorization.
- [ ] Identity-link conflict and account-recovery policy approved.
- [ ] Invitation scope registry and migration compatibility approved.
- [ ] Personal-account plan/entitlement and lifecycle policy approved.
- [ ] Context token/session contract approved.

## Tenant creation and Workspace boundary

- [x] Every verified user may explicitly request Tenant creation within plan/policy bounds.
- [x] Google sign-in, invitation acceptance, and first membership do not auto-create a Tenant.
- [x] Tenant is the ownership, isolation, billing, governance, federation, data-policy, connection, audit, and lifecycle boundary.
- [x] Workspace is a Tenant-owned operational context and not a mini-Tenant.
- [x] Every Workspace belongs to exactly one Tenant.
- [x] Workspaces bind to Brands, Departments, Groups, Activities, Roles/profiles, Agents, and resources through explicit typed bindings and grants.
- [x] Personal-account Tenant and personal Workspace are optional and isolated.
- [x] Multi-Brand Workspaces are disabled by default and remain same-Tenant when enabled.
- [x] Cross-Tenant Workspaces are forbidden.
- [x] Explicit owner assignment replaces first-membership ownership inference.
- [x] Workspace deletion and Tenant offboarding have separate dependency-disposition lifecycles.
- [ ] Tenant/Workspace type registries and migration mapping approved.
- [ ] Tenant-creation entitlements and provisioning rules approved.
- [ ] Multi-Brand Workspace policy and conflicts approved.
- [ ] Workspace deletion and personal-account lifecycle approved.

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

## Layered purpose-bound data governance

- [x] Access authority is necessary but insufficient for consequential data use.
- [x] Classification uses sensitivity tiers plus category attributes and non-downgradable protected classes.
- [x] Every consequential use declares a registered purpose with eligible classes, operations, audiences, destinations, providers/models, regions, retention, and approvals.
- [x] Lawful-basis and consent evidence is versioned, purpose-bound, and revocable where applicable.
- [x] Residency covers storage, processing, models/providers, backups, exports, and cross-border transfer mechanisms.
- [x] Retention and legal hold are independent; hold prevents scoped deletion without granting read authority.
- [x] Privacy requests cover access, export, correction, restriction, erasure, objection, and consent withdrawal.
- [x] Lineage and disposition cover summaries, embeddings, indexes, Agent memory, evaluations, analytics, aggregates, artifacts, provider copies, and backups.
- [x] Provider/model data-use policy covers prompt/response retention, evaluation, training, fine-tuning, embeddings, Agent memory, provider training, deletion, and zero-retention mode.
- [x] Raw cross-Tenant learning is forbidden and aggregate learning is privacy/cohort/contribution/residency/fairness governed.
- [x] Every consequential operation binds an immutable data-use decision and governance version vector into the manifest.
- [x] Most-restrictive applicable rule wins and missing, stale, conflicting, revoked, or ambiguous evidence fails closed.
- [ ] Initial classification, purpose, lawful-basis, retention, and jurisdiction policy-pack seeds approved for implementation.
- [ ] Exact aggregate-learning cohort, contribution, re-identification, fairness, and opt-out thresholds approved.
- [ ] Implementation and migration scope authorized.

## Dynamic Commercial and FinOps

- [x] Commercial semantics are database-authoritative through versioned registries and specialized scoped records.
- [x] Initial billing models include Credits and Direct Monetary Billing, with future compatible models activated through registry governance.
- [x] Initial monetary collection modes include prepaid balance and postpaid invoice.
- [x] Credits, money, and usage units are separate assets with explicit conversion contracts where allowed.
- [x] Users customize only template-exposed typed billing-profile fields within contract, plan, Tenant, delegated, risk, tax, accounting, and payment bounds.
- [x] Billing profile resolution uses most-restrictive limits and blocks equal-ranked incompatible selections.
- [x] One direct non-transitive billable owner and billing account resolve per cost-bearing operation.
- [x] Tokens are one meter family; operation, duration, data, storage-time, compute, AI modality, retrieval, seat/entity, concurrency, channel, business-operation, and verified-outcome meters are supported.
- [x] Units, conversions, scaling, rounding, minimum increments, aggregation, deduplication, correction, verification, late events, and composite-meter semantics are registered and versioned.
- [x] Raw technical usage, billable usage, rating, provider/internal cost, customer charge, estimate, reservation, settlement, and ledger posting remain separately explainable.
- [x] Included units apply before Credits or monetary rating and do not become a third settlement asset.
- [x] Reservation is atomic, idempotent, concurrency-safe, expiry/epoch bound, and mandatory before cost-bearing dispatch unless bounded postpaid policy explicitly allows otherwise.
- [x] Streaming usage uses bounded reservation extension and safe-stop behavior.
- [x] Settlement requires verified usage/outcome evidence and cannot exceed authorization without approved overage.
- [x] Ledger posting is append-only, double-entry balanced, and corrections/refunds/disputes use compensating entries.
- [x] Grace, past-due, paused, cancelled, fraud, and security behavior is registered and fail-closed.
- [x] Manifest binds billing profile/model, meters/units, rating/price, estimate, reservation, standing, policy versions, and commercial epoch.
- [ ] Initial registry seed values, profile templates, price books, tax/discount, FX, overage, and standing policies approved for implementation.
- [ ] Accounting chart, posting rules, period close, invoice, payment, refund, dispute, and reconciliation ownership approved.
- [ ] Implementation and migration scope authorized.

## Review status

- [ ] Product terminology approved.
- [ ] Typed field/operator registry approved.
- [x] Layered purpose-bound privacy, consent/lawful-basis, retention, residency, model/provider data-use, lineage/disposition, and aggregate-learning policy approved at design level.
- [ ] Initial pilot family and context approved.
- [ ] Implementation scope authorized.
