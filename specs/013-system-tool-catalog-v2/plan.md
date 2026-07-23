# Implementation Plan

## Phase 1 — Pure catalog service

Implement stable descriptor normalization, catalog versions, snapshot-bound cursors, filtering, direct lookup, intent ranking, parity audit, and no-secret counters. Validate with a 250-tool fixture.

## Phase 2 — System Layer wiring

Route `/system/tools` through Catalog V2, preserve a bounded compatibility adapter for no-query clients, and add direct lookup, capability resolution, and admin observability routes.

## Phase 3 — Contracts and compatibility

Publish OpenAPI 3.1, structured errors, examples, migration guidance, and deprecation metadata. Preserve existing response aliases during the compatibility window.

## Phase 4 — Verification and rollout

Run syntax, architecture, unit/integration, isolation, descriptor parity, and large-catalog tests. Enable read-only behavior only. Remove the legacy adapter in a later separately approved version after usage reaches zero.
