# Activation Session Summary Graph Memory

## Purpose

This phase wires the graph-backed session summary memory resolver into activation/session-context.

Previous phases created a governed read path:

```text
loadSessionSummaryGraphMemory(...)
```

This phase makes activation consume that path before falling back to direct SQL summary reads.

## Runtime flow

`loadConversationMemoryContext(...)` now does:

```text
loadSessionSummaryGraphMemory({ tenant_id, user_id, limit })
→ returns only graph-backed summaries with graph_topology_present=true
→ conversation_memory.recent_session_summaries
```

If the graph-backed resolver fails, activation falls back to the legacy bounded SQL query:

```text
SELECT ... FROM session_summaries
```

and marks:

```text
conversation_memory.session_summary_memory.fallback_used = true
```

## Evidence fields

`conversation_memory.status` now includes:

```text
summary_strategy: prefer_graph_backed_session_summary_memory_then_sql_fallback
graph_backed_session_summaries
session_summary_fallback_used
```

`conversation_memory.session_summary_memory` includes:

```text
source
graph_backed
fallback_used
fallback_reason
count
surface_authority
secrets_included: false
```

## Safety

The graph-backed resolver is secret-free and returns compact, bounded summary memory only. It does not return raw transcripts, raw provider outputs, Drive file IDs, folder IDs, credentials, or tokens.

## Why this matters

Hard activation now benefits from the governed memory chain:

```text
registry_surfaces_catalog
→ Session Summary Memory
→ JSON Asset Registry
→ Platform Graph Memory
→ graph topology readback
→ activation/session-context memory
```
