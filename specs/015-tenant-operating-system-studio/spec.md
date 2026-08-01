# Feature Specification: Tenant-Authored Operating Systems, Solution Packages, and Lifecycle Studio

**Branch:** `gpt/spec-015-tenant-operating-system-studio-20260801`  
**Status:** Draft; specification-only; implementation blocked pending Work Map and convergence review  
**Delivery:** Multi-PR  
**Spec owner:** platform-team

## 1. Problem statement

The platform already contains strong foundations for dynamic workflows, typed capabilities, configuration inheritance, tenant/workspace/Brand context, provider adapters, generated frontend surfaces, audit evidence, approvals, and durable execution. However, those foundations are distributed across technical registries and Specs.

A freelancer, agency, or company cannot yet use one tenant-facing product to define a complete reusable operating system for its own business or clients. The current model is strongest at authoring individual assets and workflows. It does not yet provide one governed package that combines entities, forms, lifecycles, files, AI, dashboards, reports, connections, roles, tests, installation, upgrades, transfer, and closeout.

The required product is a **Tenant Operating System Studio** whose unit of composition and distribution is a versioned **Solution Package**.

## 2. Goals

- **G-001** Allow a tenant to create a complete business system without changing the platform stable kernel.
- **G-002** Let agencies reuse one package across multiple clients while preserving exact client/Brand isolation.
- **G-003** Let a client own its own Tenant and delegate bounded operating access to an agency.
- **G-004** Compose existing platform assets, workflows, capabilities, policies, connections, and UI manifests rather than copy them silently.
- **G-005** Support install, configure, override, extend, fork, tenant-author, publish, upgrade, rollback, transfer, and retire.
- **G-006** Make every effective field, step, policy, connection requirement, and UI surface explainable through lineage and revision vectors.
- **G-007** Make system generation AI-assisted but never AI-authoritative.
- **G-008** Generate tenant-safe runtime surfaces from strict package contracts.
- **G-009** Allow package validation, sandboxing, sample-data simulation, acceptance testing, and canary activation.
- **G-010** Preserve portability and handover when an agency/client relationship changes.
- **G-011** Make package development requirements and tests machine-readable.
- **G-012** Keep package content free from credentials, grants, secrets, and implicit authority.

## 3. Non-goals

- No arbitrary tenant JavaScript, SQL, shell, or network code as configuration authority.
- No package installation may grant capabilities or permissions by itself.
- No tenant package may remove mandatory platform security, approval, audit, readback, retention, or isolation policy.
- No silent copy of provider credentials between Brands, Workspaces, Tenants, packages, or forks.
- No one-size-fits-all business system.
- No assumption that a recommended Blueprint or AI-generated package is ready for activation.
- No destructive uninstall that removes business records or audit evidence by default.
- No cross-client portfolio view that exposes client-private content.
- No replacement of Spec 006 workflow runtime, Spec 011 control plane, Spec 012 context authority, or existing connector authorities.

## 4. Actors

| Actor | Responsibilities |
|---|---|
| Individual tenant owner | Create and operate systems for personal/freelance work |
| Agency tenant owner | Publish reusable private packages and manage client installations |
| Tenant system designer | Define entities, forms, lifecycles, workflows, files, AI, surfaces, and reports |
| Brand/client administrator | Configure one installation and approve activation |
| Client approver | Review outputs and bounded changes for one client scope |
| Tenant operator | Use generated surfaces and run permitted workflows |
| Platform administrator | Publish mandatory policy, certify primitives, inspect conflicts, and govern rollout |
| Package reviewer | Validate compatibility, security, tests, and publication readiness |
| Background compiler/worker | Compile package revisions and execute bounded jobs without acquiring user authority |
| AI assistant | Propose schemas, fields, workflows, mappings, tests, and documentation as drafts |

## 5. Core concepts

### 5.1 Solution Package

A canonical, versioned composition of tenant-eligible components. It is a product definition, not an authority grant or live installation.

### 5.2 Package Version

An immutable normalized manifest plus referenced component revisions, compatibility requirements, content hash, migration plan, and acceptance suite.

### 5.3 Package Publication

A policy-controlled statement that a package version is visible to a bounded audience and may be installed under declared modes.

### 5.4 Package Installation

A scope-bound reference to one package version or version policy, attached to an exact Tenant/Workspace/Brand/client context.

### 5.5 Installation Revision

An immutable resolved snapshot containing package version, overrides, extensions, connections, role bindings, policies, sample-data/test evidence, and context hash.

### 5.6 System Blueprint

A recommendation and composition pattern. A Blueprint may propose packages and configuration but does not activate them.

### 5.7 Component

A package-referenced versioned definition such as entity, form, lifecycle, workflow, file policy, AI use case, UI surface, report, role template, connector requirement, or acceptance suite.

## 6. User scenarios

### US-001 — Freelancer builds a client delivery system

A freelancer creates a package containing Accounts, Contacts, Research, Evidence, Audit, Opportunity, Project, Delivery, Approval, and Outcome entities; client onboarding forms; evidence and Audit lifecycles; Drive file rules; Gemini-assisted drafts; dashboards; reports; and acceptance tests.

**Expected:** the package remains draft until all schemas, references, policy requirements, tests, and required manual reviews pass.

### US-002 — Agency installs one package for several clients

An agency installs the same package for Brand A, Brand B, and Brand C.

**Expected:** each installation has independent records, files, connections, overrides, lifecycle state, reports, costs, permissions, audit evidence, and upgrade decisions.

### US-003 — Client owns a separate Tenant

A client installs a package in its own Tenant and grants the agency delegated operating access.

**Expected:** the client retains ownership of data, files, package installation, and connections; revoking the agency does not break the system or transfer data ownership.

### US-004 — AI creates a package draft

The user describes the desired system in Arabic. AI proposes entity schemas, forms, workflows, lifecycles, dashboards, and acceptance cases.

**Expected:** all output is untrusted draft data; unsupported fields, invalid references, dangerous effects, and missing policies block validation.

### US-005 — Configure and activate an installation

A Brand administrator selects a package, resolves required profile fields and connections, applies sparse overrides, loads sample data, runs the acceptance suite, previews impact, and requests activation.

**Expected:** activation creates an immutable installation revision, evaluates fresh authority, and does not copy credentials or grants.

### US-006 — Upgrade with local customizations

A package publisher releases a compatible version.

**Expected:** the installation receives a three-way compatibility preview across origin version, new version, and local overrides/extensions. Conflicts block; compatible changes may be approved and activated as a new revision.

### US-007 — Fork for a specialized client

An agency forks a package for a regulated client.

**Expected:** origin lineage remains immutable; mandatory platform policy survives; credentials and grants are not copied; later upstream updates are advisory only.

### US-008 — Transfer or end an agency relationship

The client requests handover.

**Expected:** the platform generates a portability report, validates ownership, removes delegated agency access, preserves the active installation, and records all transferred/non-transferable dependencies.

## 7. Functional requirements

### Package identity, ownership, and versioning

- **FR-001** Every package MUST have a canonical key, owner container, package class, lifecycle state, visibility policy, and immutable versions.
- **FR-002** Package keys, display names, marketplace labels, URLs, and aliases MUST NOT grant authority.
- **FR-003** Active, published, deprecated, and retired package versions MUST be immutable.
- **FR-004** A new edit MUST create a draft version with explicit parent lineage.
- **FR-005** A package MUST declare whether it is platform-owned, tenant-owned, shared-by-agreement, or forked.
- **FR-006** Package ownership MUST remain separate from installation ownership, data ownership, connection ownership, and execution authority.
- **FR-007** A package MUST contain no credential values, authority grants, membership rows, signed URLs, or raw provider payloads.

### Component composition

- **FR-008** A package MAY reference entity, relationship, form, survey, lifecycle, workflow, file, AI, UI, report, role, connector, policy, sample-data, migration, acceptance, and runbook components.
- **FR-009** Every component reference MUST pin a canonical key and compatible version rule.
- **FR-010** Compilation MUST fail closed for missing, ambiguous, deprecated-without-waiver, cyclic, incompatible, or unauthorized components.
- **FR-011** Package composition MUST use references and sparse local state; platform canonicals MUST NOT be copied or rewritten silently.
- **FR-012** A package dependency graph MUST be acyclic and bounded.
- **FR-013** Component schemas MUST use strict JSON Schema unless a bounded extension point is explicitly declared.

### Entity and relationship authoring

- **FR-014** Tenants MUST be able to define bounded custom entity types, fields, relationships, indexes, classifications, retention, and views.
- **FR-015** Entity fields MUST declare type, sensitivity, required state, validation, defaulting policy, source authority, editability, and lifecycle behavior.
- **FR-016** Relationship definitions MUST declare cardinality, ownership, cascade policy, cross-scope restrictions, and deletion/retirement behavior.
- **FR-017** Custom entities MUST map to approved persistence/resource patterns; arbitrary table or SQL names are forbidden.
- **FR-018** Schema changes MUST classify compatibility and provide migration preview before activation.

### Forms, surveys, and client links

- **FR-019** A package MUST support versioned forms, sections, fields, branching, dynamic options, prefill bindings, submission handlers, receipts, and error recovery.
- **FR-020** Client-facing forms MUST hide internal identifiers and expose only purpose-limited fields.
- **FR-021** Client links MUST be bounded, revocable, non-enumerable, scope-bound, and expiring where policy requires.
- **FR-022** Form submissions MUST be idempotent and bind to an exact form version and target installation revision.
- **FR-023** A form definition MUST NOT become execution authority.

### Lifecycle and workflow authoring

- **FR-024** Tenants MUST be able to compose lifecycle definitions with immutable versions, states, transitions, guards, effects, approvals, SLAs, timers, events, and compensation.
- **FR-025** Lifecycle transitions MUST use expected state/version and persist append-only transition evidence.
- **FR-026** Workflow graphs MUST reuse Spec 006 step types, compilation, approvals, outbox, callbacks, retries, compensation, and readback.
- **FR-027** Tenant-authored workflows MUST use only tenant-eligible certified capabilities and adapters.
- **FR-028** Mandatory platform and package policy MUST survive override, extension, fork, and upgrade.
- **FR-029** Internal draft effects, staging effects, production canary, and production writes MUST remain separate boundaries.

### File and evidence fabric

- **FR-030** A package MAY define file classes, folder templates, naming, routing, sharing, retention, duplicate, derivative, evidence, archive, and recovery policies.
- **FR-031** File policies MUST resolve against exact Tenant/Workspace/Brand/resource and connection ownership.
- **FR-032** Personal storage MUST NOT silently become authority for shared Brand/client assets.
- **FR-033** File moves, renames, shortcuts, shares, deletes, and restores MUST be idempotent, auditable, and readback-verified.
- **FR-034** Restricted or ambiguous files MUST fail into explicit review/quarantine states.

### AI-assisted authoring and operation

- **FR-035** AI MAY propose package manifests, fields, forms, lifecycles, workflows, prompts, mappings, tests, and documentation.
- **FR-036** AI output MUST validate as untrusted draft content and MUST NOT grant authority, publish, activate, delete, share, spend, or send externally.
- **FR-037** AI use cases MUST declare model alias, modalities, sensitivity policy, output schema, semantic validators, budget policy, and manual fallback.
- **FR-038** Package AI definitions MUST reference versioned prompt/model/policy registries and record lineage in every result.
- **FR-039** Prompt text and model output MUST NOT become executable policy or unrestricted expression authority.

### UI and generated surfaces

- **FR-040** A package MAY declare tables, detail views, forms, kanban, calendar, timeline, queue, dashboard, portal, report, and operator cockpit surfaces.
- **FR-041** UI surfaces MUST consume tenant-safe Resource/Application services and MUST NOT derive authority from manifest visibility.
- **FR-042** The Studio MUST display local, inherited, mandatory, blocked, missing, deprecated, and conflict states with source lineage.
- **FR-043** A package MUST expose an impact preview before publication, installation, activation, upgrade, rollback, or retirement.
- **FR-044** Generated surfaces MUST be accessibility- and localization-ready, including Arabic RTL.

### Publication, catalogs, and reuse

- **FR-045** Packages MUST support private, tenant-internal, shared-by-agreement, marketplace-candidate, platform-curated, deprecated, and retired publication states.
- **FR-046** Publication MUST declare audience, install modes, customization modes, version policies, certification, approvals, support, and license/usage constraints.
- **FR-047** A publisher MUST NOT expose client data, credentials, grants, or installation-specific overrides inside a package version.
- **FR-048** Marketplace or shared publication MUST require stronger review and sandbox evidence than private tenant use.

### Installation, configuration, and activation

- **FR-049** Installation MUST bind exact Tenant, Workspace, Brand/client, package version policy, owner, and target environment.
- **FR-050** Installation MUST NOT automatically create capabilities, memberships, credentials, or provider authority.
- **FR-051** Required profile fields, components, connections, resources, roles, policies, and approvals MUST resolve before activation.
- **FR-052** Installation configuration MUST use sparse, schema-valid overrides and approved extension points.
- **FR-053** Compilation MUST produce an immutable resolved installation snapshot, lineage, revision vector, compatibility report, context hash, and no-secret declaration.
- **FR-054** Activation MUST require current authority, successful acceptance evidence, no unresolved blocking conflicts, and same-cycle readback.
- **FR-055** Identical package/context/revision inputs MUST produce an identical normalized installation hash.

### Upgrade, rollback, fork, transfer, and retirement

- **FR-056** Upgrade MUST use three-way comparison among installed origin, target version, and local customization.
- **FR-057** Breaking changes MUST require explicit migration plan, backup/recovery posture, and owner approval.
- **FR-058** Rollback MUST create a new active revision or repoint through governed compare-and-set; historical evidence remains immutable.
- **FR-059** Platform updates MUST NOT silently rewrite tenant forks.
- **FR-060** Transfer/handover MUST distinguish package IP, installation configuration, business data, files, connections, credentials, and delegated access.
- **FR-061** Uninstall MUST default to disable/archive while preserving business records and audit evidence.
- **FR-062** Retirement MUST identify active installations and migration/continuity options.

### Agency and client operating models

- **FR-063** The platform MUST support multiple client Brands inside an agency Tenant with strict Brand/resource isolation.
- **FR-064** The platform MUST support client-owned Tenants with delegated agency operation.
- **FR-065** Delegation MUST be capability-, resource-, environment-, and time-bounded and independently revocable.
- **FR-066** Agency portfolio views MUST use allowlisted summaries and MUST NOT expose private client records across Brands/Tenants.
- **FR-067** Package defaults MAY be shared; client data, files, credentials, and approvals MUST never be inherited across clients.
- **FR-068** Handover MUST allow agency access removal without deactivating the client-owned system.

### Testing, assurance, and completion

- **FR-069** Every package version MUST declare contract, state-machine, security, isolation, compatibility, accessibility, and acceptance tests as applicable.
- **FR-070** The Studio MUST support sample data and sandbox runs isolated from production records and provider writes.
- **FR-071** Test success MUST bind exact package version, installation revision, component revisions, policy versions, and candidate hash.
- **FR-072** A validation report MUST distinguish ready, warning, blocked, not-applicable, not-evaluated, stale, and failed.
- **FR-073** Package development MAY use machine-readable work packets, but planning contracts never grant mutation authority.
- **FR-074** Closeout MUST verify package contract, runtime installation, generated surfaces, migration state if any, provider readiness, fallback, rollback, observability, documentation, and unresolved backlog.

## 8. Non-functional requirements

- **NFR-001 Isolation:** all package, installation, records, queues, caches, files, search, embeddings, reports, and metrics are scope-bound.
- **NFR-002 Determinism:** compilation and resolution are deterministic for identical revision vectors.
- **NFR-003 Security:** default deny, least privilege, no caller-controlled scope identity, no secret-bearing package content.
- **NFR-004 Durability:** accepted configuration, transitions, operations, and evidence survive worker restart.
- **NFR-005 Idempotency:** unsafe retries use durable operation identity and readback.
- **NFR-006 Portability:** packages and installation manifests have governed export/import contracts without secrets.
- **NFR-007 Compatibility:** additive implementation and shadow migration preserve existing assets/workflows.
- **NFR-008 Explainability:** effective values, conflicts, versions, and decisions expose bounded lineage.
- **NFR-009 Accessibility:** generated tenant/client surfaces target WCAG 2.2 AA and mobile use.
- **NFR-010 Localization:** Arabic RTL and English are first-class.
- **NFR-011 Performance:** bounded compilation, list, search, preview, and surface-dispatch latency.
- **NFR-012 Observability:** structured metrics, logs, traces, drift, and reconciliation without secrets.
- **NFR-013 Recovery:** backup, rollback, disable, handover, and manual fallback are testable.
- **NFR-014 Extensibility:** new component types require certified extension contracts, not kernel branching.
- **NFR-015 Governance:** active definitions and revisions are immutable and attributable.

## 9. Success criteria

- **SC-001** A tenant creates and validates one complete system package without runtime code changes.
- **SC-002** The same package is installed for two client Brands without record, file, connection, or permission leakage.
- **SC-003** A client-owned Tenant delegates and later revokes agency access without losing operation.
- **SC-004** AI-generated package content cannot activate or grant authority.
- **SC-005** Every installation snapshot exposes lineage and a deterministic hash.
- **SC-006** Upgrade conflict detection preserves local customization and blocks ambiguity.
- **SC-007** Rollback restores a prior working installation revision without deleting history.
- **SC-008** Package export contains no credentials, grants, client records, or signed URLs.
- **SC-009** Generated forms, queues, dashboards, and client portal obey the same context and authority services as APIs and agents.
- **SC-010** An Evidence Intelligence package derived from PR #4432 validates as a reference package.
- **SC-011** A Retail Commerce package derived from PR #3922 validates without making Commerce concepts mandatory for every package.
- **SC-012** Closeout cannot report complete from specification or UI presence alone.

## 10. Open decisions

- **OD-001** Select the canonical package/component persistence mapping onto existing asset/configuration registries.
- **OD-002** Define the initial tenant-eligible custom entity storage strategy.
- **OD-003** Define publisher visibility and commercial/licensing policy.
- **OD-004** Define import/export signature, provenance, and trust levels.
- **OD-005** Choose the first Studio UI delivery mode and schema-form renderer.
- **OD-006** Define package dependency and semantic-version compatibility policy.
- **OD-007** Define maximum tenant-authored schema, workflow, predicate, and surface complexity.
- **OD-008** Define agency/client portability and contractual ownership defaults.
- **OD-009** Define billing/quota attribution for shared packages and AI/provider use.
- **OD-010** Select pilot packages, Tenants, Brands, and acceptance thresholds.

## 11. Delivery state

This Spec defines convergence and product contracts only. Runtime implementation remains blocked until:

- Work Map classification is current;
- existing registry reuse is proven at field level;
- PR #3922 and PR #4432 have explicit extraction/reclassification plans;
- open architecture/security/product decisions required by the first implementation slice are resolved;
- child PR boundaries, tests, and rollback are approved.