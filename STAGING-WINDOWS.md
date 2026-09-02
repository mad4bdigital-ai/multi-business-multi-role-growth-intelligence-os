# Local Staging on Windows 10/11

## Runtime contract

The repository requires Node.js `>=22 <23`. The `http-generic-api` runtime declares its dependencies in `http-generic-api/package.json` and locks them in `http-generic-api/package-lock.json`. The container uses `node:22-slim` and `npm ci --omit=dev` so the Docker image follows the repository engine and the lockfile.

For Windows 10, use a supported 64-bit 22H2 build (Docker's current WSL2 backend requirements identify build 19045), at least 8 GB RAM, SLAT-capable hardware, BIOS/UEFI virtualization enabled, WSL2, and the Windows `LanmanServer` service enabled and set to Automatic. Microsoft documents `wsl.exe --list --verbose` as the verification command and Docker documents WSL 2.1.5 as the minimum WSL version for the Docker Desktop WSL backend; use the latest available WSL update instead of pinning an old kernel. Sources: https://learn.microsoft.com/en-us/windows/wsl/install and https://docs.docker.com/desktop/setup/install/windows-install/.

Install one Ubuntu distribution as WSL2 and Docker Desktop with the WSL2 backend on each Windows host. In Docker Desktop, use Linux containers, enable the WSL 2 based engine, and enable WSL Integration for the selected Ubuntu distribution. Do not install a second Docker Engine inside Ubuntu; Docker documents that running both engines can cause conflicts. The repository and `.staging-data` are portable on the SSD, but Docker Desktop's WSL distribution, image cache, and build cache remain machine-local and must be rebuilt or pulled on another computer.

Keep the repository on the External SSD, for example:

```text
M:\Users\Nagy\Repo\multi-business-multi-role-growth-intelligence-os
```

Inside Ubuntu, the path is:

```text
/mnt/m/Users/Nagy/Repo/multi-business-multi-role-growth-intelligence-os
```

## First-time preparation

Confirm the SSD is mounted as NTFS and has a stable drive letter before starting. In elevated PowerShell, inspect it with:

```powershell
Get-Volume -DriveLetter M | Format-List DriveLetter,FileSystem,HealthStatus,SizeRemaining
```

If another computer assigns a different letter, pass the actual repository path to Auto Pilot with `-RepositoryPath`; do not edit the manifest or hard-code the old drive letter. Git attributes pin PowerShell and env files to LF so Auto Pilot's manifest hashes remain stable when Git is configured with Windows line endings.

From Ubuntu or PowerShell in the `http-generic-api` directory:

```bash
cp .env.staging.example .env.staging
```

Fill only local values. Do not copy Production credentials, GitHub tokens, Google service-account JSON, or database passwords to the External SSD. Add `.env.staging` to the local Git exclude if it is not already ignored.

Validate the Compose model without starting containers:

```bash
docker context show
docker compose -f docker-compose.yml -f docker-compose.staging.yml --env-file .env.staging config --quiet
```

The Docker context must be local. Do not continue if `DOCKER_HOST` or `DOCKER_CONTEXT` points to a remote daemon. Confirm WSL2 and Docker integration with:

```powershell
wsl.exe --status
wsl.exe --list --verbose
wsl.exe --version
docker context show
docker info --format '{{.ServerVersion}}'
```

The selected Ubuntu row must show version `2`, Docker must be in Linux-container mode, and the context must be `default` or `desktop-linux`. Auto Pilot performs these checks and also refuses a remote `DOCKER_HOST` or `DOCKER_CONTEXT`.

## Local-only start

Start Redis and the application with the staging override:

```bash
docker compose -f docker-compose.yml -f docker-compose.staging.yml --env-file .env.staging up -d --build
```

Check status and logs:

```bash
docker compose -f docker-compose.yml -f docker-compose.staging.yml --env-file .env.staging ps
docker compose -f docker-compose.yml -f docker-compose.staging.yml --env-file .env.staging logs --tail=100 app
```

The staging override disables the queue worker and explicitly sets mutation/Production flags to false. Redis is local to the Compose project. No migration or SQL apply command is part of this procedure.

## Dev-only Cloudflare Tunnel

The `cloudflared` service is intentionally placed behind the opt-in `tunnel` profile. The default staging startup does not expose the application publicly. After the local app is healthy, use one dedicated Cloudflare Tunnel identity for Staging and configure two active opt-in ingress hostnames: `dev.mad4b.com` and `mcp-dev.mad4b.com`, both targeting `http://app:8080`, plus an explicit fail-closed fallback for unmatched hostnames. Do not create ingress for `activation-dev.mad4b.com`; it remains reserved-disabled until its independent gateway bundle exists. Put only the Staging tunnel token in the untracked `.env.staging` as `CLOUDFLARE_TUNNEL_TOKEN`; never copy the Hostinger/Production DNS credentials, Production hostnames, or Production secrets to the External SSD. The authoritative hostname matrix is `http-generic-api/config/domain-family-policy.json`.

Start the tunnel explicitly, without changing the default local safety flags:

```bash
docker compose -f docker-compose.yml -f docker-compose.staging.yml --env-file .env.staging --profile tunnel up -d cloudflared
```

The tunnel is a routing mechanism, not a deployment or migration authorization. Keep `CLOUDFLARE_TUNNEL_ENABLED=false`, `MIGRATION_APPLIED=false`, and `DATABASE_MUTATED=false`; the Compose profile is the explicit operator action that starts the connector. Stop it separately when public Dev access is no longer required:

```bash
docker compose -f docker-compose.yml -f docker-compose.staging.yml --env-file .env.staging --profile tunnel stop cloudflared
```

Production remains on Hostinger Cloud and uses separate Cloudflare DNS/CDN records for `auth.mad4b.com`, `mcp.mad4b.com`, and `activation.mad4b.com`, with separate Production credentials. None of those Production records may point at this local Staging tunnel, and no Staging hostname may point at the Hostinger Production origin. Staging must use `TENANT_GPT_SSO_COOKIE_MODE=host_only`; never configure a shared `.mad4b.com` cookie on the External SSD. `mcp-dev.mad4b.com` is active opt-in only when `REMOTE_MCP_ENABLED=true` and `REMOTE_MCP_OAUTH_ENABLED=true`; `activation-dev.mad4b.com` remains reserved-disabled until its separate gateway bundle is available. DNS exposure alone is not evidence that a local service is healthy.

Stop without deleting local data:

```bash
docker compose -f docker-compose.yml -f docker-compose.staging.yml --env-file .env.staging stop
```

Do not use `docker compose down -v` unless you intentionally want to delete the local Redis and app volumes. Before physically ejecting the SSD, stop the Compose project, stop the tunnel separately, run `wsl.exe --shutdown`, wait for Docker Desktop disk activity to finish, and then use Windows Safely Remove Hardware. This prevents partial writes to MariaDB bind mounts.

## Dependencies assessment

No new npm package is required for the runtime: the existing `http-generic-api/package.json` already covers `express`, `bcrypt`, `bullmq`, `google-auth-library`, `googleapis`, `ioredis`, `jsonwebtoken`, `mysql2`, and `yaml`, and its lockfile passes `npm ci --dry-run`. The necessary repository fixes are runtime/deployment dependencies rather than new JavaScript packages: Node 22 alignment, lockfile-based `npm ci`, a Docker build context ignore file, a staging Compose override, and a safe staging environment template.

The root package is a separate test/governance workspace. Its `package.json` has Jest, ts-jest, and TypeScript as development dependencies and does not replace the `http-generic-api` runtime manifest.

## Safety boundary

This document describes local container startup only. It does not authorize database migration, SQL apply, Production deployment, GitHub writes, Ruleset changes, or use of real external credentials. For protected routes, set a local-only `BACKEND_API_KEY`; leave all external provider fields blank unless a separate local test contract authorizes them.

## Three-database local topology

The application has three independent MariaDB bindings and the staging override keeps them separate:

| Binding | Container | Environment prefix | Local identity |
|---|---|---|---|
| Ordinary runtime DB | `runtime-db` | `DB_*` | `runtime_app` |
| Governance DB | `governance-db` | `GOVERNANCE_DB_*` | `governance_writer` |
| Runtime persistence DB | `persistence-db` | `RUNTIME_PERSISTENCE_DB_*` | `runtime_persistence_writer` |

The ordinary runtime pool is created by `getPool()`. Governance writes use `getGovernancePool()` and reject the ordinary runtime identity or the ordinary runtime database. Runtime persistence writes use `getRuntimePersistencePool()` and are evaluated against their own privilege contract. Do not point two prefixes at the same database name or user.

The staging Compose override starts three separate `mariadb:11.4` services with separate bind mounts under `${STAGING_DATA_ROOT:-./.staging-data}`. Redis, app data, and all three databases therefore remain on the repository drive/External SSD instead of an opaque Docker named volume. It creates empty local databases only; it does not run schema migrations. A service may start successfully while application features that require schema objects remain unavailable until a separately approved, local-only schema provisioning procedure exists.

To validate the complete topology without starting it:

```bash
cp .env.staging.example .env.staging
docker compose -f docker-compose.yml -f docker-compose.staging.yml --env-file .env.staging config --quiet
```

To start all local services:

```bash
docker compose -f docker-compose.yml -f docker-compose.staging.yml --env-file .env.staging up -d --build
```

Use `docker compose ... ps` and `docker compose ... logs --tail=100 app` for read-only diagnostics. The bind-mounted local state is under `.staging-data`; do not delete it unless you intentionally want to reset Redis, app data, or one of the three local databases.
