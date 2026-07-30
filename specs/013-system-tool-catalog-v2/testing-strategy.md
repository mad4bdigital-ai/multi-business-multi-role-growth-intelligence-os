# Testing Strategy

- Generate 250 descriptors and traverse every page without loss or duplication.
- Reverse input order and prove identical catalog version and result ordering.
- Resolve a descriptor positioned after item 200 by direct lookup.
- Reject stale or malformed cursors with structured errors.
- Prove explicit pagination remains bounded while legacy compatibility is separately labeled.
- Prove Tenant-visible subsets cannot look up or resolve hidden Admin descriptors.
- Prove exact tool/capability resolution and ambiguity handling.
- Audit descriptor/runtime parity and observability counters.
- Run HTTP integration tests for list, lookup, resolution, errors, and observability.
- Run OpenAPI 3.1 validation and existing platform regression suites.
