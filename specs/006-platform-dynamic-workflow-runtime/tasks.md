# Implementation Task Breakdown

## Epic A — Container and authority foundation

- [ ] ADR for independent graphs.
- [ ] Additive container and relationship migrations.
- [ ] Seed Platform Scope, Platform Admin Workspace, and Platform Brand.
- [ ] Graph cycle and ambiguity validators.
- [ ] Principal and authority-grant repositories.
- [ ] Platform-principal and tenant-principal decision paths.
- [ ] Object-level authorization matrix tests.
- [ ] Platform-admin tenant access audit events.

## Epic B — Asset catalog and tenancy

- [ ] Asset definitions and immutable versions.
- [ ] Publication audience and policy evaluator.
- [ ] Tenant catalog discovery.
- [ ] Installation and binding flow.
- [ ] Sparse override validator.
- [ ] Named extension-point compiler.
- [ ] Governed fork with immutable lineage.
- [ ] Tenant-authored draft lifecycle.
- [ ] Upgrade preview, pinning, approval, and compatibility report.
- [ ] Deprecation, retirement, and uninstall behavior.

## Epic C — Workflow compiler

- [ ] Workflow/step/edge schemas.
- [ ] DAG, reachability, join, and cycle validation.
- [ ] Input/output contract validation.
- [ ] Required capability extraction.
- [ ] Approval and verification checkpoint compilation.
- [ ] Compensation graph compilation.
- [ ] Deterministic normalized plan and hash.
- [ ] Generated-workflow draft and validation gates.

## Epic D — Settings resolver

- [ ] Setting definition registry.
- [ ] Scope graph resolver.
- [ ] Merge operator library.
- [ ] Bounds and cross-setting validation.
- [ ] Secret-reference validation.
- [ ] Resolution lineage and events.
- [ ] Immutable snapshot and hash.
- [ ] Property and ambiguity tests.

## Epic E — Runtime core

- [ ] Run/step schemas and repositories.
- [ ] CAS transition service.
- [ ] Claims, leases, and heartbeat.
- [ ] Operation-scoped idempotency.
- [ ] Transactional outbox.
- [ ] Retry taxonomy and scheduler.
- [ ] Callback ingress and verification.
- [ ] Approval hold binding and consumption.
- [ ] Compensation orchestration.
- [ ] Readback and normalized output.
- [ ] Reconciliation and dead-letter operations.

## Epic F — Runtime adapters

- [ ] Adapter SDK and interface.
- [ ] Certification schema and test harness.
- [ ] Platform-native adapter.
- [ ] n8n webhook adapter.
- [ ] n8n API adapter.
- [ ] Make MCP adapter.
- [ ] Generic MCP adapter.
- [ ] HTTP action adapter.
- [ ] Agent runtime adapter.
- [ ] Health, freshness, and kill switches.

## Epic G — API and client surfaces

- [ ] Split OpenAPI contracts and generated schema sync.
- [ ] Stable error catalog.
- [ ] Cursor pagination for assets, runs, and evidence.
- [ ] Tenant/admin capability projection.
- [ ] Simulation and dry-run endpoints.
- [ ] Upgrade, fork, and compatibility endpoints.
- [ ] Run timeline and evidence endpoints.

## Epic H — Operations and rollout

- [ ] Metrics, traces, logs, and dashboards.
- [ ] Security alert rules.
- [ ] Migration inventory and backfill.
- [ ] Shadow comparison ledger.
- [ ] Pilot cohort controls.
- [ ] Recovery runbooks.
- [ ] Load, concurrency, and rate-limit tests.
- [ ] Release-readiness and rollback rehearsal.

## Definition of done

Contracts, implementation, migrations, generated schemas, and canonical docs are synchronized; CI/security/isolation/concurrency/recovery tests pass; pilot evidence meets gates; and production approval is recorded.
