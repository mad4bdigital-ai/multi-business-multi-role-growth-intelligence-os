# JSON Asset Registry Required Execution Surface

## Purpose

This phase promotes the JSON Asset Registry from an authoritative memory/artifact surface to a required execution surface.

Phase 18 introduced a safe authority gate with:

```text
requireExecution: false
```

This phase adds a catalog migration and raises the runtime gate to:

```text
requireExecution: true
```

## Migration

```text
http-generic-api/migrations/133_sprint65_json_asset_registry_required_execution.sql
```

The migration updates:

```text
surface.json_asset_registry_sheet
required_for_execution = TRUE
authority_status = authoritative
active_status = active
backend_type = sql
backend_adapter = json_assets_readback_artifact_layer
authority_model = sql_runtime_authority
```

It also marks the legacy alias:

```text
surface.json_asset_registry
```

as a `legacy_alias` pointing to:

```text
surface.json_asset_registry_sheet
```

## Runtime flow

`sessionSummaryService.attachSessionSummaryToGraph(...)` now requires execution authority before writing summary memory artifacts:

```text
assertSurfaceAuthority(SURFACE_KEYS.JSON_ASSET_REGISTRY, { requireExecution: true })
→ INSERT INTO json_assets
→ INSERT INTO json_asset_subject_links
→ INSERT INTO platform_graph_nodes
→ INSERT INTO platform_graph_edges
```

## Why this matters

Session summary memory assets are now protected by the same authority chain as execution evidence:

```text
registry_surfaces_catalog
→ required JSON Asset Registry surface
→ json_assets / graph memory writes
```

This prevents runtime memory writes from trusting table presence alone.

## Safety

The gate remains secret-free and does not expose raw session transcript, raw provider output, Drive file IDs, folder IDs, or secrets.
