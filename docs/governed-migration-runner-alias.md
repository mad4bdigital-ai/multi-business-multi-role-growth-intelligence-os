# Governed Migration Runner Aliases

## Purpose

The governed migration runner provides a narrow, auditable shell-alias path for applying explicitly allowlisted SQL migration files. It exists to avoid manual copy/paste execution of long migration SQL through admin DB control.

## Built-in aliases

- `migration_apply_guarded_dry_run`
- `migration_apply_guarded_apply`

Both aliases execute `http-generic-api/scripts/governed-migration-runner.mjs` through `admin_control` shell dispatch.

## Safety contract

The runner is intentionally constrained:

- It accepts only files in its internal allowlist.
- It runs SQL preflight before apply.
- It refuses apply unless preflight status is `pass`.
- Dry-run mode never applies SQL.
- Apply mode requires an explicit typed confirmation token derived from the migration filename.
- The output is bounded JSON and does not include secrets.

## Current allowlist

- `162_sprint66_cms_site_resource_access_grants.sql`
- `166_sprint65_ai_intelligence_runtime_governance.sql`
- `168_sprint65_database_table_lifecycle_governance.sql`

## Example dry run

```bash
admin_control shell migration_apply_guarded_dry_run --migration=166_sprint65_ai_intelligence_runtime_governance.sql
```

## Example apply

```bash
admin_control shell migration_apply_guarded_apply \
  --migration=166_sprint65_ai_intelligence_runtime_governance.sql \
  --confirm=APPLY_166_SPRINT65_AI_INTELLIGENCE_RUNTIME_GOVERNANCE
```

## Operational notes

Use dry-run first, review the reported preflight and artifact readback, then apply one migration file at a time. After apply, run `release_readiness` to verify that dynamic migration drift decreased as expected.
