# Staging Backup Broker: candidate discovery vs operational authority

Tracking: #8534, #8640. **Source-only change.** Exact base: main
`08560efad01f17320a69bd78812636cc49dbd8ee`.

## Live input driving the correction

On the certified *host topology* for `DESKTOP-91FDEFP`, the Staging app was
still serving `7ade100bd65f4d8bed98fa16fed16f0a501ae5bb`. All five
containers were healthy and the five persistent mounts were identified.
The Windows service `Mad4B-Staging-Backup-Db-Broker` was installed but
`Stopped`/`Manual`. Canonical read-only host discovery returned
`topology_observed=true`, and trust discovery returned
`host_topology_observed=true`, both with
`broker_operationally_certified=false`. The old trust wrapper set
`broker_candidate_running` from `broker_candidate_found`; this was an
ambiguous observation, not a stopped-service bypass or proof of DBA access.

## Read-only contract and interpretation

1. `staging-backup-db-broker-host-discovery.mjs` returns
   `broker_candidate_found` (SCM service or isolated Docker candidate exists)
   and **separately** `broker_candidate_running` (observed SCM service
   running or candidate container running). Both are **untrusted host
   observations**, not cryptographic attestations.
2. `Inspect-StagingBackupBrokerTrustReadiness.ps1` forwards both distinct
   fields from the canonical host report; it no longer copies `found`
   into `running`.
3. `staging-backup-db-broker-trust-readiness.mjs` reports both fields,
   `candidate_is_operational_broker=false`, and
   `BROKER_INERT_CANDIDATE_NOT_OPERATIONAL_SERVICE` whenever a candidate is
   *present*, regardless of its running state. `BROKER_DEDICATED_WINDOWS_SERVICE_NOT_RUNNING`
   remains when the SCM service is stopped. A running state can never
   override the independent trust blockers.
4. Both read-only discovery CLIs intentionally exit **2**, even if host
   topology is healthy. `broker_operationally_certified=false`,
   `db_admin_operation_authorized=false`, `owner_operation_approved=false`,
   `backup_executed=false`, `restore_executed=false` and
   `production_mutation=false` remain mandatory.
5. The `Mad4B-Staging-Backup-Db-Broker` Windows service is currently only an
   **inert SCM bootstrap**. Starting it, measuring its EXE, or fixing a label
   is **not** an operational Broker installation and cannot unlock backup.

## Source regression commands (Node 22, no external service)

Run from the repository root:

```sh
node local-connector/test-staging-backup-db-broker-host-discovery.mjs
node local-connector/test-staging-backup-db-broker-trust-readiness.mjs
node local-connector/test-staging-backup-broker-candidate-handoff.mjs
node local-connector/test-staging-backup-db-admin-broker.mjs
```

The new handoff regression checks five cases (no candidate, stopped/running
Windows service, stopped/running Docker candidate), CLI exit 2, and denial
of claimed owner, DBA, Backup, Restore and Production authority. Synthetic
test results are **not** live Staging acceptance.

## Operational Broker delivery dependency — NOT implemented by this branch

The existing `local-connector/staging-backup-db-admin-broker.mjs` is an
injection-only restricted SQL core. It is not registered as an HTTP, MCP,
arbitrary shell, service command or live DBA client. Independently required:

- A separately approved, signed, OS-isolated Staging-only operational Broker
  and measured running process identity, source/image/network/actual DB
  endpoint, binary digest, protected Windows ACL, and negative Production
  routing proof.
- Dedicated `backup_grant_service` MariaDB account and privileged credential
  storage **outside** the long-running app and Git; least-authority fixed SQL
  allowlist and temporary `backup_policy_reader` lifecycle only.
- Independently pinned and controlled Ed25519 Owner verification key,
  separately signed short-lived exact-plan/single-use approval, durable
  atomic replay ledger, externally verifiable immutable audit and key custody.
  GitHub `OWNER_ATTEST_SINGLE_OWNER` for *source review* does not replace
  a broker operation-signing key.
- Reviewed provider adapter integrating the existing one-shot broker factory,
  with enforced cleanup of the reader and its grants even after failure.
  No request-controlled `verified=true` field or self-signed JSON is trust.
- Only after separately authorized live reader provisioning/census/revoke:
  activate the approved Staging-only backup policy/destination, export an
  encrypted backup from the actual running Staging database, and verify
  **the exact same artifact** via isolated restore before any fixture or
  app-only Staging upgrade.
- No `docker compose up/down`, `Start-Service`, SQL/GRANT, migration, image
  swap, key generation, Provider/Cloudflare or Production operation is
  authorized or performed by this source branch.

Keep Issue #8534 and #8640 open. Current static release-cut readiness does not
certify the serving old image; Production promotion remains **NO-GO**.
