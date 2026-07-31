# Authority Data Foundation Phase

## Purpose

This phase groups UEACP tasks `T001`, `T002`, and `T021`–`T024` into one governed delivery stage instead of treating them as isolated implementation tickets.

The phase converts repository and runtime evidence into two canonical machine-readable artifacts:

1. an Authority Path Inventory that reconciles Admin, Tenant, shared, internal, route, tool, handler, and registry authority contracts;
2. an Authority Data Foundation Plan that reconciles the path inventory with the read-only SQL catalog census and produces bounded reuse-versus-additive-storage decisions.

The phase does not apply SQL, enable writers, activate evidence persistence, change runtime enforcement, or promote Production.

## Integrated flow

```text
registered and discovered authority surfaces
  -> authority path inventory compiler
  -> unresolved path/control/revision gaps
  -> read-only Authority Catalog Census
  -> exact object and revision-support reconciliation
  -> T021 revision plan
  -> T022/T023 graph and delegation storage plan
  -> T024 decision/projection/invalidation/drift ledger plan
  -> human contract review
  -> separately authorized migrations
```

## Phase components

### Authority Path Inventory Compiler

The compiler accepts bounded source snapshots from registries, route discovery, handler discovery, endpoint catalogs, local/device surfaces, and compatibility mappings.

Each canonical path records:

- path/tool identity, route, method, handler, surface family, and source registry;
- Admin, Tenant, shared, or internal authority mode;
- read-only, preview, shadow, plan, mutation, or internal operation mode;
- actor, subject, Tenant, Workspace, resource, capability, provider, and credential-scope sources;
- risk, approval, typed confirmation, envelope, idempotency, readback, rollback, and atomicity requirements;
- revision, freshness, revocation, and invalidation sources;
- aliases and canonical replacement for deprecated paths;
- callability, lifecycle status, unresolved fields, and source conflicts.

Duplicate path keys from multiple registries are merged only when their normalized contracts are identical. Conflicting duplicates are blocking gaps.

The compiler never declares `T001` complete automatically. A zero-gap result becomes only `ready_for_human_closure_review` because unregistered runtime paths and local compatibility paths still require explicit human verification.

### Authority Data Foundation Planner

The planner consumes only:

- a canonical no-secret Authority Path Inventory;
- a read-only Authority Catalog Census with tables, views, columns, indexes, foreign keys, hashed view definitions, and revision-support classification.

It then produces:

- referenced revision-source coverage for each authority path;
- exact reuse, alias-review, additive-create, or ambiguity decisions for logical UEACP storage;
- three separate migration batches:
  1. authority revisions (`T021`);
  2. resource graph, restrictions, and delegation storage (`T022`/`T023`);
  3. decision, projection, invalidation, and drift ledgers (`T024`).

The planner emits no executable SQL. It cannot authorize migration execution.

## Logical storage reconciliation

### T021 — Revision support

Only confirmed authority-owning tables are candidates. Existing explicit revisions are reused. Temporal timestamps alone do not silently become revision authority. Missing or temporal-only support requires owner review before an additive revision proposal is designed.

A path revision source that cannot be mapped to an exact catalog object blocks the phase.

### T022 — Resource relations and restrictions

The planner checks exact current-schema coverage for:

- `resource_nodes`;
- `resource_edges`;
- `resource_access_grants`;
- `resource_restrictions`.

Existing tables are reused only after exact contract review. Missing objects become additive-create candidates. The planner does not create a parallel graph when current tables already cover the semantics.

### T023 — Delegation contexts

`delegation_contexts` is the logical canonical. Existing aliases such as `delegation_grants` require explicit contract review for actor preservation, Tenant/Workspace binding, allowed operations, validity windows, approval, and revocation semantics.

Alias presence never authorizes silent reuse or duplicate creation.

### T024 — Decision and lifecycle ledgers

The planner reconciles:

- `effective_authority_decisions`;
- `authority_decision_evidence`;
- `authority_projection_snapshots`;
- `authority_projection_items`;
- `authority_drift_findings`;
- `authority_invalidation_events`.

Historical names such as `effective_authority_shadow_decisions` and `authority_projection_drift_events` are alias candidates requiring contract review. They are not treated as absent, and they are not silently accepted as complete replacements.

No writer, scheduler, persistence mode, or retention policy is enabled by this phase.

## Fail-closed rules

The phase blocks migration design or execution when any of these conditions exists:

- an expected authority source is absent or incomplete;
- two registries disagree about one canonical path;
- a path is missing actor, subject, scope, authority, risk, revision, freshness, revocation, or invalidation evidence;
- mutation paths lack idempotency, readback, or rollback contracts;
- a deprecated path lacks a canonical replacement;
- an inventory revision source does not map to a catalog object;
- an existing storage alias has not passed exact contract review;
- multiple current objects match one logical UEACP entity;
- the SQL census is not same-cycle live evidence;
- secret-bearing fields appear in input or output.

## Safety boundaries

Every phase artifact must preserve:

- `migration_execution_authorized=false`;
- `runtime_enforcement_enabled=false`;
- `evidence_persistence_enabled=false`;
- `provider_calls=false`;
- `credential_payload_read=false`;
- `external_writes=false`;
- `secrets_included=false`.

The CLI reads local JSON evidence and writes only the resulting JSON to standard output.

## Phase exit criteria

The phase may progress to separately reviewed migration PRs only when:

1. every expected authority source has a complete bounded snapshot;
2. all canonical path conflicts and missing control fields are resolved;
3. human review confirms the path inventory against registered and unregistered runtime surfaces;
4. a same-cycle live Authority Catalog Census is captured from the intended schema;
5. each authority-owning table has an approved revision-support classification;
6. every T022–T024 logical object has an exact reuse or additive-create decision;
7. aliases have exact column, key, lifecycle, scope, retention, and no-secret contract evidence;
8. ambiguous objects are resolved;
9. each migration batch has a separate checksum-bound plan, dry-run, approval, rollback, and same-cycle readback contract.

`T001`, `T002`, and `T021`–`T024` remain open until their respective live evidence, implementation, and closeout criteria are independently satisfied.
