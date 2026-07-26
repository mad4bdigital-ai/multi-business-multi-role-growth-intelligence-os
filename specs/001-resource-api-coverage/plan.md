# Implementation Plan: Self-Discovering Resource API Coverage

## Architecture

- **Transport registration**: `routes/resourceApiRoutes.js` registers Admin, Tenant, Session, and operation paths and applies transport authentication middleware only.
- **API mapping**: `src/api/resourceApi/resourceApiController.js` maps request parameters, response envelopes, status codes, and typed application errors.
- **Application orchestration**: `src/application/resourceApi/resourceApiService.js` coordinates membership, authorization, lifecycle operations, audit, summary generation, and same-cycle readback.
- **Domain policy**: `src/domain/resourceApi/resourceCatalog.js` owns descriptors, capability policy, pagination tokens, invariants, and typed errors.
- **Infrastructure**: `src/infrastructure/resourceApi/resourceRepository.js` owns code-selected SQL and safe projections; `resourceApiComposition.js` wires the SQL pool and existing summary/audit services.
- **Coverage authority**: `resource-api-coverage.manifest.json` defines logical resources and operation states.
- **Persistence**: MySQL registry tables persist descriptors, operation exports, audit runs, and findings.
- **CI**: `resource-api-coverage-audit.mjs` detects new uncovered relations, routes, and tool exports. `test-resource-api-architecture.mjs` blocks layer violations.
- **Contracts**: OpenAPI 3.1 documents all public paths without changing existing route contracts.
- **Governance**: canonical families, the Knowledge Guide, the folder map, and the architecture ADR declare fail-closed behavior and dependency direction.

## Dependency direction

```text
routes -> api/controllers -> application -> domain
                                  |
                                  v
                         infrastructure ports
```

Controllers do not call repositories directly. Domain and application modules do not depend on Express, JWT parsing, or database drivers. SQL exists only in infrastructure repositories.

## Validation strategy

1. Domain and coverage tests validate descriptors, pagination, and coverage policy.
2. Application tests use an injected fake repository to validate authorization, lifecycle behavior, transcript restrictions, and readback.
3. Architecture tests reject SQL or forbidden imports above the infrastructure layer.
4. OpenAPI and split-schema tests verify implementation/contract parity.
5. The complete explicit test manifest runs before PR merge.

## Rollout

1. Add additive migration and descriptor manifest.
2. Add resource routes and safe projections.
3. Register Admin/Tenant tools.
4. Add changed-surface and architecture CI gates.
5. Rebase on current `main` and resolve overlapping governance documents without dropping existing security policy.
6. Merge through governed PR checks.
7. Apply the additive migration through the governed migration process.
8. Verify production deployment and run the live audit.
9. Treat legacy findings as prioritized debt; block all new regressions.
