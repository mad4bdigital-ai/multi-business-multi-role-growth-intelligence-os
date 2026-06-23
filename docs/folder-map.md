# Repository Folder Map

## Purpose

This document records the active repository structure and the ownership boundaries that must remain stable during implementation and review.

## Resource API structure

```text
http-generic-api/
├─ routes/
│  └─ resourceApiRoutes.js
├─ src/
│  ├─ api/resourceApi/
│  │  └─ resourceApiController.js
│  ├─ application/resourceApi/
│  │  └─ resourceApiService.js
│  ├─ domain/resourceApi/
│  │  └─ resourceCatalog.js
│  └─ infrastructure/resourceApi/
│     ├─ resourceRepository.js
│     └─ resourceApiComposition.js
├─ activation-surfaces/
├─ migrations/
├─ scripts/
├─ openapi.yaml
├─ openapi.tenant-gpt.auth.yaml
├─ resource-api-coverage.manifest.json
└─ test-resource-api-*.mjs
```

## Layer responsibilities

### `routes/`

Transport registration only. A route may apply transport authentication middleware and delegate to a controller. It must not contain SQL, resource policy, workflow orchestration, or provider calls.

### `src/api/`

Controllers map HTTP requests to application calls and map typed application errors into stable response envelopes and status codes. Controllers must not import the SQL pool or construct persistence queries.

### `src/application/`

Application services coordinate membership, authorization, lifecycle operations, auditing, summary generation, and same-cycle readback. They depend on domain policy and injected ports, not Express, JWT parsing, or database drivers.

### `src/domain/`

Domain modules own resource descriptors, capability policy, pagination token rules, typed errors, and invariants. Domain code remains independent of transport and persistence frameworks.

### `src/infrastructure/`

Repositories and composition modules own SQL, database access, and wiring to existing services. SQL table and field selection remains code-owned and descriptor-bound.

### `activation-surfaces/`

Safe activation summary descriptors. Every qualifying migration table must have a descriptor or an explicit governed exclusion.

### `migrations/`

Additive schema migrations and registry seed data. Destructive operations require separate review, rollback planning, and explicit approval.

### `scripts/`

Repeatable CI and maintenance utilities, including changed-surface resource coverage detection.

### `.specify/` and `specs/`

The Spec Kit constitution, reusable templates, approved feature specifications, plans, tasks, data models, and contracts.

## Dependency direction

```text
routes -> api/controllers -> application -> domain
                                  |
                                  v
                         infrastructure ports
```

Infrastructure is composed at the application boundary. Controllers do not call repositories directly for resource workflows.

## Enforcement

`test-resource-api-architecture.mjs` fails when SQL or database imports appear above the infrastructure layer, when application/domain code depends on Express or JWT parsing, or when the resource route file grows beyond its transport-only role.

Update this map whenever a new top-level subsystem or architectural layer is added.
