# Staging Auto Deploy on Windows

## Purpose

This contract automatically updates the local Staging environment on the External SSD after a new commit reaches `main`. The deployment target is the local Windows machine only. It never deploys Hostinger Production, creates or changes Cloudflare DNS records, mutates a database, or consumes Production credentials.

The process has two separate stages. GitHub Actions evaluates the exact `main` commit and publishes a success check named `Staging Main Deploy Eligibility`. The Windows agent then polls the public Git reference, reads the exact commit SHA, and invokes `Start-AutoPilot.ps1` only when that same SHA has a successful eligibility check. A missing, running, or failed check is fail-closed.

> A new push to `main` is a candidate for Staging; it is not automatically trusted until the exact commit passes the eligibility gate.

## Two supported operating modes

| Mode | Behavior | Tradeoffs | Cost | Setup complexity |
|---|---|---|---|---|
| Scheduled watcher | Windows Task Scheduler starts the watcher at user logon. The watcher polls `main` every five minutes and deploys only eligible commits. | The computer must be on and the user must be logged in; latency is normally up to one polling interval. No public inbound endpoint is required. | No additional service cost. | Low; one administrator PowerShell command. |
| Manual one-shot | The operator runs `Auto-Deploy-Staging.ps1` once after reviewing the candidate. | No background process and maximum operator control, but no automatic deployment. | No additional service cost. | Very low. |

The scheduled watcher is the recommended mode for the External SSD because it works across devices, does not expose a webhook endpoint, and does not depend on a drive letter remaining unchanged.

## One-time installation

Open **PowerShell as Administrator** and run:

```powershell
cd M:\Users\Nagy\Repo\autopilot-portable-staging
.\Install-AutoDeployTask.ps1 -RepositoryPath M:\Users\Nagy\Repo -PollSeconds 300
```

To start the Cloudflare Tunnel automatically after an eligible Staging deployment, only after the Staging token and OAuth secrets have been placed in the ignored `.env.staging`, use:

```powershell
.\Install-AutoDeployTask.ps1 -RepositoryPath M:\Users\Nagy\Repo -PollSeconds 300 -StartTunnel
```

The installer creates the task under the current Windows user with `InteractiveToken` logon behavior. It does not create a Windows service, open an inbound port, or store a token in the task definition.

## Manual one-shot execution

To check the current `main` candidate without starting containers:

```powershell
.\Auto-Deploy-Staging.ps1 -RepositoryPath M:\Users\Nagy\Repo -ValidateOnly
```

To deploy the exact eligible commit to local Staging:

```powershell
.\Auto-Deploy-Staging.ps1 -RepositoryPath M:\Users\Nagy\Repo -SkipBuild
```

The script passes the exact remote SHA to `Start-AutoPilot.ps1`; it does not perform a ref-only checkout. `Start-AutoPilot.ps1` continues to enforce clean working tree, local Docker context, WSL2 availability, manifest integrity, Staging-only hostnames, and false mutation flags.

## Update and rollback behavior

The watcher records the deployed SHA in the ignored `autopilot-portable-staging\auto-deploy-state.json`. It does not redeploy the same SHA repeatedly. If a new `main` commit fails or lacks the eligibility check, the previous healthy Staging deployment remains running and the new commit is not applied. A rollback is performed by creating a controlled corrective commit on `main` and waiting for that exact commit to pass the same eligibility gate; the watcher never guesses an older SHA.

To remove the watcher while leaving Staging running:

```powershell
.\Uninstall-AutoDeployTask.ps1
```

To remove the watcher and stop local Staging:

```powershell
.\Uninstall-AutoDeployTask.ps1 -StopStaging
```

## Safety boundaries

The policy permits only `dev.mad4b.com` and `mcp_dev.mad4b.com` as Staging tunnel hostnames. `auth.mad4b.com`, `mcp.mad4b.com`, `activation.mad4b.com`, and `activation_dev.mad4b.com` are rejected as deployment targets. The workflow and local watcher carry no secrets; local tunnel and OAuth values remain in the ignored `http-generic-api\.env.staging` file.

The watcher is intentionally not a GitHub webhook receiver. It uses outbound `git ls-remote` and the GitHub check-runs API, so the Windows machine does not need a public inbound address. If the computer is off, deployment waits until the next logon and then evaluates the current `main` SHA.
