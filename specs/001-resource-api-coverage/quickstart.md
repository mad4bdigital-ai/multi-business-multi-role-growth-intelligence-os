# Quickstart

From `http-generic-api/`:

```bash
node scripts/resource-api-coverage-audit.mjs
node test-resource-api-coverage.mjs
npm test -- --grep=resource-api-coverage
```

CI regression mode:

```bash
node scripts/resource-api-coverage-audit.mjs --ci --changed
```

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
