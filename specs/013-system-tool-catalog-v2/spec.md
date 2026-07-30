# Feature Specification: System Tool Catalog V2

**Branch:** `gpt/013-system-tool-catalog-v2`  
**Status:** implementation started

## Problem

The legacy System Layer list couples tool discovery to array order and a fixed page window. As the catalog grows, previously visible tools can leave the first page and clients can incorrectly treat absence from that page as absence from the platform.

## Requirements

- **FR-001:** Catalog listing MUST be principal-scoped before filtering, sorting, pagination, lookup, or intent resolution.
- **FR-002:** Catalog ordering MUST be deterministic by `source_key` and stable tool name.
- **FR-003:** Cursor traversal MUST bind a catalog version, filter snapshot, and next index.
- **FR-004:** A stale cursor MUST fail with `409 SYSTEM_TOOL_CATALOG_SNAPSHOT_MISMATCH`.
- **FR-005:** Direct lookup MUST return one visible descriptor or a non-enumerating `404`.
- **FR-006:** Intent resolution MUST use the same visible descriptor set and MUST NOT grant execution authority.
- **FR-007:** Descriptor/runtime parity MUST be auditable and fail closed for callable projections.
- **FR-008:** The transitional no-query list MAY return a bounded legacy projection with deprecation metadata.
- **FR-009:** Explicit `limit`, `cursor`, query, tag, source, and capability filters MUST remain paginated.
- **FR-010:** OpenAPI 3.1 MUST document list, lookup, resolution, errors, cursor behavior, auth, and compatibility metadata.
- **FR-011:** Observability MUST count list, direct lookup, misses, legacy requests, resolution, snapshot mismatch, descriptor/runtime mismatch, and descriptor-name collision without secrets.
- **FR-012:** The implementation MUST support at least 250 descriptors without loss, duplication, or order drift.
- **FR-013:** A public stable tool name MUST identify no more than one divergent visible descriptor. Normalized-equivalent duplicates MAY be coalesced, but any conflicting descriptor sharing the same name MUST fail closed with `500 SYSTEM_TOOL_DESCRIPTOR_NAME_COLLISION` independently of input order.
- **FR-014:** Query, tag, alias, description, and intent normalization MUST preserve Unicode letters and numbers, including Arabic and other non-Latin scripts; normalization MUST NOT erase a valid non-Latin intent.

## Non-goals

- No provider call or mutation.
- No new execution authority.
- No migration in the initial implementation.
- No replacement of effective capability, approval, dispatch, or readback authorities.
