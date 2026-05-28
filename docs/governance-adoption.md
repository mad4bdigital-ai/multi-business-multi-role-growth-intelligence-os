# Governance Adoption Notes

This repository can use governance checklists and review automation, but they must fit the current architecture. Generic clean-architecture advice is not an implementation directive here.

## Current Boundaries

- Root canonicals (`system_bootstrap.md`, `memory_schema.json`, `prompt_router.md`, and related files) define governance authority.
- `http-generic-api/` is the primary runtime/API implementation boundary.
- Root `src/` currently contains TypeScript execution resolver sources and tests. It is not a mandate to reorganize the whole platform into `src/api`, `src/application`, `src/domain`, and `src/infrastructure`.
- `http-generic-api/openapi.yaml` is the source contract for callable HTTP routes.

## OpenAPI Contract Policy

The split OpenAPI files are intentional artifacts, not accidental duplication:

- `openapi.custom-gpt.auth-dispatcher.yaml` exposes the governed admin dispatcher surface.
- `openapi.tenant-gpt.auth.yaml` exposes the tenant GPT/MCP-style surface.
- `openapi.gpt-action.local-connector.yaml` exposes the standalone admin break-glass local connector.

Do not merge or delete these split files as a cleanup task. When route contracts change, update `http-generic-api/openapi.yaml`, regenerate or review the relevant split artifact, and run the OpenAPI split and Custom GPT schema tests.

## Data Source Policy

Production runtime should use SQL as the authoritative registry source (`DATA_SOURCE=sql`). Sheets support remains for legacy, bootstrap, and recovery workflows, not as the production default.

`dual` mode should be treated as a transition or recovery mode because SQL/Sheets mirror behavior can create drift if not monitored.

## Safe Adoption Rules

- Prefer documentation and review checklists before blocking CI or branch protection changes.
- Only add CI jobs that use scripts already present in `package.json` or checked-in test files.
- Do not add required Snyk, Sonar, coverage, Prettier, or migration rollback jobs until those tools and scripts exist in the repo.
- Treat branch protection as a repository settings step after the current CI jobs are stable and trusted.
- Keep governance changes small, reviewable, and reversible.
