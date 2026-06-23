# Implementation Plan

## Phase 0 — Canonical and overlap alignment

- Rebase after PR `#1894` is resolved.
- Add canonical domain pages for tenant asset federation to `system_bootstrap`, `direct_instructions_registry_patch`, `module_loader`, and `prompt_router` sources.
- Update `AI_Agent_Knowledge_Guide.md` and rebuild generated canonicals.
- Define tenant-safe asset classification and mandatory platform policy floor.

## Phase 1 — Additive SQL foundation

Create one governed migration for:

- platform asset catalog;
- tenant instances and versions;
- composition profiles and scope bindings;
- generic grants;
- connection bindings;
- upgrade runs;
- resolution ledger;
- effective views and parity views.

No existing grant table is removed or changed into a compatibility view in this phase.

## Phase 2 — Read-only catalog and resolver

Implement layered services under:

- `src/domain/tenantAssets`
- `src/application/tenantAssets`
- `src/infrastructure/tenantAssets`
- `src/api/tenantAssets`

Add read-only catalog, instance read, effective resolution, and readiness endpoints. Run the generic resolver in shadow mode against existing specialized authorities.

## Phase 3 — Adoption and editable versions

Add idempotent adoption, overlay/fork creation, draft versioning, validation, publish, rollback, and audit/readback. Enforce platform-base immutability and bounded patch schemas.

## Phase 4 — Scope composition

Add user-managed composition profiles and bindings for tenant root, workspace, brand, activity type, role, and composites. Certify union/intersection behavior, deterministic precedence, conflict blocking, and explicit deny semantics.

## Phase 5 — Credential and installation integration

Bind tenant asset instances to existing connection/vault authorities. Add credential readiness without secret exposure. Require installation and smoke certification for operational readiness.

## Phase 6 — Grant bridges

Bridge generic grants to existing specialized authorities:

- agent skills;
- agent workflows;
- app actions;
- workspace resources;
- policies and execution authority.

Record parity gaps. Do not cut over any asset family until same-cycle parity, isolation, and execution tests pass.

## Phase 7 — Tenant UI/GPT surfaces

Expose catalog, adoption, editable version, scope profile, connection setup, readiness, and upgrade guidance through Tenant GPT and dashboard surfaces. Show at most three prioritized next actions and distinguish missing evidence from zero.

## Phase 8 — Controlled cutover

Cut over one low-risk read-only asset family first. Expand by asset family after certification. Write/consequential actions remain behind capability, credential, resource, quota, approval, audit, and readback gates.

## Verification gates

- migration preflight and authorization;
- schema/view readback;
- cross-tenant isolation tests;
- deterministic union/intersection tests;
- conflict and deny tests;
- overlay/fork version tests;
- credential non-disclosure tests;
- specialized bridge parity tests;
- OpenAPI coverage;
- runtime policy and architecture checks;
- dev verification before production promotion;
- production parity and behavioral readback.

## No-go conditions

- unresolved PR overlap with the Resource API architecture;
- missing tenant membership enforcement;
- any secret value copied into tenant asset JSON;
- union mode bypassing mandatory safety;
- specialized/granular runtime cutover without parity;
- ambiguous connection or scope resolution;
- missing rollback/readback evidence.
