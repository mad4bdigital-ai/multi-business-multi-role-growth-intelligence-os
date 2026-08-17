# Tenant Tool Auth Audit — 2026-08-17

## User-requested contract

Tenant Local Tools and System Tools must use exactly one OAuth security requirement:

```yaml
userBearerAuth:
  - https://auth.mad4b.com/scopes/tenant.links
  - https://auth.mad4b.com/scopes/tenant.status
  - https://auth.mad4b.com/scopes/tenant.activation
  - https://auth.mad4b.com/scopes/tenant.install
  - https://auth.mad4b.com/scopes/tenant.system-tools
```

The same tenant OAuth scope authority must be used in Staging and Production. Staging resource and authorization endpoints remain on `https://dev.mad4b.com`; this change does not create or modify a database.

## Repository evidence before patch

At branch `fix/production-readiness-oauth-db-parity-20260817`, Tenant Core production schema had 30 operations and five backend-auth operations: `/local/tools` GET (`listLocalGatewayTools`), `/system/tools` GET (`listTools`), `/system/tools/call` POST (`callTool`), `/gpt/sessions/{id}/turn` POST, and `/gpt/sessions/{id}/end` POST. The requested tool routes were declared with both `backendBearerAuth` and `backendApiKeyAuth`. Tenant Staging had 25 operations because `build-staging-openapi.mjs` excluded `/local/tools`, `/system/tools`, and `/system/tools/call` along with the two session routes.

The canonical source is `http-generic-api/openapi.yaml`; the three tool operations carry `x-custom-gpt-surfaces: [admin_core, tenant_core]` and tenant operation aliases. `scripts/split-openapi.mjs` applies `x-tenant-gpt-auth` globally, but currently preserves source backend security whenever any backend scheme appears. `build-staging-openapi.mjs` removes the three tool routes from the Staging Tenant schema.

The patch now separates the shared scope authority from the environment resource: `tenantGptOAuthPreset.js` emits the five `https://auth.mad4b.com/scopes/...` links in both environments, while Staging continues to use `https://dev.mad4b.com` for the OAuth issuer/resource and schema server. `openapi.yaml` records `x-tenant-gpt-security: tenant_user` for the three Tenant tool operations; `scripts/split-openapi.mjs` applies that marker only to the Tenant OAuth projection, so Admin projections retain backend authentication. `build-staging-openapi.mjs` retains the three Tenant tool routes and excludes only the two session-archive routes. Dedicated schema, OAuth, governance, and auth-parity tests cover the contract.

## OpenAPI reference consulted

[1] [OpenAPI Authentication and Security](https://swagger.io/docs/specification/v3_0/authentication/) — OAuth scopes are defined by the OAuth security scheme and referenced by Security Requirement Objects; scheme selection and scope requirements are separate from the server URL.

No database migration, new table, grant, privilege change, Production deployment, or live mutation is part of this schema-contract patch.
