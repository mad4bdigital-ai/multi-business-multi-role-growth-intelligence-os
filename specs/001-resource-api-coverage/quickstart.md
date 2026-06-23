# Quickstart

From `http-generic-api/`:

```bash
node scripts/resource-api-coverage-audit.mjs --ci --changed
node test-resource-api-coverage.mjs
node test-resource-api-architecture.mjs
node test-resource-api-service.mjs
npm test
```

The architecture test verifies that:

- routes and controllers contain no SQL;
- application and domain modules do not depend on Express, JWT parsing, or database drivers;
- persistence queries remain in `src/infrastructure/resourceApi/resourceRepository.js`;
- existing Admin, Tenant, and Session routes remain registered.

Runtime Admin audit:

```http
GET /admin/resource-coverage/audit?persist=true&limit=250
```

Tenant catalog:

```http
GET /me/workspaces/{tenant_id}/resources
```

Search example:

```http
GET /me/workspaces/{tenant_id}/resources/sessions?q=activation&pageSize=50
```

Layer map:

```text
routes -> src/api -> src/application -> src/domain
                           |
                           v
                  src/infrastructure
```

See `docs/adr-2026-06-22-resource-api-layer-boundaries.md` and `docs/folder-map.md` before changing resource routing, authorization, or persistence behavior.
