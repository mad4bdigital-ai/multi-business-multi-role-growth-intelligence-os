# Migration and Rollout

## Principles

- Additive before subtractive.
- Shadow before enforcement.
- Read surfaces before write surfaces.
- Capability-by-capability rather than global cutover.
- Exact-ID parity rather than count-only parity.
- Rollback and evidence in every phase.
- No provider mutation in specification or shadow phases.

## Phase 0: Inventory and terminology

- Catalog every Admin and Tenant authorization implementation and local SQL filter.
- Define current meanings of `active`, `connected`, `visible`, `installed`, and `ready`.
- Map Admin, Tenant, service, support, agency, and agent identity sources.
- Record existing tables and avoid duplicate authority stores.

**Exit:** approved authority map and compatibility glossary.

## Phase 1: Contracts and code invariants

- Add decision types, readiness vector, reason taxonomy, and actor/subject model.
- Add hard invariants for Tenant scope, ambiguity, shadow execution, approval reuse, projection non-authority, and no-secret manifests.
- Introduce no enforcement change.

## Phase 2: Shadow PDP

- Compute new decisions beside legacy behavior.
- Persist bounded decision evidence.
- Classify mismatches by layer and affected resource ID.
- Never trigger provider calls from shadow output.

**Exit:** approved parity thresholds and zero unexplained critical over-grants.

## Phase 3: Admin diagnostics and connector inventory

- Cut over read-only platform diagnostics.
- Expose connector readiness dimensions.
- Preserve legacy fields as compatibility projections.
- Treat `platform_admin_all + zero visible registered systems` as an invariant violation.

## Phase 4: Dynamic projections

Cut over in this order:

1. Connector Inventory
2. Dynamic Tabs
3. Dashboard
4. Tool Catalog listing
5. Agent and skill recommendations

Each surface compares exact IDs, capabilities, and reason codes before enforcement.

## Phase 5: Read-only dispatch canary

- Select low-risk capabilities.
- Use bounded Tenant and Admin cohorts.
- Enable final PEP revalidation.
- Monitor latency, mismatch rate, denial changes, stale decisions, and error budget.

## Phase 6: Reversible writes

- Draft-only or internal-registry writes first.
- Require typed approval, idempotency, readback, and rollback.
- Do not permit publish, deploy, delete, or external send until capability certification passes.

## Phase 7: High-risk execution

- Review each capability independently.
- Require stronger approval and delegation policies.
- Perform production verification and post-merge audit.
- Maintain an automatic disable or rollback policy.

## Phase 8: Legacy deprecation

A legacy path may be removed only when usage is measured, callers migrated, parity SLO sustained, rollback rehearsal passed, deprecation documented, release readiness approved, and post-merge production audit completed.

## Multi-PR sequence

1. Types, glossary, and invariants
2. Logical schema and additive migrations
3. Shadow resolver and decision ledger
4. Resource graph and delegation
5. Projection compiler and connector dimensions
6. Invalidation and reconciliation
7. Admin diagnostics
8. Dynamic Tabs and Dashboard
9. Tool Catalog
10. Read-only PEP canary
11. Reversible write pilot
12. Canonical docs and OpenAPI alignment
13. Release verification and closeout

## Rollback
Every enforcement phase retains the legacy path behind a governed feature policy until cutover acceptance. Rollback disables new enforcement, invalidates affected manifests, restores the legacy projection source, and records the reason and versions. Rollback MUST NOT reactivate revoked grants or consumed approvals.

## Current branch migration runbook

### Migration inventory and apply order

Apply the current additive migrations in this order, one migration per governed operation:

1. `http-generic-api/migrations/20260721_ueacp_connector_inventory_read.sql`
   - registers or updates the read-only `connector.inventory.read` semantic capability;
   - does not grant execution authority or modify connector rows.
2. `http-generic-api/migrations/20260721_ueacp_shadow_decision_ledger.sql`
   - creates the shadow decision and projection-drift evidence tables;
   - constrains persisted evidence to shadow-only, no-authority, no-provider-call, no-credential-read, no-external-write, and no-secret rows.
3. `http-generic-api/migrations/20260725_ueacp_performance_retention_indexes.sql`
   - adds Tenant cursor, installation-state join, and decision-expiration indexes;
   - does not delete, backfill, or rewrite application rows.

Do not combine the three migration applies into one approval. Each apply requires its own checksum-bound plan item, dry-run, typed approval, and same-cycle readback. Keep `UEACP_RECONCILIATION_ENABLED`, `UEACP_RECONCILIATION_PERSIST`, and `UEACP_SHADOW_EVIDENCE_MODE` disabled throughout schema application and verification.

### Preflight evidence

Before each migration apply:

- verify that the deployed `main` commit contains the exact migration file and tested checksum;
- capture the current schema and migration-runner state;
- record whether `connector.inventory.read` already exists and capture its complete before-image when present;
- record whether each ledger table and each proposed index already exists;
- capture current ledger row counts without reading raw evidence payloads;
- confirm that no UEACP evidence writer, persistence flag, reconciliation scheduler, provider executor, or shared PEP cutover is enabled;
- review active transactions and DDL blockers according to the governed migration runner contract;
- record a rollback plan item that is separate from the apply approval.

A failed or incomplete preflight blocks the apply. A branch-only migration is not eligible for production dry-run until it is present in the deployed migration source.

### Backfill policy

#### Capability registration

No historical data backfill is required. The capability migration performs an idempotent registry upsert for `connector.inventory.read` only. It must not create connector records, installations, grants, approvals, manifests, or provider credentials.

When the capability row already exists, the before-image is mandatory because the migration updates approved metadata fields. Rollback restores that before-image rather than guessing prior values.

#### Shadow decision and drift ledgers

No historical decision or drift backfill is permitted in this phase. The new tables begin empty. The platform must not synthesize decisions for past sessions, reconstruct past manifests from logs, or infer prior authority from connector state.

After a separately approved evidence-mode activation, only new same-cycle shadow decisions may be written. Historical backfill requires a separate specification, privacy review, retention decision, bounded source contract, and no-secret validation.

#### Performance and retention indexes

No application-data backfill is required. The database builds the indexes over existing rows as part of the governed DDL operation. The migration must not update `connected_systems`, `installations`, shadow decisions, or drift events.

### Apply and same-cycle readback

#### Capability migration readback

After apply, verify exactly one active row for `connector.inventory.read` and compare the complete approved contract:

- resource type and operation;
- risk class and default execution mode;
- input and output schemas;
- connection, workspace-authority, approval, audit-evidence, and readback requirements;
- schema version, status, and no-execution notes.

Registration alone does not establish live parity or execution eligibility.

#### Ledger migration readback

After apply:

- verify both tables, primary keys, unique keys, foreign keys where defined, checks, and indexes;
- verify zero rows before any evidence-mode activation;
- verify that constraints reject authority grants, provider calls, credential reads, external writes, and secret inclusion;
- do not enable persistence in the same operation.

#### Index migration readback

After apply:

- verify the three named indexes in `information_schema.statistics` with exact column order;
- rerun representative Platform and Tenant `EXPLAIN FORMAT=JSON` queries;
- confirm Tenant cursor stability and Tenant-aware installation joins;
- verify the expiration index without running deletion;
- record query-plan evidence before enabling any scheduled reconciliation or persistence.

Stop the sequence after any discrepancy. Keep all UEACP runtime flags disabled and do not apply the next migration until the discrepancy is resolved and a new approval is issued.

### Rollback triggers

A rollback or apply stop is required for:

- checksum, statement-count, or deployed-source mismatch;
- unexpected mutation of an existing capability row;
- missing or malformed constraints, indexes, or keys;
- non-zero ledger rows before evidence activation;
- unexpected lock duration or latency regression beyond the approved migration budget;
- query-plan regression after index creation;
- any secret-like field, provider payload, credential payload, external write, or authority-grant evidence;
- any mismatch between same-cycle readback and the approved manifest.

### Migration-specific rollback

#### Capability registration rollback

1. Keep legacy runtime authoritative and disable all UEACP consumers first.
2. Restore the captured before-image when the capability existed before migration.
3. When no before-image existed, prefer setting the capability status to `inactive` until a dependency audit proves that no compiled manifest, source link, certification, evidence row, route, or projection references the capability.
4. Hard deletion requires a separate destructive-change approval and same-cycle reference readback.
5. Never reactivate revoked grants, expired delegations, or consumed approvals.

#### Ledger schema rollback

1. Disable evidence persistence and reconciliation persistence before schema rollback.
2. If both tables are empty and no consumer references them, a separate destructive rollback migration may remove them after explicit approval.
3. If either table contains rows, do not drop it. Preserve evidence under the approved retention/access policy, keep writers disabled, and use a separately reviewed archival or cleanup plan.
4. Schema rollback must not delete open drift evidence or bypass legal, incident, or compliance holds.

#### Performance-index rollback

1. Remove only the three UEACP-named indexes through a separate rollback migration after verifying their existence and ownership.
2. Do not remove or replace pre-existing indexes.
3. Rerun the same representative `EXPLAIN FORMAT=JSON` queries and record the post-rollback plans.
4. Index rollback must not mutate application rows or enable purge behavior.

### Rollback readback and rehearsal

Every rollback must verify and record:

- UEACP enforcement, scheduling, and persistence flags are disabled;
- `legacy_runtime_authoritative=true` and `execution_authority_changed=false` remain true for the runtime path;
- capability metadata matches the captured before-image or the explicitly approved inactive state;
- expected tables and indexes are present or absent according to the rollback plan;
- evidence row counts are unchanged unless an independently approved retention operation occurred;
- no provider call, credential payload read, external write, secret inclusion, grant reactivation, or approval replay occurred;
- rollback reason, operator, plan item, migration checksum, before/after versions, and same-cycle readback references are persisted in governed audit evidence.

Rehearse apply and rollback on staging after merge and before production migration approval. Apply and rollback approvals are never interchangeable, and neither approval may be reused for enforcement cutover, evidence activation, purge, deployment, or legacy removal.
