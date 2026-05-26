# Session Summary Memory Surface Resolver

## Purpose

This phase registers `session_summaries` as a governed memory surface and adds a graph-backed read resolver for session summary memory.

Previous phases protected:

```text
execution_log
json_assets
platform_graph_nodes/platform_graph_edges
```

This phase protects the summary row itself:

```text
session_summaries
```

## Migration

```text
http-generic-api/migrations/139_sprint65_session_summary_memory_surface.sql
```

It seeds or updates:

```text
surface_id: surface.session_summary_memory
logical_surface_key: surface.session_summary_memory
surface_name: Session Summary Memory
authority_status: authoritative
required_for_execution: TRUE
active_status: active
backend_type: sql
backend_adapter: sessionSummaryService
authority_model: sql_runtime_authority
```

## Runtime write gate

`writeSessionSummary(...)` now checks:

```text
assertSurfaceAuthority(SURFACE_KEYS.SESSION_SUMMARY_MEMORY, { requireExecution: true })
```

before inserting into:

```text
session_summaries
```

## Graph-backed read resolver

`loadSessionSummaryGraphMemory(...)` now provides a secret-free read path:

```text
assertSurfaceAuthority(SURFACE_KEYS.SESSION_SUMMARY_MEMORY, { requireExecution: true })
assertSurfaceAuthority(SURFACE_KEYS.JSON_ASSET_REGISTRY, { requireExecution: true })
assertSurfaceAuthority(SURFACE_KEYS.PLATFORM_GRAPH_MEMORY, { requireExecution: true })
→ SELECT candidate session_summaries
→ verifySessionSummaryWrite(...)
→ return only summaries with graph_topology_present
```

## Returned memory shape

The resolver returns compact, summary-only memory:

```text
summary_id
session_id
tenant_id
user_id
workspace_key
summary_text
tasks_completed
blockers
feature_requests
integration_needs
complexity
turn_count
created_at
graph_edge_id
graph_topology_present
secrets_included: false
```

## Safety

The resolver does not return raw transcripts, raw provider outputs, Drive file IDs, folder IDs, credentials, or tokens. Summary text is redacted and bounded.

## Governance chain

```text
registry_surfaces_catalog
→ surface.session_summary_memory
→ session_summaries
→ verify graph-backed memory topology
→ return compact memory artifact
```
