# Issue #8534 — Independent Staging Broker trust-boundary readiness

## Scope and evidence strength

This release adds a **read-only** Windows host service readiness observation,
not an installed MariaDB DBA Broker, not an operating-system certificate,
not a key-pinning or immutable-audit provider, and not an executable grant.
No HTTP route, credential loader, SQL client or Docker network is created.
The inert `network_mode: none` candidate from PR #8557 remains separate and
**can never connect to MariaDB or act as a privileged Broker**.

## Run from the Staging host, exact certified release

```powershell
$repo = 'M:\Users\Nagy\Repo\multi-business-multi-role-growth-intelligence-os'
$sha = '<currently deployed and certified Staging commit SHA>'
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File "$repo\autopilot-portable-staging\Inspect-StagingBackupBrokerTrustReadiness.ps1" `
  -RepositoryPath $repo -ExpectedCommit $sha
```

This command invokes the existing read-only Staging topology discovery,
checks the exact in-container SHA and device, inspects the named Windows
service `Mad4B-Staging-Backup-Db-Broker` if present, and observes its
running state, PID, account type and executable image SHA-256. The digest
is a **measurement only**, never independent binary, script, owner-key or
OS ACL attestation. It does not reveal service executable paths or account
identifiers in JSON, or open key, database or credential files.

Exit **2 is required**: this source-level diagnostic cannot grant trust.
Outputs are redacted, explicit blockers and always
`broker_operationally_certified=false`,
`owner_operation_approved=false`,
`db_admin_operation_authorized=false`,
`backup_executed=false` and `production_mutation=false`.
Malformed input and missing service fail closed.

## Authority gates not satisfied by host observations

A separately approved operator must, in a later change:

1. Establish an actual isolated Staging-only broker service identity and
   verify service executable **and loaded script** hashes, dedicated OS
   principal, file ACL, startup policy, remote control paths and deny tests.
2. Choose an independently attested network/endpoint design for a real
   `runtime-db:3306` Staging DBA connection. The disconnected inert probe
   has no endpoint. Do not publish the DB port or attach all DBs by default.
3. Provision a narrowly scoped `backup_grant_service` MariaDB identity
   under independently controlled credential custody. Never use root,
   runtime_app, the web-app pool or generic remote SQL routes.
4. Pin a separately controlled Ed25519 **public** verifier in the actual
   broker service, with owner private signing material never handled
   by the web app, ChatGPT, GitHub source review or these scripts.
5. Use durable one-shot replay reservation plus independent immutable
   audit custody, an operator-validated fail-closed disaster path and a
   signed, bounded exact plan before reader CREATE/GRANT/census/DROP.
6. Only after a true verified reader census, separately authorize
   encrypted backup and same-artifact isolated restore. Complete the
   18 OA/MC live acceptance cases before any production discussion.

Neither `OWNER_ATTEST_SINGLE_OWNER` for a source SHA nor a service's
running state confers the separate Ed25519 operation signature.
No Production mutation is permitted.

## Verified at 2026-10-16 Staging

On `DESKTOP-91FDEFP`, SHA
`7e70a6b62b189b3962596f3b8cec4a4dfb5f38eb`:
`observed_exact_staging_release=true` and
`host_topology_observed=true`, but
`dedicated_service_observed=false`. The command deliberately returned
exit 2 and reported eight unmet trust prerequisites. The existing
synthetic Broker core and file-state tests passed without real DB writes.

## Regression

```powershell
node "$repo\local-connector\test-staging-backup-db-broker-trust-readiness.mjs"
node "$repo\local-connector\test-staging-backup-db-admin-broker.mjs"
node "$repo\local-connector\test-staging-backup-db-broker-file-state.mjs"
```

All tests are synthetic. A running service and arbitrary caller-supplied
`isolated_staging_process_attested`, signature or audit flags must not
set any operational authority to true.
