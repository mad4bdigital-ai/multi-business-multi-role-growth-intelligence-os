# Specification: Shared Asset Fabric and Contextual Policy Composition

## 1. Problem

The platform already stores most agents, skills, workflows, actions, apps, plugins, engines, and policies as shared global definitions. Runtime access and context are distributed across tenant memberships, workspaces, brands, business activities, roles, grants, connections, policies, and newer Dynamic Container Authority registries.

The missing capability is a single explainable model that lets every authorized user:

1. discover and use shared platform assets without creating copies;
2. choose how eligible context layers compose for their work;
3. personalize non-authority behavior such as preferred agents, workflows, output style, and interaction mode;
4. create an optional variant only when an asset itself needs customization;
5. use tenant-owned credentials for apps, plugins, and provider actions;
6. benefit from adaptive recommendations driven by measured outcomes;
7. preserve mandatory safety, isolation, approval, quota, and certification controls.

## 2. Core decisions

### 2.1 Shared by default

Platform assets remain canonical and shared. A tenant grant, role, workspace, brand, or activity binding references the shared asset directly. Adoption or ordinary use creates no copy.

### 2.2 Variants are optional

A variant is created only after an explicit customization request by an authorized principal. The variant stores bounded patches against a shared base asset and has an owner scope such as user, role, workspace, brand, activity, or tenant.

### 2.3 Runtime composition is independent from variants

`union`, `intersection`, `deny_wins`, `minimum`, `maximum`, replacement, and ordered merge are runtime composition strategies. They determine how contextual layers combine. They do not describe asset ownership.

### 2.4 Authority and preference are separate

A user preference may rank, hide, or select among already-authorized options. It may not create authority, weaken mandatory policy, expose credentials, or enable an unready provider action.

### 2.5 Adaptation is proposal-driven

The platform may learn from explicit feedback, behavior, quality, and business outcomes, but it may only create no-secret adaptation proposals. A proposal must pass simulation, policy classification, and the required approval or canary process before changing an effective profile or variant.

## 3. Context layers

The resolver evaluates these conceptual layers:

1. mandatory platform safety floor;
2. tenant policy and entitlement;
3. workspace configuration;
4. brand governance and Brand Core;
5. business activity type constraints and defaults;
6. role authority;
7. user experience and workflow preferences;
8. bounded session/task context;
9. exact execution envelope, resource authority, connection, and credential readiness.

The physical graph may be multi-parent. Brand, activity, and workflow may be reached through more than one valid container path. Equal-precedence conflicts fail closed.

## 4. Asset families

The shared catalog must support at least:

- `agent`
- `skill`
- `workflow`
- `policy`
- `rule`
- `app`
- `plugin`
- `action`
- `tool`
- `endpoint`
- `logic`
- `engine`
- `knowledge`
- `profile`
- `dashboard_component`
- future registry-defined families

Catalog projection does not replace each canonical source table.

## 5. Composition profiles

A user may select or maintain composition profiles for eligible dimensions and contexts. A profile includes:

- owner principal;
- target container or context selector;
- dimension or policy family;
- allowed composition mode;
- required layers;
- precedence and tie-break behavior;
- conflict policy;
- effective dates;
- audit and version metadata.

A profile is valid only within modes allowed by the dimension registry and mandatory platform policy.

## 6. Typed policy algebra

The resolver must not merge arbitrary JSON. Every policy field is registered with a semantic type and merge operator.

Examples:

- allow/catalog sets: `union` or `intersection`;
- denies: accumulated union, with deny winning;
- requirements and validators: accumulated union;
- approval severity: maximum;
- risk and data sensitivity: maximum;
- budgets, quotas, and upper limits: minimum;
- scalar preferences: nearest or priority replacement;
- ordered workflows: stable topological merge;
- weights: bounded normalized weighted merge;
- prompts and knowledge: ordered append, de-duplicate, and token-budget enforcement.

## 7. Personalization

Every user may customize experience within their authority:

- preferred agents and workflows;
- explanation depth;
- language and tone;
- notification cadence;
- preferred channels;
- default dashboard views;
- autonomy preference within allowed policy;
- preferred tools among ready alternatives;
- personal composition profiles;
- optional personal variants.

Personalization never changes another user's preferences or the shared base asset.

## 8. Dynamic growth

The platform should continuously improve through governed evidence:

- recommendation shown/opened/accepted/dismissed/executed/result events;
- intent resolution quality;
- workflow success and verification;
- business KPI movement;
- user feedback;
- readiness and operational friction;
- variant and composition experiment results.

The system may recommend:

- a different shared workflow;
- a new composition profile;
- a personal or scoped variant;
- a missing connection or credential setup;
- a safer or more automated operating mode;
- promotion of a proven tenant-local improvement into a reusable platform candidate.

Cross-tenant promotion requires aggregation, privacy protection, admin review, certification, and a new shared asset version. Tenant content is never silently copied into the platform catalog.

## 9. Functional requirements

- **FR-001:** Shared assets are referenced directly without automatic copying.
- **FR-002:** Ordinary grants and use do not create variants.
- **FR-003:** An authorized principal may explicitly create a bounded variant.
- **FR-004:** Variants support user, role, workspace, brand, activity, and tenant ownership scopes.
- **FR-005:** Platform base assets remain immutable to tenant principals.
- **FR-006:** The resolver evaluates tenant, workspace, brand, activity, role, and user layers.
- **FR-007:** Composition mode is selected per eligible dimension or policy family, not as one unsafe global switch.
- **FR-008:** Modes are constrained by the dimension registry and platform safety floor.
- **FR-009:** Typed field operators determine effective policy values.
- **FR-010:** Deny, restriction, required approval, and mandatory validators cannot be removed by union or preference.
- **FR-011:** Intersection fails closed when a configured required layer is missing.
- **FR-012:** Equal-ranked conflicting replacements block with evidence.
- **FR-013:** User preferences can narrow or rank authorized options but cannot grant authority.
- **FR-014:** Role permissions, resource bindings, grants, and user preferences remain separately explainable.
- **FR-015:** Effective results include all contributing layers, assets, variants, operators, and blocking reasons.
- **FR-016:** Apps/plugins/actions use tenant- or user-owned connection references and never store credentials in asset definitions.
- **FR-017:** Catalog availability is distinct from grant, installation, certification, credential, and execution readiness.
- **FR-018:** Approval-sensitive active grants are distinguished from pending approval requests.
- **FR-019:** Adaptation begins as a proposal and never directly mutates effective authority.
- **FR-020:** Every adaptive proposal includes objective, evidence, expected impact, risk, affected scopes, simulation, rollback, and expiry.
- **FR-021:** Low-risk preference changes may be user-approved; authority and provider-write changes follow governed approval.
- **FR-022:** Experiments are scope-bounded, reversible, and measured against declared outcomes.
- **FR-023:** Successful tenant-local improvements may become platform promotion candidates only through separate governance.
- **FR-024:** Existing specialized authorities remain authoritative until shadow parity and cutover certification pass.
- **FR-025:** The Dynamic Container Authority must be seeded from canonical tenant/workspace/brand/activity/workflow subjects before enforcement.
- **FR-026:** Current `execution_policies` enforcement remains in place until contextual policy parity is proven.
- **FR-027:** Every effective runtime context is immutable, hashed, no-secret, versioned, and reconstructable.
- **FR-028:** Each user can preview and explain the exact effect of changing a composition profile before applying it.
- **FR-029:** Users can reset preferences or variants to shared defaults without affecting grants or credentials.
- **FR-030:** Platform learning and personalization include explicit data-use visibility and opt-out controls where applicable.

## 10. Non-functional requirements

- deterministic resolution for the same principal, context, epoch, registry version, profile version, and asset versions;
- bounded graph traversal and candidate counts;
- no raw secret values in catalog, profile, variant, proposal, experiment, ledger, or response;
- backward-compatible additive schema changes;
- idempotent mutations and same-cycle readback;
- cursor pagination for catalogs and history;
- stable structured errors;
- complete object-level tenant authorization;
- cache keys include authority epoch, composition profile version, and variant/base checksums;
- event-driven invalidation with bounded TTL fallback;
- framework-independent domain algebra under `src/domain`;
- no provider call before effective authority and credential eligibility are resolved.

## 11. Extended platform planes

The Context Compiler must consume evidence from independent planes rather than embedding every concern in one resolver:

1. Identity and Organization;
2. Tenant Federation and Lifecycle;
3. Blueprint and Layer Inheritance;
4. Context and Resource Authority;
5. Policy Composition;
6. Preference and Variant;
7. Data Governance;
8. Commercial and FinOps;
9. Model Governance;
10. Knowledge and Provenance;
11. Runtime Orchestration;
12. Connection and Provider Readiness;
13. Human Approval and Operations;
14. Resilience and Recovery;
15. Adaptive Growth.

Each plane has its own authority, lifecycle, audit, versioning, and rollback. The Effective Runtime Manifest references the contributing versions and decisions without becoming the write authority for those planes.

## 12. Extended functional requirements

- **FR-031:** Users, agents, services, and groups resolve through an authoritative principal graph with bounded nested membership and delegation.
- **FR-032:** Group membership, service identity ownership, break-glass use, and delegated authority are tenant-bound, expiring, auditable, and non-escalating.
- **FR-033:** Parent, partner, managed-client, and white-label tenant relationships never imply resource or data access without an explicit relationship policy and delegated grant.
- **FR-034:** Tenant suspension, ownership transfer, offboarding, export, legal hold, credential shutdown, and erasure are modeled as explicit lifecycle workflows.
- **FR-035:** Data use is constrained by sensitivity, purpose, consent or lawful basis where applicable, retention, residency, jurisdiction, and legal hold.
- **FR-036:** Personal preference and adaptation data can be inspected, exported, reset, or erased subject to the minimal immutable audit policy.
- **FR-037:** Entitlement, quota, credit, and budget are resolved separately from authorization and readiness.
- **FR-038:** Consequential cost-bearing execution follows estimate, reservation, execution, verification, settlement, and refund or adjustment.
- **FR-039:** Cost and usage entries are idempotent and linked to the exact manifest, execution, tenant, and billable owner.
- **FR-040:** Model selection is contextual and constrained by capability, task class, risk, data policy, region, tenant entitlement, quality evidence, cost, latency, and provider readiness.
- **FR-041:** Model fallback cannot weaken data-handling, residency, safety, quality, tool, or structured-output requirements.
- **FR-042:** Model, prompt, workflow, and tool versions require evaluation evidence and compatibility before promotion or contextual write use.
- **FR-043:** Every long-running or externally effectful operation declares delivery, idempotency, retry, deadline, cancellation, partial-success, and compensation semantics.
- **FR-044:** State changes that emit events use an outbox/inbox or equivalent deduplicated consistency contract.
- **FR-045:** Concurrency, reservations, tenant fairness, priority, and backpressure prevent duplicate effects and noisy-neighbor starvation.
- **FR-046:** Every artifact and knowledge object records schema version, checksum, source lineage, manifest reference, sensitivity, audience, ownership/license, freshness, verification, and retention.
- **FR-047:** Corrections, retractions, source expiry, and erasure propagate to derived artifacts, indexes, and promotion candidates.
- **FR-048:** Resolution supports an explicit `as_of` timestamp, scheduled future changes, historical replay, grace periods, and timezone normalization.
- **FR-049:** Environment, region, and jurisdiction are first-class context dimensions for connections, credentials, approvals, variants, models, data processing, and execution.
- **FR-050:** Preview, simulation, or non-production manifests cannot authorize production execution.
- **FR-051:** Plugins and packages require publisher identity, immutable digest, requested capabilities, trust policy, certification, and revocation.
- **FR-052:** Third-party or code-bearing packages require supply-chain evidence such as signature, dependency inventory, vulnerability review, license, and compatibility where applicable.
- **FR-053:** Contracts, policy DSL, manifests, variants, clients, models, and tools declare version and compatibility behavior with deprecation windows.
- **FR-054:** Tenants can export and import portable no-secret manifests for supported profiles, variants, grants, preferences, and artifacts with conflict validation.
- **FR-055:** Backup, restore, disaster, and degraded-mode evidence cover every new authority and preserve tenant isolation and manifest reconstructability.
- **FR-056:** Human approvals and managed operations include queue ownership, workload limits, fallback approvers, escalation, separation of duties, and rollback ownership.
- **FR-057:** Intent resolves first to a capability ontology, then to compatible asset implementations ranked by authority, readiness, quality, risk, cost, locale, and preference.
- **FR-058:** Quality evaluations cover asset family, activity, language, model, workflow, risk, grounding, policy, tool selection, and output contract.
- **FR-059:** Recommendation and experiment governance detects exposure bias, popularity feedback loops, manipulated events, and cross-tenant domination.
- **FR-060:** Cross-tenant learning uses approved aggregation, minimum cohorts, tenant privacy controls, and never exposes raw tenant content to another tenant.
- **FR-061:** The platform provides a registry-driven Layer Blueprint and Inheritance authority that supports current and future organizational, principal, agent, knowledge, capability, and asset layer families.
- **FR-062:** Every layer family retains a specialized canonical table or authority while generic typed relationship, closure, inheritance, compatibility, and provenance registries connect the layers.
- **FR-063:** Business Types may define versioned Department, Group, Role, member-profile, AI-Agent-profile, Business-Activity, knowledge-tree, workflow, policy, app, tool, engine, logic, graph, dashboard, metric, validator, prompt, and output-template Blueprints.
- **FR-064:** A Brand binds to one primary and optional secondary Business Types using versioned, effective-dated, approved bindings that grant no execution authority by themselves.
- **FR-065:** A Brand inheritance profile selects required, recommended, and optional Blueprints and declares merge, exclusion, replacement, pinning, upgrade, and local-override behavior per layer family.
- **FR-066:** Inherited organizational and profile Blueprints produce Brand-scoped layer instances; shared Skills, Workflows, Policies, Apps, Tools, Graphs, Engines, Logic, Knowledge, and other platform assets remain canonical references unless a bounded optional variant is explicitly created.
- **FR-067:** Departments are Brand-scoped and contain Groups; Groups contain or assign human members, AI agents, and service principals according to Brand/Tenant/Platform authority.
- **FR-068:** Member-profile, Role, and AI-Agent-profile Blueprints configure eligibility, placement, capabilities, knowledge, model policy, autonomy, cost, evaluation, and handoff bounds without auto-creating users, copying base agents, or granting authority.
- **FR-069:** Multiple Business Types compose per layer family using registered semantics such as guarded union, strict intersection, deny-wins, minimum, maximum, equivalence, supersession, priority, and block-on-ambiguity.
- **FR-070:** Blueprint and instance hierarchies use typed relationships and bounded closure tables with cycle detection, path limits, source versions, and deterministic checksums.
- **FR-071:** Every inherited instance and binding records Business Type, Blueprint/version, inheritance-profile/version, merge operator, local overrides, canonical source references, and effective authority/configuration epoch.
- **FR-072:** Blueprint updates run impact analysis and classify each inherited instance as auto-safe, review-required, conflicting, blocked, pinned, superseded, or revoked before adoption.
- **FR-073:** Removing a Business-Type binding or Blueprint requires a disposition plan for Departments, Groups, members, Agents, Roles, grants, schedules, approvals, variants, artifacts, and dependent layers.
- **FR-074:** Blueprint inheritance and settings resolve through Platform hard bounds, Platform defaults, Business-Type defaults, Tenant policy, Brand profile, delegated Department/Group settings, Workspace bindings, and non-authority Principal preferences.
- **FR-075:** The Effective Runtime Manifest includes the resolved layer-instance graph, inherited resource bindings, Blueprint provenance, conflicts, exclusions, local patches, upgrade state, and inheritance version vector.
- **FR-076:** A human user has one global platform identity that may be linked to Google and other identity providers without creating duplicate users or Tenants.
- **FR-077:** A team invitation targets an existing Tenant and carries an immutable, versioned scope for minimal Tenant membership plus exact Brand, Workspace, Department, Group, Role/profile, and resource grants.
- **FR-078:** Accepting a scoped invitation never creates a new Tenant or personal workspace automatically.
- **FR-079:** New Google invitees create or link a global user identity only after verified-email match, stable provider-subject validation, nonce/state validation, and explicit acceptance.
- **FR-080:** Invitation tokens are single-use, expiring, revocable, stored as hashes, delivered through an approved outbox channel, and never returned or logged after delivery.
- **FR-081:** Invitation acceptance is transactional, idempotent, authority-bounded, and creates/reactivates only the approved membership, grants, Department/Group assignments, and Role/profile bindings.
- **FR-082:** Scoped invitations disable broad default workspace grants; exact resource grants determine access while a minimal Tenant membership establishes the isolation boundary.
- **FR-083:** Existing users retain personal and other Tenant memberships; accepting an invitation cannot downgrade stronger target authority or alter unrelated contexts.
- **FR-084:** A personal-account Tenant and personal Workspace are optional, explicitly created, isolated from company Tenants, and limited by Platform policy.
- **FR-085:** Multi-membership users select an active Tenant, Brand, Workspace, Department, Group, and Role context through a revalidated context-switch contract rather than an implicit first membership.
- **FR-086:** Every verified global user may explicitly request creation of a Tenant within configurable plan, verification, risk, and policy limits while retaining memberships in other Tenants.
- **FR-087:** Google sign-in, invitation acceptance, and first membership never create a Tenant automatically.
- **FR-088:** A Tenant is the canonical ownership, isolation, billing, governance, federation, data-policy, connection, audit, and lifecycle boundary.
- **FR-089:** Every Workspace belongs to exactly one Tenant and is an operational collaboration/execution context rather than a mini-Tenant.
- **FR-090:** Workspaces connect to Brands, Departments, Groups, Business Activities, Roles/profiles, Agents, and resources through explicit typed bindings and grants.
- **FR-091:** Workspace access requires active Tenant membership plus all applicable organizational, Workspace, resource, environment, commercial, approval, and readiness checks.
- **FR-092:** Personal-account Tenants and personal Workspaces are optional, explicit or lazy, and isolated from company Tenants.
- **FR-093:** Multi-Brand Workspaces are disabled by default, remain inside one Tenant when enabled, and require explicit Brand bindings, grants, policy conflict resolution, and provenance.
- **FR-094:** Cross-Tenant Workspaces are forbidden.
- **FR-095:** Tenant ownership is represented by an explicit versioned owner-assignment authority and is not inferred from membership order.
- **FR-096:** Tenant creation is a governed provisioning workflow with status, idempotency, plan/entitlement checks, region selection, risk/verification, owner assignment, audit, and same-cycle readback.
- **FR-097:** Workspace deletion never deletes its Tenant or Brands and requires disposition of tasks, schedules, Agents, grants, artifacts, bindings, and active operations.
- **FR-098:** Tenant offboarding includes every owned Workspace and its dependent operational resources.
- **FR-099:** Creating or owning a Tenant never grants authority in another Tenant or changes existing memberships.
- **FR-100:** Commercial limits on owned Tenants and Workspaces are explained as entitlement restrictions and never presented as security or authorization failures.
- **FR-101:** Access authority alone never authorizes consequential data processing; every operation must also pass data-governance eligibility.
- **FR-102:** Data classification combines one sensitivity tier with zero or more category attributes, source/version evidence, and non-downgradable credential, secret, legal-hold, and regulated classifications.
- **FR-103:** Every consequential data operation declares a registered processing purpose whose rules define eligible data classes, operations, audiences, providers/models, regions, lawful basis, consent, retention, derived-data creation, approvals, and opt-out behavior.
- **FR-104:** Lawful-basis and consent evidence is purpose-bound, versioned, timestamped, revocable where applicable, and cannot override Platform, legal, security, contract, or Tenant prohibitions.
- **FR-105:** Residency and transfer policy independently constrains storage, processing, providers/models, backups, exports, destinations, and cross-border mechanisms.
- **FR-106:** Retention resolves by data class, purpose, Tenant/Brand/Workspace policy, artifact type, source contract, jurisdiction, subject request, and legal hold; retention expiry never overrides legal hold.
- **FR-107:** Legal hold is an independent scoped overlay that prevents governed deletion or mutation without granting any new read authority.
- **FR-108:** Access, export, correction, restriction, erasure, objection, and consent-withdrawal requests run as governed, identity-verified, auditable workflows with completion evidence.
- **FR-109:** Provenance and disposition propagate correction, restriction, retraction, erasure, and consent withdrawal to raw records, summaries, embeddings, indexes, Agent memory, evaluation samples, analytics, aggregates, artifacts, provider copies, and backups.
- **FR-110:** Derived data is never presumed anonymous solely because it was transformed; each dependent object receives an explicit delete, rebuild, invalidate, retract, anonymize, aggregate, hold, or minimal-tombstone disposition.
- **FR-111:** External model/provider eligibility includes region, retention, provider training, subprocessors, contract/certification, security posture, deletion capability, zero-retention mode, and registered-purpose compatibility.
- **FR-112:** Provider/model fallback blocks when it would weaken data-use, residency, transfer, retention, deletion, training, contract, or purpose requirements.
- **FR-113:** Raw cross-Tenant content learning is forbidden; privacy-governed aggregate learning additionally requires an approved purpose, Tenant participation policy, minimum cohort, contribution limits, residency compatibility, re-identification safeguards, provenance, and quality/fairness evidence.
- **FR-114:** Every consequential operation binds an immutable, explainable data-use decision and governance version vector into the Effective Runtime Manifest.
- **FR-115:** The effective data-use decision applies the most restrictive applicable Platform, jurisdiction, Tenant, Brand, Workspace, delegated organizational, resource, subject, operation, provider/model, region, audience, and destination rule and fails closed on missing, stale, conflicting, revoked, or ambiguous evidence.

## 13. Extended non-functional requirements

- every authority plane exposes versioned, deterministic, no-secret evidence;
- manifest creation remains bounded even when some planes are unavailable;
- unavailable evidence is represented as unknown or blocked, never as permissive zero;
- write dispatch revalidates temporal, environment, commercial, model, and authority versions;
- cost, model, artifact, privacy, and operation events share stable request/manifest/execution correlation;
- tenant export, retention, and disaster workflows are idempotent and read back;
- compatibility and quality gates block unsafe promotion instead of relying on client convention;
- zero-tolerance conditions include cross-tenant exposure, secret exposure, stale revoked dispatch, unapproved consequential effect, and unreconstructable critical execution.

## 14. Design Freeze prerequisites

Production contracts for the Context Compiler and Effective Runtime Manifest are not frozen until the following are approved:

1. principal/group/service identity authority;
2. tenant federation and offboarding lifecycle;
3. data purpose, retention, residency, export, legal hold, and erasure;
4. entitlement, reservation, settlement, and refund contract;
5. contextual model selection and evaluation;
6. universal async, idempotency, cancellation, and compensation;
7. artifact and knowledge provenance;
8. temporal, environment, region, and jurisdiction semantics;
9. plugin/package supply-chain trust;
10. initial quality suites and cutover thresholds.

## 15. Non-goals

This specification does not authorize automatic cross-tenant learning, silent policy mutation, automatic creation of one copy per tenant, copying credential values into variants, provider writes, bypassing approvals, or replacing current runtime enforcement before certified rollout.
