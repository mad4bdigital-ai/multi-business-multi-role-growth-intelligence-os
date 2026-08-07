# Admin Control DB Contract Governance Policy

## Policy

The repository has one canonical contract for database requests sent to `/admin/control`:

- Contract manifest: `.github/contracts/admin-control-db.v1.json`
- Provider implementation: `http-generic-api/routes/adminCliRoutes.js`
- Shared request builder: `.github/ops/lib/admin-control-db-request.mjs`
- Repository ratchet: `http-generic-api/scripts/admin-control-db-contract-governance.mjs`

For contract version `admin_control_db_run_v1`, the only supported request shape is:

```js
{
  tool: 'db',
  action: 'run',
  sql: '<statement>',
  ...
}
```

`action: 'query'` and the `query` SQL-field alias are not supported contracts.

## Mandatory rules

1. New operational callers under `.github/ops` MUST use the shared request builder. They MUST NOT create raw `tool: 'db'` payloads.
2. Existing raw callers are an explicit migration-only allowlist in the canonical manifest. The allowlist may shrink; it may not grow.
3. Every allowlisted raw caller is still validated against the canonical `action=run` and `sql` field contract.
4. The provider MUST fail closed on unsupported DB actions and missing SQL. A caller mismatch MUST be repaired at the caller or shared builder; the provider MUST NOT gain a compatibility alias merely to make a broken caller pass.
5. Any intentional breaking contract change MUST update the manifest, provider, shared builder, governance checks, tests, E2E phase contract, and policy in the same PR. A breaking shape change requires a new contract version rather than silently changing v1 semantics.
6. CI runs the repository-wide contract ratchet before the normal test manifest. Contract drift or a new raw DB caller is merge-blocking.
7. Governed migration Apply workflows remain fail-closed. A contract mismatch MUST stop before an execution envelope or Apply request; it MUST NOT be retried by broadening the provider contract.

## Ratchet behavior

The governance check validates four boundaries together:

- the canonical manifest is still `tool=db`, `action=run`, `sql_field=sql`;
- the provider still enforces those values and retains `unsupported_db_action` / `db_sql_required` failures;
- the shared builder emits exactly the canonical request fields and no legacy alias;
- operational callers either use the builder or belong to the shrinking legacy allowlist and still match the canonical shape.

On pull requests, the check compares the current legacy allowlist with the base branch and fails if a new legacy raw caller is added.

## Migration rule for legacy callers

When touching a legacy raw caller, prefer migrating it to the shared builder in the same PR. Once migrated, remove its manifest allowlist entry. Do not replace one raw form with another raw form.

## Incident class prevented

This policy prevents the class of failure where repository automation assumes a request such as `{ action: 'query', query: sql }` while the runtime provider supports only `{ action: 'run', sql }`. Such drift is now detected before merge rather than during a Production migration operation.
