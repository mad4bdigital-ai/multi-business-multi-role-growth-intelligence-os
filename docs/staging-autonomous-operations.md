# Staging autonomous acceptance supervisor

## What is implemented

The independent `Staging-AutonomousSupervisor.ps1` consumes read-only staging evidence and issues `logs/autonomous-acceptance.json` every 60 seconds. Operational readiness requires:

- The exact approved Windows watcher action, principal, repository, and one of two explicitly approved working directories (the Staging checkout root or its `autopilot-portable-staging` directory);
- A running watcher with **two complete, clean poll/sleep cycles** from the current task run, and a fresh poll;
- A fresh, healthy staging snapshot with no active startup/deployment lease;
- Matching exact desired, deployed, certified and runtime commit SHA, with ready certification;
- No forbidden deploy flags.

An invalid/absent receipt fails closed. `accepted=true` means **operational acceptance of these checks only**. It is not an independently verified immutable runtime-content attestation. The field `full_runtime_integrity_attested=false` prevents confusing these two certificates.

## Safe self-healing

If the *existing* watcher task has state `Ready`, correct identity, approved command, and there is no active lease, the supervisor may call only `Start-ScheduledTask` for that same task. It never registers or rewrites the watcher itself, updates Git, deploys Docker, writes a database, changes provider credentials, or touches Production/DNS. Recovery is limited to **3 starts per rolling 24 hours**, with **15 minutes** between starts, and attempts are persisted before the action. It does not forcibly stop or restart a running/stale watcher.

If the watcher action differs from its expected checkout or if evidence cannot be parsed, the supervisor blocks instead of repairing. Recovery remains scoped to the current interactive Windows user. Docker Desktop is still not a service-independent boot architecture.

## Installing on an existing Staging host without changing existing tasks

The safe installer is additive:

```powershell
cd M:\Users\Nagy\Repo\multi-business-multi-role-growth-intelligence-os\autopilot-portable-staging
.\Install-AutonomousSupervisorTask.ps1 -RepositoryPath M:\Users\Nagy\Repo\multi-business-multi-role-growth-intelligence-os -Activate
```

Run only after the implementation is reviewed, merged and present on the local checkout. It verifies the existing watcher task action and **does not overwrite the existing Auto Deploy, Health Monitor, Docker Bootstrap, or tunnel configuration**. A new full installation can also register the supervisor through `Install-AutoDeployTask.ps1`; avoid re-running that broader installer on an already configured host without separately reviewing its parameters.

`-Activate` requests an immediate launch. Without it, the new task starts at the next user logon. The task requires an interactive Windows session. An offline Windows device cannot install itself from a GitHub PR.

## Evidence and tests

- `autonomous-acceptance.json`: current acceptance, reason codes, task/run evidence and last recovery disposition.
- `autonomous-supervisor-state.json`: cooldown and recovery attempts.
- `autonomous-supervisor-heartbeat.json`: periodic heartbeat with sanitized fields.
- `test/Test-AutonomousSupervisor.ps1`: Windows PowerShell 5.1 parse checks, policy invariants and synthetic task/continuity/drift/lease tests.
- `.github/workflows/staging-autonomous-supervisor.yml`: isolated Windows pull-request smoke workflow.

All output files are untracked in the existing staging log directory.

## Non-goals and follow-up gates

This phase does not install a Windows service or guarantee Docker Desktop can start before user logon; achieving service-independent operation requires a separate OS/runtime design. It does not perform automatic schema grants, migrations, arbitrary Docker rebuilds, fail-open certification, or self-authorize provider mutations. `runtime_artifact_content_unverified` must be resolved by the existing exact immutable-artifact verification, not suppressed.

Do not merge on syntax checks alone: require a Windows task-readback test on the intended machine, an on-host continuity test, and separate confirmation that the current Staging runtime remains healthy.
