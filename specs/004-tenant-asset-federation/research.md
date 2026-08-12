# Research Findings and Architectural Decisions

## 1. The platform is already shared-first

Core assets are global definitions. Tenant/user-specific state is generally represented through grants, bindings, connections, workspaces, brands, roles, and preferences. A one-copy-per-tenant design would increase storage, drift, upgrade complexity, conflict handling, and audit ambiguity without matching current architecture.

Decision: build a shared asset catalog projection and sparse optional variants.

## 2. The current policy runtime is global and textual

`runtimePolicyLoader.js` matches `execution_scope` and `affects_layer` strings from `execution_policies`. `runtimePolicyResolver.js` loads platform target rules as evidence but keeps `execution_policies` as enforcement and reports cutover disabled.

Decision: do not replace current enforcement immediately. Normalize existing policies into typed scoped atoms and run contextual shadow parity first.

## 3. Dynamic Container Authority is the correct context substrate

It already provides:

- dynamic container types;
- multi-parent DAG traversal;
- containment, sharing, delegation, reference, and management edges;
- classifications and merge strategies;
- role templates and assignments;
- resource dimensions and bindings;
- authority epochs, immutable ledgers, overrides, cache invalidation, limits, and rollout policy.

It is safer to extend this substrate than to create parallel workspace/brand/activity/role policy tables with independent resolution.

## 4. The container foundation is not operationally populated

The type/dimension registries are seeded, but live `containers`, relationships, assignments, bindings, and ledgers were empty during review. Rollout is shadow and enforcement/provider writes are disabled.

Decision: canonical projection and parity evidence are mandatory before any enforcement work.

## 5. Declared dimension strategies are richer than current resource execution

The dimension registry already assigns union, intersection, deny-wins, minimum, and nearest-replace strategies. Generic candidate resolution implements union/intersection, but current resource binding authorization uses deny-wins for safety and exposes the dimension strategy mainly as evidence.

Decision: retain deny-wins for authority, while adding typed composition for positive catalogs/preferences and policy fields. Do not reinterpret union as authorization bypass.

## 6. Variants already exist, but only for package-shaped assets

Package variants support scoped patches, risk, approval, certification, edit sessions, and merge runs. Their scopes omit workspace and role, and they do not cover every shared asset family.

Decision: reuse patch/version/risk concepts and add a generic shared-asset variant authority for non-package assets. Avoid forcing all canonical assets into package containers.

## 7. Preference data exists but is fragmented

Agent-surface and dashboard preferences exist; memory scope links include user/workspace/brand/activity/role/runtime references. None is a unified runtime preference contract.

Decision: create an allowlisted user runtime preference profile, then bridge compatible existing settings. Preference remains downstream of authorization.

## 8. The platform has enough learning signals

Recommendation events, intent resolutions, execution logs, workflow and step runs, output artifacts, adaptation records, readiness, and KPI evidence already capture much of the required feedback loop.

Decision: focus new work on attribution, proposal lifecycle, simulation, experiment governance, and promotion—not another raw event system.

## 9. Effective manifests are the missing attribution spine

Without a versioned manifest, outcomes cannot be reliably attributed to the exact context path, policies, profile, assets, variants, preferences, connection readiness, or authority epoch.

Decision: add an immutable effective runtime manifest linked to container resolution and execution evidence.

## 10. Personalization must be bounded by user trust

Dynamic personalization can become opaque or intrusive if inferred preferences silently change behavior. It can also become an escalation path if mixed with grants.

Decision: classify adaptations, show explanations, require confirmation based on risk, provide reset/opt-out/history, and prohibit authority mutation through preference.

## 11. Platform learning must not leak tenant intellectual property

A tenant-specific prompt, workflow, policy, or business practice may be proprietary even if it improves outcomes.

Decision: cross-tenant/platform promotion uses privacy-safe aggregate signals or explicitly reviewed candidates. It never copies tenant content into shared assets automatically.

## 12. Policy composition needs algebra, not precedence folklore

One fixed order such as “user overrides role overrides brand” is unsafe because fields have different semantics. Risk should take maximum, quota should take minimum, denies should accumulate, preferences may replace, and allowed catalogs may union or intersect.

Decision: register field semantics and operators. Layer order is evidence and tie-break context, not a universal override rule.

## 13. Discovery and execution should use different strictness

Users benefit from broad discovery but execution must remain restrictive.

Decision:

- discovery/read-only catalogs default to guarded union;
- write, spend, credential, deployment, and destructive execution use strict authority, deny-wins, and approval gates;
- the same profile can declare different behavior per dimension.

## 14. Existing Resource API architecture should shape interfaces

Latest `main` includes Resource API coverage conventions and Spec Kit templates. Public interfaces should cover list, get, search, permissions, changes, revisions, and readback with OpenAPI 3.1 and stable errors.

Decision: implement the new surfaces through existing resource-layer boundaries rather than standalone route files.

## 15. Repository branch continuity matters

The active PR branch diverged from `main`, but governed reconciliation found no overlapping files. Creating a replacement branch would fragment history and review context unnecessarily.

Decision: repair the current branch first through governed reconciliation and no-force updates. New branches are last resort.

## 16. Business-Type Blueprint inheritance is the missing reusable operating-model layer

The platform already has global Business Activity/Type registries, shared assets, Brand/workspace subjects, package variants, and Dynamic Container relationship semantics. It does not yet have a generic authority that lets a Business Type describe a reusable organizational and capability tree and lets a Brand selectively instantiate it with provenance.

Creating Department/Group/Role/Agent structures manually for every Brand would repeat setup and lose the platform's ability to improve Business-Type defaults. Copying Skills, Workflows, Policies, Apps, Tools, Graphs, Engines, Logic, or Knowledge into every Brand would recreate the duplication problem the shared-asset design is intended to solve.

Decision:

- Business Types own versioned Layer Blueprints, not live Brand entities;
- Brands bind to primary/secondary Business Types and publish inheritance profiles;
- inheritance creates Brand-scoped organizational/profile/binding instances only;
- specialized domain tables remain canonical;
- a generic typed layer/relationship/closure/provenance authority connects them;
- shared assets remain canonical references;
- multiple Business Types compose per layer family;
- Blueprint upgrades, pins, conflicts, rebase, replacement, supersession, revocation, and removal disposition are explicit lifecycles;
- Departments live under Brands, Groups under Departments, and human/Agent/service principals under or assigned through those organizational scopes.

This model generalizes beyond Departments to Roles, member profiles, AI Agent profiles, Activities, knowledge, capabilities, and future registered layers.

## 17. Recommended target architecture

```text
Shared canonical assets
        ↓
Shared catalog projection
        ↓
Business-Type Layer Blueprints
        ↓
Brand Business-Type bindings + inheritance profile
        ↓
Brand-scoped layer instances + canonical resource references
        ↓
Dynamic Container context + existing authority bridges
        ↓
Composition profile selection
        ↓
Typed policy algebra
        ↓
Optional scoped variants
        ↓
User preference ranking
        ↓
Connection/credential/install/certification/approval readiness
        ↓
Immutable effective runtime manifest
        ↓
Execution evidence and outcomes
        ↓
Governed adaptive proposals and experiments
```

## 17. Open decisions before implementation

- exact ownership and delegation rules for role-scoped profile publication;
- which policy families are user-selectable versus admin-only;
- data retention and export semantics for inferred preferences;
- minimum evidence thresholds by adaptive proposal class;
- whether generic variants extend package tables or share only domain services;
- policy atom bridge materialization versus runtime views;
- initial pilot tenant, workspace, brand, activity, and read-only asset family;
- migration sequencing relative to Dynamic Container production seeding.
