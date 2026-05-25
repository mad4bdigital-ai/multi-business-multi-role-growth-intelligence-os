# Session Summary Graph Readback Integrity

## Purpose

After Platform Graph Memory became a required execution surface, session summary verification must validate the graph topology that was written, not only the JSON asset row.

This phase extends `verifySessionSummaryWrite(...)` with explicit readback for:

```text
platform_graph_nodes
platform_graph_edges
```

## Runtime flow

After a session summary is written and attached to graph memory, verification now checks:

```text
session_summaries row exists
json_assets row exists
conversation graph node exists
json_asset graph node exists
attached_to graph edge exists
```

The expected graph IDs are deterministic:

```text
conversation.<session_id>
json_asset.<summary_asset_id>
edge.session_summary.<summary_id>
```

## Verification fields

`verifySessionSummaryWrite(...)` now returns:

```text
graph_conversation_node_present
graph_asset_node_present
graph_edge_present
graph_topology_present
graph_edge_id
```

`ok` now requires:

```text
summary row present
AND graph topology present
```

## Execution evidence

`writeSessionSummaryExecutionLog(...)` includes graph topology readback in `output_summary.verification`.

If the summary row exists but graph topology is incomplete, recovery notes classify it as:

```text
summary_graph_topology_missing
```

## Why this matters

A successful JSON asset write is not enough to prove memory graph integrity. Runtime retrieval depends on the topology between:

```text
conversation node
summary asset node
attached_to edge
```

This phase makes that topology observable and verifiable.

## Safety

The readback checks deterministic IDs and lifecycle/status metadata only. It does not expose raw transcripts, raw summaries beyond existing summary-only payloads, Drive file IDs, folder IDs, or secrets.
