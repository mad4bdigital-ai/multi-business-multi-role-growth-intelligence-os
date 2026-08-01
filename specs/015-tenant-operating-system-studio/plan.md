# Implementation Plan

## Phase 0 — Convergence and brownfield proof

1. Inventory exact current-main implementations and schemas for Spec 006, 010, 011, 012, Dynamic Container Authority, asset catalogs, workflow runtime, UI manifests, resource APIs, provider connections, approvals, audit, and lifecycle registries.
2. Build a field-level reuse matrix for every logical entity in `data-model.md`.
3. Inventory PR #3922 and classify each artifact as:
   - generic business-profile substrate;
   - generic package/Blueprint substrate;
   - retail-commerce child-pack content;
   - obsolete/duplicated/current-main conflict.
4. Inventory PR #4432 and classify each artifact as:
   - generic package-development assurance template;
   - evidence-intelligence child-pack content;
   - Google Workspace/Gemini adapter-specific content;
   - obsolete/duplicated/current-main conflict.
5. Resolve duplicate `Spec 014` identity and assign current canonical paths before merge or reconstruction.
6. Update Work Map and schema-domain classification. No runtime work starts before this phase is reviewed.

## Phase 1 — Package and component registry foundation

- add or map package definitions, versions, publications, component definitions/versions, component bindings, dependencies, and compatibility;
- preserve existing asset/workflow registries through references;
- add strict package/component JSON Schemas;
- add lifecycle and immutable-version enforcement;
- add no-secret, cycle, compatibility, and provenance validators;
- add read-only Admin/Tenant inspection APIs first.

## Phase 2 — Installation compiler and revisions

- add installation identity, target scope, version policy, draft configuration, sparse overrides, extensions, bindings, and immutable resolved revisions;
- implement deterministic package compiler;
- produce lineage, conflicts, version vectors, context hashes, and impact previews;
- integrate Business Operating Profile and Activity Pack applicability;
- fail closed on stale, missing, ambiguous, or incompatible dependencies.

## Phase 3 — Custom entity and lifecycle components

- map tenant custom entities to approved Resource/persistence patterns;
- implement strict field/relationship definitions and compatibility classification;
- implement tenant lifecycle definitions using stable runtime transition primitives;
- add state/transition/guard/approval/SLA/event/compensation contracts;
- add migration previews and rollback behavior.

## Phase 4 — Form, survey, file, and client-link components

- implement versioned forms, branching, dynamic options, prefill, handlers, receipts, and idempotent submissions;
- implement bounded client-link identity;
- implement package file policies over existing Workspace File Fabric/resource authorities;
- add naming/routing/sharing/retention/quarantine/readback contracts;
- prove cross-client and personal/shared-storage isolation.

## Phase 5 — AI, UI, reports, and generated surfaces

- implement AI authoring assistant as draft-only structured proposals;
- map operational AI use cases to provider abstraction and policy registries;
- implement UI surface definitions for tables, forms, kanban, calendar, timeline, queue, dashboards, portals, and reports;
- route generated surfaces through unified tenant-safe frontend dispatch;
- add Arabic RTL, mobile, accessibility, and field/action authority tests.

## Phase 6 — Publication, installation, activation, and upgrades

- implement private/tenant/shared/curated publication policies;
- implement install/configure/validate/ready/activate lifecycle;
- bind acceptance evidence and exact candidate hash;
- implement three-way upgrades and migration planning;
- implement rollback, suspend, archive, retirement, and continuity behavior;
- maintain fresh final operation authorization after activation.

## Phase 7 — Agency/client delegation and portability

- productize clients-as-Brands and client-owned-Tenant delegation journeys;
- implement portfolio-safe projections;
- implement handover cases, export manifests, non-transferable findings, and delegation revocation order;
- prove system continuity after agency removal;
- define package IP versus installation/data/file/connection ownership contracts.

## Phase 8 — Reference packages

### Evidence Intelligence Pack

Reconstruct applicable content from PR #4432 on current main as a child package:

- entities/forms/lifecycles/file rules;
- Gemini use cases;
- human review;
- Research/Audit links;
- package acceptance and development-assurance template.

### Retail Commerce Pack

Reconstruct applicable content from PR #3922 on current main as a child package:

- Business Operating Profile substrate retained generically where appropriate;
- commerce/POS/inventory/payment/WooCommerce/ERPNext modules remain package-specific;
- package validates without making Commerce a universal platform requirement.

## Phase 9 — Pilot and rollout

Pilot matrix:

1. individual freelancer with one internal package;
2. agency Tenant with two client Brands using one package and different overrides/connections;
3. client-owned Tenant with delegated agency access and successful revocation/handover;
4. Evidence Intelligence Pack;
5. Retail Commerce Pack in sandbox-only mode.

Rollout states:

```text
disabled → internal_authoring → sandbox → shadow → pilot → tenant_canary → broader_tenant → production
```

## Child PR sequence

- **PR-015-01** convergence inventory, Work Map, and reuse matrix;
- **PR-015-02** package/component contracts and registries;
- **PR-015-03** installation compiler, lineage, and impact preview;
- **PR-015-04** entity/relationship/lifecycle components;
- **PR-015-05** forms/client links/file policies;
- **PR-015-06** AI authoring and operational AI definitions;
- **PR-015-07** generated tenant/client surfaces and reports;
- **PR-015-08** publication/install/activation/upgrade/rollback;
- **PR-015-09** agency delegation, portfolio isolation, portability, handover;
- **PR-015-10** Evidence Intelligence reference pack reconstruction;
- **PR-015-11** Retail Commerce reference pack reconstruction;
- **PR-015-12** pilot, hardening, runbooks, production readiness, closeout.

## Migration posture

- additive first;
- existing asset/workflow/configuration records remain authoritative until shadow parity and adoption evidence exist;
- no mass rewrite of current tenant assets;
- candidate mappings are generated read-only first;
- every activation has rollback/disable posture;
- database presence is not production migration evidence;
- all new tables register owner, sensitivity, retention, backup, and recovery class.

## Definition of implementation readiness

A slice becomes ready only when:

- its current-main brownfield sources are identified;
- schema-domain and Work Map classifications are resolved;
- requirements, operation paths, contracts, tests, and rollback are present;
- required open decisions are closed;
- allowed paths and forbidden actions are explicit;
- no stale candidate-branch result is treated as current-main evidence.

## Definition of done

The product is not complete until:

- a non-developer Tenant can author and validate a package from the Studio;
- two client installations prove strict isolation;
- delegated agency access can be revoked with client continuity;
- package compilation, installation, upgrade, and rollback are deterministic and evidenced;
- generated surfaces are usable and tenant-safe;
- AI cannot create authority;
- reference packages validate and run through real platform authorities;
- migration, runtime health, fallback, observability, backup, handover, and production parity evidence exist;
- unresolved work is explicitly owned, deferred, blocked, or retired.