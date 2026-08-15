# Portable Staging Auto Pilot

This folder contains the reusable Windows PowerShell launcher for local Staging on an NTFS External SSD. It is designed for Windows 10 with WSL2 and Docker Desktop using a local Docker context.

The launcher is intentionally fail-closed. It requires an exact 40-character commit SHA, refuses a dirty working tree, rejects `DOCKER_HOST` and `DOCKER_CONTEXT`, accepts only local Docker contexts, validates the pinned repository files against `manifest.json`, creates only an ignored local `.env.staging`, preserves `MIGRATION_APPLIED=false` and `DATABASE_MUTATED=false`, and never creates DNS records, changes Cloudflare, deploys Hostinger, or runs migrations.

## First run

Open PowerShell as Administrator and run:

```powershell
Set-Location M:\Users\Nagy\Repo\multi-business-multi-role-growth-intelligence-os\autopilot-portable-staging
.\Start-AutoPilot.ps1 -ExpectedCommit <exact-main-sha> -ValidateOnly
.\Start-AutoPilot.ps1 -ExpectedCommit <exact-main-sha>
```

The first normal run creates `http-generic-api\.env.staging` with local-only database passwords and a local API key. It never fills `CLOUDFLARE_TUNNEL_TOKEN`; that value must be placed manually in the ignored `.env.staging` only after the dedicated Dev Tunnel has been created.

## Dev Tunnel

Before exposing anything publicly, configure one dedicated Cloudflare Tunnel identity for Staging and one active remote ingress for `dev.mad4b.com` targeting `http://app:8080`. The remote configuration must have an explicit unmatched-hostname fallback that denies traffic. Do not create ingress for `mcp_dev.mad4b.com` or `activation_dev.mad4b.com`; those hostnames remain reserved-disabled until their independent service contracts are implemented.

After the remote configuration has been reviewed, put only the Dev tunnel token in the ignored `.env.staging`, then run:

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

Production remains on Hostinger Cloud and never uses the local `.env.staging`, local bind mounts, Dev tunnel token, or Dev Tunnel identity. `mcp.mad4b.com`, `activation.mad4b.com`, and `auth.mad4b.com` are not valid local targets.
