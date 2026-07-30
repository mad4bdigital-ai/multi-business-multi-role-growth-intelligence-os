# Connection Ownership Migration Preflight and Readback Contract

## Status

```text
migration artifact: merged
migration authorization: pending_separate_authorization
migration dry-run against a live database: not executed
migration apply: not executed
database mutation: false
same-cycle schema readback: false
runtime consumers enabled: false
```

This contract prepares the migration introduced by PR #3483 without authorizing or executing it.

## Bound artifact

- Migration: `20260730_context_kernel_connection_ownership_persistence.sql`
- Source implementation merge: `a9c3aa67e4ed2d846fc9a0697fa95d5c5fd35902`
- Expected governed statement count: `4`
- Required apply confirmation: `APPLY_20260730_CONTEXT_KERNEL_CONNECTION_OWNERSHIP_PERSISTENCE`
- Resource URI: `db-migration://growth_intelligence_platform/20260730_context_kernel_connection_ownership_persistence.sql`

The repository preflight computes the SHA-256 checksum from the merged SQL file with the canonical governed migration statement splitter. It rejects statement-count drift, unsupported top-level SQL, row backfill, and destructive SQL before any database transport is considered.

## Reviewed statement scope

The only allowed top-level statements are, in order:

1. `ALTER TABLE workspace_registry`
2. `CREATE TABLE connection_ownership_scopes`
3. `CREATE TABLE provider_authorization_states`
4. `CREATE OR REPLACE VIEW v_context_kernel_connection_ownership_compatibility`

The artifact must not contain top-level `INSERT`, `UPDATE ... SET`, `DELETE`, `REPLACE`, `DROP`, or `TRUNCATE` statements. Existing `workspace_registry.workspace_type` values remain unchanged, and legacy rows remain unclassified.

## Repository-only preflight

The CI preflight is intentionally database-free. It:

1. reads the merged migration artifact;
2. computes its SHA-256 checksum;
3. splits it with `splitGovernedMigrationStatements`;
4. verifies the exact four-statement additive scope;
5. creates the exact `dry_run` input for `governed_migration_execute`;
6. creates the exact expectation input for `governed_migration_schema_readback`;
7. proves `mutation_requested=false`, `apply_permitted=false`, and `secrets_included=false`.

The preflight module must not import a database pool, open a connection, execute SQL, call a provider, create a capability envelope, or enable runtime consumers.

## Environment gate

No live environment is selected by this artifact.

The historical `dev.mad4b.com` environment is intentionally retired and must not be treated as an available migration target. A later execution plan must identify an approved environment and prove its database identity before dry-run or apply.

Production execution is not authorized by repository CI or by a development dry-run. It requires an independent production plan, deployment binding, migration authorization, apply policy, capability envelope, typed confirmation, ledger, and same-cycle readback.

## Required live preflight before authorization

A later authorized operator must collect, in one governed plan:

1. exact environment and database identity;
2. current schema readback classified as `absent`, `partial`, or `ready`;
3. merged migration checksum and statement count;
4. governed migration authorization record for the exact checksum;
5. applicable migration execution and resource-authority policies;
6. dry-run evidence with `applies_sql=false`;
7. required typed confirmation;
8. capability-envelope binding requirements;
9. rollback and containment plan;
10. expected same-cycle ledger and schema readback.

Any ambiguity, checksum mismatch, statement-count mismatch, partial schema, stale envelope, unauthorized environment, or production/deployment mismatch stops the operation.

## Expected schema readback

### Existing table additions

`workspace_registry` must contain:

- `workspace_ownership_type`
- `owner_user_id`
- `ownership_revision`

### New persistence tables

- `connection_ownership_scopes`
- `provider_authorization_states`

### Compatibility view

- `v_context_kernel_connection_ownership_compatibility`

### Required indexes

Connection ownership:

- `uq_connection_ownership_id`
- `uq_connection_ownership_connection`
- `idx_connection_owner_scope`
- `idx_connection_owner_user`
- `idx_connection_owner_brand`
- `idx_connection_provider_account_ref`
- `idx_connection_provider_account_hash`

Provider authorization state:

- `uq_provider_authorization_state_ref`
- `uq_provider_authorization_nonce`
- `idx_provider_authorization_context`
- `idx_provider_authorization_target`
- `idx_provider_authorization_principal`
- `idx_provider_authorization_claim`

The readback tool must also find a successful governed migration ledger row bound to the exact migration filename and SHA-256 checksum. Row data is not read during schema certification.

## Readback classification

### `absent`

No matching ledger row exists, both new tables and the compatibility view are absent, and the three workspace ownership columns are absent.

### `partial`

Some but not all expected schema exists, or schema exists without a matching successful ledger row. Apply must stop; the state requires a separately reviewed reconciliation or repair plan.

### `ready`

The matching ledger row exists and all expected tables, columns, indexes, and view are present for the exact checksum and statement count.

## Same-cycle apply obligations

A later authorized apply is complete only when the same governed cycle proves:

- the migration runner executed the exact approved four statements;
- `applies_sql=true` only in approved apply mode;
- the governed migration ledger contains a successful exact-checksum record;
- schema readback returns `ready`;
- no legacy ownership classification or data backfill occurred implicitly;
- no OAuth route, provider call, credential mutation, shadow consumer, read consumer, or write consumer became enabled;
- `secrets_included=false`.

An ambiguous transport result must be resolved by ledger and schema readback before any retry.

## Rollback and containment

The migration is additive. The default containment strategy is:

```text
disable all dependent consumers
retain the inactive additive columns, tables, and view
fail closed for owner-scope resolution
prepare a separately authorized repair or rollback plan
```

Dropping tables, columns, indexes, or the view is not part of this migration and must not be performed automatically.

## Next authorization boundary

This artifact does not authorize migration execution. The next state-changing step requires a separate explicit authorization bound to:

- one approved environment;
- the exact migration SHA-256 checksum;
- statement count `4`;
- the exact resource URI;
- an approved capability envelope;
- the exact typed confirmation;
- mandatory same-cycle ledger and schema readback.
