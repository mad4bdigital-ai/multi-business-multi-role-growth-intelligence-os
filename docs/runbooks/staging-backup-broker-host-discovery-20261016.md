# Issue #8534 — Independent Staging Backup Broker: host discovery

This is a **read-only discovery gate**, not an authorization, installation,
backup, migration, grant or attestation of an independent OS process. It
provides a reproducible inventory before the DBA operator takes action.

## Operator usage (Windows Staging only)

Run from the authorized Staging device:

```powershell
$repo = 'M:\Users\Nagy\Repo\multi-business-multi-role-growth-intelligence-os'
& "$repo\autopilot-portable-staging\Inspect-StagingBackupBrokerPrerequisites.ps1" `
  -RepositoryPath $repo `
  -ExpectedCommit '4e13688c12b7406e3b65d231bc125e0d3b91ce9c'
```

Exit `2` is expected. The output is a single redacted JSON record:
`topology_observed`, `broker_candidate_found`, and blockers.
It **never** emits `broker_operationally_certified=true` and does
not expose SQL, environment variables, passwords, secret paths or tokens.
This tool observes *candidate* Windows service or Docker sidecar names;
undiscovered names are not proof of absence.

## Directly measured in the Oct 16, 2026 Staging topology

- Docker private network: `http-generic-api_default`, `172.18.0.0/16`.
- MariaDB: `runtime-db:3306`, without a host-published DB port.
- App, Redis and three MariaDB containers are on the Staging network.
- No dedicated Backup DB Broker process found in the inspected service/task
  inventory at the time of the report.
- Published app port `127.0.0.1:8080` is **not** a DBA endpoint.

A Windows-host service cannot rely on Docker-internal `runtime-db` DNS.
A future isolated sidecar requires a security-reviewed network design,
not just attaching to every Staging database network. Do not publish
`3306`, expose a generic remote SQL route, use root/runtime_app or infer
OS isolation from a caller-provided JSON field.

## Separate operational acceptance still required

1. Host operator verifies an isolated **Staging-only** process identity,
   runtime binary digest, restrictions, runtime/device trust and deny tests.
2. Independently establish a restricted real MariaDB admin principal,
   credential custody, exact endpoint/network measurement, ACL and revocation.
3. Independently pin the Ed25519 owner operation public key. No signing
   private key can be fabricated from GitHub source review.
4. Prove private replay ledger, redacted audit and external immutable
   evidence custody.
5. Receive a separate short-lived **one-operation signed plan** before any
   `CREATE USER`, four `GRANT SELECT`, census, `DROP USER` and readback.
6. Only afterward separately authorize fresh encrypted backup, same-artifact
   isolated restore and OA/MC 18 live cases.

The `OWNER_ATTEST_SINGLE_OWNER` on PR #8551 was **source approval only**.
No new approval for a privileged DB operation is assumed. Production remains
blocked, and there are no QA fixtures or real backup/restore effects.

## Regression test

```sh
node local-connector/test-staging-backup-db-broker-host-discovery.mjs
```

The test is synthetic. Even an all-green discovery result is not an
independently signed operational certificate.
