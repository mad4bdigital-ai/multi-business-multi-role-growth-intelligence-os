# ADR: Resource API Layer Boundaries

**Status:** Accepted  
**Date:** 2026-06-22

## Context

The first Resource API implementation proved the contracts, security model, tenant scoping, lifecycle behavior, and coverage gate, but concentrated descriptors, SQL, authorization orchestration, and HTTP response handling in `routes/resourceApiRoutes.js`. The behavior was tested, yet the route layer had become a maintenance and security hotspot.

The repository architecture requires interface code to receive input and map responses, application services to coordinate workflows, domain modules to own policy, and infrastructure adapters to isolate persistence and external systems.

## Decision

The Resource API is divided into explicit layers:

- `routes/resourceApiRoutes.js` registers paths and transport authentication middleware.
- `src/api/resourceApi/resourceApiController.js` maps HTTP input/output and typed errors.
- `src/application/resourceApi/resourceApiService.js` coordinates memberships, permissions, lifecycle behavior, audit, summary generation, and readback.
- `src/domain/resourceApi/resourceCatalog.js` owns descriptors, capabilities, pagination rules, invariants, and typed errors.
- `src/infrastructure/resourceApi/resourceRepository.js` owns SQL and persistence projections.
- `src/infrastructure/resourceApi/resourceApiComposition.js` wires the SQL pool and existing summary/audit services.

All existing public routes and OpenAPI contracts remain backward compatible. The refactor introduces no new runtime dependency and no database schema change.

## Enforcement

`test-resource-api-architecture.mjs` is a blocking CI test. It rejects:

- SQL above the infrastructure layer;
- direct database imports from routes, controllers, or application services;
- Express or JWT dependencies in application/domain/repository modules;
- direct route imports of summary or audit infrastructure;
- route growth beyond a bounded transport-only size.

`test-resource-api-service.mjs` validates application behavior with an injected repository, including tenant isolation, ownership, input validation, transcript preview restrictions, audit arguments, and same-cycle summary readback.

## Consequences

### Positive

- Persistence and transport can evolve independently.
- Authorization and lifecycle behavior are unit-testable without Express or MySQL.
- SQL projections remain explicit and code-owned.
- Future resource adapters can reuse domain and application policy.
- Architectural regressions become merge-blocking.

### Costs

- More modules and explicit dependency wiring.
- Cross-layer changes may touch several focused files instead of one large route module.

## Alternatives considered

1. Keep all logic in the route module and rely on review. Rejected because review alone did not prevent architectural drift.
2. Move only SQL into a helper. Rejected because authorization and orchestration would still remain transport-coupled.
3. Introduce a new framework or ORM. Rejected because it adds dependency and migration risk without solving the immediate boundary problem.
