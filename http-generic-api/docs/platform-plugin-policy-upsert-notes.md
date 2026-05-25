# Platform Plugin policy upsert notes

## Purpose

`platform_plugin_policy_upsert` is the first state-changing Platform Plugin surface. It installs or updates a tenant-scoped overlay policy for a preset Platform Plugin.

It writes to the existing `tenant_integration_policies` table and deliberately avoids creating or updating the platform base definition.

## Route and tool

- Route: `POST /platform/plugins/install-policy`
- Tool key: `platform_plugin_policy_upsert`
- Storage: `tenant_integration_policies`
- Evidence: `execution_log`
- Secrets returned: never

## Inputs

```json
{
  "tenant_id": "tenant-id",
  "plugin_key": "google_drive",
  "source_mode": "managed",
  "fallback_allowed": true,
  "required_for_device_install": false,
  "notes": "Managed Google Drive overlay",
  "user_id": "user-id"
}
```

## Guardrails

The service validates:

- active tenant exists
- Platform Plugin exists in `app_integrations`
- plugin status is `active` or `beta`
- source mode is `managed` or `dedicated`
- payload does not contain secret-like keys

The service then:

1. Upserts a tenant overlay row.
2. Reads the row back.
3. Writes an `execution_log` evidence row.
4. Returns a no-secrets result envelope.

## Non-goals

This route does not:

- store credentials
- execute plugin actions
- modify `app_integrations`
- promote tenant/user plugins into the platform base
- grant agent skills

## Next implementation step

The next safe step is tenant/user plugin contribution intake: draft plugin manifests scoped to tenant/user, followed by certification before promotion to the platform base.
