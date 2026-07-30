# ADR: System Tool Catalog V2

## Status

Proposed on branch `gpt/013-system-tool-catalog-v2`.

## Context

A growing flat System Layer catalog made tool visibility depend on array order and a fixed first-page limit. Increasing the limit postpones the problem but does not solve discovery, stable traversal, direct lookup, or intent resolution.

## Decision

Adopt a principal-scoped Catalog V2 with:

- deterministic `source_key + tool_name` ordering;
- catalog-version and filter-snapshot cursors;
- direct lookup by stable name;
- read-only intent-to-capability resolution over the visible descriptor set;
- descriptor/runtime parity diagnostics;
- no-secret observability;
- a temporary bounded compatibility adapter for no-query legacy clients.

Catalog results are discovery projections and never execution authority. Existing effective capability, authority, approval, dispatch, and readback systems remain canonical.

## Consequences

Clients can traverse large catalogs safely and resolve known tools without scanning pages. Stale cursors fail explicitly. A later versioned change can remove compatibility mode after metrics show zero legacy use.
