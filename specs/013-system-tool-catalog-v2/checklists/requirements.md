# Requirements Checklist

- [x] Catalog visibility is resolved before filtering, pagination, lookup, or intent resolution.
- [x] Ordering is deterministic by `source_key` and stable tool name.
- [x] V2 cursors bind catalog version, filter snapshot, and next index.
- [x] Stale cursors fail with a structured `409` response.
- [x] Direct lookup does not bypass principal visibility.
- [x] Intent resolution never grants execution authority.
- [x] Existing `tools`, `page`, and `total_available_tools` fields remain compatible.
- [x] Numeric cursors remain accepted during the documented migration window.
- [x] OpenAPI 3.1 documents list, lookup, resolution, observability, errors, and compatibility.
- [x] Tests cover 250 tools, isolation, stale cursors, ambiguity, parity, and HTTP routes.
- [x] No provider call, mutation, migration, deployment, device action, or secret exposure is introduced.
- [ ] CI and branch freshness are verified on the final head.
