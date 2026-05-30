# Runtime sheet evidence removal note

Runtime registry reads must use SQL-primary registry tables. Google Sheets are not valid operational fallback for runtime authority.

This note records the S6 cleanup policy:

```text
readGovernedSheetRecords = SQL-only compatibility wrapper
Hostinger runtime registry reads = SQL-only
runtime responses must not return legacy_mirror_source
selected runtime schemas must not retain spreadsheet/sheet/workbook evidence fields
recovery from historical workbooks, if ever required, must be an explicit import job into SQL, not implicit runtime fallback
```

The CI guard `http-generic-api/test-no-sheet-runtime-evidence.mjs` blocks reintroducing removed sheet runtime evidence terms in governed runtime files and selected schemas.
