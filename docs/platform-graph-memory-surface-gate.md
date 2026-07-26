# Platform Graph Memory Surface Gate

## Purpose

This phase registers the platform graph memory tables as a required runtime surface and gates session summary graph writes on that surface authority.

The affected tables are:

```text
platform_graph_nodes
platform_graph_edges
```

## Migration

```text
http-generic-api/migrations/134_sprint65_platform_graph_memory_surface.sql
```

The migration seeds or updates:

```text
surface_id: surface.platform_graph_memory
logical_surface_key: surface.platform_graph_memory
surface_name: Platform Graph Memory
authority_status: authoritative
required_for_execution: TRUE
active_status: active
backend_type: sql
backend_adapter: platform_graph_memory_writer
authority_model: sql_runtime_authority
```

## Runtime flow

`sessionSummaryService.attachSessionSummaryToGraph(...)` now checks two memory/artifact surfaces before writing graph memory:

```text
assertSurfaceAuthority(SURFACE_KEYS.JSON_ASSET_REGISTRY, { requireExecution: true })
assertSurfaceAuthority(SURFACE_KEYS.PLATFORM_GRAPH_MEMORY, { requireExecution: true })
→ INSERT INTO json_assets
→ INSERT INTO json_asset_subject_links
→ INSERT INTO platform_graph_nodes
→ INSERT INTO platform_graph_edges
```

## Evidence

The returned `surface_authority` evidence is secret-free and includes both:

```text
json_asset_registry
platform_graph_memory
```

Each contains:

```text
ok
resolved_surface_key
classification
code
secrets_included: false
```

## Why this matters

Session summary memory writes now require separate authority for:

```text
JSON artifact storage
Graph memory topology
```

This avoids assuming that permission to write JSON assets automatically authorizes graph node/edge writes.

## Governance chain

```text
registry_surfaces_catalog
→ surface.json_asset_registry_sheet
→ json_assets / json_asset_subject_links

registry_surfaces_catalog
→ surface.platform_graph_memory
→ platform_graph_nodes / platform_graph_edges
```

## Safety

The surface gate does not expose raw transcripts, raw summaries beyond existing summary-only payloads, Drive file IDs, folder IDs, or secrets.
