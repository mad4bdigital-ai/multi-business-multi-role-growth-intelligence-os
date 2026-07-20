# Governed Rollout and Pull Request Sequence

Each PR solves one bounded problem, includes tests and rollback notes, and may not silently combine specification, migrations, runtime cutover, UI, and production activation.

## PR-0 — Spec Kit

- all Spec 011 documents, contracts, schemas, checklists, manifest, and completion state;
- no runtime or database mutation;
- OpenAPI/JSON validation and inventory checks.

## PR-1 — Resource and registry mapping

- DB-backed descriptors and operation matrices;
- existing-authority mapping and source links;
- no active behavior.

## PR-2 — Additive migrations

- configuration definitions/schemas/versions and any missing Activity Pack/binding structures;
- indexes, constraints, revisions, lifecycle, audit/outbox support;
- governed dry-run/apply/readback.

## PR-3 — Read-only repositories and APIs

- catalog, detail, search, permissions, changes, revisions, validation and effective preview;
- tenant field allowlists;
- OpenAPI 3.1 and integration tests.

## PR-4 — Configuration resolver

- precedence, merge operators, lineage, revision vector, SHA-256;
- deterministic golden tests and conflict/security tests;
- shadow only.

## PR-5 — Activity Pack registry and validation

- manifest/schema validation, compatibility matrix, travel reference package;
- no tenant auto-activation.

## PR-6 — Control-plane plan compiler

- capability/workflow composition on top of Specs 006/007;
- immutable plan snapshot and explicit provider holds;
- internal-only reference workflow.

## PR-7 — Policy compiler and approval profiles

- bounded operators/effects;
- deny-wins, separation of environments, request hashes, expiry;
- no provider adapter dispatch yet.

## PR-8 — Provider adapter resolution

- shared ports, certification, ranking, readiness and ambiguity block;
- inspection/readback contract;
- staging adapters only.

## PR-9 — Events, invalidation, queues and leases

- event registry/schemas, outbox consumers, cache invalidation;
- tenant/brand partitioning, concurrency and idempotency.

## PR-10 — Dynamic Admin UI

- schema/manifest-driven forms, diff, lineage, validation, approvals, diagnostics;
- no UI-derived authority.

## PR-11 — Tenant-safe UI and APIs

- brand/activity/config/plan/readback views with field allowlists;
- role and resource tests.

## PR-12 — Analytics normalization

- KPI mappings and portfolio projections;
- preserve native definitions, units, confidence, freshness, and lineage.

## PR-13 — Shadow evidence and reconciliation

- comparison jobs, mismatch taxonomy, dashboards, reconciliation tooling;
- no active enforcement.

## PR-14 — Internal pilot activation

- allowlisted pilot, internal artifacts only;
- explicit approval and final readback;
- no provider write.

## PR-15 — Staging execution

- one certified provider/resource cohort;
- typed approval, rollback, readback, operational smoke.

## PR-16 — Production canary

- bounded production action/resource;
- release gate, metrics, audit, rollback evidence.

## PR-17 — Production parity and closeout

- parity check, drift audit, canonical/OpenAPI/knowledge updates;
- `completion.json` implementation evidence;
- close or archive feature branch only after proof.

## Per-PR checklist

- scope and non-goals;
- impacted layers and logical resources;
- API/database/security impact;
- tests and manual verification;
- migration/rollback/readback where applicable;
- CI, branch freshness, merge check, deployment evidence;
- no secrets or provider writes outside approved scope.
