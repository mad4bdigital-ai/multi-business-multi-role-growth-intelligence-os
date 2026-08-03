# Runtime Registry Authority

The generic `runtime_endpoint_call` resolver must not require a Registry Google Sheet when the configured registry authority is SQL-backed.

## Authority modes

- `DATA_SOURCE=sql`: runtime registry authority is SQL. `REGISTRY_SPREADSHEET_ID` is not required.
- `DATA_SOURCE=dual`: runtime registry authority remains SQL at resolver level. No automatic Sheets fallback is attempted.
- `DATA_SOURCE=sheets`: `REGISTRY_SPREADSHEET_ID` is required before registry loading. Missing configuration returns HTTP `503` with code `registry_spreadsheet_id_required`.
- Any other `DATA_SOURCE` value returns HTTP `503` with code `invalid_registry_data_source`.

## Google Sheets operations

An ordinary Google Sheets API request that supplies `path_params.spreadsheetId` is independent from the Registry workbook configuration. The explicit request spreadsheet ID must continue to be used even when runtime registry authority is SQL.

## Force refresh

A force refresh follows the canonical loader for the configured authority. SQL and dual modes call the SQL-backed registry reload path without requiring Sheets configuration.

## Safety boundary

The resolver does not silently fall back from SQL to Sheets. Authority selection is explicit, invalid configuration fails closed, and provider resolution occurs only after the authority contract is validated.
