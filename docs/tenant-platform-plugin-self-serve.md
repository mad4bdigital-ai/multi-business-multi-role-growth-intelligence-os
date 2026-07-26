# Tenant self-serve Platform Plugin routes

## Purpose

Tenants and users should be able to discover, install, and resolve promoted Platform Base plugins without admin-only tooling. These routes expose tenant-facing surfaces backed by the same governed runtime logic while deriving `tenant_id` and `user_id` from the signed-in user JWT.

## Runtime surfaces

- `GET /tenant/platform/plugins/catalog`
- `POST /tenant/platform/plugins/install`
- `POST /tenant/platform/plugins/resolve`

## Auth model

All routes require a user JWT. The server resolves an active tenant membership for the signed-in user. Request bodies cannot override `tenant_id` or `user_id`.

## Install behavior

Tenant install calls the same guarded install service used by admin tooling:

- writes a tenant policy overlay
- optionally writes no-secret connection metadata
- rejects secret-like payload keys
- requires HTTPS metadata URLs
- does not mutate Platform Base tables

## Resolve behavior

Tenant resolve evaluates plugin readiness using:

- Platform Base definition
- action/tool binding
- tenant policy overlay
- user/tenant connection state
- skill gate preview when applicable

## Boundaries

- These routes do not certify or promote contributions.
- These routes do not mutate `app_integrations`.
- These routes do not accept secrets.
- Real credentials must go through OAuth or governed credential intake.
