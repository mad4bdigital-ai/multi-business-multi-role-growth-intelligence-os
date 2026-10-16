# Issue #8534 — zero-impact Staging Backup Broker candidate

## Operational boundary

The PR #8555 candidate is **not an operational MariaDB Broker**.
This revision makes the optional container a **network-disconnected probe**:
`network_mode: none`, no runtime-db override, no declared network, no DB
dependency, no published port, no environment secret, no host volume or
Docker socket. Root filesystem is read-only; it runs as UID/GID 65534,
with every capability dropped and privilege escalation disabled.

The regular `Auto-Deploy-Staging.ps1` remains unchanged and excludes
`docker-compose.staging.backup-broker-preflight.yml`.
The profile is opt-in. It does not attach MariaDB to another network,
and cannot establish a MariaDB endpoint or privileged Broker authority.

## Required read-only host preflight

```powershell
$repo = 'M:\Users\Nagy\Repo\multi-business-multi-role-growth-intelligence-os'
$sha = '<exact certified Staging main SHA>'
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File "$repo\autopilot-portable-staging\Inspect-StagingBackupBrokerZeroDbImpact.ps1" `
  -RepositoryPath $repo -ExpectedCommit $sha
node "$repo\local-connector\test-staging-backup-broker-candidate-profile.mjs"
node "$repo\local-connector\test-staging-backup-db-broker-host-discovery.mjs"
```

Exit 0 from the first command certifies **configuration parity ONLY**:
all existing Compose services and networks unchanged; candidate has no
network, ports, volumes or independent DBA privileges; live runtime-db
is healthy, on its original network with no published DB port; exact
app source SHA matches; no candidate is running. Exit 2 is fail-closed.
The script never creates, starts, stops or connects Docker resources,
and never reads database credentials or executes SQL.

## Future optional sandbox exercise (separate operator approval)

After source-head CI, owner review and merge, an operator can explicitly
approve a **Staging-only inert probe**, not DBA access. Before any
activation, verify the exact deployed SHA, run the read-only preflight,
record live DB container ID / health / network and local app health. With
explicit authorization for the inert candidate only, run an opt-in
`docker compose --profile backup-broker-preflight up -d --no-deps backup-db-broker`
using the three official Staging Compose files **plus** this overlay.
Then inspect only the new container's security and `NetworkMode=none`,
verify the DB container ID/network unchanged and app health, and remove
only the probe with Compose `stop` and `rm`. Stop and report rather
than modifying `runtime-db` on any mismatch.

Do **not** activate the old overlay that attached the DB to a new network.
Do not run unqualified `docker compose up` for this phase.

## What this cannot authorize

Even after a successful inert probe, discovery output must keep
`broker_operationally_certified=false`,
`owner_operation_approved=false`,
`db_admin_operation_authorized=false`.
A separate DBA endpoint trust boundary, OS/service identity, privileged
secret custody, Ed25519 per-operation owner signature and independent
immutable audit are still required. GitHub source approval is **not**
an operation signature. No CREATE/GRANT/DROP, credential exposure, DB
write, real backup, isolated restore, OA/MC fixtures or Production
change is authorized by this candidate or its preflight.
