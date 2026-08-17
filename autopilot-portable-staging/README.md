# Portable Staging Auto Pilot

This folder contains the reusable Windows PowerShell launcher for local Staging on an NTFS External SSD. It is designed for Windows 10 with WSL2 and Docker Desktop using a local Docker context.

## Recommended one-click operation

For the normal operator workflow, double-click `Start-Staging-One-Click.cmd`. It automatically requests Administrator elevation, installs or verifies Git, GitHub CLI, Docker Desktop, and WSL2, clones the repository when it is absent, authenticates GitHub CLI when required, waits for the exact `main` commit to pass the Staging eligibility check, creates local-only secrets, starts the three local databases and application, starts the explicitly allowed Dev Tunnel, seeds an approved local schema-only bundle when present, and installs the logon Auto Deploy task.

The first run may ask for two unavoidable credentials: GitHub CLI device/browser authentication and the dedicated Staging Cloudflare Tunnel token. These are entered inside the launcher; no separate Terminal command is required. They are not committed to GitHub. Subsequent runs reuse the ignored local `.env.staging` and normally require no additional input.

The launcher is intentionally safe when a schema bundle is absent. It starts fresh local databases and does not apply migrations or copy data. To seed schemas automatically, place the approved local files `runtime.schema.sql.gz`, `governance.schema.sql.gz`, and `persistence.schema.sql.gz` in `autopilot-portable-staging\staging-db-dumps\`; the one-click runner consumes them only as `schema_only`. Production dumps and sanitized data are never accepted by this path.

Use `-RequireSchemaBundle` only when the local schema bundle is already present and the run must fail closed if it is missing.

The one-click runner records only non-secret state in the ignored `one-click-state.json`. It never creates DNS records, changes Cloudflare configuration, deploys Hostinger, runs migrations, or enables Production/provider mutation.

## Persistent operations log

Every run writes a durable JSONL log under `autopilot-portable-staging\logs\operations.jsonl` on the External SSD. The same log covers the Auto Pilot bootstrap, Auto Deploy watcher and eligibility decisions, and application operations such as Compose startup, service health, tunnel startup, stop, and fail-closed errors. `latest-status.json` contains the most recent event, while `last-failure.json` contains the latest redacted error snapshot and remains available after the PowerShell or CMD window closes.

The CMD launcher prints the log directory and the last failure automatically. For a readable filtered view, run `Show-StagingLogs.ps1`, or use `Show-StagingLogs.ps1 -FailuresOnly`, `Show-StagingLogs.ps1 -Component auto-deploy`, or `Show-StagingLogs.ps1 -OpenFolder`. Secrets, tokens, passwords, API keys, and bearer values are redacted before they are written. The logging path is ignored by Git and never becomes part of a commit.

## Maintenance without terminal expertise

`Staging-Maintenance.cmd` is the maintenance entry point. Double-clicking it runs the Doctor in `Status` mode, prints a machine-readable `maintenance-status.json`, and keeps the result visible. To request the safe local repair mode, launch `Staging-Maintenance.cmd Repair`; repair can recreate the two local scheduled tasks, rotate oversized logs, and run one health check. It cannot delete data, apply migrations, rewrite local secrets, change Cloudflare DNS, touch Hostinger, or deploy Production. To inspect logs only, launch `Staging-Maintenance.cmd Logs`.

The maintenance policy is versioned in `staging-maintenance-policy.json`. This prevents future updates from silently expanding repair authority. The persistent operator artifacts are `maintenance-status.json`, `health-snapshot.json`, `latest-status.json`, `last-failure.json`, and the redacted `operations.jsonl` family. The first diagnostic action after any failure is therefore to double-click `Staging-Maintenance.cmd`, not to rerun clone or delete the repository. If Auto Pilot stops before Docker, GitHub CLI, or WSL checks complete, `bootstrap-console.log` is written before those checks and the CMD launcher prints it automatically. On an existing checkout, the ignored `.env.staging` is initialized before prerequisite validation, so a missing local dependency does not hide the Staging environment boundary.


The launcher is intentionally fail-closed. It requires an exact 40-character commit SHA, refuses a dirty working tree, rejects `DOCKER_HOST` and `DOCKER_CONTEXT`, accepts only local Docker contexts, validates the pinned repository files against `manifest.json`, creates only an ignored local `.env.staging`, preserves `MIGRATION_APPLIED=false` and `DATABASE_MUTATED=false`, and never creates DNS records, changes Cloudflare, deploys Hostinger, or runs migrations.

## First run

Open PowerShell as Administrator and run:

```powershell
Set-Location M:\Users\Nagy\Repo\multi-business-multi-role-growth-intelligence-os\autopilot-portable-staging
.\Start-AutoPilot.ps1 -ExpectedCommit <exact-main-sha> -ValidateOnly
.\Start-AutoPilot.ps1 -ExpectedCommit <exact-main-sha>
```

The first normal run creates `http-generic-api\.env.staging` with local-only database passwords, API keys, MCP signing material, and a separate Activation OAuth client secret. It also repairs missing non-secret Activation host defaults without overwriting non-empty values. It never fills `CLOUDFLARE_TUNNEL_TOKEN`; that value must be placed manually in the ignored `.env.staging` only after the dedicated Dev Tunnel has been created. Secrets are never printed to logs or responses.

To enable the independent Staging Activation Gateway explicitly through the reusable one-click path, use:

```powershell
.\One-Click-Staging.ps1 -Mode Install -RepositoryPath M:\Users\Nagy\Repo\multi-business-multi-role-growth-intelligence-os -EnableActivationGateway
```

This sets only `ACTIVATION_STAGING_GATEWAY_ENABLED=true`, `ACTIVATION_HOST_GATEWAY_HOST=activation-dev.mad4b.com`, and `ACTIVATION_STAGING_AUTH_HOST=activation-dev.mad4b.com` in the ignored local env file. The Activation hostname is served by its independent Worker; it is never added to the Tunnel allowlist.

## Auto Deploy from main

`Auto-Deploy-Staging.ps1` supports fail-closed deployment after a new push to `main`. GitHub Actions first evaluates the exact commit with the `Staging Main Deploy Eligibility` workflow. The Windows watcher then uses the exact SHA from `git ls-remote` and queries the matching Workflow Run for that same SHA before invoking `Start-AutoPilot.ps1`. Check Runs are not used as the sole authority because they can be stale or belong to a different attempt. A missing, running, or failed Workflow Run is not deployed, and a successfully deployed SHA is not repeated.

For the recommended logon watcher, run PowerShell as Administrator:

```powershell
.\Install-AutoDeployTask.ps1 -RepositoryPath M:\Users\Nagy\Repo\multi-business-multi-role-growth-intelligence-os -PollSeconds 300
```

To include the already configured Staging tunnel explicitly:

```powershell
.\Install-AutoDeployTask.ps1 -RepositoryPath M:\Users\Nagy\Repo\multi-business-multi-role-growth-intelligence-os -PollSeconds 300 -StartTunnel
```

For a one-shot deployment or validation:

```powershell
.\Auto-Deploy-Staging.ps1 -RepositoryPath M:\Users\Nagy\Repo\multi-business-multi-role-growth-intelligence-os -ValidateOnly
.\Auto-Deploy-Staging.ps1 -RepositoryPath M:\Users\Nagy\Repo\multi-business-multi-role-growth-intelligence-os -SkipBuild
```

Remove the watcher without stopping Staging with `Uninstall-AutoDeployTask.ps1`; add `-StopStaging` only when the local services should also stop. This mechanism requires the Windows computer to be on and the user to be logged in. It uses outbound GitHub CLI/Git requests and does not expose an inbound webhook. The scheduled-task principal uses the `Interactive` logon type supported by Windows PowerShell 5.1; no permanent execution-policy change is required because the task launches PowerShell with `-ExecutionPolicy Bypass` for that process only.

## Dev Tunnel

Before exposing anything publicly, configure one dedicated Cloudflare Tunnel identity for Staging with two active opt-in ingress hostnames: `dev.mad4b.com` and `mcp_dev.mad4b.com`, both targeting `http://app:8080`. The remote configuration must have an explicit unmatched-hostname fallback that denies traffic. `activation-dev.mad4b.com` is deliberately excluded from the Tunnel because it is served by the independent `mad4b-activation-gateway-staging` Worker.

After the remote configuration has been reviewed, put only the Staging tunnel token in the ignored `.env.staging`, then run:

```powershell
.\Start-AutoPilot.ps1 -ExpectedCommit <exact-main-sha> -StartTunnel
```

`-StartTunnel` is explicit and fails if the token is empty. The default run starts the local app and three databases but does not start `cloudflared`.

## Stop and recovery

Stop the local services without deleting SSD data:

```powershell
.\Start-AutoPilot.ps1 -ExpectedCommit <exact-main-sha> -Stop
```

Do not use `docker compose down -v` unless you intentionally want to delete the bind-mounted Redis, app, Runtime DB, Governance DB, and Persistence DB data. If the SSD is moved to another Windows machine, run `-ValidateOnly` first; the launcher will stop on Docker/WSL2/context/commit/manifest mismatch instead of modifying the environment.

Production remains on Hostinger Cloud and never uses the local `.env.staging`, local bind mounts, Staging tunnel token, or Staging Tunnel identity. `mcp.mad4b.com`, `activation.mad4b.com`, and `auth.mad4b.com` are not valid local targets. `activation-dev.mad4b.com` is valid only through the independent Staging Activation Gateway Worker, not through the local Tunnel.
