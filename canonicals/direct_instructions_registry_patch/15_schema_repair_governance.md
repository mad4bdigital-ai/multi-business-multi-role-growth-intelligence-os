# Schema Repair Governance

## Safe additive repair over omission

When a platform registry update fails because a live database is missing a
column, table, or diagnostic view that can be added safely, the correct response
is to apply an idempotent additive repair and then continue the intended update.
Do not silently omit the update.

Safe additive repairs include:

- `ADD COLUMN IF NOT EXISTS` for nullable or defaulted audit columns
- `CREATE TABLE IF NOT EXISTS` for registry guard tables
- `CREATE OR REPLACE VIEW` for diagnostic/readiness views
- metadata-only policy or certification rows that do not expand runtime power

Blocked shortcuts:

- skipping a registry mutation because a required column is missing
- claiming readiness after the intended mutation was omitted
- using a permanent `BINARY` join workaround instead of fixing collation
- marking a surface recovered without same-cycle readback evidence

Required evidence:

1. Preflight the current schema.
2. Classify the change as additive or destructive.
3. Apply only additive repairs without data loss.
4. Read back the repaired schema and the intended registry mutation.
5. Record ledger and execution-log evidence.

## Database collation guard

New schema DDL must use:

```sql
DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
```

JSON-like longtext columns may use `utf8mb4_bin` only when policy permits it.
Cross-table join keys must not use mixed collations. Existing legacy mismatches
must be tracked as expiring exceptions in
`database_collation_policy_exception_registry`; future unregistered mismatches
are actionable drift.

Guard surfaces:

- `database_collation_policy_registry`
- `database_collation_policy_exception_registry`
- `v_database_collation_policy_violations`
- `v_database_collation_policy_status`
- `database_schema_governance.unified_collation_required`

## Automatic additive reconciliation

Automatic schema repair is permitted only through the governed migration reconciliation engine. The internal scheduler may invoke `governed-migration-reconciler.mjs` under a MySQL advisory lock, but every mutation still requires an exact active rule, DB-backed authorization, static preflight `pass`, typed runner confirmation, and same-cycle ledger plus schema readback.

The scheduler must fail closed when configuration is disabled, a rule or authorization is absent, preflight is not `pass`, or the migration is already recorded. It must not execute raw SQL, infer approval from a file name, widen a migration's resource pattern, retain raw output, or expose secrets. `information_schema`-guarded DDL remains mandatory for `ALTER TABLE ... MODIFY` reconciliation.

## Capability-vault skillpack runtime safety

Tenant-private draft installs expose package and skill catalog assets before any
runtime tool is enabled. Advisory routes must keep writes, shell, package
install, deploy, provider writes, secret reads, WebFetch, and other runtime tools
blocked unless an explicit approved grant exists.
