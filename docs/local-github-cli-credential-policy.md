# Local GitHub CLI credential policy

## Purpose

The local connector `/github` endpoint is a break-glass recovery surface. It runs the device-local GitHub CLI (`gh`) and depends on the device having `gh` installed and authenticated.

Normal platform repository work must use the auth-host GitHub App / DB-backed route, such as `admin_control` with `tool=github`. That path resolves credentials through the governed backend registry and avoids storing GitHub credentials on the local Windows connector.

## Runtime boundary

- Local connector `/github`: device-local CLI recovery only.
- Auth-host `admin_control github`: normal repo reads and mutations.
- Local connector must not read platform GitHub credentials directly from the database.
- Local connector must not receive or persist GitHub tokens just to make routine repo operations work.

## Failure behavior

When the local GitHub CLI is missing authentication, the connector classifies the result as:

```json
{
  "code": "GH_AUTH_REQUIRED",
  "recommended_route": "auth_host_admin_control_github",
  "credential_boundary": "local_device_cli_only",
  "db_backed_route_available": true,
  "secrets_included": false
}
```

This makes the failure actionable without exposing secrets.

## Policy rationale

This keeps credential ownership in the governed auth-host layer and preserves the local connector as a recovery tool rather than a second source of GitHub provider credentials.

## Related registry update

Migration `169_sprint65_local_github_cli_policy.sql` updates the local gateway and endpoint tool registry descriptions so `connector_github` and `local.admin.github_cli` are described as break-glass recovery surfaces, not the default platform repo mutation route.
