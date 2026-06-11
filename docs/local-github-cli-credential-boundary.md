# Local GitHub CLI Credential Boundary

## Purpose

The local connector `/github` endpoint is an admin break-glass surface for running the device-local GitHub CLI (`gh`). It is not the normal platform path for repository reads or mutations.

## Boundary

- The local connector does not read platform GitHub credentials from the database.
- The local connector does not receive or store GitHub App private keys, installation tokens, PATs, or OAuth tokens for repo work.
- The `/github` endpoint depends on `gh` being installed and authenticated on the device.
- Local recovery should check the PATH first and then the standard Windows install path `C:\\Program Files\\GitHub CLI\\gh.exe`; when the binary exists outside PATH, add a no-secret shim such as `C:\\ProgramData\\chocolatey\\bin\\gh.cmd` instead of reinstalling or injecting credentials.
- If local `gh` is present but not authenticated, the connector classifies the result as `GH_AUTH_REQUIRED` and returns `recommended_route: auth_host_admin_control_github`.
- Do not inject GitHub App installation tokens, PATs, or OAuth tokens into the local device to satisfy `gh auth status`; use auth-host GitHub App / REST fallback for governed repo work.

## Governed DB-backed route

Normal platform repository work should use the auth-host GitHub App / DB-backed route through `admin_control` with `tool: "github"`.

That route resolves credentials on the backend side using governed platform registry and credential policy. It can use the GitHub REST fallback when `gh` CLI is not installed on the auth-host runtime.

## Why not read DB credentials locally?

The local connector is a device bridge. Allowing it to read platform GitHub credentials directly would expand credential blast radius and blur the boundary between:

- device-local break-glass CLI recovery, and
- backend-governed platform repository operations.

Keeping normal repo mutations on auth-host preserves auditability, least privilege, and centralized credential rotation.

## Operational guidance

When local `/github` returns `GH_AUTH_REQUIRED`:

1. Prefer `admin_control` with `tool: "github"` for platform repo work.
2. Configure local `gh auth login` only for explicit break-glass recovery.
3. Do not place GitHub tokens in local connector `.env` files.
4. Do not expose GitHub secrets in connector responses or logs.

## Related controls

- `local.admin.github_cli` remains an admin-only recovery tool.
- `connector_github` registry notes should state that local GitHub CLI requires local authentication.
- Auth-host GitHub App / REST fallback remains the preferred DB-backed route for repo operations.
