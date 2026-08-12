# Tenant route follow-up readiness — 2026-08-12

## Scope

This evidence records the current-main reconciliation of the open Tenant workstreams and the bounded local repair added by the follow-up branch `feat/tenant-brand-asset-scope`. It does not claim Production completion, migration apply, provider certification, Cloudflare recovery, or tenant canary success.

The follow-up deliberately reuses the existing canonical Brand Core asset materialization route and service instead of creating a parallel Brand asset endpoint or authority store.

## Current-main reconciliation

| Workstream | Current source evidence | Local outcome in this follow-up | Remaining closure gate |
|---|---|---|---|
| #4451 Tenant capability discovery and self-repair | `tenantPlatformPluginRoutes.js` uses canonical `createUserJwtMiddleware()` and derives tenant identity from authenticated membership; eligibility blockers and connector contracts are already covered by existing tests. | No duplicate asset or auth implementation was added. The follow-up hardens the shared resource route family to consume only canonical parsed User-JWT output. | Production tenant canary, complete capability/runtime/certification parity, and managed repair readback remain required. |
| #4447 Brand Core | `workspaceBrandLifecycle.js` already provides idempotent Brand creation, `tenant_brand_links`, brand workspace binding, and creator grant. `workspaceGrantResourceAuthority.js` rejects missing, inactive, ambiguous, and cross-tenant Brand references. The canonical `workspaceBrandCoreAssetMaterialization.js` service and `resourceApiRoutes.js` route already provide Brand Core asset materialization with lineage/readback tests. | Preserved the canonical materialization path and removed the remaining local JWT fallback from `resourceApiRoutes.js`; the shared tenant auth regression now covers resource routes as well as workspace/plugin routes. | Profile inheritance, full invitation/delegation lifecycle, actual provider/content ingestion, monitoring, and exact Production readback remain open. |
| #4448 Growth Audit | Tenant Growth Control Plane routes are mounted behind canonical auth parsing and tenant guards. | No parallel audit lifecycle was created. | Scope/plan/execute/evidence/report/delivery/acknowledgement/rerun and Production canary still require their own governed implementation and readback. |
| #4450 Monitoring and customer-safe readback | Tenant observability route has canonical tenant membership resolution and a parser-before-guard contract. | No broad signal model was invented in this bounded repair. | Full six-domain signal matrix, contradiction/SLA/readback coverage, dedupe, and canary evidence remain open. |
| #4446 WordPress/Hostinger self-repair | Existing source contains managed execution and provider-readiness foundations, but connection/binding/certification and stale-grant closure are runtime-dependent. | No provider or credential path was called. | Exact provider binding/certification, stale-grant reconciliation, governed apply, rollback and runtime SHA readback remain required. |
| #6813 / #6871 / #5459 | Issue contracts explicitly require dedicated Production DB authority, migration dry-run/readback, or authoritative Production schema evidence. | No Production DB or migration operation was attempted. | External authority, fresh authorization, exact runtime readback, and issue-specific closure artifacts. |

## New bounded local contract

The follow-up repair is a **canonical authentication boundary** for `resourceApiRoutes.js`. The route family no longer owns an ad-hoc `jsonwebtoken` verifier or a development fallback secret. It consumes only `req.auth` produced by `createUserJwtMiddleware()`, rejects a request that contains only an Authorization header, and preserves the parsed User-JWT principal for tenant resource handlers.

The existing Brand Core materialization route remains the canonical asset path. Its service already enforces Root Workspace → Brand Container topology, Brand Core source identity, idempotent workspace asset identity, provenance, and same-cycle readback; this follow-up adds no duplicate asset mutation surface.

## Verification performed locally

The following checks pass locally on the follow-up branch:

- `node --check routes/resourceApiRoutes.js`
- `node test-tenant-route-canonical-user-jwt-auth.mjs`
- `node test-workspace-resource-grant-assignment.mjs`
- `node test-workspace-resource-grant-canonical-validation.mjs`
- `node test-brand-core-asset-materialization-operation-governance.mjs`
- `node test-workspace-brand-core-asset-materialization.mjs`
- `git diff --check`

The E2E contract is `.changes/e2e/tenant-route-auth-hardening.json`; the existing canonical Brand Core materialization tests remain the regression for asset lineage and readback.

## Non-authorizations

This change does not authorize migration apply, Production DB writes, provider calls, credential reads, active external exports, Cloudflare changes, force-pushes, or direct merge to `main`. Closure of the remaining Tenant workstreams still requires the exact runtime and authority readbacks stated in their issue contracts.
