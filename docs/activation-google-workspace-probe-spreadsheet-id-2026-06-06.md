# Activation Google Workspace probe spreadsheet ID

Date: 2026-06-06

## Context

Activation bootstrap authority is DB-native via `/activation/bootstrap-config` and `activation_bootstrap_config_read`.

A legacy environment/config name, `ACTIVATION_BOOTSTRAP_SPREADSHEET_ID`, remained in provider-probe paths after Sheets bootstrap reads were deprecated. The name implied that Google Sheets was still activation bootstrap authority, even though the value is now only needed for Google Workspace connectivity/probe compatibility.

## Change

Add the neutral config name `ACTIVATION_GOOGLE_WORKSPACE_PROBE_SPREADSHEET_ID`.

Resolution order:

1. `ACTIVATION_GOOGLE_WORKSPACE_PROBE_SPREADSHEET_ID`
2. `ACTIVATION_PROVIDER_PROBE_SPREADSHEET_ID`
3. legacy `ACTIVATION_BOOTSTRAP_SPREADSHEET_ID`
4. existing default ID

`ACTIVATION_BOOTSTRAP_SPREADSHEET_ID` remains as a deprecated compatibility alias to avoid breaking older environment configuration and legacy getSheetValues placeholder tests.

## Safety

- No migration.
- No registry mutation.
- DB bootstrap authority is unchanged.
- Google Sheets is not restored as activation bootstrap authority.
- The deprecated `activation_sheets_bootstrap_read` alias remains DB-backed and reports `sheets_called: false`.
