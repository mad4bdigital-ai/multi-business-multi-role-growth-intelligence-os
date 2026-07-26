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
├─ resourceApiCoverageService.js
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

Capability security decisions live under `http-generic-api/src/domain/capability/`. That layer owns `SecurityDecision`, gate results, public/admin trace projection, invariant metrics, and fail-closed dispatch invariants. Routes and infrastructure may project or persist the result, but must not reimplement security decision rules.

### `src/infrastructure/`

Repositories and composition modules own SQL, database access, and wiring to existing services. SQL table and field selection remains code-owned and descriptor-bound.

### `activation-surfaces/`

Safe activation summary descriptors. Every qualifying migration table must have a descriptor or an explicit governed exclusion.

### `migrations/`

Additive schema migrations and registry seed data. Destructive operations require separate review, rollback planning, and explicit approval.

### `scripts/`

Repeatable CI and maintenance utilities, including changed-surface Resource API coverage detection.

### `http-generic-api/docs/` and `docs/`

Subsystem-local docs under `http-generic-api/docs/` describe service-owned runtime contracts. Repository-level docs under `docs/` describe cross-cutting architecture, runbooks, migration guidance, and documentation governance. Changes that add a security contract, trace schema, or deprecation timeline must update the relevant subsystem notes plus a repository-level migration guide.

### Resource surface policy authority

`resourceApiCoverageService.js`, `resource-api-coverage.manifest.json`, and `platform_resource_surface_policy_registry` jointly classify tables, views, and tools. A surface must either resolve to a logical resource or declare an explicit internal policy with rationale; broad implicit exemptions are not an architectural boundary.

### `.specify/` and `specs/`

The Spec Kit constitution, reusable templates, approved feature specifications, plans, tasks, data models, contracts, machine-readable `completion.json` records, and feature-specific checklists. Any new or modified Spec Kit is subject to the changed-scope completion gate.

## OpenAPI canonical and generated artifacts

### `canonicals/openapi/`

Git-controlled source contracts that are not derived from `http-generic-api/openapi.yaml`. The Local Connector contract lives here because it has a separate host, authentication profile, and device-plane ownership boundary.

### `edge/activation-gateway/`

Canonical Cloudflare Worker source, generated route policy, runtime enforcement, and deployment runbook for the Activation Gateway. This source is not imported directly by the auth-host service image.

### `http-generic-api/activation-gateway-runtime/`

Generated service-local copy of the Worker modules and route policy used by the governed rollout tools. It exists because the auth-host Docker image copies only `http-generic-api`. Do not edit it directly; regenerate with `npm run activation-gateway:bundle:sync` and enforce parity with `npm run activation-gateway:bundle:check`.

### `http-generic-api/activationGatewayRolloutTool.js`

Application/infrastructure boundary for read-only rollout planning and approval-gated workers.dev dark deployment. It owns exact resource validation, signed attestation checks, single-use envelope claiming, secret-safe Cloudflare calls, awaited audit evidence, smoke readback, and rollback. DNS and custom-domain operations are outside its authority.

### `http-generic-api/scripts/sync-activation-gateway-runtime-bundle.mjs`

Deterministic write/check generator that copies the canonical Worker modules and route policy into the service-local runtime bundle and records stable SHA-256 evidence.

### `http-generic-api/scripts/generate-custom-gpt-schemas.mjs`

The single write/check orchestrator for active Custom GPT schemas. It generates into a temporary directory, validates every artifact, and writes committed files only after validation succeeds.

### `http-generic-api/scripts/openapi-builder-schema-guard.mjs`

Recursive OpenAPI 3.1 contract validation for request, response, component, array, reference, and property schemas. Empty YAML property schemas and unresolved local references are release-blocking.

### Generated `http-generic-api/openapi.*.yaml` files

Published action schemas are generated artifacts. Do not hand-edit them. Update `openapi.yaml` or the relevant file under `canonicals/openapi/`, run `npm run schemas:generate`, and commit both the canonical and generated output.

### `edge/activation-gateway/`

Stateless Activation transport boundary deployed separately from the auth application. It consumes the generated route policy, enforces signed policy freshness and bounded host/path/method/query/header rules, and forwards allowed requests only to `auth.mad4b.com`. It must not connect to MySQL, resolve tenant membership, decrypt credentials, select providers, or implement Activation business logic.

The committed `generated/route-policy.json` file is produced from the Activation Admin and Tenant Activation OpenAPI surfaces. Edit `canonicals/openapi/custom-gpt-surfaces.yaml` or `http-generic-api/openapi.yaml`, not the generated policy directly.

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
