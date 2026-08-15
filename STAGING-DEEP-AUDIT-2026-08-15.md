# Staging Deep Audit Report

**Author:** Manus AI  
**Date:** 2026-08-15  
**Repository:** `mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os`  
**Pull Request:** [#7264](https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/pull/7264)

## Executive conclusion

The deeper audit found and corrected a material runtime gap: the Staging environment template declared `TENANT_GPT_STAGING_*` variables, but the OAuth runtime previously resolved the generic Production namespace and fixed Production resource URLs. The runtime is now environment-aware. When `NODE_ENV=staging` or `REMOTE_MCP_ENVIRONMENT=staging`, Tenant GPT uses `dev.mad4b.com`, the dedicated staging client ID, staging scope URLs, and `TENANT_GPT_STAGING_OAUTH_CLIENT_SECRET`. The Staging resolver is explicitly environment-only and will not fall back to Production `platform_runtime_config` or Production secret references.

The audit also found that the first Auto Pilot version generated database and backend secrets but did not generate all startup secrets required by the OAuth, SSO, and token-encryption paths. Auto Pilot now generates local `JWT_SECRET`, `TENANT_GPT_SSO_SIGNING_SECRET`, `TOKEN_ENCRYPTION_KEY`, and `REMOTE_MCP_OAUTH_SIGNING_SECRET`. It performs this as an upgrade-safe operation: existing non-placeholder local values are preserved, while missing or `local_*change_me` placeholders are replaced. The dedicated Staging GPT OAuth client secret and Cloudflare tunnel token remain manual operator inputs and are never generated or committed.

## Live Cloudflare verification

The live Cloudflare account and zone were inspected read-only through the configured Cloudflare integration. The Staging tunnel is remote-managed and has the expected identity.

| Item | Observed value | Assessment |
|---|---|---|
| Tunnel name | `mad4b-staging-external-ssd` | Correct |
| Tunnel ID | `156b6897-cfd0-4965-91c2-73146c6ede40` | Matches repository/operator contract |
| Remote configuration | `config_src=cloudflare`, `remote_config=true` | Correct for dashboard-managed ingress |
| Ingress 1 | `dev.mad4b.com` -> `http://app:8080` | Correct |
| Ingress 2 | `mcp_dev.mad4b.com` -> `http://app:8080` | Correct |
| Catch-all | `http_status:404` | Fail-closed |
| WARP routing | Disabled | Correct for published web applications |
| Tunnel status during audit | `inactive`, zero connections | Expected until Windows connector starts |

Cloudflare DNS was also verified directly. Both Staging hostnames are proxied CNAME records to the tunnel UUID target. `activation_dev.mad4b.com` has no DNS record. Production hostnames remain proxied A records to `147.93.49.130` and do not point at the Staging tunnel.

| Hostname | Live DNS result | Environment boundary |
|---|---|---|
| `dev.mad4b.com` | CNAME -> `156b6897-cfd0-4965-91c2-73146c6ede40.cfargotunnel.com` | Staging |
| `mcp_dev.mad4b.com` | CNAME -> same tunnel target | Staging |
| `activation_dev.mad4b.com` | No record | Reserved-disabled |
| `auth.mad4b.com` | A -> `147.93.49.130` | Production / Hostinger |
| `mcp.mad4b.com` | A -> `147.93.49.130` | Production / Hostinger |
| `activation.mad4b.com` | A -> `147.93.49.130` | Production / Hostinger |

No Cloudflare mutation, Hostinger mutation, DNS mutation, database mutation, or Production deployment was performed during this audit.

## Runtime and environment corrections

The following controls are now present in the PR branch:

| Area | Hardening result |
|---|---|
| OAuth client namespace | Staging uses `TENANT_GPT_STAGING_OAUTH_CLIENT_ID` and `TENANT_GPT_STAGING_OAUTH_CLIENT_SECRET`; Production defaults remain unchanged. |
| OAuth resource | Staging core resource and issuer resolve to `https://dev.mad4b.com`. |
| Activation boundary | `activation_dev.mad4b.com` is not registered as a Staging OAuth resource. |
| Remote MCP | Resource and authorization server continue to resolve from Staging env values: `mcp_dev.mad4b.com` and `dev.mad4b.com/auth/mcp`. |
| DB-derived secret fallback | Disabled for Staging OAuth; the Staging environment must supply its own secret namespace. |
| Startup secrets | Auto Pilot generates local JWT, SSO, token-encryption, and MCP signing secrets when missing. |
| Tunnel exposure | `-StartTunnel` fails if the tunnel token is empty, the Staging GPT secret is empty, or MCP OAuth signing secret is empty while the corresponding feature is enabled. |
| Environment parsing | Duplicate env keys are rejected by both Auto Pilot and the DB cloning tool. |
| Database copy safety | DB flags are read from `.env.staging` and must be exactly `false`; remote Docker contexts and Production/provider dump paths are rejected. |
| Manifest integrity | Manifest scope increased from 18 to 31 files and now includes the Staging runtime OAuth regression test plus the Dockerfile, dockerignore, database pool modules, health route, OAuth/MCP runtime modules, and `.gitattributes`. |

## Verification performed

The following checks passed locally in the Linux sandbox:

```text
staging_runtime_oauth_profile=PASS
domain_family_policy=PASS
staging_openapi_mcp_db_boundary=PASS
staging_autopilot_closure=PASS
tenant GPT OAuth secret reference tests passed
staging_three_db_topology=PASS
openapi schema output path guard passed
PASS tenant-gpt-oauth-token-binding-guard
PASS tenant-gpt-oauth-token-exchange-routes
validate_staging_env: ok=true
git diff --check: PASS
```

PowerShell parsing could not be executed in this Linux sandbox because `pwsh` is not installed. The Windows host remains the authoritative place for the first real PowerShell validation. The scripts use Windows PowerShell-compatible syntax and the repository regression suite now covers the critical textual contracts, but the operator should still run `-ValidateOnly` on Windows before starting Docker.

## GitHub state

The PR branch is clean and pushed at commit `2e2d3d3f9` (`Wire staging OAuth namespace and local secrets`). PR #7264 is non-draft and open against `main`. At the last observation, GitHub reported no failing checks but many checks were still pending, and the merge state was `UNSTABLE`. It must not be treated as merged until the required checks complete and the repository owner authorizes the merge if a protected owner gate appears.

## Safe operator sequence

After PR #7264 is merged, obtain the exact merged `main` SHA rather than reusing an older SHA. From PowerShell in the repository, the operator can read the current remote pin with:

```powershell
git fetch origin main
git rev-parse origin/main
```

Use that exact 40-character SHA with Auto Pilot. The first command is validation-only:

```powershell
cd M:\Users\Nagy\Repo\autopilot-portable-staging
.\Start-AutoPilot.ps1 -ExpectedCommit <current-main-sha> -ValidateOnly
```

After validation succeeds, run the local services without public exposure:

```powershell
.\Start-AutoPilot.ps1 -ExpectedCommit <current-main-sha>
```

Place the dedicated Staging OAuth client secret and Cloudflare tunnel token only in the ignored local file `http-generic-api\.env.staging`. Then provision schemas with the dry-run first:

```powershell
.\Clone-StagingDatabases.ps1 -Mode schema_only -DumpDirectory M:\Users\Nagy\Repo\staging-dumps
```

Use `-Apply` only after confirming that the three dump files are local Staging schema dumps. Finally, start public access explicitly:

```powershell
.\Start-AutoPilot.ps1 -ExpectedCommit <current-main-sha> -StartTunnel
```

The tunnel should remain stopped until the local app, three MariaDB services, Redis, generated local secrets, and the dedicated Staging OAuth values have been validated.

## References

[1]: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/configuration-file/ "Cloudflare One: Configuration file"

[2]: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/dns/ "Cloudflare One: DNS records"

[3]: https://developers.cloudflare.com/tunnel/setup/ "Cloudflare Tunnel: Setup"


## Expanded settings audit

The second settings pass added controls beyond the original runtime namespace hardening. The Staging Compose overlay now removes the inherited Redis host port and binds the API only to `127.0.0.1:${PORT}`. Public access is therefore through the Cloudflare connector rather than a LAN listener. The application has a container healthcheck that requires both HTTP success and a JSON body with `status=healthy`; this avoids treating the health route's HTTP 200 response as readiness when dependencies are degraded. `cloudflared` waits for the application to become healthy.

Auto Pilot now verifies that at least one WSL distribution reports version 2 through `wsl.exe --list --verbose`, waits for Redis, all three MariaDB services, and the API to become healthy, and refuses non-local Docker contexts. The DB copy tool performs the same local Docker and Compose-model preflight and refuses `-Apply` unless all three database containers are healthy. It continues to reject Production/provider dump paths and reads mutation flags directly from `.env.staging`.

The environment template now declares all three database connection limits and timeouts explicitly, including the governance root password. Auto Pilot generates missing local database passwords and root passwords in addition to JWT, SSO, token-encryption, backend, and MCP signing secrets. Existing non-placeholder values remain untouched. Cloudflare tunnel logging is explicitly constrained to `info` with a 30-second grace period; debug logging is rejected because Cloudflare documents that it can expose request URLs and headers.

Git line-ending attributes now pin `*.ps1` and `*.env*` to LF. This is required because the portable manifest hashes files byte-for-byte and a Windows checkout with `core.autocrlf=true` could otherwise convert unpinned files to CRLF and fail closed on every device.

The runtime OAuth regression now performs an HTTP round-trip through `buildRootDiscoveryRoutes()`. It confirms that `dev.mad4b.com/tenant-gpt/oauth-preset` returns the dedicated Staging client and `dev.mad4b.com` authorization/token URLs, while `mcp_dev.mad4b.com` and `activation_dev.mad4b.com` return 404 for the Tenant GPT preset endpoint.

## Expanded verification

Additional passing checks:

```text
staging_three_db_topology=PASS
staging_runtime_oauth_profile=PASS (including HTTP discovery round-trip)
staging_openapi_mcp_db_boundary=PASS
staging_autopilot_closure=PASS
domain_family_policy=PASS
validate_staging_env: ok=true
git diff --check: PASS
```

The Linux sandbox does not have Docker, PowerShell, or WSL installed, so the merged Compose model and PowerShell execution still require Windows-side validation. The source-level and Node regression checks pass; no local containers or Cloudflare connector were started here.

## Windows and Docker prerequisites

Microsoft's current WSL documentation requires Windows 10 version 2004/build 19041 or later for the one-command installer, while Docker's current Windows WSL2 backend requirements identify supported Windows 10 22H2 build 19045, WSL 2.1.5 or later, 8 GB RAM, SLAT, hardware virtualization, and the `LanmanServer` service enabled. Docker recommends WSL integration for the selected Ubuntu distribution and warns against installing a second Docker Engine inside WSL.

References: [Microsoft WSL installation](https://learn.microsoft.com/en-us/windows/wsl/install), [Microsoft manual WSL installation](https://learn.microsoft.com/en-us/windows/wsl/install-manual), [Docker WSL 2 backend](https://docs.docker.com/desktop/features/wsl/), and [Docker Desktop Windows installation](https://docs.docker.com/desktop/setup/install/windows-install/).
