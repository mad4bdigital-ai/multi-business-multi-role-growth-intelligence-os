# Execution Log Surface Authority Gate

## Purpose

This phase starts restoring `execution_log` as a governed execution evidence sink instead of allowing every service to write durable evidence directly.

The first shared helper is:

```text
http-generic-api/executionEvidenceLogger.js
```

It gates execution evidence writes through `registry_surfaces_catalog` before inserting into SQL `execution_log`.

## Runtime flow

```text
writeExecutionEvidence(...)
→ assertSurfaceAuthority(SURFACE_KEYS.EXECUTION_LOG, { requireExecution: true })
→ INSERT INTO execution_log
→ SELECT readback by execution_trace_id_writeback
```

## First integrated path

`platformPluginPolicy.js` now uses `writeExecutionEvidence(...)` for its policy upsert audit row.

This changes the evidence path from:

```text
platformPluginPolicy.js
→ INSERT INTO execution_log
```

to:

```text
platformPluginPolicy.js
→ writeExecutionEvidence
→ Execution Log surface authority check
→ INSERT INTO execution_log
→ readback
```

## Evidence contract

The helper requires:

- `traceId`
- `entryType`

It writes standard execution evidence fields and returns:

- `ok`
- `row`
- `trace_id`
- `surface_authority`
- `secrets_included: false`

## Authority chain

The execution evidence sink now follows:

```text
registry_surfaces_catalog
→ surface.operations_log_unified_sheet
→ execution_log
→ readback evidence
```

## Safety

- Missing trace IDs are rejected.
- Surface authority failures block durable writes.
- Output summaries are serialized safely.
- The helper returns secret-free metadata only.

## Next integrations

Remaining direct writers should be migrated to `writeExecutionEvidence(...)` incrementally:

- platformPluginContribution.js
- platformPluginInstall.js
- platformPluginPrivateRestDispatch.js
- platformPluginPromotion.js
- sessionSummaryService.js
