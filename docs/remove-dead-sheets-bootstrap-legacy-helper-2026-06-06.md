# Remove dead Sheets bootstrap legacy helper

Date: 2026-06-06

## Context

Activation bootstrap is now DB-native. The active system-layer compatibility tool `activation_sheets_bootstrap_read` delegates to `activation_bootstrap_config_read` and returns `sheets_called: false` / `google_sheets_called: false`.

A stale, unrouted helper named `activationSheetsBootstrapReadLegacy()` remained in `http-generic-api/routes/systemLayerRoutes.js`. It still contained direct Google Sheets metadata and range reads, even though the dispatcher no longer routes to it.

## Change

Remove the dead legacy helper and the now-unused activation Sheets range import from `systemLayerRoutes.js`.

## Safety

- No migration.
- No registry mutation.
- No callable surface removed.
- The deprecated public compatibility alias remains available and DB-backed.
- Google Sheets is still available for unrelated user-owned/legacy recovery flows where explicitly governed, but not for activation bootstrap authority.
