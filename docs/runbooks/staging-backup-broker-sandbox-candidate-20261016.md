# Issue #8534 — Staging backup broker sandbox candidate

## What this stage delivers

A **disabled-by-default** Docker Compose overlay at
`http-generic-api/docker-compose.staging.backup-broker-preflight.yml`.
It introduces a credential-free, non-admin **host candidate**, not a
production-ready MariaDB broker, not the Broker core and not an authority.
The official `Auto-Deploy-Staging.ps1` does not include the overlay.

The opt-in profile `backup-broker-preflight` attaches only `runtime-db`
and the sidecar candidate to a **new Docker-internal network**. It preserves
the original Staging default network for the application. No DB port is
published to the host. The candidate uses non-root UID/GID 65534,
read-only root filesystem, all Linux capabilities dropped,
`no-new-privileges`, a PID and memory limit, no host volumes or
Docker socket, and no injected environment configuration.

The candidate simply emits an **uncertified** status and remains alive
for independent sandbox observation. It has no SQL client, credentials,
signing private/public key, audit root, operational Broker code, or HTTP/MCP
route. No signer or DBA privileges can be obtained from this package.

## Source and host checks (do not activate the profile)

```powershell
$repo = 'M:\Users\Nagy\Repo\multi-business-multi-role-growth-intelligence-os'
node "$repo\local-connector\test-staging-backup-broker-candidate-profile.mjs"
node "$repo\local-connector\test-staging-backup-db-broker-host-discovery.mjs"
$api = "$repo\http-generic-api"
docker compose -f "$api\docker-compose.yml" `
  -f "$api\docker-compose.staging.yml" `
  -f "$api\docker-compose.staging.windows-service.yml" `
  -f "$api\docker-compose.staging.backup-broker-preflight.yml" `
  --env-file "$api\.env.staging" `
  --profile backup-broker-preflight config --quiet
```

The configuration check is read-only. The optional profile is **not**
part of the standard Staging deployment. A future operator-approved
sandbox rollout must first explicitly review the network change because
connecting `runtime-db` to the internal-only network may recreate the
existing database container.

## Acceptance and non-authority boundary

The host discovery script checks the observed container security posture
before labelling a running candidate's sandbox as observed. On a
two-network runtime-db it continues to require membership of the
original Staging network. Its `broker_operationally_certified`,
`owner_operation_approved` and `db_admin_operation_authorized`
must **always be false**, even after successful sandbox checks. Exit 2
is expected.

The following **remain independently blocked**: a measured Broker
binary/runtime identity and OS ACL, actual independently attested
Staging-only `runtime-db:3306` administrative endpoint, a dedicated
`backup_grant_service` account and isolated secret custody,
a separately pinned Ed25519 owner operation verification key,
trusted immutable audit custody, and a one-shot cryptographically signed
grant/census/revoke plan. GitHub's source-head review is not such a
signature. The credential-free host candidate cannot satisfy these.

No `CREATE USER`, `GRANT`, `DROP USER`, policy census, encrypted
backup, isolated restore, OA/MC fixtures or Production mutation is
authorized by this source change.

**Deployment state of this PR:** source-only, not activated. All live
Staging rollout must go through a separately approved release and
post-deploy certification, without bypassing the established DBA
execution safety boundary.
