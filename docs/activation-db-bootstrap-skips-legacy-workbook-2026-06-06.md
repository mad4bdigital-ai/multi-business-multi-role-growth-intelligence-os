# DB-native activation skips legacy workbook resolution

Date: 2026-06-06

## Context

Activation bootstrap authority is DB-native via `/activation/bootstrap-config` and `activation_bootstrap_config_read`. Google Sheets is no longer activation bootstrap authority.

The governed activation runner already records `sheets_required: false` and `sheets_skipped: true` when DB runtime bootstrap is authoritative, but it still resolved the legacy workbook shim and recorded `bootstrap_spreadsheet_id` evidence.

## Change

When Sheets is skipped/not required, the runner now:

- skips legacy workbook resolution
- reads the bootstrap row using `source: "db_runtime"`
- records `bootstrap_source: "db_runtime"`
- does not record `bootstrap_spreadsheet_id`

Legacy workbook resolution remains available only for compatibility paths where Sheets is explicitly required.

## Safety

- No migration.
- No registry mutation.
- Public tool names unchanged.
- Existing DB-native activation behavior remains active.
- Regression coverage verifies the legacy workbook is not called for DB-native activation.
