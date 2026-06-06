# Activation probe spreadsheet diagnostic naming

Date: 2026-06-06

## Context

Activation bootstrap authority is DB-native through `/activation/bootstrap-config` and the `activation_bootstrap_config_read` system-layer tool. The remaining spreadsheet ID used by activation-related code is for Google Workspace/provider connectivity probe compatibility, not bootstrap authority.

## Change

The activation bootstrap diagnostic response now reports the spreadsheet ID as `activation_google_workspace_probe_spreadsheet_id`, with `legacy_activation_bootstrap_spreadsheet_id_alias` retained for compatibility context. It also includes `activation_bootstrap_authority: db_runtime` to make the authority boundary explicit.

## Safety

- No migration.
- No registry mutation.
- No callable surface removed.
- Existing legacy environment variable compatibility remains in `config.js`.
- The public bootstrap authority remains DB/runtime config, not Google Sheets.
