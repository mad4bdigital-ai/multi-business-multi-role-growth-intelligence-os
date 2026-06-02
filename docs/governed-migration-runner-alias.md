# Governed Migration Runner Aliases

## Purpose

The governed migration runner provides a narrow, auditable shell-alias path for applying explicitly allowlisted SQL migration files. It exists to avoid manual copy/paste execution of long migration SQL through admin DB control.

## Built-in aliases

- `migration_apply_guarded_dry_run`
- `migration_apply_guarded_apply`
- `migration_ledger_record_dry_run`
- `migration_ledger_record_apply`

All aliases execute `http-generic-api/scripts/governed-migration-runner.mjs` through `admin_control` shell dispatch.

## Safety contract

The runner is intentionally constrained:

- It accepts only files in its internal allowlist.
- It runs SQL preflight before apply.
- It refuses apply unless preflight status is `pass`.
- Dry-run mode never applies SQL.
- Apply mode requires an explicit typed confirmation token derived from the migration filename.
- Record-only ledger mode never executes migration SQL; it records checksum/preflight evidence for previously applied migrations.
- Record-only ledger apply requires a `RECORD_...` confirmation token and deduplicates by migration filename + checksum + mode.
- The output is bounded JSON and does not include secrets.

## Current allowlist

- `051_sprint48_cloudflare_and_self_repair_tools.sql`
- `052_sprint49_local_connector_install_bundle.sql`
- `054_sprint50_admin_device_seed_and_self_repair_tool.sql`
- `055_sprint51_sql_primary_data_source.sql`
- `057_sprint53_admin_session_turn_tools.sql`
- `162_sprint66_cms_site_resource_access_grants.sql`
- `163_sprint65_session_archive_smoke_tool.sql`
- `166_sprint65_ai_intelligence_runtime_governance.sql`
- `168_sprint65_database_table_lifecycle_governance.sql`
- `176_sprint66_governed_migration_ledger.sql`

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

## Output evidence

The runner returns bounded JSON with:

- migration filename
- migration checksum (`migration_checksum_sha256`)
- SQL preflight status and risk count
- statement count and statement execution summaries
- requirements summary
- ledger evidence (`ledger.run_id`) after successful apply
- `secrets_included: false`

JSON payloads written to the ledger are passed as regular `JSON.stringify(...)` string values through placeholders; the runner does not use `CAST(? AS JSON)`.

## Operational notes

Use dry-run first, review the reported preflight and artifact readback, then apply one migration file at a time. After apply, run `release_readiness` to verify that dynamic migration drift decreased as expected.
