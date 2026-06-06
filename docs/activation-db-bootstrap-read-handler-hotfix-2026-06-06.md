# Activation DB-native bootstrap read handler hotfix

Date: 2026-06-06

## Context

PR #654 added the `activation_bootstrap_config_read` system-layer tool and deprecated `activation_sheets_bootstrap_read` as a compatibility alias that no longer calls Google Sheets.

Live validation after merge showed the tool was listed by `/admin/system/tools`, but dispatching it returned `unknown_tool` because the system-layer switch handler was missing.

## Fix

Add the `activation_bootstrap_config_read` case to `callSystemLayerTool`, routing it to `activationBootstrapConfigRead()`.

## Safety

- No migration.
- No registry mutation.
- No Google Sheets call.
- The legacy `activation_sheets_bootstrap_read` alias remains for compatibility but delegates to the DB-native bootstrap read.
- The authoritative bootstrap source remains backend runtime / DB config with `sheets_required: false`.
