# Feature Specification: Policy-Driven Resource Surface Governance

## Problem

The Resource API live audit currently assumes every table, view, and enabled tool must be exposed as a logical resource. That creates false positives for internal runtime surfaces and weakens the signal of genuine coverage gaps.

## Objective

Require every table, view, and enabled tool to have an explicit Resource API exposure decision. A surface is either covered by a logical resource or operation, or explicitly classified as internal with requirement states and rationale.

## User scenarios

1. A developer adds a user-visible relation. CI blocks the change unless a logical resource descriptor covers it.
2. A developer adds an internal registry or log. CI blocks the change unless the migration declares an explicit surface policy.
3. An operator runs the live audit. The result reports only unmet declared requirements, not generic physical-column assumptions.
4. A reviewer can distinguish resource sources, read models, tools, internal runtime surfaces, placeholders, and recovery snapshots.

## Functional requirements

- Create `platform_resource_surface_policy_registry`.
- Backfill active policies for every current base table, view, and enabled Admin or Tenant tool.
- Keep new relations and tools fail-closed in changed-scope CI.
- Evaluate descriptor, operation, archive, and version requirements from policy states.
- Resolve current `runtime_unclassified` lifecycle metadata through a deterministic metadata-only backfill.
- Preserve structured findings, bounded output, persistence, and no-secret guarantees.
- Preserve existing HTTP routes and OpenAPI contracts.

## Non-goals

- Exposing internal SQL tables as public endpoints.
- Adding optimistic concurrency to resources whose selected strategy is `readback_guarded`.
- Running archive, delete, purge, or provider operations.

## Success criteria

- Unit and integration tests pass.
- Changed-scope gate rejects a new relation or tool without a descriptor or explicit policy.
- Migration preflight passes with no destructive operation.
- Migration readback shows active policy coverage for all current relations and enabled tools.
- Post-merge live audit returns zero unresolved findings under declared policy.
