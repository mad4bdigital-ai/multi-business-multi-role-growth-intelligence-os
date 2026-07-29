# Spec 006 Task Reconciliation Baseline — 2026-07-24

## Purpose

This document reconciles the unchecked implementation tasks and production-readiness checklist for Spec 006 against direct repository evidence.

It is deliberately conservative:

- `implemented` requires a direct implementation plus focused verification evidence that matches the task.
- `partial` means related production code, schema, tests, or governance exists, but the complete task acceptance scope is not proven.
- `no_direct_evidence` means the baseline scan found no implementation evidence specific enough to close the task.
- Design documents, similarly named platform components, and generic capability surfaces do not by themselves close a task.
- This baseline does not change any checkbox in `tasks.md` or `checklists/production-readiness.md`.

## Summary

```text
total implementation tasks: 70
implemented: 7
partial: 25
no_direct_evidence: 38
checkboxes changed: 0
global enforcement enabled: false
secrets included: false
```

The completed and production-verified Dynamic Container slice is narrower than the complete Spec 006 scope. It covers container/authority foundations, shadow comparison, bounded canary controls, data remediation, and closeout evidence. It does not prove the full asset catalog, workflow compiler, settings resolver, durable workflow runtime, adapter suite, or all client surfaces.

## Epic A — Container and authority foundation

| Task | Classification | Evidence and rationale |
| --- | --- | --- |
| ADR for independent graphs | `partial` | `architecture.md` and the Dynamic Container design describe independent graph concepts, but no standalone accepted ADR was found. |
| Additive container and relationship migrations | `implemented` | `migrations/319_sprint69_dynamic_container_authority_foundation.sql`, `migrations/320_sprint69_dynamic_container_authority_runtime_contracts.sql`, and `test-dynamic-container-migration-preflight.mjs`. |
| Seed Platform Scope, Platform Admin Workspace, and Platform Brand | `partial` | Authority-scope and container-type seeds exist, and the platform brand exists globally. The exact three-node topology and verification test were not found as one evidence-backed seed contract. |
| Graph cycle and ambiguity validators | `implemented` | `dynamicContainerAuthority.js`, `dynamicContainerAuthorityMutationService.js`, `container_cycle_detected`, `container_path_ambiguous`, and focused foundation tests. |
| Principal and authority-grant repositories | `implemented` | `src/infrastructure/authorityScope/authorityScopeRepository.js`, `dynamicContainerAuthorityRepository.js`, role assignments, resource bindings, and repository tests. |
| Platform-principal and tenant-principal decision paths | `implemented` | `src/application/authorityScope/authorityScopeService.js`, domain authority-scope rules, shadow bridge, and `test-authority-scope-foundation.mjs`. |
| Object-level authorization matrix tests | `partial` | Cross-tenant and insufficient-role negative tests exist, but a complete matrix covering every principal/object/action combination was not found. |
| Platform-admin tenant access audit events | `no_direct_evidence` | No task-specific access-audit event contract and focused verification were found. |

## Epic B — Asset catalog and tenancy

All ten tasks are `no_direct_evidence` in this baseline:

- Asset definitions and immutable versions.
- Publication audience and policy evaluator.
- Tenant catalog discovery.
- Installation and binding flow.
- Sparse override validator.
- Named extension-point compiler.
- Governed fork with immutable lineage.
- Tenant-authored draft lifecycle.
- Upgrade preview, pinning, approval, and compatibility report.
- Deprecation, retirement, and uninstall behavior.

Related resource catalogs and capability registries exist elsewhere in the platform, but no Spec 006 asset-version/publication/install/fork lifecycle implementation and focused acceptance suite were found.

## Epic C — Workflow compiler

All eight tasks are `no_direct_evidence` in this baseline:

- Workflow/step/edge schemas.
- DAG, reachability, join, and cycle validation.
- Input/output contract validation.
- Required capability extraction.
- Approval and verification checkpoint compilation.
- Compensation graph compilation.
- Deterministic normalized plan and hash.
- Generated-workflow draft and validation gates.

Generic plan hashes and execution-plan governance exist in other platform services. They are not evidence of the Spec 006 workflow compiler described by the acceptance matrix.

## Epic D — Settings resolver

All eight tasks are `no_direct_evidence` in this baseline:

- Setting definition registry.
- Scope graph resolver.
- Merge operator library.
- Bounds and cross-setting validation.
- Secret-reference validation.
- Resolution lineage and events.
- Immutable snapshot and hash.
- Property and ambiguity tests.

Dynamic Container classifications implement inheritance and merge strategies, but that does not prove the separate settings-definition and immutable settings-snapshot subsystem required by this Epic.

## Epic E — Runtime core

| Task | Classification | Evidence and rationale |
| --- | --- | --- |
| Run/step schemas and repositories | `partial` | Durable execution and release-operation schemas exist elsewhere, but the Spec 006 workflow run/step contract is not fully traced. |
| CAS transition service | `partial` | Guarded state transitions exist in governed services; no complete Spec workflow-runtime transition suite was found. |
| Claims, leases, and heartbeat | `no_direct_evidence` | No task-specific runtime worker claim/lease/heartbeat evidence found. |
| Operation-scoped idempotency | `partial` | Idempotency and request-hash conflict guards are widely implemented, including Dynamic Container mutations, but the full workflow-runtime namespace contract is not proven. |
| Transactional outbox | `partial` | `20260711_transactional_outbox_shadow_sync_foundation.sql` and `test-platform-outbox-foundation.mjs` prove a platform outbox foundation, not full Spec runtime atomicity. |
| Retry taxonomy and scheduler | `no_direct_evidence` | No focused Spec 006 retry taxonomy/scheduler evidence found. |
| Callback ingress and verification | `no_direct_evidence` | No signature/nonce/expiry/replay callback suite matching AC-012 and AC-013 found. |
| Approval hold binding and consumption | `partial` | Capability envelopes and approval holds bind hashes in governed operations, but complete workflow checkpoint compilation and consumption are not proven. |
| Compensation orchestration | `no_direct_evidence` | No Spec compensation graph execution and evidence-retention implementation found. |
| Readback and normalized output | `partial` | Readback contracts and normalized tool results exist broadly, but not a complete workflow-runtime readback contract. |
| Reconciliation and dead-letter operations | `partial` | Release and operational reconciliation surfaces exist, but no complete Spec workflow dead-letter lifecycle was found. |

## Epic F — Runtime adapters

| Task | Classification | Evidence and rationale |
| --- | --- | --- |
| Adapter SDK and interface | `partial` | Multiple governed adapters and runtime bindings exist, but no single Spec 006 adapter SDK contract and conformance suite was found. |
| Certification schema and test harness | `partial` | Capability certification registries, issuers, and focused tests exist; complete workflow-adapter certification coverage is not proven. |
| Platform-native adapter | `partial` | Platform-native governed execution exists, but no Spec adapter conformance record was found. |
| n8n webhook adapter | `no_direct_evidence` | No task-specific conformance implementation found. |
| n8n API adapter | `no_direct_evidence` | No task-specific conformance implementation found. |
| Make MCP adapter | `no_direct_evidence` | No task-specific conformance implementation found. |
| Generic MCP adapter | `no_direct_evidence` | Generic MCP transports exist, but no Spec adapter contract and certification evidence were found. |
| HTTP action adapter | `partial` | HTTP delegated actions exist through the governed endpoint registry; the Spec runtime adapter lifecycle is incomplete. |
| Agent runtime adapter | `partial` | Agent runtime governance exists; no complete Spec adapter conformance evidence found. |
| Health, freshness, and kill switches | `partial` | Health/readiness and kill-switch patterns exist across platform runtimes, but the complete adapter matrix is not verified. |

## Epic G — API and client surfaces

| Task | Classification | Evidence and rationale |
| --- | --- | --- |
| Split OpenAPI contracts and generated schema sync | `partial` | `openapi/container-authority.yaml` documents the Dynamic Container slice. The full workflow-runtime contract and generated client synchronization are not proven. |
| Stable error catalog | `partial` | Stable error codes exist in Dynamic Container and authority-scope services; no complete Spec-wide catalog verification found. |
| Cursor pagination for assets, runs, and evidence | `no_direct_evidence` | No complete asset/run/evidence pagination contract found. |
| Tenant/admin capability projection | `partial` | Platform capability projection surfaces exist, but the Spec asset/runtime projection scope remains incomplete. |
| Simulation and dry-run endpoints | `partial` | Dynamic Container projection, readiness, promotion, rollback, and closeout dry-runs are implemented; full workflow simulation is not. |
| Upgrade, fork, and compatibility endpoints | `no_direct_evidence` | No direct implementation found. |
| Run timeline and evidence endpoints | `partial` | Audit and evidence endpoints exist, but no complete workflow-run timeline contract was found. |

## Epic H — Operations and rollout

| Task | Classification | Evidence and rationale |
| --- | --- | --- |
| Metrics, traces, logs, and dashboards | `partial` | Performance samples, audit coverage, rollout-readiness views, and operational evidence exist; complete dashboard/trace/SLO activation is not proven. |
| Security alert rules | `no_direct_evidence` | No Spec-specific security alert rule set and verification found. |
| Migration inventory and backfill | `implemented` | Governed migrations, migration preflight tests, projection remediation, data-hold resolution, and same-cycle readbacks are documented and applied. |
| Shadow comparison ledger | `implemented` | `container_shadow_comparisons`, repository writes, sampler, readiness views, and migration tests. |
| Pilot cohort controls | `implemented` | `container_authority_rollout_readiness_v1`, read-only canary runtime, promotion/monitoring/closeout/rollback tools, 100-probe evidence, and closeout readback. |
| Recovery runbooks | `partial` | Closeout and canary documents include rollback conditions; a complete runtime recovery/dead-letter runbook set is not proven. |
| Load, concurrency, and rate-limit tests | `partial` | Query-plan preflight and latency-budget tests exist; full sustained load, concurrency, and provider rate-limit testing is not proven. |
| Release-readiness and rollback rehearsal | `partial` | Release readiness and closeout are verified. Rollback dry-run/tooling exists, but an executed failure-path rollback rehearsal was not required by the successful canary. |

## Production-readiness reconciliation

### Architecture and domain

- `implemented`: graph cycle and ambiguity validators.
- `partial`: platform/admin/brand seed topology; tenant non-containment verification; object authority matrix.
- `no_direct_evidence`: active asset-version immutability; fork lineage and mandatory policy inheritance.

### Security

- `partial`: authentication/authorization separation; object authorization negatives; credential references and least-privilege metadata; approval-hash governance; general threat-model review.
- `no_direct_evidence`: explicit platform-admin tenant access audit contract; full callback signature/nonce/expiry/replay suite.
- Dynamic Container and canary evidence confirm that execution mode/classification did not grant global authority and no credential payload was read.

### Runtime correctness

- `partial`: CAS/idempotency/readback/reconciliation patterns exist in governed services.
- `no_direct_evidence`: complete worker claim/lease tests, workflow outbox atomicity, unknown-outcome workflow reconciliation, retry scheduler, compensation semantics, and callback state machine.

### Data and migration

- `implemented`: additive migrations, explicit approvals, dry-run/apply separation, same-cycle readbacks, and no destructive change in the completed Dynamic Container slice.
- `partial`: query-plan/index review exists for Dynamic Container; broad retention/evidence reconstruction and all backfill confidence/quarantine cases remain unproven.

### Adapters

- `partial`: certification/readiness/readback patterns exist.
- `no_direct_evidence`: complete adapter lifecycle matrix across platform-native, n8n, Make, generic MCP, HTTP, and agent runtime.

### API and documentation

- `partial`: OpenAPI 3.1 contract for Container Authority, stable slice errors, dry-run examples, canonical closeout docs, and backward-compatible additive changes.
- `no_direct_evidence`: full Spec-generated schema sync, complete asset/run pagination, and upgrade/fork API contracts.

### Operations

- `implemented`: bounded pilot evidence met gates and returned to shadow.
- `partial`: metrics/readiness views, recovery conditions, latency budgets, and release verification.
- `no_direct_evidence`: approved SLO/error budgets, complete critical security alerts, rehearsed dead-letter operations, executed failure-path rollback, and explicit global production-enforcement approval.

## Direct evidence inventory

Primary evidence reviewed in this baseline includes:

- `migrations/20260628_authority_scope_registry_foundation.sql`
- `migrations/319_sprint69_dynamic_container_authority_foundation.sql`
- `migrations/320_sprint69_dynamic_container_authority_runtime_contracts.sql`
- `migrations/20260715_dynamic_container_rollout_readiness_current_evidence.sql`
- `dynamicContainerAuthority.js`
- `dynamicContainerAuthorityRepository.js`
- `dynamicContainerAuthorityResolver.js`
- `dynamicContainerCanaryRuntime.js`
- `dynamicContainerCanaryProbeSampler.js`
- `dynamicContainerQueryPlanPreflight.js`
- `src/application/authorityScope/authorityScopeService.js`
- `src/infrastructure/authorityScope/authorityScopeRepository.js`
- `test-authority-scope-foundation.mjs`
- `test-dynamic-container-authority-foundation.mjs`
- `test-dynamic-container-authority-runtime.mjs`
- `test-dynamic-container-rollout-safety.mjs`
- `test-dynamic-container-canary-runtime.mjs`
- `test-dynamic-container-canary-probe-sampler.mjs`
- `test-dynamic-container-migration-preflight.mjs`
- `openapi/container-authority.yaml`
- `final-closeout-20260724.md`
- `enforcement-canary-pilot-20260724.md`

## Recommended implementation sequence

### Batch 1 — Close Epic A and harden Epic H

1. Add an accepted ADR for independent container, asset, workflow, and settings graphs.
2. Add explicit Platform Scope/Admin Workspace/Platform Brand topology migration and verification.
3. Add platform-admin tenant-access audit events and complete the object-level authorization matrix.
4. Add Spec-specific security alerts and a complete Dynamic Container recovery runbook.
5. Execute a bounded failure-path rollback rehearsal and retain evidence.
6. Add sustained load, concurrency, and rate-limit tests for the read-only authority paths.

### Batch 2 — Workflow compiler and settings foundations

Implement Epics C and D together because the normalized workflow plan must bind an immutable resolved-settings snapshot and hash.

### Batch 3 — Asset catalog and tenancy

Implement Epic B with immutable versions, publication policy, install/bind, sparse overrides, extension points, forks, and upgrade compatibility.

### Batch 4 — Runtime core and adapters

Implement Epics E and F in governed increments: run state/CAS/idempotency/outbox first, then callbacks/retries/compensation, followed by certified adapters.

### Batch 5 — API/client completion and global readiness

Complete Epic G and the remaining production-readiness checklist. Global enforcement remains a separate decision and is not authorized by this reconciliation.

## Baseline conclusion

The Dynamic Container authority slice is closed, verified, and safely returned to `shadow`. Spec 006 as a whole remains `in_progress`. The next implementation work should begin with Batch 1; no unchecked task should be marked complete without direct code, tests, and operational evidence.
