# Tasks: Dynamic Capability Governance and Universal Tool Projection

## Specification PR

- [x] T001 Define the platform-wide problem, scope, non-goals, and success criteria.
- [x] T002 Map existing capability, policy, authority, certification, projection, evidence, and debt sources.
- [x] T003 Define canonical identity and alias precedence.
- [x] T004 Define dynamic effect and risk classification.
- [x] T005 Define requirement compilation and fail-closed behavior.
- [x] T006 Define Admin/Tenant projection separation.
- [x] T007 Define shared enforcement, adapter, readback, and reconciliation boundaries.
- [x] T008 Define logical resources and additive data model.
- [x] T009 Draft OpenAPI 3.1 Admin and Tenant contracts.
- [x] T010 Define migration, compatibility, rollout, testing, threat, and operational models.
- [x] T011 Create requirements, security, and release-readiness checklists.
- [x] T012 Record multi-PR completion governance and no-runtime-effect specification evidence.

## Foundation implementation

- [ ] T100 Run fresh live data-source census and approve physical table/view names.
- [ ] T101 Implement registry inventory source adapters for all governed surface families.
- [ ] T102 Implement canonical surface descriptor normalization.
- [ ] T103 Implement canonical capability and alias resolver with ambiguity denial.
- [ ] T104 Implement deterministic effect/risk classifier.
- [ ] T105 Implement requirement compiler with source precedence and strict surface overrides.
- [ ] T106 Implement immutable manifest hashing and revision model.
- [ ] T107 Persist compilation runs, manifests, source links, and typed gaps through additive migration.
- [ ] T108 Add bounded Admin compile, manifest, and gap APIs.
- [ ] T109 Add compiler diagnostics and release-readiness coverage.

## Projection implementation

- [ ] T120 Implement Admin projection candidate compiler.
- [ ] T121 Implement Tenant-safe projection candidate compiler.
- [ ] T122 Enforce signed tenant/user context and schema allowlists.
- [ ] T123 Add projection reconciliation against existing tool/export tables.
- [ ] T124 Block unsafe active exports and shadow executable projections.
- [ ] T125 Add bounded Tenant effective capability list and preview APIs.
- [ ] T126 Add generated OpenAPI/schema parity without automatic callable promotion.

## Shared enforcement implementation

- [ ] T140 Implement application/domain shared enforcement kernel.
- [ ] T141 Bind invocation decisions to manifest revision and request hash.
- [ ] T142 Revalidate grants, resource authority, connection, credential scope, approval, and quotas.
- [ ] T143 Implement single-use state-changing envelopes and idempotency reservation.
- [ ] T144 Add compatibility wrappers and legacy/adaptive shadow evidence.
- [ ] T145 Block stale, ambiguous, missing-policy, or unevaluated required gates.

## Adapter, certification, and readback

- [ ] T160 Implement generic adapter descriptor and deterministic candidate resolution.
- [ ] T161 Implement generic versioned certification lifecycle and stale/revoked blocking.
- [ ] T162 Implement generic capability readback contract registry.
- [ ] T163 Implement acknowledgement, readback, verification, and unknown-effect states.
- [ ] T164 Reconcile specialized certification/readback sources through explicit source links.
- [ ] T165 Implement compensation authority checks and evidence preservation.

## Reconciliation and operational alerts

- [ ] T180 Implement manifest/projection/certification drift reconciliation.
- [ ] T181 Persist capability debt with ownership, severity, and closure lifecycle.
- [x] T182 Generate operational alerts from typed assurance gaps and runtime failures.
- [x] T183 Require matching operation/resource fingerprints for later-success resolution.
- [x] T184 Migrate operational alert sync/lifecycle tools as the first internal-write pilot.

## Capability cohorts

- [ ] T200 Migrate internal read-only cohort.
- [ ] T201 Migrate internal registry-write cohort.
- [ ] T202 Migrate provider read-only cohort.
- [ ] T203 Implement WordPress connection validation capability.
- [ ] T204 Run WordPress create-draft shadow and certified canary.
- [ ] T205 Keep WordPress publish disabled until separate high-impact approval and certification gates pass.
- [ ] T206 Migrate additional external-write cohorts capability by capability.
- [ ] T207 Preserve deployment, destructive, credential-touching, and local-device capabilities behind stricter independent cohorts.

### T201 governance writer prerequisite

Issue #6813 establishes the required source boundary for the internal registry-write cohort: ordinary runtime/database authority remains the reader, while canonical capability-envelope and governed-migration mutations use a dedicated, fail-closed Governance DB writer identity with table-scoped privileges. The source implementation, no-fallback contract, regression tests, and E2E phase are prerequisites for T201, but **T201 remains incomplete** until the dedicated Production principal is separately provisioned, bounded grants are verified, `GOVERNANCE_DB_*` secrets are configured without disclosure, Production parity is proven, and a no-secret privilege/readiness probe passes. Source merge alone must not mark T201 complete.

## Verification and closeout

- [x] T220 Add deterministic unit, integration, property, security, and parity tests.
- [x] T221 Register tests in the explicit test manifest.
- [ ] T222 Update OpenAPI splits, canonicals, knowledge guide, and resource coverage manifests.
- [ ] T223 Run CI, architecture drift, contract, resource coverage, and completion gates.
- [x] T224 Apply authorized additive migrations with checksum and schema readback.
- [ ] T225 Verify dev/staging shadow and canary evidence.
- [x] T226 Verify production commit/runtime parity and cohort status.
- [x] T227 Complete post-merge audit and record tracked residual debt.
- [ ] T228 Complete the final closeout PR and deprecation plan.

## Completion governance

- [x] T300 Select `multi_pr` because migration, production verification, and post-merge audit are required.
- [x] T301 Keep the specification PR free of runtime, provider, migration apply, and production enforcement changes.
- [x] T302 Record every merged implementation PR and SHA in `completion.json`.
- [ ] T303 Resolve every task and checklist item before marking the feature complete.
- [ ] T304 Run `node http-generic-api/scripts/spec-kit-completion-gate.mjs --changed` in every changed-scope PR.

### Operational alert pilot audit note

T182-T184 are marked implementation-complete based on live `main` evidence in `operationalAlertService.js`, `test-operational-alerting-control-plane.mjs`, `20260704_operational_alert_lifecycle_fingerprints.sql`, and `governed-migration-runner.mjs`. This does not mark the feature complete: production runtime parity, post-merge audit, and full completion bookkeeping remain tracked by T225-T228 and T303-T304.

### Migration apply/readback evidence note

T224 is marked complete based on governed readback evidence for `20260704_operational_alert_lifecycle_fingerprints.sql`: checksum `c84ff288afd3b351c48c3da22c9b2bc4298ad42ed29792e0db7da902ae254488`, statement count `3`, ledger run `5b602672-bdab-4aa1-9e46-4cc3f6a21350`, and `governed_migration_schema_readback` status `pass`. The readback tool reported no missing tables, columns, indexes, or rule conditions and no provider call, external write, row-data read, freeform SQL, or secrets.

### Production parity evidence note

T226 is marked complete based on production parity readback for commit `59d5c1e0991028dcd8ddc58e5a1294ec926662db`: expected and deployed commit SHAs matched, `production_parity` was `verified`, `runtime_health_status`, `migration_status`, and `activation_summary_status` were `pass`, and `blocking_gap_count` was `0`. The evidence used the summary-first `release_readiness` response added by PR #2370 and did not execute deploy, restart, SSH, migration apply, provider calls, or secrets. This does not complete dev/staging shadow or canary evidence or final closeout.

### Post-merge audit and residual debt note

T227 is marked complete based on post-merge readback after PR #2393: GitHub REST confirmed the PR was merged at `2026-07-09T15:16:09Z` with merge commit `c3250d42bbf67dd59f54fafd5513de785487eec1`, compare readback confirmed the merge commit is an ancestor of `main`, `release_readiness` run `fc43581c-d302-44e8-aafd-f76f4b56f075` returned `overall: warn` with zero fails, and `platform_tool_binding_integrity_audit` returned `pass` with `36/36` healthy bindings and `0` gaps. The residual debt is tracked as: `migration_drift` warning with `4` actionable migration artifact gaps, T225 dev/staging shadow and canary evidence still pending, T228 final closeout and deprecation plan still pending, and T303-T304 completion governance still pending. No deploy, restart, SSH, migration apply, provider external write, or secrets were executed.
