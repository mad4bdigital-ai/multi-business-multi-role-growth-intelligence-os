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

## 11. Non-goals

This specification does not authorize automatic cross-tenant learning, silent policy mutation, automatic creation of one copy per tenant, copying credential values into variants, provider writes, bypassing approvals, or replacing current runtime enforcement before certified rollout.
