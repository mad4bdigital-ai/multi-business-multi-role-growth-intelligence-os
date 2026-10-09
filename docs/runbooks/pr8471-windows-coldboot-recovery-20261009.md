# PR #8471 — Windows Cold-Boot Recovery and Silent Runtime Supervision

**Scope:** source-level safety and local Staging operations only. **NO PRODUCTION PROMOTION.**
This change does not activate remote Hostinger, manage Windows credentials, create a database, authorize a migration, apply a GitHub Ruleset, or certify a physical device. It never changes Production/DNS/Provider state.

## Operator evidence: 9 October 2026

The native Windows Task Scheduler readout following reboot reported:

| Scheduled task | State | LastTaskResult |
| --- | --- | --- |
| MAD4B Staging Docker Bootstrap | Ready | 1 |
| MAD4B Staging Auto Deploy | Ready | 1 |
| MAD4B Staging Health Monitor | Running | 267009 |
| MAD4B Staging Autonomous Supervisor | MISSING | none |

Docker reported local context `desktop-linux` and Engine `29.7.2`. Local repo drive `M:\` was mounted and Windows `Dnscache` was running. The Local Manager screenshot showed `dns_unresolved` for `auth.mad4b.com`, and Git transport emitted three retry records at 2/4/8 seconds. DNS recovery and Compose health were not independently read back.

`LastTaskResult=1` is a failed **previous** task execution, not proof that Docker Engine is still unavailable. `267009` is the Task Scheduler running-state value; it does not prove service health. A stopped `com.docker.service` alone does not establish Docker Engine failure under WSL2.

**Root-cause hypothesis (not native proof):** A logon race among network/GitHub eligibility, Docker Desktop startup, and unattended watchers; the additive supervisor task is absent. An older watcher could also reuse a saved successful certification while Compose is stopped.

## Source changes

- The independent Docker bootstrap remains scheduled before Auto Deploy and proves Engine readiness using `docker info`; process presence and service status are not authority.
- All four interactive user-logon Scheduled Task PowerShell actions request `-WindowStyle Hidden`. This removes persistent console windows in normal execution but cannot guarantee zero transient process flashes on every Windows configuration. Log files remain authoritative.
- Auto Deploy watcher does not terminate on temporary Git/DNS/eligibility query failure. It records `auto-deploy-transport.json` with `status=retry_later`, clears in-memory verified SHA/eligibility, never deploys from previous Git receipts, and retries after the governed poll interval. One-shot mode continues to fail closed.
- Once Git eligibility is independently re-established, a previously certified commit must pass live local Compose service health verification after Docker Engine readiness. Stopped containers re-enter the approved exact-SHA startup pipeline rather than inheriting stale ready status.
- The existing additive `Install-AutonomousSupervisorTask.ps1` remains the preferred narrowly scoped repair for a **missing** supervisor. It verifies the exact existing watcher principal, script, arguments, working directory, and policy before registering the missing supervisor. It does not modify watcher configuration.
- `Staging-Doctor.ps1` reports failed task result and whether continuous watchers are actually running. Its optional `-RepairMissingSupervisor` invokes the additive installer, never the broad replacement by default.
- `Staging-ColdBoot-Diagnostics.ps1` inspects local task states, Docker Engine, DNS name resolution, Git transport state and fresh health/acceptance evidence, writing sanitized `logs/coldboot-diagnostics.json`. It never repairs tasks or marks an offline device recovered.

## Read-only verification on a Windows checkout containing the updated source

On 9 October 2026 the operator also reported a local `PSSecurityException / UnauthorizedAccess` with `running scripts is disabled on this system` after attempting to invoke the installer directly with `& "$Repo\\...\\Install-AutonomousSupervisorTask.ps1"`. The following scheduled-task lookup then returned not found. **This establishes an Execution Policy launch failure; it does not prove an installer execution failure.**

Open an elevated Windows PowerShell 5.1 terminal for the reviewed **local checkout**. Run local scripts in a child PowerShell process with a per-process execution-policy argument, rather than invoking `.ps1` directly:

```powershell
$Repo = "M:\Users\Nagy\Repo\multi-business-multi-role-growth-intelligence-os"
$PS51 = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$Scripts = Join-Path $Repo "autopilot-portable-staging"
if (-not (Test-Path -LiteralPath $Scripts -PathType Container)) { throw "Checkout missing: $Scripts" }
& $PS51 -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Scripts "Staging-ColdBoot-Diagnostics.ps1") -RepositoryPath $Repo
& $PS51 -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Scripts "Staging-Doctor.ps1") -RepositoryPath $Repo -Mode Status
```

These diagnostic commands are read-only apart from their sanitized local report files. A nonzero Doctor result means the machine remains degraded and must not be treated as an approval to deploy. The path is a previously observed checkout, not a verified current device identity; replace it with the actual trusted checkout if different.

If and only if `MAD4B Staging Autonomous Supervisor` is missing and the existing watcher action/policy passes identity verification, an administrator may explicitly run:

```powershell
$Installer = Join-Path $Scripts "Install-AutonomousSupervisorTask.ps1"
if (-not (Test-Path -LiteralPath $Installer -PathType Leaf)) { throw "Missing trusted installer" }
& $PS51 -NoLogo -NoProfile -ExecutionPolicy Bypass -File $Installer -RepositoryPath $Repo -Activate
if ($LASTEXITCODE -ne 0) { throw "Supervisor installer failed; do not claim repaired state" }
$Task = Get-ScheduledTask -TaskName "MAD4B Staging Autonomous Supervisor" -ErrorAction Stop
$TaskInfo = Get-ScheduledTaskInfo -TaskName $Task.TaskName -ErrorAction Stop
[pscustomobject]@{ State = $Task.State; LastResult = $TaskInfo.LastTaskResult; LastRun = $TaskInfo.LastRunTime }
```

The `-ExecutionPolicy Bypass` switch applies **only to this child process** and is not an instruction to change the machine or current-user policy. It does not override enforced Group Policy (`MachinePolicy` / `UserPolicy`). If still blocked, inspect `Get-ExecutionPolicy -List`, the exact script origin/signature and IT policy; **do not use `Set-ExecutionPolicy -Scope LocalMachine` or `Unblock-File` as a workaround for an untrusted file**. A successful Scheduled Task registration is not a native reboot/runtime certificate.

This creates only the absent Supervisor task. If an unexpected conflicting task or watcher identity is found, stop and investigate; do not use `-Force`, bypass signature checks, or re-register broad tasks without reviewing the exact tunnel and gateway flags.

The broader `Install-AutoDeployTask.ps1` updates the other task actions to hidden execution, but it is **not** automatically invoked on users' machines. Before any reinstall, preserve and review the existing `-TunnelMode`, `-EnableActivationGateway`, user principal, paths and deployment options. Do not treat this PR as approval to silently change runtime topology.

## Additional operator blocker — watcher principal/actions mismatch

A second Windows user report after applying the process-local execution policy override was:

- \`STAGING_AUTONOMOUS_INSTALL_BLOCKED: Unexpected watcher principal/actions\`
- Child \`powershell.exe\` exited with code 1; the Supervisor task remains unregistered.

The original installer combined *two* unrelated safety checks into one error: textual \`DOMAIN\USERNAME\` equality and exactly one existing watcher Scheduled Task Action. The error alone **does not identify the failing predicate**. Do not re-register the Auto Deploy task or change its user, run level or action without independent inspection.

For a read-only diagnostic that works with the **currently installed** Windows scripts (no Git checkout update needed), run from an elevated Windows PowerShell:

\`\`\`powershell
$Task = Get-ScheduledTask -TaskPath "\" -TaskName "MAD4B Staging Auto Deploy" -ErrorAction Stop
$CurrentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$TaskSid = ""
try {
    if ([string]$Task.Principal.UserId -match '^S-\d-\d+(?:-\d+)+

Source regressions: `node http-generic-api/test-staging-coldboot-recovery.mjs` from the repository root; additionally run existing `test-windows-staging-bootstrap-supervisor.mjs` and `autopilot-portable-staging/test/Test-AutonomousSupervisor.ps1` (native Windows PowerShell 5.1).

**A native Windows reboot is still required to certify behavior.** With separate approved Staging access, capture independent evidence for:

1. Cold logon with Docker closed, delayed Docker Engine, delayed WSL2, and missing network; no console leaks and no automatic Production or database writes.
2. Intermittent DNS failure for `auth.mad4b.com` and `github.com`; watcher remains alive, does not reuse stale SHA, and retries without requiring a fresh operator login.
3. GitHub authentication or eligibility denial after DNS recovers; no deploy, no cached approval, and bounded retry.
4. Docker Engine healthy but Compose stopped after reboot; previous source certificate must not mark services healthy. Restore only an exact eligible local Staging build, read back container health, certify anew.
5. Missing Supervisor; additive install succeeds with exact watcher identity, but fails closed for unexpected task command, user principal or path.
6. Reboot with disconnected removable drive and with the intended Windows user not logged on; report blocked rather than claiming service-independent operation.
7. Repeat restart, overlapping task triggers, and transient task failure; verify named mutexes, `IgnoreNew`, log continuity, rollback and task result readback.
8. Recovered DNS/network and stable Compose; require two clean watcher poll/sleep cycles, fresh `health-snapshot.json`, exact SHAs and supervisor acceptance. Native hardware/device-generation and Production status remain separate.

Windows Docker Desktop under an `Interactive` user task **requires user logon**. Boot-before-login or headless 24/7 operation requires a separately approved system-service/WSL architecture, not a hidden Scheduled Task.

**Release decision:** This source hardening does not supersede PR #8471's independent policy objections, exact-head owner approval or the NO-GO Production decision.
) {
        $TaskSid = [System.Security.Principal.SecurityIdentifier]::new([string]$Task.Principal.UserId).Value
    } else {
        $Account = [System.Security.Principal.NTAccount]::new([string]$Task.Principal.UserId)
        $TaskSid = $Account.Translate([System.Security.Principal.SecurityIdentifier]).Value
    }
} catch { $TaskSid = "" }
[pscustomobject]@{
    PrincipalSIDResolved = -not [string]::IsNullOrWhiteSpace($TaskSid)
    SameWindowsSID = ($TaskSid -ne "" -and $TaskSid -eq $CurrentSid)
    LogonType = [string]$Task.Principal.LogonType
    ActionCount = @($Task.Actions).Count
    TaskState = [string]$Task.State
} | Format-List
\`\`\`

This command does not print usernames, credentials or task arguments. If \`SameWindowsSID=False\`, the existing task may actually belong to a different user or a group/service identity; stop before authorization. If \`ActionCount != 1\`, do not arbitrarily delete extra actions. If both predicates pass and the local installer still fails, compare trusted script revision and checkout/task identity.

After obtaining **the reviewed updated source on a separate authorized checkout**, the enhanced additive installer supports \`-DiagnoseOnly\`. This mode returns structured booleans for principal SID equality, logon type, exact executable, working directory and approved arguments without registering any tasks. Never confuse \`eligible_for_explicit_install\` with operational readiness.

The shared SID helper accepts the same real Windows user's name/SID aliases but rejects unknown SIDs, foreign owners, multi-action tasks, noninteractive logon and command/path drift. Supervisor readback applies the same identity boundary. These improvements require source installation plus native Windows testing; they have **not** been executed on the operator machine.

## Confirmed runtime source skew — detached Staging checkout (9 Oct 2026)

The operator supplied these **native, read-only** results:

| Observation | Value |
| --- | --- |
| Legacy textual task principal comparison | \`LegacyNameMatch=False\` |
| Canonical Windows SID comparison | \`SameWindowsSID=True\` |
| Existing watcher actions | exactly one |
| Existing watcher logon type | Interactive |
| Old principal/action guard present in local installer | \`OldGuardPresent=True\` |
| SID-safe guard present in local installer | \`SIDFixPresent=False\` |
| Read-only diagnostic mode present in local installer | \`DiagnoseOnlyAvailable=False\` |
| Local branch | empty (detached HEAD) |
| Local short HEAD | \`f9d80998ca\` |

GitHub source review confirmed that \`main@f9d80998ca3fce852d47465dbe990a8c08458462\` contains textual principal matching in **both** \`Install-AutonomousSupervisorTask.ps1\` and \`Staging-AutonomousSupervisor.ps1\`. Updated source in PR #8471 normalizes SID in both paths and supports \`-DiagnoseOnly\`; it is **not** installed on the operator's machine.

**Root cause demonstrated:** a string-display alias mismatch blocks the legacy installer even though the canonical SID and action count are valid; the detached checkout is older than the PR branch. This is an expected source-revision mismatch, not proof that Scheduler task ownership is unsafe. It is **not** proof that Staging runtime is healthy.

**Do not attempt these unsafe workarounds:**

- Force-register the Supervisor task with the old script: the running Supervisor independently repeats the same textual principal guard, so installing a task is insufficient.
- \`git switch\`, \`git checkout\`, \`git pull\` or \`git reset --hard\` inside the active detached Staging checkout. The governed Auto Deploy pins that checkout to an eligible \`main\` commit and requires a clean worktree; altering it can conflict with the deploy controller.
- Overwrite only the local installer with the PR version: the updated installer depends on the SID helper, and the old Supervisor still has its own outdated identity logic.
- Relax or disable identity validation, patch Windows user environment variables to simulate a match, use \`-Force\` or alter the existing watcher's principal/actions.

**Approved remediation paths:**

1. **Normal governed rollout**: complete #8471 source checks and owner/governance approval; promote the selected fix to the eligible \`main\` release using existing release procedures; verify the local Staging checkout independently converges to the exact approved SHA; then invoke the same-release additive installer using process-scoped execution policy and verify both Scheduled Task state and Supervisor acceptance. This path **does not authorize Production promotion**.
2. **Independent minimal hotfix**: if the operator needs recovery before #8471 can be merged, prepare a separate, reviewed release containing the *installer, Supervisor and SID helper together*, with exact-SHA certification and native Windows tests. Deliver through the existing Staging eligibility channel; do not copy files into the detached working tree or weaken the test authority checks.
3. **Separately certified sidecar**: a pinned, signed sidecar supervisor pointing at an older Staging checkout would require explicit cross-root script/path/policy support, verified task identity and durable logs. Such support is **not currently certified** and must not be inferred from this PR.

The user can inspect the current task state without changing the repository:

\`\`\`powershell
Get-ScheduledTask -TaskPath "\" -TaskName "MAD4B Staging Auto Deploy" |
    Select-Object TaskName, State
Get-ScheduledTaskInfo -TaskPath "\" -TaskName "MAD4B Staging Auto Deploy" |
    Select-Object LastRunTime, LastTaskResult
\`\`\`

A successfully running watcher is only evidence for that process. An uninstalled Supervisor means cold-boot autonomous acceptance remains incomplete until the approved version is deployed and native reboot tests pass.

## Acceptance and failure injection

Source regressions: `node http-generic-api/test-staging-coldboot-recovery.mjs` from the repository root; additionally run existing `test-windows-staging-bootstrap-supervisor.mjs` and `autopilot-portable-staging/test/Test-AutonomousSupervisor.ps1` (native Windows PowerShell 5.1).

**A native Windows reboot is still required to certify behavior.** With separate approved Staging access, capture independent evidence for:

1. Cold logon with Docker closed, delayed Docker Engine, delayed WSL2, and missing network; no console leaks and no automatic Production or database writes.
2. Intermittent DNS failure for `auth.mad4b.com` and `github.com`; watcher remains alive, does not reuse stale SHA, and retries without requiring a fresh operator login.
3. GitHub authentication or eligibility denial after DNS recovers; no deploy, no cached approval, and bounded retry.
4. Docker Engine healthy but Compose stopped after reboot; previous source certificate must not mark services healthy. Restore only an exact eligible local Staging build, read back container health, certify anew.
5. Missing Supervisor; additive install succeeds with exact watcher identity, but fails closed for unexpected task command, user principal or path.
6. Reboot with disconnected removable drive and with the intended Windows user not logged on; report blocked rather than claiming service-independent operation.
7. Repeat restart, overlapping task triggers, and transient task failure; verify named mutexes, `IgnoreNew`, log continuity, rollback and task result readback.
8. Recovered DNS/network and stable Compose; require two clean watcher poll/sleep cycles, fresh `health-snapshot.json`, exact SHAs and supervisor acceptance. Native hardware/device-generation and Production status remain separate.

Windows Docker Desktop under an `Interactive` user task **requires user logon**. Boot-before-login or headless 24/7 operation requires a separately approved system-service/WSL architecture, not a hidden Scheduled Task.

**Release decision:** This source hardening does not supersede PR #8471's independent policy objections, exact-head owner approval or the NO-GO Production decision.
