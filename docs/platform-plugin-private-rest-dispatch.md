# Platform Plugin private REST dispatch

## Purpose

Private REST dispatch allows a tenant/user-owned Platform Plugin contribution to execute a REST action inside the owner's scope before Platform Base promotion.

Promotion remains required before other tenants/users can install or use the plugin from the shared Platform Base.

## Runtime surface

- `POST /platform/plugins/contributions/dispatch-rest`
- Tool: `platform_plugin_contribution_private_dispatch_rest`

## Required conditions

The dispatcher requires:

- private contribution activation
- owner tenant/user scope match
- action binding match
- contribution credential policy allows the requested scope
- active `user_app_connections` row for the contribution `plugin_key`
- `api_base_url` on the owner connection
- HTTPS URL

## Guardrails

- No localhost or private network targets.
- No HTTP; HTTPS only.
- No raw JavaScript or arbitrary code execution.
- Authorization, cookie, API-key, and proxy auth headers are stripped from contribution action headers.
- Secrets are not returned.
- Execution writes `execution_log` evidence.
- `dry_run` is supported to verify dispatch planning without outbound HTTP.

## Certification parity backlog

The public Platform Plugin REST dispatch path now enforces smoke certification, expiry, drift, recertification policy, audit history, and rollback controls. Private contribution dispatch must reach parity before private actions are treated as production-ready outside owner-scoped smoke work.

Backlog requirement:

```text
private contribution dispatch
→ owner scope checks
→ provider smoke evidence
→ private smoke certification
→ expiry/drift guard
→ promotion gate parity
```

Until private parity is implemented, do not treat private contribution dispatch as equivalent to certified Platform Base dispatch.

## Boundaries

This is the first REST adapter boundary. It intentionally does not promote the contribution, grant agent skills, or expose credentials. Credential-bearing dispatch can be extended later through the governed credential resolver rather than raw contribution manifests.
