# Local Manager Capability Installer Governance — 2026-05-28

## Purpose

This runbook records the end-to-end Local Manager and local connector capability rollout completed across the 2026-05-27/2026-05-28 admin session. It is the architecture and operations reference for update metadata, app-managed connector installers, capability grants, and post-install verification.

## Deployment authority

`auth.mad4b.com` production deploys from `main` through Hostinger hPanel Auto Deploy. GitHub Actions SSH fallback deploy was removed from the repository. Do not reintroduce a GitHub SSH fallback workflow or Hostinger SSH deployment secrets unless a separate recovery design is explicitly approved.

Evidence from the session:

| Area | PR | Result |
|---|---:|---|
| Add governed `delete_file` support to `repo_patch_apply` | #326 | Merged; enabled removing obsolete repo files through governed GitHub App flow |
| Remove Hostinger fallback deploy workflow | #331 | Merged; `.github/workflows/deploy-hostinger-node.yml` deleted |
| Current deployment path | n/a | `push/merge main` → Hostinger hPanel Auto Deploy → `auth.mad4b.com` |

## Local Manager release chain

| Version | PR | Problem fixed | Required user action |
|---|---:|---|---|
| `0.2.9` | #342 | Update loop caused by backend advertising a newer version while the Windows binary metadata still reported an older `ProductVersion`/`FileVersion` | Install once; verify `current_version=0.2.9` and `update_available=false` |
| `0.2.10` | #348 | Background desktop command polling surfaced transient SSL/network failures as a noisy main-screen loop | Install once; polling failures back off and show secret-safe paused diagnostics |
| `0.2.11` | #352 | Connector repair/capability installers were downloaded but still expected the user to run a BAT manually | App launches the generated installer through Windows UAC, handles cancellation, waits when possible, then refreshes controls |
| `0.2.12` | #361 | App-managed installer BAT still ended with `Press any key to continue`, blocking full in-app workflow completion | App requests `app_managed=true`/`suppress_pause=true`; app-managed BAT exits with `exit /b 0` or `exit /b 1` |

The app update endpoint and DB-backed `local_app_releases` must remain aligned with the Windows project metadata. Tests must assert `Version`, `AssemblyVersion`, `FileVersion`, and `InformationalVersion` alignment with the advertised release asset.

## Capability installer architecture

### Control-plane request

Local Manager uses its DPAPI-protected device token to call:

```text
POST /local-connector/install/device-download-link
```

For app-owned flows it must send:

```json
{
  "format": "bat",
  "ttl_minutes": 30,
  "app_managed": true,
  "suppress_pause": true,
  "capabilities": ["powershell_admin", "windows_control"],
  "permission_grants": {
    "apps": [],
    "allowed_paths": [],
    "shell_aliases": []
  }
}
```

The backend signs these values into a short-lived installer token. The token must carry capability and permission grant intent so the generated installer cannot drift from the user's explicit local consent.

### Bootstrap BAT behavior

`GET /local-connector/install/download` returns a BAT wrapper. In app-managed mode, the wrapper must not pause. It downloads `/connector-agent/installer.ps1`, executes it elevated, and exits with an explicit process code:

```text
success: exit /b 0
failure: exit /b 1
```

Manual/non-app downloads keep the visible `pause` behavior for operator awareness.

### PowerShell installer behavior

`GET /connector-agent/installer.ps1` is the final writer of the local connector `.env`. It must render all signed capability and dynamic grant values, including:

```text
CONNECTOR_POWERSHELL_ENABLED=true
CONNECTOR_WIN_ENABLED=true
CONNECTOR_FILE_PATHS=<comma-separated allowed paths>
CONNECTOR_APP_ALLOWLIST=<json object>
CONNECTOR_SHELL_ALLOWLIST=<json object>
```

PR #368 fixed the root cause where the app and BAT were correct, but `/connector-agent/installer.ps1` used a separate `.env` generator that ignored capability flags and most dynamic grants. Regression tests now assert that `connectorAgentRoutes.js` defines the explicit capability mapping, renders app/path grants, and passes signed `payload.capabilities` into installer env generation.

## Security invariants

- Windows UAC/local Administrator approval is always required for service and `.env` mutation.
- The app must not bypass elevation.
- Device tokens remain DPAPI-protected and must not be printed.
- Installer tokens are short-lived and HMAC-signed.
- High-risk capabilities such as `powershell_admin` and `windows_control` are opt-in only.
- `CONNECTOR_POWERSHELL_ENABLED=true` and `CONNECTOR_WIN_ENABLED=true` must never appear in the base/default connector env.
- Dynamic Windows paths must reject newline and CMD metacharacters before rendering into installer output.
- Diagnostics must include `secrets_included=false` and avoid connector secrets, Cloudflare tokens, API keys, cookies, and signed URLs.

## Verification contract

After running Capabilities through Local Manager, do not rely on `section=settings` refresh alone. Verify the effective connector behavior:

| Check | Expected evidence |
|---|---|
| Connector health | `connector_health` returns `ok=true` through the device route |
| PowerShell capability | `connector_ps` returns a PowerShell version instead of structured `DISABLED` |
| Windows control capability | `connector_win process_list` returns process data instead of structured `DISABLED` |
| File path grants | `connector_files list_drives` shows the selected path in `allowed_paths` |
| App grants | `connector_apps list` includes default apps plus selected dynamic app aliases |

Session validation evidence for `essam-pc` after PR #368:

```json
{
  "connector_health": "healthy",
  "powershell_admin_enabled": true,
  "powershell_version": "5.1.22621.6133",
  "windows_control_enabled": true,
  "windows_process_smoke": "Mad4B-Local-Manager",
  "allowed_paths": ["D:\\"],
  "dynamic_app_alias": "cursor--user",
  "secrets_included": false
}
```

## Device identity rule

The canonical connector device id remains `essam-pc`. Windows/Local Manager identities such as `ESSAM` or `Essam` are aliases and must resolve through `local_connector_device_aliases`. Do not rename runtime registry rows to match transient hostnames.

## Desktop command polling

Desktop command polling is a background convenience path. Transient SSL/network failures must not overwrite the main app status repeatedly. Local Manager 0.2.10 added failure counting, bounded backoff, and secret-safe diagnostics. Smoke validation used a harmless `notify` command and confirmed claim/completion by Local Manager without enabling PowerShell or Windows control.

## Operational sequence for future capability changes

1. Update Local Manager project metadata and backend route constants together when publishing a new Windows app release.
2. Update `local_app_releases` so DB-backed metadata selects the new release.
3. Keep app-managed installer mode (`app_managed=true`, `suppress_pause=true`) for in-app repair/capability flows.
4. Ensure `/local-connector/install/download` and `/connector-agent/installer.ps1` both preserve capability/grant intent.
5. Add or update regression tests for every changed path.
6. Merge only after CI and Windows EXE workflows pass.
7. Validate live `auth.mad4b.com` after Hostinger Auto Deploy.
8. Run post-install connector behavior checks, not just Settings refresh.

## Related files

- `apps/local-manager-windows/Program.cs`
- `apps/local-manager-windows/Mad4B.LocalManager.Windows.csproj`
- `http-generic-api/routes/localConnectorInstallRoutes.js`
- `http-generic-api/routes/connectorAgentRoutes.js`
- `http-generic-api/routes/localManagerBetaRoutes.js`
- `http-generic-api/services/localManagerDeviceLinkService.js`
- `http-generic-api/test-local-manager-tool-release-owner.mjs`
- `http-generic-api/test-local-connector-capability-installer-grants.mjs`
- `docs/hostinger-node-deploy.md`
- `docs/sprint64-device-runtime-control-update-2026-05-24.md`
