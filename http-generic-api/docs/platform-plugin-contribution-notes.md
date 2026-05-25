# Platform Plugin contribution intake notes

## Purpose

Platform Plugin contribution intake lets tenants and users propose scoped plugin drafts without modifying the Platform Base.

This is the first step toward user/tenant-driven platform growth:

1. Tenant/user creates a private draft contribution.
2. The draft can later be submitted for validation and certification.
3. Certified contributions may later be promoted into marketplace or Platform Base surfaces.

## Storage

New table:

- `platform_plugin_contributions`

The table stores no credentials. It stores manifests, protocol/action binding proposals, and credential resolver policy metadata only.

## Routes and tools

- `POST /platform/plugins/contributions` → `platform_plugin_contribution_create`
- `GET /platform/plugins/contributions` → `platform_plugin_contribution_list`
- `GET /platform/plugins/contributions/{contribution_id}` → `platform_plugin_contribution_get`

## Guardrails

Contribution create validates:

- owner scope is `tenant` or `user`
- target is tenant/user private, marketplace candidate, or platform base candidate
- active tenant/user exists when provided
- `plugin_key` does not collide with current `app_integrations`
- `base_plugin_key`, when provided, exists in current `app_integrations`
- payload does not contain secret-like keys

It then writes the draft row, reads it back, and writes `execution_log` evidence.

## Non-goals

This route does not:

- execute contributed plugins
- store credentials
- mutate `app_integrations`
- publish to a marketplace
- promote to Platform Base
- grant agent skills

## Next implementation step

Add a certification preview surface that validates contribution manifests and produces a structured validation report without promoting the draft.
