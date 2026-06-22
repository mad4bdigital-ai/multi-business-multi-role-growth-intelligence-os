# Resource API Coverage Constitution

## Purpose

This Spec Kit governs resource-facing platform changes. It is subordinate to platform safety/runtime policy and the repository canonicals.

## Non-negotiable principles

1. **No feature without resource API coverage.** A new table, view, route, tool export, or user-visible workflow must map to a logical resource descriptor before merge.
2. **SQL authority, resource abstraction.** Runtime authority remains MySQL, but clients consume governed resources rather than raw tables.
3. **Tenant identity is server resolved.** Tenant and user principals cannot override tenant, workspace, or user scope supplied by signed authentication and active membership.
4. **Safe fields only.** Every resource has an explicit output allowlist. Secret values, credential payloads, raw authorization material, and unrestricted transcript content are forbidden.
5. **Drive-style completeness.** Resource design covers list, get, search, permissions, changes, revisions, and readback. Mutation operations additionally require validation, authorization, audit, and same-cycle readback.
6. **Archive before delete.** DELETE means archive, revoke, disable, or expire unless a separately approved purge policy exists.
7. **Fail closed in CI.** The coverage gate blocks new uncovered relations, routes, or tool exports. Exemptions must be explicit, justified, and expiring.
8. **OpenAPI 3.1 and structured errors.** Every public operation is documented and returns stable error envelopes.
9. **No raw SQL endpoint.** SQL fragments are selected from code-owned descriptors; client input never controls tables, columns, projections, or ordering.
10. **Backward-compatible rollout.** Existing routes remain available while new resource routes provide a consistent projection.

## Quality gates

A change is mergeable only when:

- its resource descriptor and operation matrix are complete;
- routes and tool exports appear in OpenAPI and the coverage manifest;
- tests are registered in the explicit test manifest;
- tenant isolation and field redaction are tested;
- mutations have readback and lifecycle semantics;
- canonicals and the knowledge guide are updated when behavior changes;
- CI, release readiness, and governed PR merge checks pass.
