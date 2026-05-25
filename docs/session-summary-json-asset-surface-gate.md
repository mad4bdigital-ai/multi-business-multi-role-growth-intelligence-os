# Session Summary JSON Asset Surface Gate

## Purpose

This phase starts restoring `json_assets` as a governed memory/artifact surface instead of allowing session-summary graph attachment to trust table presence alone.

Session summary memory assets now require the JSON Asset Registry surface to be active and authoritative before `sessionSummaryService` writes summary-only memory assets.

## Runtime flow

`sessionSummaryService.attachSessionSummaryToGraph(...)` now runs:

```text
assertSurfaceAuthority(SURFACE_KEYS.JSON_ASSET_REGISTRY, { requireExecution: false })
→ INSERT INTO json_assets
→ INSERT INTO json_asset_subject_links
→ INSERT INTO platform_graph_nodes
→ INSERT INTO platform_graph_edges
```

## Why `requireExecution: false`

Current catalog state marks:

```text
surface.json_asset_registry_sheet
authority_status: authoritative
active_status: active
required_for_execution: FALSE
```

Because the surface is authoritative but not yet marked required for execution, this phase gates on active/authoritative status without requiring `required_for_execution = TRUE`. A later catalog-policy migration can safely promote this to a required execution surface.

## Evidence

`attachSessionSummaryToGraph(...)` returns secret-free surface evidence:

```text
surface_authority: {
  ok,
  resolved_surface_key,
  classification,
  code,
  secrets_included: false
}
```

## Safety

The gate does not expose raw session transcript, raw summary text beyond existing summary-only asset payload, file IDs, folder IDs, or secrets.

## Governance chain

The session summary memory path now follows:

```text
registry_surfaces_catalog
→ surface.json_asset_registry_sheet
→ json_assets
→ json_asset_subject_links
→ platform graph nodes/edges
```

This complements the existing execution-evidence chain:

```text
registry_surfaces_catalog
→ surface.operations_log_unified_sheet
→ writeExecutionEvidence(...)
→ execution_log
```
